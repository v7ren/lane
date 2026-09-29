//! Process-tree teardown (Job Objects on Windows, process groups on Unix).

mod tree;

pub use tree::{
    assign_pid_to_pane_job, configure_unix_session, init_application_job, ProcessTree,
};
