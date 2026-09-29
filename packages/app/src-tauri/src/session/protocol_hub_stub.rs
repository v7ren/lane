//! Test-build stub: avoids linking Tauri emit paths into the lib test executable on Windows.



use crate::protocol::{

    AgentEvent, AgentEventEnvelope, Capabilities, Endpoint, ProtocolAdapter, AGENT_EVENT_CHANNEL,

};

use parking_lot::Mutex;

use std::collections::{HashMap, VecDeque};

use std::sync::Arc;



pub struct ProtocolHub {

    panes: Mutex<HashMap<String, StubPane>>,

}



struct StubPane {

    capabilities: Capabilities,

    history: VecDeque<AgentEventEnvelope>,

    seq: u64,

}



impl ProtocolHub {

    pub fn new() -> Arc<Self> {

        Arc::new(Self {

            panes: Mutex::new(HashMap::new()),

        })

    }



    pub fn bind_app(self: &Arc<Self>, _app: tauri::AppHandle, _session_states: Arc<crate::session::SessionStateStore>) {}



    pub fn unregister(self: &Arc<Self>, pane_id: &str) {

        self.panes.lock().remove(pane_id);

    }



    pub fn has_session(self: &Arc<Self>, pane_id: &str) -> bool {

        self.panes.lock().contains_key(pane_id)

    }



    pub fn register(

        self: &Arc<Self>,

        pane_id: String,

        adapter: Arc<dyn ProtocolAdapter>,

        endpoint: Endpoint,

    ) -> Result<(), String> {

        let session = adapter.connect(endpoint).map_err(|e| e.to_string())?;

        let caps = session.capabilities();

        self.panes.lock().insert(

            pane_id,

            StubPane {

                capabilities: caps,

                history: VecDeque::new(),

                seq: 0,

            },

        );

        Ok(())

    }



    pub fn capabilities(self: &Arc<Self>, pane_id: &str) -> Capabilities {

        self.panes

            .lock()

            .get(pane_id)

            .map(|p| p.capabilities.clone())

            .unwrap_or_else(Capabilities::none)

    }



    pub fn history(self: &Arc<Self>, _pane_id: &str) -> Vec<AgentEventEnvelope> {

        Vec::new()

    }



    pub fn protocol_child_pid(self: &Arc<Self>, _pane_id: &str) -> Option<u32> {

        None

    }



    pub fn send_prompt(self: &Arc<Self>, pane_id: &str, _text: String) -> Result<(), String> {

        if self.has_session(pane_id) {

            Ok(())

        } else {

            Err(format!("no protocol session for pane {pane_id}"))

        }

    }



    pub fn respond_approval(

        self: &Arc<Self>,

        pane_id: &str,

        _approval_id: &str,

        _decision: &str,

    ) -> Result<(), String> {

        if self.has_session(pane_id) {

            Ok(())

        } else {

            Err(format!("no protocol session for pane {pane_id}"))

        }

    }



    pub fn cancel_turn(self: &Arc<Self>, pane_id: &str) -> Result<(), String> {

        if self.has_session(pane_id) {

            Ok(())

        } else {

            Err(format!("no protocol session for pane {pane_id}"))

        }

    }



    pub fn ingest_test_event(self: &Arc<Self>, pane_id: &str, event: AgentEvent) {

        let mut panes = self.panes.lock();

        if let Some(pane) = panes.get_mut(pane_id) {

            pane.seq += 1;

            pane.history.push_back(AgentEventEnvelope {

                pane_id: pane_id.to_string(),

                seq: pane.seq,

                event,

            });

        }

    }

}



pub fn agent_error_message(err: crate::protocol::AgentError) -> String {

    err.to_string()

}



#[allow(dead_code)]

pub const AGENT_EVENT_CHANNEL_TEST: &str = AGENT_EVENT_CHANNEL;


