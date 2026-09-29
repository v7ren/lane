//! Patches `settings.json` from the backend so project_path survives frontend store races.

use serde_json::{json, Map, Value};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "settings";

fn merge_settings_object(raw: Value) -> Map<String, Value> {
    match raw {
        Value::Object(map) => {
            if let Some(Value::Object(inner)) = map.get("0") {
                let mut merged = inner.clone();
                for (key, value) in map {
                    if key != "0" && key != "1" {
                        merged.insert(key, value);
                    }
                }
                return merged;
            }
            map
        }
        Value::Array(items) => items
            .into_iter()
            .find_map(|item| item.as_object().cloned())
            .unwrap_or_default(),
        _ => Map::new(),
    }
}

pub fn read_persisted_project_path(app: &AppHandle) -> Option<String> {
    let store = app.store(STORE_FILE).ok()?;
    let raw = store
        .get(SETTINGS_KEY)
        .unwrap_or_else(|| Value::Object(Map::new()));
    let settings = merge_settings_object(raw);
    settings
        .get("project_path")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

pub fn persist_project_path(app: &AppHandle, path: &str) -> Result<(), String> {
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let raw = store
        .get(SETTINGS_KEY)
        .unwrap_or_else(|| Value::Object(Map::new()));
    let mut settings = merge_settings_object(raw);
    settings.insert("project_path".to_string(), json!(path));
    store.set(SETTINGS_KEY.to_string(), Value::Object(settings));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}
