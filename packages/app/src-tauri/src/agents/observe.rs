//! Heuristic agent output observations (PTY scrollback text).

use crate::events::{PaneId, SystemEvent};

pub fn observe_agent_output(
    agent_type: &str,
    pane_id: &str,
    text: &str,
) -> Vec<SystemEvent> {
    let lower = text.to_ascii_lowercase();
    let mut observations = Vec::new();

    push_if(
        &mut observations,
        pane_id,
        agent_type,
        "agent_ready",
        &lower,
        text,
        &["ready", "waiting for input"],
    );
    push_if(
        &mut observations,
        pane_id,
        agent_type,
        "agent_idle",
        &lower,
        text,
        &["idle", "awaiting"],
    );
    push_if(
        &mut observations,
        pane_id,
        agent_type,
        "agent_blocked",
        &lower,
        text,
        &["blocked", "cannot continue", "need clarification"],
    );
    push_if(
        &mut observations,
        pane_id,
        agent_type,
        "permission_prompt",
        &lower,
        text,
        &["permission", "approval required", "allow this command"],
    );
    push_if(
        &mut observations,
        pane_id,
        agent_type,
        "command_started",
        &lower,
        text,
        &["running command", "$ ", "> "],
    );
    push_if(
        &mut observations,
        pane_id,
        agent_type,
        "command_finished",
        &lower,
        text,
        &["exit code", "process exited", "command finished"],
    );
    push_if(
        &mut observations,
        pane_id,
        agent_type,
        "test_failure",
        &lower,
        text,
        &["test failed", "tests failed", "failures:", "failed."],
    );
    push_if(
        &mut observations,
        pane_id,
        agent_type,
        "test_success",
        &lower,
        text,
        &["test result: ok", "tests passed", "all tests passed"],
    );
    push_if(
        &mut observations,
        pane_id,
        agent_type,
        "file_change_mention",
        &lower,
        text,
        &["modified ", "created ", "wrote ", "updated "],
    );
    push_if(
        &mut observations,
        pane_id,
        agent_type,
        "final_report",
        &lower,
        text,
        &["final answer", "summary:", "completed:"],
    );

    observations
}

fn push_if(
    observations: &mut Vec<SystemEvent>,
    pane_id: &str,
    agent_type: &str,
    observation: &str,
    lower: &str,
    original: &str,
    needles: &[&str],
) {
    if needles.iter().any(|needle| lower.contains(needle)) {
        observations.push(SystemEvent::AgentObservation {
            pane_id: PaneId(pane_id.to_string()),
            agent_type: agent_type.to_string(),
            observation: observation.to_string(),
            text: Some(original.trim().chars().take(500).collect()),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_permission_and_test_success() {
        let observations = observe_agent_output(
            "codex",
            "pane-1",
            "approval required before running command\ntest result: ok. 3 passed",
        );
        let names = observations
            .iter()
            .filter_map(|event| match event {
                SystemEvent::AgentObservation { observation, .. } => Some(observation.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert!(names.contains(&"permission_prompt"));
        assert!(names.contains(&"test_success"));
    }
}
