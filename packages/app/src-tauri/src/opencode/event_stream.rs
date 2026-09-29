//! OpenCode `/event` SSE stream reader.

use super::event_map::{map_opencode_event, OpenCodeMapperState};
use crate::protocol::AgentEvent;
use parking_lot::Mutex;
use std::io::{BufRead, BufReader};
use std::sync::atomic::AtomicU64;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tokio::sync::broadcast;

pub fn spawn_event_reader(
    base_url: String,
    session_id: String,
    tx: broadcast::Sender<AgentEvent>,
    turn_counter: Arc<AtomicU64>,
) -> thread::JoinHandle<()> {
    let mapper_state = Arc::new(Mutex::new(OpenCodeMapperState::default()));
    thread::Builder::new()
        .name("opencode-sse".into())
        .spawn(move || {
            let url = format!("{}/event", base_url.trim_end_matches('/'));
            loop {
                let Ok(response) = ureq::get(&url).timeout(Duration::from_secs(3600)).call() else {
                    thread::sleep(Duration::from_secs(2));
                    continue;
                };
                let reader = BufReader::new(response.into_reader());
                for line in reader.lines().map_while(Result::ok) {
                    let Some(data) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let data = data.trim();
                    if data.is_empty() {
                        continue;
                    }
                    let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
                        continue;
                    };
                    let mut state = mapper_state.lock();
                    for event in map_opencode_event(&value, &session_id, &turn_counter, &mut state) {
                        let _ = tx.send(event);
                    }
                }
                thread::sleep(Duration::from_secs(1));
            }
        })
        .expect("spawn opencode sse")
}
