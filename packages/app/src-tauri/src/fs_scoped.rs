//! Project-scoped filesystem access for the Monaco editor.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, State};

use crate::commands::AppState;
use crate::pty::registry_get_project_path;

const MAX_READ_BYTES: u64 = 5 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8192;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsDirEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsReadResult {
    pub content: String,
    pub encoding: String,
    pub size: u64,
    pub mtime_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsStatResult {
    pub kind: String,
    pub size: u64,
    pub mtime_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteResult {
    pub mtime_ms: i64,
    pub size: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsWriteArgs {
    pub root: String,
    pub path: String,
    pub content: String,
    pub expected_mtime_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FsChangedPayload {
    pub root: String,
    pub paths: Vec<String>,
}

struct WatcherState {
    root: Option<PathBuf>,
}

static WATCHER: Mutex<WatcherState> = Mutex::new(WatcherState { root: None });

fn mtime_ms(path: &Path) -> Result<i64, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = meta.modified().map_err(|e| e.to_string())?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64)
}

fn is_windows_device_name(name: &str) -> bool {
    let upper = name.to_uppercase();
    matches!(
        upper.as_str(),
        "CON" | "PRN" | "AUX" | "NUL"
            | "COM0" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9"
            | "LPT0" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    )
}

fn reject_dangerous_segment(segment: &str) -> Result<(), String> {
    if segment.is_empty() {
        return Err("empty path segment".into());
    }
    if segment == "." || segment == ".." {
        return Err("path traversal is not allowed".into());
    }
    if segment.contains(':') || segment.contains('\0') {
        return Err("invalid path segment".into());
    }
    let base = segment.split('.').next().unwrap_or(segment);
    if is_windows_device_name(base) {
        return Err("reserved device name in path".into());
    }
    Ok(())
}

fn normalize_relative_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Ok(PathBuf::from(""));
    }
    if trimmed.starts_with('\\') || Path::new(trimmed).is_absolute() {
        return Err("absolute paths are not allowed".into());
    }
    let raw = trimmed.replace('\\', "/");
    if raw.starts_with("//?/") || raw.starts_with("\\\\?\\") {
        return Err("extended device paths are not allowed".into());
    }
    let mut out = PathBuf::new();
    for component in Path::new(&raw).components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                return Err("absolute paths are not allowed".into());
            }
            Component::ParentDir => return Err("path traversal is not allowed".into()),
            Component::CurDir => {}
            Component::Normal(seg) => {
                reject_dangerous_segment(seg.to_str().unwrap_or(""))?;
                out.push(seg);
            }
        }
    }
    Ok(out)
}

pub fn canonical_project_root(root: &str) -> Result<PathBuf, String> {
    let expanded = crate::project_path::expand_user_path(Path::new(root));
    let normalized = crate::project_path::normalize_project_path(&expanded)?;
    let canonical = fs::canonicalize(&normalized).map_err(|e| format!("invalid project root: {e}"))?;
    if !canonical.is_dir() {
        return Err("project root must be a directory".into());
    }
    Ok(canonical)
}

pub fn resolve_inside_root(root_canon: &Path, rel: &str) -> Result<PathBuf, String> {
    let joined = join_under_root(root_canon, rel)?;
    let canonical = fs::canonicalize(&joined).map_err(|e| format!("path not found: {e}"))?;
    if !canonical.starts_with(root_canon) {
        return Err("path escapes project root".into());
    }
    Ok(canonical)
}

fn join_under_root(root_canon: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = normalize_relative_path(rel)?;
    if rel_path.as_os_str().is_empty() {
        Ok(root_canon.to_path_buf())
    } else {
        Ok(root_canon.join(rel_path))
    }
}

/// Resolve a path that may not exist yet, while still enforcing it stays under `root_canon`.
pub fn resolve_new_under_root(root_canon: &Path, rel: &str) -> Result<PathBuf, String> {
    let joined = join_under_root(root_canon, rel)?;
    let mut anchor = joined.clone();
    // symlink_metadata so a dangling link is not skipped (canonicalize then fails -> rejected)
    while anchor.symlink_metadata().is_err() {
        anchor = anchor
            .parent()
            .ok_or_else(|| "invalid path".to_string())?
            .to_path_buf();
    }
    let anchored = fs::canonicalize(&anchor).map_err(|e| e.to_string())?;
    if !anchored.starts_with(root_canon) {
        return Err("path escapes project root".into());
    }
    if !joined.starts_with(root_canon) {
        return Err("path escapes project root".into());
    }
    Ok(joined)
}

