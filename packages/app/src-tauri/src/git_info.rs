//! Read-only git helpers for the pane header (`±N`, branch) and the Review panel.
//!
//! Every function degrades to an empty result when the folder is not a repo or `git` is missing.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const GIT_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_DIFF_FILES: usize = 200;
const MAX_FILE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct GitSummary {
    pub branch: Option<String>,
    pub changed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiffFile {
    pub path: String,
    pub before: String,
    pub after: String,
}

/// Run `git -C <cwd> <args>`; `None` on spawn failure, non-zero exit or timeout.
fn run_git(cwd: &Path, args: &[&str]) -> Option<Vec<u8>> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(cwd)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let deadline = Instant::now() + GIT_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let out = reader.join().ok()?;
    match status {
        Some(s) if s.success() => Some(out),
        _ => None,
    }
}

/// One `git status --porcelain=v1 -z` entry (path is relative to the repo root).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StatusEntry {
    pub x: char,
    pub y: char,
    pub path: String,
}

/// Parse `--porcelain=v1 -z` output. Rename/copy entries are followed by the original path.
pub fn parse_porcelain_z(raw: &[u8]) -> Vec<StatusEntry> {
    let mut out = Vec::new();
    let mut parts = raw.split(|b| *b == 0).filter(|p| !p.is_empty());
    while let Some(part) = parts.next() {
        if part.len() < 4 || part[2] != b' ' {
            continue;
        }
        let (x, y) = (part[0] as char, part[1] as char);
        if x == '!' && y == '!' {
            continue;
        }
        let path = String::from_utf8_lossy(&part[3..]).into_owned();
        if matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C') {
            let _ = parts.next(); // original path
        }
        out.push(StatusEntry { x, y, path });
    }
    out
}

fn status_entries(cwd: &Path) -> Option<Vec<StatusEntry>> {
    let raw = run_git(cwd, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    Some(parse_porcelain_z(&raw))
}

fn branch_name(cwd: &Path) -> Option<String> {
    let clean = |b: Vec<u8>| {
        let s = String::from_utf8_lossy(&b).trim().to_string();
        (!s.is_empty()).then_some(s)
    };
    // Works on an unborn branch too; fails on a detached HEAD.
    if let Some(b) = run_git(cwd, &["symbolic-ref", "--short", "-q", "HEAD"]).and_then(clean) {
        return Some(b);
    }
    run_git(cwd, &["rev-parse", "--short", "HEAD"]).and_then(clean)
}

fn summary_for(cwd: &str) -> GitSummary {
    let dir = Path::new(cwd);
    if cwd.trim().is_empty() || !dir.is_dir() {
        return GitSummary::default();
    }
    let Some(entries) = status_entries(dir) else {
        return GitSummary::default();
    };
    GitSummary {
        branch: branch_name(dir),
        changed: entries.len() as u32,
    }
}

fn truncate_lossy(mut bytes: Vec<u8>) -> String {
    bytes.truncate(MAX_FILE_BYTES);
    String::from_utf8_lossy(&bytes).into_owned()
}

fn diff_files_for(cwd: &str) -> Vec<DiffFile> {
    let dir = Path::new(cwd);
    if cwd.trim().is_empty() || !dir.is_dir() {
        return Vec::new();
    }
    let Some(entries) = status_entries(dir) else {
        return Vec::new();
    };
    let Some(top) = run_git(dir, &["rev-parse", "--show-toplevel"]) else {
        return Vec::new();
    };
    let top = PathBuf::from(String::from_utf8_lossy(&top).trim());
    entries
        .into_iter()
        .take(MAX_DIFF_FILES)
        .map(|e| {
            let spec = format!("HEAD:{}", e.path);
            let before = run_git(&top, &["show", &spec])
                .map(truncate_lossy)
                .unwrap_or_default();
            let after = std::fs::read(top.join(&e.path))
                .map(truncate_lossy)
                .unwrap_or_default();
            DiffFile { path: e.path, before, after }
        })
        .collect()
}

#[tauri::command]
pub async fn git_status_summary(cwd: String) -> Result<GitSummary, String> {
    Ok(tauri::async_runtime::spawn_blocking(move || summary_for(&cwd))
        .await
        .unwrap_or_default())
}

#[tauri::command]
pub async fn git_diff_files(cwd: String) -> Result<Vec<DiffFile>, String> {
    Ok(tauri::async_runtime::spawn_blocking(move || diff_files_for(&cwd))
        .await
        .unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modified_untracked_deleted() {
        let raw = b" M src/a.rs\0?? new file.txt\0D  gone.txt\0!! ignored\0";
        let e = parse_porcelain_z(raw);
        assert_eq!(e.len(), 3);
        assert_eq!((e[0].x, e[0].y, e[0].path.as_str()), (' ', 'M', "src/a.rs"));
        assert_eq!(e[1].path, "new file.txt");
        assert_eq!((e[2].x, e[2].y), ('D', ' '));
    }

    #[test]
    fn rename_consumes_original_path() {
        let raw = b"R  new.rs\0old.rs\0 M other.rs\0";
        let e = parse_porcelain_z(raw);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].path, "new.rs");
        assert_eq!(e[1].path, "other.rs");
    }

    #[test]
    fn empty_and_garbage_input() {
        assert!(parse_porcelain_z(b"").is_empty());
        assert!(parse_porcelain_z(b"x\0").is_empty());
    }

    #[test]
    fn non_repo_or_missing_dir_is_empty() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(summary_for(d.path().to_str().unwrap()), GitSummary::default());
        assert!(diff_files_for(d.path().to_str().unwrap()).is_empty());
        assert_eq!(summary_for("Z:/definitely/not/here"), GitSummary::default());
        assert_eq!(summary_for(""), GitSummary::default());
    }

    fn git_available() -> bool {
        Command::new("git")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    fn g(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"])
            .args(args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success();
        assert!(ok, "git {args:?} failed");
    }

    #[test]
    fn temp_repo_summary_and_diff() {
        if !git_available() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let p = d.path();
        g(p, &["init", "-q", "-b", "main"]);
        std::fs::write(p.join("a.txt"), "one\n").unwrap();
        g(p, &["add", "a.txt"]);
        g(p, &["commit", "-q", "-m", "init"]);
        let clean = summary_for(p.to_str().unwrap());
        assert_eq!(clean, GitSummary { branch: Some("main".into()), changed: 0 });

        std::fs::write(p.join("a.txt"), "two\n").unwrap();
        std::fs::write(p.join("b.txt"), "new\n").unwrap();
        let s = summary_for(p.to_str().unwrap());
        assert_eq!(s.changed, 2);

        let mut files = diff_files_for(p.to_str().unwrap());
        files.sort_by(|a, b| a.path.cmp(&b.path));
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, "a.txt");
        assert_eq!(files[0].before.replace("\r\n", "\n"), "one\n");
        assert_eq!(files[0].after.replace("\r\n", "\n"), "two\n");
        assert_eq!(files[1].before, "");
        assert_eq!(files[1].after.trim(), "new");
    }
}
