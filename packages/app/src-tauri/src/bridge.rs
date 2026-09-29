//! Embedded HTTP bridge for the desktop webview and local tooling.

use parking_lot::Mutex;
use serde::Deserialize;
use serde_json::json;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

use crate::pty::agents::AgentType;
use crate::pty::{
    registry_kill_pane, registry_read_buffer, registry_read_raw_buffer, registry_read_snapshot,
    registry_set_project_path, registry_spawn_pane, registry_write_input, PaneRegistry,
    SpawnPaneArgs,
};
use crate::settings_store;

type SseSender = std::sync::mpsc::SyncSender<String>;
pub type SseClients = Arc<Mutex<Vec<SseSender>>>;

static SSE_CLIENTS: once_cell::sync::OnceCell<SseClients> = once_cell::sync::OnceCell::new();
static BRIDGE_APP: once_cell::sync::OnceCell<AppHandle> = once_cell::sync::OnceCell::new();
static BRIDGE_REGISTRY: once_cell::sync::OnceCell<Arc<Mutex<PaneRegistry>>> =
    once_cell::sync::OnceCell::new();
static BRIDGE_BASE_URL: once_cell::sync::OnceCell<String> = once_cell::sync::OnceCell::new();
static BRIDGE_PORT: once_cell::sync::OnceCell<u16> = once_cell::sync::OnceCell::new();

pub fn bridge_session() -> Option<(String, String)> {
    let url = BRIDGE_BASE_URL.get()?.clone();
    let token = crate::bridge_auth::token()?.to_string();
    Some((url, token))
}

pub fn app_handle() -> Option<AppHandle> {
    BRIDGE_APP.get().cloned()
}

pub fn registry() -> Option<Arc<Mutex<PaneRegistry>>> {
    BRIDGE_REGISTRY.get().cloned()
}

pub fn get_sse_clients() -> SseClients {
    SSE_CLIENTS
        .get_or_init(|| Arc::new(Mutex::new(Vec::new())))
        .clone()
}

pub fn push_sse(payload: String) {
    let clients = get_sse_clients();
    let mut guard = clients.lock();
    guard.retain(|sender| sender.try_send(payload.clone()).is_ok());
}

pub fn push_terminal_sse(pane_id: &str, data: &[u8]) {
    let payload = json!({ "pane_id": pane_id, "data": data });
    if let Ok(json) = serde_json::to_string(&payload) {
        push_sse(format!("event: terminal\ndata: {json}\n\n"));
    }
}

pub fn push_pane_status_sse(pane_id: &str, status: &str) {
    let payload = json!({ "pane_id": pane_id, "status": status });
    if let Ok(json) = serde_json::to_string(&payload) {
        push_sse(format!("event: pane-status\ndata: {json}\n\n"));
        crate::pane_wait_notify::bump_waiters();
    }
}

pub fn push_pane_resize_sse(pane_id: &str, cols: u16, rows: u16) {
    let payload = json!({ "pane_id": pane_id, "cols": cols, "rows": rows });
    if let Ok(json) = serde_json::to_string(&payload) {
        push_sse(format!("event: pane-resize\ndata: {json}\n\n"));
    }
}

const HOST: &str = "127.0.0.1";
const PORT_MIN: u16 = 17321;
const PORT_MAX: u16 = 17399;

