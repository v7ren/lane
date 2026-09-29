//! Per-launch bridge token and request guards (localhost-only, origin-scoped CORS).

use once_cell::sync::OnceCell;
use rand::Rng;

static TOKEN: OnceCell<String> = OnceCell::new();

pub fn init_token() -> String {
    TOKEN
        .get_or_init(|| {
            rand::thread_rng()
                .sample_iter(&rand::distributions::Alphanumeric)
                .take(48)
                .map(char::from)
                .collect()
        })
        .clone()
}

pub fn token() -> Option<&'static str> {
    TOKEN.get().map(String::as_str)
}

pub fn extract_token(headers_raw: &str, query: &str) -> Option<String> {
    for line in headers_raw.lines() {
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("authorization") {
                let v = value.trim();
                if let Some(rest) = v.strip_prefix("Bearer ") {
                    let t = rest.trim();
                    if !t.is_empty() {
                        return Some(t.to_string());
                    }
                }
            }
        }
    }
    query_param(query, "token")
}

pub fn token_matches(headers_raw: &str, query: &str) -> bool {
    let expected = token();
    match expected {
        None => false,
        Some(expected) => extract_token(headers_raw, query).as_deref() == Some(expected),
    }
}

pub fn host_allowed(host_header: Option<&str>, port: u16) -> bool {
    let host = host_header.map(|h| h.trim().to_lowercase());
    match host.as_deref() {
        Some(h) if h == format!("127.0.0.1:{port}") => true,
        Some(h) if h == format!("localhost:{port}") => true,
        Some(h) if h == format!("[::1]:{port}") => true,
        _ => false,
    }
}

pub fn cors_allow_origin(origin_header: Option<&str>, dev: bool) -> Option<String> {
    let origin = origin_header.map(|h| h.trim()).filter(|h| !h.is_empty())?;
    if origin == "tauri://localhost" || origin == "http://tauri.localhost" {
        return Some(origin.to_string());
    }
    if dev && (origin == "http://127.0.0.1:1420" || origin == "http://localhost:1420") {
        return Some(origin.to_string());
    }
    None
}

fn query_param(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        if key == name {
            Some(value.to_string())
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_token() {
        let _ = init_token();
        assert!(!token_matches("", ""));
    }

    #[test]
    fn accepts_bearer_token() {
        let headers = match token() {
            Some(t) => format!("Authorization: Bearer {t}\r\n"),
            None => {
                let t = init_token();
                format!("Authorization: Bearer {t}\r\n")
            }
        };
        assert!(token_matches(&headers, ""));
    }

    #[test]
    fn rejects_wrong_host() {
        assert!(!host_allowed(Some("evil.com:17321"), 17321));
        assert!(host_allowed(Some("127.0.0.1:17321"), 17321));
    }
}