fn validate_root_against_app(state: &AppState, root: &str) -> Result<PathBuf, String> {
    let canon = canonical_project_root(root)?;
    let registry_root = registry_get_project_path(&state.registry);
    if registry_root.is_empty() {
        return Err("no project path set".into());
    }
    let registry_canon = canonical_project_root(&registry_root)?;
    if canon != registry_canon {
        return Err("root does not match the active project".into());
    }
    Ok(canon)
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(BINARY_SNIFF_BYTES).any(|b| *b == 0)
}

fn is_ignored_dir(name: &str) -> bool {
    matches!(name, "node_modules" | "target" | ".git" | "dist" | ".next" | "coverage")
}

fn read_utf8_file(path: &Path) -> Result<FsReadResult, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    let size = meta.len();
    if size > MAX_READ_BYTES {
        return Err(format!("file exceeds {} byte limit", MAX_READ_BYTES));
    }
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = Vec::with_capacity(size.min(BINARY_SNIFF_BYTES as u64) as usize);
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    if looks_binary(&buf) {
        return Err("binary files cannot be opened in the editor".into());
    }
    let content = String::from_utf8(buf).map_err(|_| "file is not valid UTF-8".to_string())?;
    Ok(FsReadResult {
        content,
        encoding: "utf-8".into(),
        size,
        mtime_ms: mtime_ms(path)?,
    })
}

