use std::process::Child as StdChild;
use std::sync::{Arc, Mutex};

#[derive(Debug)]
pub struct CodexLink {
    pub ws_url: String,
    pub thread_id: String,
    pub cwd: String,
    serve_child: Arc<Mutex<Option<StdChild>>>,
}

impl CodexLink {
    pub fn new(
        ws_url: String,
        thread_id: String,
        cwd: String,
        serve_child: StdChild,
    ) -> Self {
        Self {
            ws_url,
            thread_id,
            cwd,
            serve_child: Arc::new(Mutex::new(Some(serve_child))),
        }
    }

    pub fn serve_handle(&self) -> Arc<Mutex<Option<StdChild>>> {
        Arc::clone(&self.serve_child)
    }

    pub fn kill_serve(&self) {
        if let Ok(mut guard) = self.serve_child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}
