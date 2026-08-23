use serde::Serialize;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BinaryStatus {
    pub path: String,
    pub exists: bool,
    pub version: Option<String>,
    /// Why validation failed (spawn error, non-zero exit, timeout). `None` when
    /// the binary is fine — this is what lets the UI explain "not found".
    pub error: Option<String>,
}

/// Kill a process by pid (cross-platform). Used to reap a binary that hangs
/// instead of exiting on `--version`.
fn kill_pid(pid: u32) {
    #[cfg(windows)]
    {
        Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .output()
            .ok();
    }
    #[cfg(not(windows))]
    {
        Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .ok();
    }
}

/// Run `<path> --version` and return its banner, or an error reason. Captures
/// BOTH stdout and stderr — ffmpeg/ffprobe log their version to stderr, and a
/// binary that fails to start logs the loader error there too.
fn run_version(path: &str) -> Result<String, String> {
    let mut cmd = Command::new(path);
    cmd.arg("--version")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Run with the executable's own directory as CWD so side-by-side DLLs
    // (ffmpeg's av*.dll, etc.) resolve regardless of the app's working dir.
    if let Some(dir) = std::path::Path::new(path).parent() {
        cmd.current_dir(dir);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start binary: {e}"))?;
    let pid = child.id();
    let (tx, rx) = mpsc::channel::<Result<String, String>>();
    std::thread::spawn(move || {
        let res = child
            .wait_with_output()
            .map_err(|e| e.to_string())
            .and_then(|o| {
                let out = String::from_utf8_lossy(&o.stdout).to_string();
                let err = String::from_utf8_lossy(&o.stderr).to_string();
                // ffmpeg/ffprobe log their banner to stderr, and some builds also exit
                // non-zero on the `--version` flag itself. If the output clearly carries
                // a version banner, the binary is valid — don't fail on the exit code.
                let text = if out.trim().is_empty() {
                    err.clone()
                } else {
                    out
                };
                let has_version = text.to_ascii_lowercase().contains("version");
                if o.status.success() || has_version {
                    // Keep just the first line (e.g. "ffmpeg version 8.1.1-...").
                    let first_line = text.lines().next().unwrap_or("").trim().to_string();
                    Ok(first_line)
                } else {
                    let msg = if err.trim().is_empty() {
                        format!("exited with status {o_status}", o_status = o.status)
                    } else {
                        err.trim().to_string()
                    };
                    Err(msg)
                }
            });
        let _ = tx.send(res);
    });
    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(v) => v,
        Err(_) => {
            kill_pid(pid);
            Err("timed out after 5s (binary hung on --version)".to_string())
        }
    }
}

/// True if the binary at `path` runs `--version` successfully (bounded).
fn binary_runs(path: &str) -> bool {
    run_version(path).is_ok()
}

/// Locate `name` on the system: first the user-configured path (if it works),
/// then the system PATH. Returns `None` if it can't be found anywhere.
pub fn resolve_binary(name: &str, configured: &str) -> Option<String> {
    if !configured.trim().is_empty() && binary_runs(configured) {
        return Some(configured.to_string());
    }
    which(name)
}

#[cfg(windows)]
fn which(name: &str) -> Option<String> {
    let out = Command::new("where").arg(name).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    s.lines().next().map(|l| l.trim().to_string())
}

#[cfg(not(windows))]
fn which(name: &str) -> Option<String> {
    let out = Command::new("which").arg(name).output().ok()?;
    let s = String::from_utf8_lossy(&out.stdout);
    s.lines().next().map(|l| l.trim().to_string())
}

// NOTE: these are async and offload the blocking process spawn onto a
// background thread (`spawn_blocking`). A synchronous `#[tauri::command]` runs on
// the webview's main thread, so a slow/broken binary would freeze the UI while
// it checks — exactly the "Settings page hangs" symptom.

#[tauri::command]
pub async fn resolve_ytdlp_path() -> String {
    tauri::async_runtime::spawn_blocking(|| resolve_binary("yt-dlp", "/usr/local/bin/yt-dlp"))
        .await
        .unwrap_or_default()
        .unwrap_or_default()
}

#[tauri::command]
pub async fn resolve_ffmpeg_path() -> String {
    tauri::async_runtime::spawn_blocking(|| resolve_binary("ffmpeg", "/usr/local/bin/ffmpeg"))
        .await
        .unwrap_or_default()
        .unwrap_or_default()
}

#[tauri::command]
pub async fn get_binary_version(path: String) -> Option<String> {
    let p = path.clone();
    tauri::async_runtime::spawn_blocking(move || run_version(&p))
        .await
        .ok()
        .and_then(|r| r.ok())
}

#[tauri::command]
pub async fn validate_path(path: String) -> BinaryStatus {
    let p = path.clone();
    let result = tauri::async_runtime::spawn_blocking(move || run_version(&p))
        .await
        .unwrap_or_else(|e| Err(e.to_string()));
    let (exists, version, error) = match &result {
        Ok(v) => (true, Some(v.clone()), None),
        Err(e) => (false, None, Some(e.clone())),
    };
    BinaryStatus {
        path,
        exists,
        version,
        error,
    }
}
