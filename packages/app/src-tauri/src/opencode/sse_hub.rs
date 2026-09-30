//! One SSE subscription per `(base_url, directory)` fan-out to panes and AgentEvent mapping.

use super::event_map::{map_opencode_event, OpenCodeMapperState};
use super::sse_parse::parse_sse_data_line;
use crate::protocol::AgentEvent;
use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::io::BufRead;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast;

const RECONNECT_BASE_MS: u64 = 500;
const RECONNECT_MAX_MS: u64 = 15_000;
const DELTA_BATCH_MS: u64 = 12;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct StreamKey {
    base_url: String,
    directory: String,
}

#[derive(Clone)]
struct PaneSink {
    pane_id: String,
    server_id: String,
    session_id: String,
    agent_tx: broadcast::Sender<AgentEvent>,
    turn_counter: Arc<AtomicU64>,
    mapper_state: Arc<Mutex<OpenCodeMapperState>>,
}

struct StreamState {
    panes: Vec<PaneSink>,
    app: AppHandle,
}

static HUB: Mutex<Option<HashMap<StreamKey, Arc<Mutex<StreamState>>>>> = Mutex::new(None);
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);

pub fn bind_app(app: AppHandle) {
    *APP.lock() = Some(app);
}

pub fn app_handle() -> Option<AppHandle> {
    APP.lock().clone()
}

fn hub_map() -> &'static Mutex<Option<HashMap<StreamKey, Arc<Mutex<StreamState>>>>> {
    &HUB
}

