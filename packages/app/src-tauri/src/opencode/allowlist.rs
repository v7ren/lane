//! HTTP proxy allowlist generated from the pinned OpenAPI spec (`npm run gen:opencode`).

use once_cell::sync::Lazy;
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct AllowlistEntry {
    pub method: String,
    pub template: String,
}

static ENTRIES: Lazy<Vec<AllowlistEntry>> = Lazy::new(|| {
    serde_json::from_str(include_str!("../../opencode_allowlist.json"))
        .expect("parse opencode_allowlist.json")
});

pub fn allowlist_len() -> usize {
    ENTRIES.len()
}

pub fn is_allowed(method: &str, path: &str) -> bool {
    let method = method.to_uppercase();
    if !path.starts_with('/') {
        return false;
    }
    if path_contains_traversal(path) {
        return false;
    }
    let path_segments = split_path(path);
    ENTRIES.iter().any(|entry| {
        entry.method == method && template_matches(&entry.template, &path_segments)
    })
}

fn path_contains_traversal(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    if lower.contains("..") {
        return true;
    }
    if lower.contains("%2e%2e") || lower.contains("%2f") {
        // Encoded traversal or encoded slashes in path (query is separate).
        return true;
    }
    false
}

fn split_path(path: &str) -> Vec<&str> {
    path.trim()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect()
}

fn split_template(template: &str) -> Vec<&str> {
    template
        .trim()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect()
}

fn template_matches(template: &str, path_segments: &[&str]) -> bool {
    let template_segments = split_template(template);
    if template_segments.len() != path_segments.len() {
        return false;
    }
    for (tpl, actual) in template_segments.iter().zip(path_segments.iter()) {
        if tpl.starts_with('{') && tpl.ends_with('}') {
            if actual.is_empty() {
                return false;
            }
            continue;
        }
        if tpl != actual {
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_non_empty() {
        assert!(allowlist_len() > 50);
    }

    #[test]
    fn allows_session_list() {
        assert!(is_allowed("GET", "/session"));
        assert!(is_allowed("post", "/session"));
    }

    #[test]
    fn allows_parameterized_session_route() {
        assert!(is_allowed("GET", "/session/sess_abc123"));
        assert!(is_allowed("POST", "/session/sess_abc/prompt_async"));
    }

    #[test]
    fn rejects_unknown_route() {
        assert!(!is_allowed("GET", "/totally/unknown"));
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(!is_allowed("GET", "/session/../config"));
        assert!(!is_allowed("GET", "/session/%2e%2e/config"));
    }

    #[test]
    fn rejects_encoded_slash_in_path() {
        assert!(!is_allowed("GET", "/session%2f../config"));
    }

    #[test]
    fn rejects_non_leading_slash() {
        assert!(!is_allowed("GET", "session"));
    }

    #[test]
    fn rejects_api_namespace() {
        assert!(!is_allowed("GET", "/api/session"));
    }

    #[test]
    fn allows_provider_reads_and_blocks_provider_writes() {
        assert!(is_allowed("GET", "/provider"));
        assert!(is_allowed("GET", "/provider/auth"));
        assert!(!is_allowed("PUT", "/provider"));
        assert!(!is_allowed("DELETE", "/provider/auth"));
    }

    #[test]
    fn allows_auth_put_and_delete_only() {
        assert!(is_allowed("PUT", "/auth/openai"));
        assert!(is_allowed("DELETE", "/auth/openai"));
        assert!(!is_allowed("GET", "/auth/openai"));
        assert!(!is_allowed("PUT", "/auth"));
        assert!(!is_allowed("PUT", "/auth/openai/extra"));
    }

    #[test]
    fn allows_mcp_list_add_and_connection_routes() {
        assert!(is_allowed("GET", "/mcp"));
        assert!(is_allowed("POST", "/mcp"));
        assert!(is_allowed("POST", "/mcp/pencil/connect"));
        assert!(is_allowed("POST", "/mcp/pencil/disconnect"));
        assert!(!is_allowed("DELETE", "/mcp"));
        assert!(!is_allowed("DELETE", "/mcp/pencil"));
        assert!(!is_allowed("GET", "/mcp/pencil/disconnect"));
    }

    #[test]
    fn allows_config_get_and_patch_only() {
        assert!(is_allowed("GET", "/config"));
        assert!(is_allowed("PATCH", "/config"));
        assert!(!is_allowed("PUT", "/config"));
        assert!(!is_allowed("DELETE", "/config"));
    }

    #[test]
    fn keeps_global_dispose_blocked() {
        assert!(!is_allowed("POST", "/global/dispose"));
        assert!(!is_allowed("GET", "/global/dispose"));
        assert!(is_allowed("GET", "/global/health"));
    }
}