pub fn list_dir_impl(root_canon: &Path, rel: &str) -> Result<Vec<FsDirEntry>, String> {
    let dir = resolve_inside_root(root_canon, rel)?;
    if !dir.is_dir() {
        return Err("not a directory".into());
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if entry.path().is_dir() && is_ignored_dir(&name) {
            continue;
        }
        let kind = if entry.path().is_dir() { "directory" } else { "file" };
        let rel_path = entry
            .path()
            .strip_prefix(root_canon)
            .map_err(|_| "internal path error".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        entries.push(FsDirEntry {
            name,
            path: rel_path,
            kind: kind.into(),
        });
    }
    entries.sort_by(|a, b| {
        let ad = a.kind == "directory";
        let bd = b.kind == "directory";
        match (ad, bd) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    Ok(entries)
}

pub fn walk_files_impl(root_canon: &Path, query: &str) -> Result<Vec<String>, String> {
    let q = query.trim().to_lowercase();
    let mut out = Vec::new();
    walk_dir(root_canon, root_canon, &q, &mut out)?;
    out.sort();
    if out.len() > 500 {
        out.truncate(500);
    }
    Ok(out)
}

fn walk_dir(
    root_canon: &Path,
    dir: &Path,
    query: &str,
    out: &mut Vec<String>,
) -> Result<(), String> {
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // Never follow symlinks/junctions: they may point outside the project root.
        if entry.file_type().map_err(|e| e.to_string())?.is_symlink() {
            continue;
        }
        if path.is_dir() {
            if is_ignored_dir(&name) {
                continue;
            }
            walk_dir(root_canon, &path, query, out)?;
        } else if query.is_empty() || name.to_lowercase().contains(query) {
            let rel = path
                .strip_prefix(root_canon)
                .map_err(|_| "internal path error".to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            out.push(rel);
        }
    }
    Ok(())
}

fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn start_watcher(app: AppHandle, root_canon: PathBuf) -> Result<(), String> {
    use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
    use std::sync::mpsc;

    let (tx, rx) = mpsc::channel();
    let mut watcher = RecommendedWatcher::new(
        move |res| {
            if let Ok(event) = res {
                let _ = tx.send(event);
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&root_canon, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    {
        let mut guard = WATCHER.lock();
        guard.root = Some(root_canon.clone());
    }

    let root_str = root_canon.to_string_lossy().into_owned();
    std::thread::spawn(move || {
        let mut pending: HashSet<String> = HashSet::new();
        let debounce = Duration::from_millis(200);
        while let Ok(event) = rx.recv() {
            if matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            ) {
                for p in event.paths {
                    if let Ok(rel) = p.strip_prefix(&root_canon) {
                        pending.insert(rel.to_string_lossy().replace('\\', "/"));
                    }
                }
            }
            std::thread::sleep(debounce);
            while rx.try_recv().is_ok() {}
            if !pending.is_empty() {
                let paths: Vec<String> = pending.drain().collect();
                let _ = app.emit(
                    "fs://changed",
                    FsChangedPayload {
                        root: root_str.clone(),
                        paths,
                    },
                );
            }
        }
        let _ = watcher;
    });

    Ok(())
}

#[tauri::command]
pub async fn fs_list_dir(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<Vec<FsDirEntry>, String> {
    let root_canon = validate_root_against_app(&state, &root)?;
    list_dir_impl(&root_canon, &path)
}

#[tauri::command]
pub async fn fs_read_file(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<FsReadResult, String> {
    let root_canon = validate_root_against_app(&state, &root)?;
    let file_path = resolve_inside_root(&root_canon, &path)?;
    read_utf8_file(&file_path)
}

#[tauri::command]
pub async fn fs_write_file(
    state: State<'_, AppState>,
    args: FsWriteArgs,
) -> Result<FsWriteResult, String> {
    let root_canon = validate_root_against_app(&state, &args.root)?;
    let file_path = resolve_new_under_root(&root_canon, &args.path)?;
    if file_path.exists() {
        let current_mtime = mtime_ms(&file_path)?;
        if let Some(expected) = args.expected_mtime_ms {
            if current_mtime != expected {
                return Err("conflict: file changed on disk since it was read".into());
            }
        }
    }
    ensure_parent(&file_path)?;
    fs::write(&file_path, args.content.as_bytes()).map_err(|e| e.to_string())?;
    let meta = fs::metadata(&file_path).map_err(|e| e.to_string())?;
    Ok(FsWriteResult {
        mtime_ms: mtime_ms(&file_path)?,
        size: meta.len(),
    })
}

#[tauri::command]
pub async fn fs_stat(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<FsStatResult, String> {
    let root_canon = validate_root_against_app(&state, &root)?;
    let target = resolve_inside_root(&root_canon, &path)?;
    let meta = fs::metadata(&target).map_err(|e| e.to_string())?;
    let kind = if meta.is_dir() {
        "directory"
    } else if meta.is_file() {
        "file"
    } else {
        "other"
    };
    Ok(FsStatResult {
        kind: kind.into(),
        size: meta.len(),
        mtime_ms: mtime_ms(&target)?,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsCreateArgs {
    pub root: String,
    pub path: String,
    pub kind: String,
}

#[tauri::command]
pub async fn fs_create(state: State<'_, AppState>, args: FsCreateArgs) -> Result<(), String> {
    let root_canon = validate_root_against_app(&state, &args.root)?;
    let target = resolve_new_under_root(&root_canon, &args.path)?;
    match args.kind.as_str() {
        "directory" => fs::create_dir_all(&target).map_err(|e| e.to_string())?,
        "file" => {
            ensure_parent(&target)?;
            if target.exists() {
                return Err("file already exists".into());
            }
            fs::write(&target, []).map_err(|e| e.to_string())?;
        }
        _ => return Err("kind must be file or directory".into()),
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_rename(
    state: State<'_, AppState>,
    root: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let root_canon = validate_root_against_app(&state, &root)?;
    let from_path = resolve_inside_root(&root_canon, &from)?;
    let to_path = resolve_new_under_root(&root_canon, &to)?;
    if to_path.exists() {
        return Err("destination already exists".into());
    }
    ensure_parent(&to_path)?;
    fs::rename(&from_path, &to_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn fs_delete(
    state: State<'_, AppState>,
    root: String,
    path: String,
) -> Result<(), String> {
    let root_canon = validate_root_against_app(&state, &root)?;
    let target = resolve_inside_root(&root_canon, &path)?;
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    } else {
        trash::delete(&target).map_err(|e| format!("delete failed: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn fs_walk_files(
    state: State<'_, AppState>,
    root: String,
    query: String,
) -> Result<Vec<String>, String> {
    let root_canon = validate_root_against_app(&state, &root)?;
    walk_files_impl(&root_canon, &query)
}

#[tauri::command]
pub async fn fs_start_watcher(state: State<'_, AppState>, app: AppHandle, root: String) -> Result<(), String> {
    let root_canon = validate_root_against_app(&state, &root)?;
    start_watcher(app, root_canon)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn setup() -> (tempfile::TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let root = dir.path().join("project");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("hello.txt"), "hello").unwrap();
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("sub/a.rs"), "fn main() {}").unwrap();
        let canon = fs::canonicalize(&root).unwrap();
        (dir, canon)
    }

    #[test]
    fn rejects_parent_traversal() {
        let (_dir, canon) = setup();
        assert!(resolve_inside_root(&canon, "../outside").is_err());
        assert!(resolve_inside_root(&canon, "sub/../../etc/passwd").is_err());
    }

    #[test]
    fn rejects_absolute_path() {
        let (_dir, canon) = setup();
        assert!(resolve_inside_root(&canon, "/etc/passwd").is_err());
    }

    #[test]
    fn rejects_device_name() {
        assert!(normalize_relative_path("CON").is_err());
        assert!(normalize_relative_path("sub/CON.txt").is_err());
    }

    #[test]
    fn reads_and_lists() {
        let (_dir, canon) = setup();
        let entries = list_dir_impl(&canon, "").unwrap();
        assert!(entries.iter().any(|e| e.name == "hello.txt"));
        let read = read_utf8_file(&canon.join("hello.txt")).unwrap();
        assert_eq!(read.content, "hello");
    }

    #[test]
    fn rejects_large_file() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("project");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("big.bin");
        let mut f = fs::File::create(&path).unwrap();
        use std::io::Write;
        let chunk = vec![b'a'; 1024];
        for _ in 0..(MAX_READ_BYTES / 1024 + 1) {
            f.write_all(&chunk).unwrap();
        }
        let canon = fs::canonicalize(&root).unwrap();
        assert!(read_utf8_file(&canon.join("big.bin")).is_err());
    }

    #[test]
    fn mtime_conflict_on_write() {
        let (_dir, canon) = setup();
        let path = canon.join("hello.txt");
        let before = mtime_ms(&path).unwrap();
        fs::write(&path, "mutated").unwrap();
        let after = mtime_ms(&path).unwrap();
        assert_ne!(before, after);
        assert!(before != after);
    }

    #[test]
    fn create_rename_delete_roundtrip() {
        let (_dir, canon) = setup();
        let new_file = canon.join("new.txt");
        fs::write(&new_file, "x").unwrap();
        let renamed = canon.join("renamed.txt");
        fs::rename(&new_file, &renamed).unwrap();
        assert!(renamed.exists());
        trash::delete(&renamed).ok();
        assert!(!renamed.exists());
    }

    #[test]
    fn rejects_binary_content() {
        let dir = tempdir().unwrap();
        let root = dir.path().join("project");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("bin.dat"), &[0u8, 1, 0, 2]).unwrap();
        let canon = fs::canonicalize(&root).unwrap();
        assert!(read_utf8_file(&canon.join("bin.dat")).is_err());
    }

    /// Creates `outside` (with a secret file) next to `project` and returns its path.
    fn make_outside(dir: &tempfile::TempDir) -> PathBuf {
        let outside = dir.path().join("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();
        fs::canonicalize(&outside).unwrap()
    }

    /// Shared assertions: `link` (relative name inside root) points at the outside dir.
    fn assert_link_escape_rejected(canon: &Path, outside: &Path, link: &str) {
        assert!(resolve_inside_root(canon, link).is_err(), "resolve link dir");
        assert!(
            resolve_inside_root(canon, &format!("{link}/secret.txt")).is_err(),
            "read through link"
        );
        assert!(list_dir_impl(canon, link).is_err(), "list through link");
        assert!(
            resolve_new_under_root(canon, &format!("{link}/secret.txt")).is_err(),
            "overwrite through link"
        );
        assert!(
            resolve_new_under_root(canon, &format!("{link}/new.txt")).is_err(),
            "create through link"
        );
        assert!(
            resolve_new_under_root(canon, &format!("{link}/newdir/new.txt")).is_err(),
            "create nested through link"
        );
        // walking the project must not surface files from beyond the link
        let walked = walk_files_impl(canon, "secret").unwrap();
        assert!(walked.is_empty(), "walk followed link: {walked:?}");
        assert_eq!(fs::read_to_string(outside.join("secret.txt")).unwrap(), "secret");
    }

    #[cfg(windows)]
    #[test]
    fn rejects_junction_escape() {
        let (dir, canon) = setup();
        let outside = make_outside(&dir);
        let link = canon.join("jlink");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(&outside)
            .output()
            .expect("run mklink");
        assert!(status.status.success(), "mklink /J failed: {status:?}");
        assert_link_escape_rejected(&canon, &outside, "jlink");
    }

    #[cfg(windows)]
    #[test]
    fn rejects_symlink_dir_escape() {
        let (dir, canon) = setup();
        let outside = make_outside(&dir);
        if let Err(e) = std::os::windows::fs::symlink_dir(&outside, canon.join("slink")) {
            eprintln!("skipping rejects_symlink_dir_escape: cannot create symlink ({e})");
            return;
        }
        assert_link_escape_rejected(&canon, &outside, "slink");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let (dir, canon) = setup();
        let outside = make_outside(&dir);
        std::os::unix::fs::symlink(&outside, canon.join("slink")).unwrap();
        assert_link_escape_rejected(&canon, &outside, "slink");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_file_escape() {
        let (dir, canon) = setup();
        let outside = make_outside(&dir);
        std::os::unix::fs::symlink(outside.join("secret.txt"), canon.join("flink")).unwrap();
        assert!(resolve_inside_root(&canon, "flink").is_err());
        assert!(resolve_new_under_root(&canon, "flink").is_err());
    }
}