pub fn server_id_for_base(base_url: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    base_url.hash(&mut hasher);
    format!("oc-{:x}", hasher.finish())
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenCodeEventPayload {
    pub pane_id: String,
    pub server_id: String,
    pub event: serde_json::Value,
}

pub struct SseSubscription {
    key: StreamKey,
    pane_id: String,
}

impl Drop for SseSubscription {
    fn drop(&mut self) {
        let pane_id = self.pane_id.clone();
        let key = self.key.clone();
        let mut guard = hub_map().lock();
        if let Some(map) = guard.as_mut() {
            if let Some(state) = map.get(&key) {
                let mut inner = state.lock();
                inner.panes.retain(|p| p.pane_id != pane_id);
            }
            let empty = map
                .get(&key)
                .map(|s| s.lock().panes.is_empty())
                .unwrap_or(true);
            if empty {
                map.remove(&key);
            }
        }
    }
}

impl SseSubscription {
    pub fn release(self) {
        let mut guard = hub_map().lock();
        if let Some(map) = guard.as_mut() {
            if let Some(state) = map.get(&self.key) {
                let mut inner = state.lock();
                inner.panes.retain(|p| p.pane_id != self.pane_id);
            }
            let empty = map
                .get(&self.key)
                .map(|s| s.lock().panes.is_empty())
                .unwrap_or(true);
            if empty {
                map.remove(&self.key);
            }
        }
    }
}

pub fn subscribe_pane(
    app: AppHandle,
    pane_id: String,
    base_url: String,
    directory: String,
    session_id: String,
    agent_tx: broadcast::Sender<AgentEvent>,
    turn_counter: Arc<AtomicU64>,
) -> SseSubscription {
    let key = StreamKey {
        base_url: base_url.clone(),
        directory: directory.clone(),
    };
    let server_id = server_id_for_base(&base_url);
    let sink = PaneSink {
        pane_id: pane_id.clone(),
        server_id,
        session_id,
        agent_tx,
        turn_counter,
        mapper_state: Arc::new(Mutex::new(OpenCodeMapperState::default())),
    };

    let mut guard = hub_map().lock();
    if guard.is_none() {
        *guard = Some(HashMap::new());
    }
    let map = guard.as_mut().expect("hub map");
    let state = map.entry(key.clone()).or_insert_with(|| {
        let state = Arc::new(Mutex::new(StreamState {
            panes: Vec::new(),
            app: app.clone(),
        }));
        spawn_reader_thread(key.clone(), Arc::clone(&state));
        state
    });
    state.lock().panes.push(sink);
    SseSubscription { key, pane_id }
}

fn spawn_reader_thread(key: StreamKey, state: Arc<Mutex<StreamState>>) {
    thread::Builder::new()
        .name("opencode-sse-hub".into())
        .spawn(move || reader_loop(key, state))
        .expect("spawn opencode sse hub");
}

fn reader_loop(key: StreamKey, state: Arc<Mutex<StreamState>>) {
    let mut backoff_ms = RECONNECT_BASE_MS;
    loop {
        if state.lock().panes.is_empty() {
            thread::sleep(Duration::from_millis(250));
            if state.lock().panes.is_empty() {
                return;
            }
        }

        let url = super::client::with_directory_query(
            &format!("{}/event", key.base_url.trim_end_matches('/')),
            Some(&key.directory),
        );

        let connected = match ureq::get(&url).timeout(Duration::from_secs(3600)).call() {
            Ok(resp) => resp,
            Err(_) => {
                emit_synthetic_all(&state, &key.directory, "loomria.opencode.disconnected");
                thread::sleep(Duration::from_millis(backoff_ms));
                backoff_ms = (backoff_ms * 2).min(RECONNECT_MAX_MS);
                continue;
            }
        };

        emit_synthetic_all(&state, &key.directory, "loomria.opencode.connected");
        backoff_ms = RECONNECT_BASE_MS;

        let reader = std::io::BufReader::new(connected.into_reader());
        let mut pending_deltas: Vec<OpenCodeEventPayload> = Vec::new();
        let mut last_flush = Instant::now();

        for line in reader.lines().map_while(Result::ok) {
            if state.lock().panes.is_empty() {
                return;
            }
            let Some(wire) = parse_sse_data_line(&line) else {
                continue;
            };

            let event_type = wire.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let is_delta = event_type == "message.part.delta";

            fan_out_raw(&state, &wire, is_delta, &mut pending_deltas, &mut last_flush);

            let panes: Vec<PaneSink> = state.lock().panes.clone();
            for pane in panes {
                let mut mapper = pane.mapper_state.lock();
                for agent_event in map_opencode_event(
                    &wire,
                    &pane.session_id,
                    &pane.turn_counter,
                    &mut mapper,
                ) {
                    let _ = pane.agent_tx.send(agent_event);
                }
            }
        }

        flush_pending(&state, &mut pending_deltas);
        emit_synthetic_all(&state, &key.directory, "loomria.opencode.disconnected");
        thread::sleep(Duration::from_millis(backoff_ms));
        backoff_ms = (backoff_ms * 2).min(RECONNECT_MAX_MS);
    }
}

fn fan_out_raw(
    state: &Arc<Mutex<StreamState>>,
    wire: &serde_json::Value,
    is_delta: bool,
    pending: &mut Vec<OpenCodeEventPayload>,
    last_flush: &mut Instant,
) {
    let (app, panes) = {
        let guard = state.lock();
        (guard.app.clone(), guard.panes.clone())
    };
    if !is_delta {
        flush_pending(state, pending);
        *last_flush = Instant::now();
    }
    for pane in panes {
        let payload = OpenCodeEventPayload {
            pane_id: pane.pane_id.clone(),
            server_id: pane.server_id.clone(),
            event: wire.clone(),
        };
        if is_delta {
            pending.push(payload);
        } else {
            let _ = app.emit("opencode://event", &payload);
        }
    }
    if !pending.is_empty() && last_flush.elapsed() >= Duration::from_millis(DELTA_BATCH_MS) {
        flush_pending(state, pending);
        *last_flush = Instant::now();
    }
}

fn flush_pending(state: &Arc<Mutex<StreamState>>, pending: &mut Vec<OpenCodeEventPayload>) {
    if pending.is_empty() {
        return;
    }
    let app = state.lock().app.clone();
    for payload in pending.drain(..) {
        let _ = app.emit("opencode://event", &payload);
    }
}

fn emit_synthetic_all(state: &Arc<Mutex<StreamState>>, directory: &str, event_type: &str) {
    let guard = state.lock();
    for pane in &guard.panes {
        let wire = serde_json::json!({
            "id": format!("loomria-{}", pane.pane_id),
            "type": event_type,
            "properties": { "directory": directory },
        });
        let payload = OpenCodeEventPayload {
            pane_id: pane.pane_id.clone(),
            server_id: pane.server_id.clone(),
            event: wire,
        };
        let _ = guard.app.emit("opencode://event", &payload);
    }
}

/// Entry point for protocol adapters and native panes.
pub fn spawn_event_reader(
    app: AppHandle,
    pane_id: String,
    base_url: String,
    directory: String,
    session_id: String,
    tx: broadcast::Sender<AgentEvent>,
    turn_counter: Arc<AtomicU64>,
) -> SseSubscription {
    subscribe_pane(app, pane_id, base_url, directory, session_id, tx, turn_counter)
}

