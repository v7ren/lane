//! Allowlisted HTTP proxy to the OpenCode server for a pane.

use super::allowlist::is_allowed;
use super::client::{encode_query_component, normalize_base_url, with_directory_query};
use serde_json::Value;
use std::collections::HashMap;
use std::time::Duration;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProxyErrorBody {
    pub status: u16,
    pub message: String,
}

pub fn opencode_request(
    base_url: &str,
    directory: &str,
    workspace: Option<&str>,
    method: &str,
    path: &str,
    query: Option<&HashMap<String, String>>,
    body: Option<&Value>,
) -> Result<Value, String> {
    let method = method.trim().to_uppercase();
    let path = path.trim();
    if path.contains('?') {
        return Err(proxy_error(400, "path must not include query string"));
    }
    if !is_allowed(&method, path) {
        return Err(proxy_error(
            403,
            format!("opencode_request: method/path not allowlisted: {method} {path}"),
        ));
    }

    let base = normalize_base_url(base_url);
    let mut url = format!("{base}{path}");
    url = with_directory_query(&url, Some(directory));
    if let Some(workspace) = workspace.map(str::trim).filter(|v| !v.is_empty()) {
        let separator = if url.contains('?') { '&' } else { '?' };
        url = format!(
            "{url}{separator}workspace={}",
            encode_query_component(workspace)
        );
    }
    if let Some(extra) = query {
        for (key, value) in extra {
            if key == "directory" || key == "workspace" {
                continue;
            }
            let separator = if url.contains('?') { '&' } else { '?' };
            url = format!(
                "{url}{separator}{}={}",
                encode_query_component(key),
                encode_query_component(value)
            );
        }
    }

    let agent = ureq::AgentBuilder::new().timeout(DEFAULT_TIMEOUT).build();
    let request = match method.as_str() {
        "GET" => agent.get(&url),
        "POST" => agent.post(&url),
        "PUT" => agent.put(&url),
        "PATCH" => agent.patch(&url),
        "DELETE" => agent.delete(&url),
        "HEAD" => agent.head(&url),
        other => return Err(proxy_error(405, format!("unsupported method: {other}"))),
    };

    let response = if let Some(body) = body {
        request
            .set("Content-Type", "application/json")
            .send_json(body)
    } else {
        request.call()
    };

    match response {
        Ok(resp) => parse_response(resp),
        Err(ureq::Error::Status(code, resp)) => {
            let message = resp.into_string().unwrap_or_default();
            let body = ProxyErrorBody {
                status: code,
                message,
            };
            Err(serde_json::to_string(&body).unwrap_or_else(|_| format!("HTTP {code}")))
        }
        Err(err) => Err(proxy_error(0, format!("opencode_request transport: {err}"))),
    }
}

fn parse_response(resp: ureq::Response) -> Result<Value, String> {
    let status = resp.status();
    if status == 204 {
        return Ok(Value::Null);
    }
    let text = resp.into_string().map_err(|err| proxy_error(0, err.to_string()))?;
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|err| {
        proxy_error(status, format!("invalid JSON response: {err}; body: {text}"))
    })
}

fn proxy_error(status: u16, message: impl Into<String>) -> String {
    serde_json::to_string(&ProxyErrorBody {
        status,
        message: message.into(),
    })
    .unwrap_or_else(|_| "proxy error".into())
}

pub fn select_tui_session(
    base_url: &str,
    directory: &str,
    session_id: &str,
) -> Result<(), String> {
    let _ = opencode_request(
        base_url,
        directory,
        None,
        "POST",
        "/tui/select-session",
        None,
        Some(&serde_json::json!({ "sessionID": session_id })),
    )?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct OpenCodeServerInfo {
    pub version: Option<String>,
    pub url_hidden: bool,
    pub healthy: bool,
    pub directory: String,
    /// OpenCode session the native TUI attach process was started with for this pane.
    pub attached_session_id: Option<String>,
}

pub fn fetch_server_info(
    base_url: &str,
    directory: &str,
    attached_session_id: Option<String>,
) -> OpenCodeServerInfo {
    let base = normalize_base_url(base_url);
    let url = format!("{base}/global/health");
    let healthy = super::client::health_ok(&base);
    let version = ureq::get(&url)
        .timeout(Duration::from_secs(5))
        .call()
        .ok()
        .and_then(|resp| resp.into_json::<Value>().ok())
        .and_then(|value| {
            value
                .get("version")
                .or_else(|| value.get("serverVersion"))
                .and_then(|v| v.as_str())
                .map(String::from)
        });
    if let Some(ref ver) = version {
        if !ver.starts_with("1.18.") {
            tracing::warn!(
                version = %ver,
                "OpenCode server version differs from pinned 1.18.x; API drift possible"
            );
        }
    }
    OpenCodeServerInfo {
        version,
        url_hidden: true,
        healthy,
        directory: directory.to_string(),
        attached_session_id,
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn select_tui_session_uses_session_id_field() {
        let body = serde_json::json!({ "sessionID": "sess_abc" });
        assert_eq!(body["sessionID"], "sess_abc");
    }
}
