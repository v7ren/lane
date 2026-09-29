//! Status heuristics for a pane — looks at recent scrollback to decide if
//! the agent is waiting on input, idle, etc.

use super::ansi::strip_ansi;
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaneStatus {
    Running,
    WaitingInput,
    Idle,
    Error,
}

impl PaneStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            PaneStatus::Running => "running",
            PaneStatus::WaitingInput => "waiting_input",
            PaneStatus::Idle => "idle",
            PaneStatus::Error => "error",
        }
    }
}

/// Generic interactive prompts when a manifest declares no `[[attention]]` rules.
static DEFAULT_PROMPT_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    [
        r"(?i)\b(y/n)\b",
        r"(?i)\b(yes/no)\b",
        r"\(Y/n\)",
        r"\(y/N\)",
        r"(?i)press enter",
        r"(?i)continue\?",
        r"[>?›»]\s*$",
        r":\s*$",
    ]
    .into_iter()
    .map(|p| Regex::new(p).expect("valid default prompt regex"))
    .collect()
});

/// Returns true if the recent scrollback (typically last 1–3 lines) looks
/// like the agent is waiting on user input.
pub fn looks_like_prompt(text: &str) -> bool {
    looks_like_prompt_with_patterns(text, &DEFAULT_PROMPT_PATTERNS)
}

pub fn looks_like_prompt_for_agent(
    catalog: &crate::agents::AgentCatalog,
    agent_id: &str,
    text: &str,
) -> bool {
    let patterns = prompt_patterns_for(catalog, agent_id);
    looks_like_prompt_with_patterns(text, &patterns)
}

fn prompt_patterns_for(
    catalog: &crate::agents::AgentCatalog,
    agent_id: &str,
) -> Vec<Regex> {
    match catalog.get(agent_id) {
        Some(manifest) if !manifest.attention_regexes.is_empty() => {
            let mut patterns = DEFAULT_PROMPT_PATTERNS.clone();
            patterns.extend(manifest.attention_regexes.iter().cloned());
            patterns
        }
        _ => DEFAULT_PROMPT_PATTERNS.clone(),
    }
}

fn looks_like_prompt_with_patterns(text: &str, patterns: &[Regex]) -> bool {
    let clean = strip_ansi(text);
    let tail: String = clean
        .lines()
        .filter(|l| !l.trim().is_empty())
        .rev()
        .take(5)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    patterns.iter().any(|re| re.is_match(&tail))
}

/// OpenCode-style TUI menus — driven from manifest `[[attention]]` regexes.
pub fn looks_like_opencode_tui_menu(
    catalog: &crate::agents::AgentCatalog,
    text: &str,
) -> bool {
    looks_like_prompt_for_agent(catalog, "opencode", text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::AgentCatalog;

    #[test]
    fn detects_opencode_numbered_yes_no_menu() {
        let catalog = AgentCatalog::load();
        let text = "1. Yes\n2. No\n3. Type your own answer\n↑↓ select  enter submit  esc dismiss";
        assert!(looks_like_opencode_tui_menu(&catalog, text));
    }
}