#[derive(Debug, Deserialize)]
struct WriteInputBody {
    text: String,
    #[serde(default = "default_true")]
    append_newline: bool,
    #[serde(default)]
    via_opencode_api: bool,
    #[serde(default)]
    model_provider: Option<String>,
    #[serde(default)]
    model_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SwitchModelBody {
    #[serde(default)]
    model_provider: Option<String>,
    model_id: String,
}

#[derive(Debug, Deserialize)]
struct PressKeyBody {
    key: String,
}

#[derive(Debug, Deserialize)]
struct OpenCodePermissionReplyBody {
    reply: String,
}

#[derive(Debug, Deserialize)]
struct OpenCodeQuestionReplyBody {
    answer: String,
    #[serde(default)]
    request_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenCodeKeyRotateBody {
    #[serde(default)]
    profile: Option<String>,
    pane_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResizeBody {
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
struct ProjectPathBody {
    path: String,
}

#[derive(Debug, serde::Serialize)]
struct Health {
    ok: bool,
    version: &'static str,
}

fn default_true() -> bool {
    true
}

pub struct BridgeHandle {
    pub url: String,
}

impl BridgeHandle {
    pub fn new(url: String) -> Self {
        Self { url }
    }
}

fn bind_listener() -> Result<(TcpListener, u16), String> {
    for port in PORT_MIN..=PORT_MAX {
        match TcpListener::bind((HOST, port)) {
            Ok(listener) => return Ok((listener, port)),
            Err(_) => continue,
        }
    }
    Err(format!("no free bridge port in {PORT_MIN}-{PORT_MAX}"))
}

pub fn start_embedded_bridge(
    registry: Arc<Mutex<PaneRegistry>>,
    app: AppHandle,
    port_file: PathBuf,
) -> Result<BridgeHandle, String> {
    let _ = BRIDGE_APP.set(app.clone());
    let _ = BRIDGE_REGISTRY.set(registry.clone());
    let _ = crate::app_paths::ensure_app_data_dir();
    let (listener, port) = bind_listener()?;
    let _token = crate::bridge_auth::init_token();
    let _ = BRIDGE_PORT.set(port);
    let url = format!("http://{HOST}:{port}");
    let _ = BRIDGE_BASE_URL.set(url.clone());
    fs::write(&port_file, format!("{HOST}:{port}\n"))
        .map_err(|err| format!("write bridge port file {}: {err}", port_file.display()))?;

    thread::Builder::new()
        .name("loomria-http-bridge".into())
        .spawn(move || {
            for stream in listener.incoming() {
                match stream {
                    Ok(stream) => {
                        let registry = registry.clone();
                        let app = app.clone();
                        thread::spawn(move || {
                            if let Err(err) = handle_connection(stream, registry, app) {
                                tracing::debug!(%err, "bridge request failed");
                            }
                        });
                    }
                    Err(err) => tracing::debug!(%err, "bridge accept failed"),
                }
            }
        })
        .map_err(|err| format!("spawn bridge thread: {err}"))?;

    Ok(BridgeHandle::new(url))
}

fn handle_connection(
    mut stream: TcpStream,
    registry: Arc<Mutex<PaneRegistry>>,
    app: AppHandle,
) -> Result<(), String> {
    let mut buf = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end;
    loop {
        let n = stream
            .read(&mut chunk)
            .map_err(|err| format!("read request: {err}"))?;
        if n == 0 {
            return Ok(());
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(pos) = find_header_end(&buf) {
            header_end = pos;
            break;
        }
        if buf.len() > 1024 * 1024 {
            return Err("request headers too large".into());
        }
    }

    let headers_raw = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = headers_raw.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "missing request line".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or("GET");
    let target = request_parts.next().unwrap_or("/");
    let content_length = headers_raw
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);

    let body_start = header_end + 4;
    while buf.len().saturating_sub(body_start) < content_length {
        let n = stream
            .read(&mut chunk)
            .map_err(|err| format!("read body: {err}"))?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let body =
        &buf[body_start..body_start + content_length.min(buf.len().saturating_sub(body_start))];

    let port = BRIDGE_PORT.get().copied().unwrap_or(PORT_MIN);
    let host_header = header_value(&headers_raw, "host");
    let origin_header = header_value(&headers_raw, "origin");
    let cors_origin = crate::bridge_auth::cors_allow_origin(origin_header.as_deref(), cfg!(debug_assertions));

    if method == "OPTIONS" {
        return write_response(&mut stream, 204, &json!({}), cors_origin.as_deref());
    }

    if !crate::bridge_auth::host_allowed(host_header.as_deref(), port) {
        return write_response(
            &mut stream,
            403,
            &json!({ "error": "forbidden host" }),
            cors_origin.as_deref(),
        );
    }

    let (path, query) = split_target(target);
    let segments: Vec<&str> = path.split('/').filter(|part| !part.is_empty()).collect();

    if segments == ["events"] && method == "GET" {
        if !crate::bridge_auth::token_matches(&headers_raw, query) {
            return write_response(
                &mut stream,
                401,
                &json!({ "error": "unauthorized" }),
                cors_origin.as_deref(),
            );
        }
        handle_sse(&mut stream, registry, &app, cors_origin.as_deref());
        return Ok(());
    }

    if !crate::bridge_auth::token_matches(&headers_raw, query) {
        return write_response(
            &mut stream,
            401,
            &json!({ "error": "unauthorized" }),
            cors_origin.as_deref(),
        );
    }

    match route(method, &segments, query, body, registry, app) {
        Ok((0, _)) => Ok(()),
        Ok((status, value)) => write_response(&mut stream, status, &value, cors_origin.as_deref()),
        Err((status, value)) => write_response(&mut stream, status, &value, cors_origin.as_deref()),
    }
}

fn route(
    method: &str,
    segments: &[&str],
    query: &str,
    body: &[u8],
    registry: Arc<Mutex<PaneRegistry>>,
    app: AppHandle,
) -> Result<(u16, serde_json::Value), (u16, serde_json::Value)> {
    if segments.is_empty() && method == "GET" {
        return Ok((
            200,
            json!({
                "service": "loomria-bridge",
                "health": "/health",
            }),
        ));
    }

    if segments == ["health"] && method == "GET" {
        return Ok((
            200,
            serde_json::to_value(Health {
                ok: true,
                version: env!("CARGO_PKG_VERSION"),
            })
            .unwrap(),
        ));
    }

    if segments == ["opencode", "keys", "status"] && method == "GET" {
        let status = crate::opencode::keys::status()
            .map_err(|err| (500, json!({ "error": err })))?;
        return Ok((200, serde_json::to_value(status).unwrap()));
    }

    if segments == ["opencode", "keys", "settings"] && (method == "PATCH" || method == "POST") {
        let patch: crate::opencode::keys::OpenCodeKeySettingsPatch = parse_json(body)?;
        let status = crate::opencode::keys::patch_settings(&patch)
            .map_err(|err| (400, json!({ "error": err })))?;
        return Ok((200, serde_json::to_value(status).unwrap()));
    }

    if segments == ["opencode", "keys", "rotate"] && method == "POST" {
        let req: OpenCodeKeyRotateBody = parse_json(body)?;
        let profile = req.profile.unwrap_or_else(|| "next".to_string());
        let target = crate::opencode::keys::RotateTarget::parse(&profile).ok_or_else(|| {
            (
                400,
                json!({ "error": "profile must be next, a, or b" }),
            )
        })?;
        let status = crate::opencode::keys::rotate(target)
            .map_err(|err| (400, json!({ "error": err })))?;
        let restarted = if let Some(pane_id) = normalize_optional_string(req.pane_id) {
            vec![crate::opencode::native::restart_native_pane(
                Arc::clone(&registry),
                &app,
                &pane_id,
            )
            .map_err(|err| (404, json!({ "error": err })))?]
        } else {
            crate::opencode::native::restart_all_native_panes(Arc::clone(&registry), &app)
                .map_err(|err| (500, json!({ "error": err })))?
        };
        return Ok((
            200,
            json!({
                "ok": true,
                "active_profile": status.active_profile,
                "profiles": status.profiles,
                "restarted_panes": restarted,
            }),
        ));
    }

    if segments == ["settings"] && method == "GET" {
        return Ok((200, settings_store::read_public_settings(&app)));
    }

    if segments == ["settings"] && (method == "PATCH" || method == "POST") {
        let patch: serde_json::Value = parse_json(body)?;
        let updated = settings_store::patch_public_settings(&app, patch);
        return Ok((200, updated));
    }

    if segments == ["project-path"] && method == "POST" {
        let req: ProjectPathBody = parse_json(body)?;
        let normalized =
            crate::project_path::normalize_project_path(std::path::Path::new(&req.path))
                .map_err(|err| (400, json!({ "error": err })))?;
        registry_set_project_path(&registry, normalized.to_string_lossy().into_owned());
        return Ok((200, json!({ "ok": true })));
    }

    if segments.len() == 1 && segments[0] == "panes" {
        match method {
            "GET" => {
                let panes = registry.lock().list();
                return Ok((200, serde_json::to_value(panes).unwrap()));
            }
            "POST" => {
                let req: SpawnPaneArgs = parse_json(body)?;
                let pane_id = registry_spawn_pane(&registry, &app, req)
                    .map_err(|err| (500, json!({ "error": err })))?;
                emit_panes_changed(&registry, &app);
                return Ok((201, json!({ "pane_id": pane_id, "ok": true })));
            }
            _ => {}
        }
    }

    if segments.len() >= 2 && segments[0] == "panes" {
        let pane_id = segments[1];
        let tail = segments.get(2).copied();
        if tail.is_none() && method == "DELETE" {
            registry_kill_pane(&registry, pane_id).map_err(|err| (500, json!({ "error": err })))?;
            emit_panes_changed(&registry, &app);
            return Ok((200, json!({ "ok": true })));
        }
        if tail == Some("buffer") && method == "GET" {
            let lines = query_param(query, "lines")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(200);
            let content = registry_read_buffer(&registry, pane_id, lines)
                .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((200, json!({ "content": content })));
        }
        if tail == Some("raw") && method == "GET" {
            let lines = query_param(query, "lines")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(10_000);
            let raw = registry_read_raw_buffer(&registry, pane_id, lines)
                .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((200, json!({ "data": raw })));
        }
        if tail == Some("snapshot") && method == "GET" {
            let content = registry_read_snapshot(&registry, pane_id)
                .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((200, json!({ "content": content })));
        }
        if tail == Some("input") && method == "POST" {
            let req: WriteInputBody = parse_json(body)?;
            let settings = settings_store::read_public_settings(&app);
            let model = crate::opencode::resolve_model(
                req.model_provider.as_deref(),
                req.model_id.as_deref(),
                &settings,
            );
            registry_write_input(
                &registry,
                &app,
                pane_id,
                &req.text,
                req.append_newline,
                req.via_opencode_api,
                model,
            )
            .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((200, json!({ "pane_id": pane_id, "written": true, "ok": true })));
        }
        if tail == Some("key") && method == "POST" {
            let req: PressKeyBody = parse_json(body)?;
            let seq = crate::pty::keys::sequence(&req.key)
                .map_err(|err| (400, json!({ "error": err })))?;
            let bytes = seq.len();
            registry_write_input(&registry, &app, pane_id, &seq, false, false, None)
                .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((200, json!({ "ok": true, "key": req.key, "bytes": bytes })));
        }
        if tail == Some("opencode") && segments.get(3) == Some(&"status") && method == "GET" && segments.len() == 4 {
            let status = crate::opencode::status::worker_status(&registry, pane_id)
                .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((200, serde_json::to_value(status).unwrap()));
        }
        if tail == Some("opencode")
            && segments.get(3) == Some(&"messages")
            && method == "GET"
            && segments.len() == 4
        {
            let limit = query_param(query, "limit")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(20)
                .clamp(1, 200);
            let role = query_param(query, "role");
            let view = crate::opencode::messages::read_pane_messages(
                &registry,
                pane_id,
                limit,
                role.as_deref(),
            )
            .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((200, serde_json::to_value(view).unwrap()));
        }
        if tail == Some("opencode") && method == "GET" && segments.len() == 3 {
            let link = crate::opencode::pane_link(&registry, pane_id).ok_or_else(|| {
                (
                    404,
                    json!({ "error": format!("pane {pane_id} has no opencode native session") }),
                )
            })?;
            return Ok((200, serde_json::to_value(link).unwrap()));
        }
        if tail == Some("opencode")
            && segments.get(3) == Some(&"permissions")
            && method == "GET"
            && segments.len() == 4
        {
            let permissions = crate::opencode::list_pane_permissions(&registry, pane_id)
                .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((200, serde_json::to_value(permissions).unwrap()));
        }
        if tail == Some("opencode")
            && segments.get(3) == Some(&"permissions")
            && segments.get(5) == Some(&"reply")
            && method == "POST"
            && segments.len() == 6
        {
            let request_id = segments[4];
            let req: OpenCodePermissionReplyBody = parse_json(body)?;
            crate::opencode::reply_pane_permission(&registry, pane_id, request_id, &req.reply)
                .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((200, json!({ "ok": true })));
        }
        if tail == Some("opencode")
            && segments.get(3) == Some(&"question")
            && segments.get(4) == Some(&"reply")
            && method == "POST"
            && segments.len() == 5
        {
            let req: OpenCodeQuestionReplyBody = parse_json(body)?;
            let result = crate::opencode::reply_pane_question(
                &registry,
                pane_id,
                &req.answer,
                req.request_id.as_deref(),
            )
            .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((200, result));
        }
        if tail == Some("detach") && method == "POST" {
            let pane = registry
                .lock()
                .list()
                .into_iter()
                .find(|pane| pane.id == pane_id)
                .ok_or_else(|| (404, json!({ "error": format!("unknown pane: {pane_id}") })))?;
            let title = format!(
                "{} · {}",
                pane.agent_type,
                pane.id.chars().take(8).collect::<String>()
            );
            let _ = app.emit(
                "pane://detach",
                json!({
                    "pane_id": pane.id,
                    "title": title,
                    "cols": pane.cols,
                    "rows": pane.rows,
                }),
            );
            return Ok((200, json!({ "ok": true })));
        }
        if tail == Some("resize") && method == "POST" {
            let _ = parse_json::<ResizeBody>(body)?;
            return Ok((200, json!({ "ok": true, "ignored": true })));
        }
        if tail == Some("model") && method == "POST" {
            let req: SwitchModelBody = parse_json(body)?;
            let settings = settings_store::read_public_settings(&app);
            let model = crate::opencode::resolve_model(
                req.model_provider.as_deref(),
                Some(req.model_id.as_str()),
                &settings,
            )
            .ok_or_else(|| (400, json!({ "error": "model_id required" })))?;
            crate::opencode::switch_native_model(&registry, &app, pane_id, &model)
                .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((
                200,
                crate::opencode::switch_model_response(&registry, pane_id, &model),
            ));
        }
        if tail == Some("model") && method == "GET" {
            let lines = query_param(query, "lines")
                .and_then(|value| value.parse::<usize>().ok())
                .unwrap_or(200);
            let pane = registry
                .lock()
                .list()
                .into_iter()
                .find(|pane| pane.id == pane_id)
                .ok_or_else(|| (404, json!({ "error": format!("unknown pane: {pane_id}") })))?;
            let _agent_type = AgentType::parse(&pane.agent_type).ok_or_else(|| {
                (
                    400,
                    json!({ "error": format!("unknown agent_type: {}", pane.agent_type) }),
                )
            })?;
            let buffer = registry_read_buffer(&registry, pane_id, lines)
                .map_err(|err| (404, json!({ "error": err })))?;
            return Ok((
                200,
                json!({
                    "pane_id": pane_id,
                    "agent_type": pane.agent_type,
                    "buffer_tail": buffer,
                }),
            ));
        }
    }

    Err((404, json!({ "error": "not found" })))
}

fn handle_sse(
    stream: &mut TcpStream,
    registry: Arc<Mutex<PaneRegistry>>,
    app: &AppHandle,
    cors_origin: Option<&str>,
) {
    let cors = cors_header(cors_origin);
    let headers = format!(
        "HTTP/1.1 200 OK\r\n\
        Content-Type: text/event-stream\r\n\
        Cache-Control: no-cache\r\n\
        Connection: keep-alive\r\n\
        {cors}\
        \r\n\
        : connected\n\n"
    );
    if stream.write_all(headers.as_bytes()).is_err() {
        return;
    }

    let panes = registry.lock().list();
    if let Ok(json) = serde_json::to_string(&panes) {
        let snapshot = format!("event: panes\ndata: {json}\n\n");
        if stream.write_all(snapshot.as_bytes()).is_err() {
            return;
        }
    }

    let settings = settings_store::read_public_settings(app);
    if let Ok(json) = serde_json::to_string(&settings) {
        let snapshot = format!("event: settings\ndata: {json}\n\n");
        if stream.write_all(snapshot.as_bytes()).is_err() {
            return;
        }
    }

    let (tx, rx) = std::sync::mpsc::sync_channel::<String>(64);
    get_sse_clients().lock().push(tx);

    for payload in rx {
        if stream.write_all(payload.as_bytes()).is_err() {
            break;
        }
    }
}

pub fn push_settings_sse(settings: &serde_json::Value) {
    if let Ok(json) = serde_json::to_string(settings) {
        push_sse(format!("event: settings\ndata: {json}\n\n"));
    }
}

pub fn push_panes_sse(registry: &Arc<Mutex<PaneRegistry>>) {
    let panes = registry.lock().list();
    if let Ok(json) = serde_json::to_string(&panes) {
        push_sse(format!("event: panes\ndata: {json}\n\n"));
    }
}

fn emit_panes_changed(registry: &Arc<Mutex<PaneRegistry>>, app: &AppHandle) {
    push_panes_sse(registry);
    let _ = app.emit("pty://panes-changed", json!({ "changed": true }));
}

fn parse_json<T: for<'de> Deserialize<'de>>(body: &[u8]) -> Result<T, (u16, serde_json::Value)> {
    serde_json::from_slice(body)
        .map_err(|err| (400, json!({ "error": format!("invalid json: {err}") })))
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|window| window == b"\r\n\r\n")
}

fn split_target(target: &str) -> (&str, &str) {
    target.split_once('?').unwrap_or((target, ""))
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

fn header_value(headers_raw: &str, name: &str) -> Option<String> {
    headers_raw.lines().find_map(|line| {
        let (key, value) = line.split_once(':')?;
        if key.eq_ignore_ascii_case(name) {
            Some(value.trim().to_string())
        } else {
            None
        }
    })
}

fn cors_header(origin: Option<&str>) -> String {
    match origin {
        Some(o) => format!("Access-Control-Allow-Origin: {o}\r\nVary: Origin\r\n"),
        None => String::new(),
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    value: &serde_json::Value,
    cors_origin: Option<&str>,
) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let body = if status == 204 {
        String::new()
    } else {
        serde_json::to_string(value).map_err(|err| format!("serialize response: {err}"))?
    };
    let cors = cors_header(cors_origin);
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: application/json; charset=utf-8\r\n\
         Content-Length: {}\r\n\
         {cors}\
         Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type, Authorization, X-Loomria-Proxied\r\n\
         Connection: close\r\n\
         \r\n\
         {}",
        body.as_bytes().len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|err| format!("write response: {err}"))
}
