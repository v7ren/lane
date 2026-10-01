//! While the Claude terminal (TUI) owns a session, the chat pane mirrors it: a tailer follows
//! Claude's session file and turns new records into transcript events, and the composer writes
//! into the terminal. Only one `claude` process owns the session at a time (see
//! docs/agent-gui-fix-plan.md, option C), so the two views can never drift apart.

use crate::protocol::claude_session_file::{session_path, SessionReplay};
use crate::protocol::{
    AgentError, AgentEvent, Capabilities, Endpoint, ProtocolAdapter, ProtocolSession,
};
use parking_lot::Mutex;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast;

const POLL_MS: u64 = 400;

type Write = Arc<dyn Fn(&str) -> Result<(), String> + Send + Sync>;
type Interrupt = Arc<dyn Fn() -> Result<(), String> + Send + Sync>;

pub struct ClaudeMirrorSession {
    events_tx: broadcast::Sender<AgentEvent>,
    stop: Arc<AtomicBool>,
    write: Write,
    interrupt: Interrupt,
}

impl Drop for ClaudeMirrorSession {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

impl ProtocolSession for ClaudeMirrorSession {
    fn capabilities(&self) -> Capabilities {
        Capabilities {
            chat: true,
            send_prompt: true,
            approvals: false,
            cancel: true,
            file_changes: false,
            attach_tui: true,
        }
    }

    fn subscribe(&self) -> broadcast::Receiver<AgentEvent> {
        self.events_tx.subscribe()
    }

    fn send_prompt(&self, text: String) -> Result<(), AgentError> {
        (self.write)(&text).map_err(AgentError::Protocol)
    }

    fn respond_to_approval(&self, _approval_id: &str, _decision: &str) -> Result<(), AgentError> {
        Err(AgentError::Unsupported(
            "answer permission prompts in the terminal".into(),
        ))
    }

    fn cancel_turn(&self) -> Result<(), AgentError> {
        (self.interrupt)().map_err(AgentError::Protocol)
    }
}

/// Registers an already-built session; `connect` can be called once.
pub struct OneShotAdapter(Mutex<Option<Box<dyn ProtocolSession>>>);

impl OneShotAdapter {
    pub fn new(session: Box<dyn ProtocolSession>) -> Arc<dyn ProtocolAdapter> {
        Arc::new(Self(Mutex::new(Some(session))))
    }
}

impl ProtocolAdapter for OneShotAdapter {
    fn protocol(&self) -> crate::agents::ProtocolKind {
        crate::agents::ProtocolKind::ClaudeStreamJson
    }

