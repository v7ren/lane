//! Parse OpenCode SSE `data:` lines (project `/event` and `/global/event` formats).

use serde_json::Value;

/// Normalize a parsed JSON value into `{ id, type, properties }`.
pub fn normalize_wire_event(value: &Value) -> Option<Value> {
    let obj = value.as_object()?;
    if let Some(payload) = obj.get("payload") {
        return normalize_wire_event(payload);
    }
    let id = obj.get("id")?.as_str()?;
    let event_type = obj.get("type")?.as_str()?;
    let properties = obj
        .get("properties")
        .cloned()
        .unwrap_or(Value::Object(Default::default()));
    Some(serde_json::json!({
        "id": id,
        "type": event_type,
        "properties": properties,
    }))
}

pub fn parse_sse_data_line(line: &str) -> Option<Value> {
    let data = line.strip_prefix("data:")?.trim();
    if data.is_empty() {
        return None;
    }
    let value: Value = serde_json::from_str(data).ok()?;
    normalize_wire_event(&value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_project_event_format() {
        let line = r#"data: {"id":"1","type":"server.connected","properties":{}}"#;
        let event = parse_sse_data_line(line).expect("parse");
        assert_eq!(event["type"], "server.connected");
    }

    #[test]
    fn parses_global_event_wrapper() {
        let line = r#"data: {"payload":{"id":"2","type":"session.updated","properties":{"sessionID":"s1"}}}"#;
        let event = parse_sse_data_line(line).expect("parse");
        assert_eq!(event["type"], "session.updated");
        assert_eq!(event["properties"]["sessionID"], "s1");
    }
}