    fn connect(&self, _endpoint: Endpoint) -> Result<Box<dyn ProtocolSession>, AgentError> {
        self.0
            .lock()
            .take()
            .ok_or_else(|| AgentError::Connect("mirror session already taken".into()))
    }
}

/// Text to type into the terminal for a composer message: multi-line text is sent as a bracketed
/// paste so the TUI does not submit it line by line.
pub fn terminal_text(text: &str) -> String {
    if text.contains('\n') {
        format!("\x1b[200~{text}\x1b[201~")
    } else {
        text.to_string()
    }
}

/// Start mirroring `session_id`. Returns the session and the transcript so far (to seed the hub).
pub fn start(
    cwd: &str,
    session_id: &str,
    write: Write,
    interrupt: Interrupt,
) -> Result<(Box<dyn ProtocolSession>, Vec<AgentEvent>), AgentError> {
    let path = session_path(cwd, session_id)
        .ok_or_else(|| AgentError::Connect("invalid claude session id".into()))?;
    let mut replay = SessionReplay::default();
    let mut seed = Vec::new();
    let mut offset = 0u64;
    let mut pending = Vec::new();
    if let Ok(bytes) = std::fs::read(&path) {
        offset = bytes.len() as u64;
        pending = bytes;
        for line in take_lines(&mut pending) {
            seed.extend(replay.push_line(&line));
        }
    }
    let (tx, _rx) = broadcast::channel(256);
    let stop = Arc::new(AtomicBool::new(false));
    spawn_tailer(path, offset, pending, replay, tx.clone(), Arc::clone(&stop))?;
    Ok((
        Box::new(ClaudeMirrorSession {
            events_tx: tx,
            stop,
            write,
            interrupt,
        }),
        seed,
    ))
}

/// Remove and return the complete (newline-terminated) lines from `buf`, keeping any partial tail.
fn take_lines(buf: &mut Vec<u8>) -> Vec<String> {
    let Some(last_newline) = buf.iter().rposition(|b| *b == b'\n') else {
        return Vec::new();
    };
    let complete: Vec<u8> = buf.drain(..=last_newline).collect();
    String::from_utf8_lossy(&complete)
        .lines()
        .map(str::to_string)
        .collect()
}

fn spawn_tailer(
    path: PathBuf,
    mut offset: u64,
    mut pending: Vec<u8>,
    mut replay: SessionReplay,
    tx: broadcast::Sender<AgentEvent>,
    stop: Arc<AtomicBool>,
) -> Result<(), AgentError> {
    std::thread::Builder::new()
        .name("claude-mirror".into())
        .spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(POLL_MS));
                let Ok(mut file) = std::fs::File::open(&path) else {
                    continue;
                };
                let Ok(len) = file.metadata().map(|m| m.len()) else {
                    continue;
                };
                if len < offset {
                    // Rewritten from scratch (compaction): start over, keep what is already shown.
                    offset = 0;
                    pending.clear();
                }
                if len == offset || file.seek(SeekFrom::Start(offset)).is_err() {
                    continue;
                }
                let mut chunk = Vec::new();
                if file.read_to_end(&mut chunk).is_err() {
                    continue;
                }
                offset += chunk.len() as u64;
                pending.extend(chunk);
                for line in take_lines(&mut pending) {
                    for event in replay.push_line(&line) {
                        let _ = tx.send(event);
                    }
                }
            }
        })
        .map(|_| ())
        .map_err(|e| AgentError::Connect(format!("spawn mirror tailer: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_last_line_waits_for_its_newline() {
        let mut buf = b"{\"a\":1}\n{\"b\":".to_vec();
        assert_eq!(take_lines(&mut buf), vec![r#"{"a":1}"#.to_string()]);
        assert_eq!(buf, b"{\"b\":");
        buf.extend_from_slice(b"2}\n");
        assert_eq!(take_lines(&mut buf), vec![r#"{"b":2}"#.to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn multi_line_composer_text_is_pasted_not_typed() {
        assert_eq!(terminal_text("one line"), "one line");
        assert_eq!(terminal_text("a\nb"), "\x1b[200~a\nb\x1b[201~");
    }

    #[test]
    fn tailer_emits_records_appended_after_start() {
        use std::io::Write as _;
        let dir = std::env::temp_dir().join(format!("loomria-mirror-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        std::fs::write(&path, "").unwrap();
        let (tx, mut rx) = broadcast::channel(16);
        let stop = Arc::new(AtomicBool::new(false));
        spawn_tailer(path.clone(), 0, Vec::new(), SessionReplay::default(), tx, Arc::clone(&stop))
            .unwrap();
        let mut f = std::fs::OpenOptions::new().append(true).open(&path).unwrap();
        writeln!(
            f,
            r#"{{"type":"user","uuid":"u1","message":{{"content":"hello"}}}}"#
        )
        .unwrap();
        let mut seen = Vec::new();
        for _ in 0..20 {
            while let Ok(event) = rx.try_recv() {
                seen.push(event);
            }
            if seen.len() >= 3 {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        stop.store(true, Ordering::SeqCst);
        assert!(matches!(seen.first(), Some(AgentEvent::TurnStarted { .. })), "{seen:?}");
        assert!(seen
            .iter()
            .any(|e| matches!(e, AgentEvent::MessageCompleted { text, .. } if text == "hello")));
        let _ = std::fs::remove_dir_all(dir);
    }
}
