use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::BufRead;
use std::process::Stdio;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};

use tauri::Emitter;
use tauri::Manager;

use crate::commands::binary;
use crate::commands::hide_console;
use crate::commands::settings;

/// Tracks in-flight download child processes by job id (stores the OS pid so
/// `cancel_download` can kill it across platforms). Also holds a set of job ids
/// that were cancelled while still queued (no pid yet) and a shared concurrency
/// gate that bounds how many yt-dlp processes run at once.
pub struct JobRegistry(
    pub Mutex<HashMap<String, u32>>,
    pub Mutex<HashSet<String>>,
    pub Arc<ConcurrencyGate>,
);

impl Default for JobRegistry {
    fn default() -> Self {
        JobRegistry(
            Mutex::new(HashMap::new()),
            Mutex::new(HashSet::new()),
            ConcurrencyGate::new(
                crate::commands::settings::default_settings().max_concurrent as usize,
            ),
        )
    }
}

/// Bounded concurrency limiter. `acquire` blocks (on a condvar) until a slot is
/// free, so a worker thread naturally *queues* behind the active cap instead of
/// spawning unbounded yt-dlp processes. Slots are released on drop via the RAII
/// `GateGuard`, so cancellation or early return still frees the slot.
pub struct ConcurrencyGate {
    active: Mutex<usize>,
    waiters: Condvar,
    max: AtomicUsize,
}

impl ConcurrencyGate {
    pub fn new(max: usize) -> Arc<Self> {
        Arc::new(Self {
            active: Mutex::new(0),
            waiters: Condvar::new(),
            max: AtomicUsize::new(max.max(1)),
        })
    }

    pub fn set_max(&self, max: usize) {
        self.max.store(max.max(1), Ordering::SeqCst);
        // Wake every waiter so they re-evaluate against the new cap.
        self.waiters.notify_all();
    }

    pub fn acquire(self: Arc<Self>) -> GateGuard {
        let mut active = self.active.lock().unwrap();
        while *active >= self.max.load(Ordering::SeqCst) {
            active = self.waiters.wait(active).unwrap();
        }
        *active += 1;
        GateGuard(self.clone())
    }

    fn release(&self) {
        let mut active = self.active.lock().unwrap();
        if *active > 0 {
            *active -= 1;
        }
        self.waiters.notify_one();
    }
}

/// RAII guard returned by `ConcurrencyGate::acquire`. Dropping it frees a slot
/// and wakes one queued worker.
pub struct GateGuard(Arc<ConcurrencyGate>);

impl Drop for GateGuard {
    fn drop(&mut self) {
        self.0.release();
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadStatus {
    Downloading,
    Merging,
    Done,
    Error,
    Cancelled,
}

/// Progress/state update emitted per job. The frontend listens and updates its
/// flat job map by `id` (no array scan per tick).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub status: DownloadStatus,
    pub progress: f64, // 0..100
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub output_path: Option<String>,
    pub error: Option<String>,
    pub format_id: Option<String>,
}

/// One WARNING/ERROR line reported by yt-dlp, classified so the frontend can
/// tell the user what to fix (e.g. `ffmpeg-missing` → point at Settings).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PostprocessIssue {
    pub level: String, // "warning" | "error"
    pub stage: String, // "postprocess" | "format" | "network" | "access" | "storage" | "download" | "general"
    pub code: String,  // machine-readable fix key
    pub message: String,
}

/// Emitted once a job's process exits, listing everything worth fixing.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PostprocessReport {
    pub id: String,
    pub issues: Vec<PostprocessIssue>,
}

/// Classify a raw yt-dlp output line into an issue. Returns None for lines
/// that aren't WARNING/ERROR entries.
fn classify_issue(line: &str) -> Option<PostprocessIssue> {
    let (level, msg) = if let Some(rest) = line.strip_prefix("ERROR:") {
        ("error", rest.trim())
    } else if let Some(rest) = line.strip_prefix("WARNING:") {
        ("warning", rest.trim())
    } else {
        return None;
    };
    if msg.is_empty() {
        return None;
    }
    let lower = msg.to_lowercase();
    let has_ffmpeg_problem = |word: &str| {
        lower.contains(word)
            && (lower.contains("not found")
                || lower.contains("no such")
                || lower.contains("not exist")
                || lower.contains("not installed")
                || lower.contains("unable")
                || lower.contains("failed")
                || lower.contains("is not recognized")
                || lower.contains("errno 2"))
    };
    let code = if lower.contains("pre-merged")
        || lower.contains("selects the best")
        || lower.contains("\"-f best\"")
    {
        // Advisory about the `-f best` selector — not a merge failure.
        "format-selector"
    } else if lower.contains("javascript runtime")
        || lower.contains("js runtime")
        || lower.contains("--js-runtimes")
    {
        "js-runtime"
    } else if has_ffmpeg_problem("ffprobe") {
        "ffprobe-missing"
    } else if has_ffmpeg_problem("ffmpeg") {
        "ffmpeg-missing"
    } else if lower.contains("requested format is not available")
        || lower.contains("format not available")
        || lower.contains("requested format not")
    {
        "format-unavailable"
    } else if lower.contains("merge") || lower.contains("merger") {
        "merge-failed"
    } else if lower.contains("postprocess") || lower.contains("post-processing") {
        "postprocess-failed"
    } else if lower.contains("subtitle") {
        "subtitle-failed"
    } else if lower.contains("embed") {
        "embed-failed"
    } else if lower.contains("http error")
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connection")
        || lower.contains("network")
        || lower.contains("temporary failure")
    {
        "network-error"
    } else if lower.contains("sign in")
        || lower.contains("confirm you")
        || lower.contains("not a bot")
        || lower.contains("cookies")
        || lower.contains("login")
        || lower.contains("authentication")
    {
        "auth-required"
    } else if lower.contains("geo") || lower.contains("not available in your country") {
        "geo-blocked"
    } else if lower.contains("no space") || lower.contains("disk") || lower.contains("errno 28") {
        "disk-full"
    } else if lower.contains("private video") || lower.contains("video unavailable") {
        "unavailable"
    } else if level == "error" {
        "download-failed"
    } else {
        "general"
    };
    let stage = match code {
        "ffmpeg-missing" | "ffprobe-missing" | "merge-failed" | "postprocess-failed"
        | "subtitle-failed" | "embed-failed" => "postprocess",
        "format-unavailable" | "format-selector" => "format",
        "js-runtime" => "metadata",
        "network-error" => "network",
        "auth-required" | "geo-blocked" | "unavailable" => "access",
        "disk-full" => "storage",
        _ => {
            if level == "error" {
                "download"
            } else {
                "general"
            }
        }
    };
    Some(PostprocessIssue {
        level: level.to_string(),
        stage: stage.to_string(),
        code: code.to_string(),
        message: msg.to_string(),
    })
}

fn expand_path(p: &str) -> String {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    if let Some(rest) = p.strip_prefix("~/") {
        format!("{}/{}", home, rest)
    } else if let Some(rest) = p.strip_prefix('~') {
        format!("{}{}", home, rest)
    } else {
        p.to_string()
    }
}

fn kill_pid(pid: u32) {
    if cfg!(windows) {
        let mut cmd = std::process::Command::new("taskkill");
        hide_console(&mut cmd);
        cmd.args(["/PID", &pid.to_string(), "/F", "/T"])
            .output()
            .ok();
    } else {
        std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .output()
            .ok();
    }
}

/// Parse a yt-dlp `[download]` line for percentage / speed / eta.
fn parse_progress(line: &str) -> Option<(f64, Option<String>, Option<String>)> {
    if !line.contains("[download]") {
        return None;
    }
    let pct = line
        .split_whitespace()
        .find(|t| t.ends_with('%'))
        .and_then(|t| t.trim_end_matches('%').parse::<f64>().ok())?;
    let tokens: Vec<&str> = line.split_whitespace().collect();
    let mut speed = None;
    let mut eta = None;
    for (i, t) in tokens.iter().enumerate() {
        if *t == "at" && i + 1 < tokens.len() {
            speed = Some(tokens[i + 1].to_string());
        }
        if *t == "ETA" && i + 1 < tokens.len() {
            eta = Some(tokens[i + 1].to_string());
        }
    }
    Some((pct, speed, eta))
}

/// True if the yt-dlp error is a format-selection problem we can recover from
/// by trying another format (closest resolution, or `best`).
fn is_format_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    m.contains("requested format is not available")
        || m.contains("format not available")
        || m.contains("has no audio")
        || m.contains("has no video")
        || m.contains("no format")
        || m.contains("format selection")
}

/// True if the failure was a missing/incomplete ffmpeg (or ffprobe) — the
/// next candidate may still work as a pre-merged file without merging, so the
/// ladder gets one more try before giving up.
fn is_ffmpeg_error(msg: &str) -> bool {
    let m = msg.to_lowercase();
    (m.contains("ffmpeg") || m.contains("ffprobe"))
        && (m.contains("not found")
            || m.contains("not installed")
            || m.contains("without")
            || m.contains("no such")
            || m.contains("failed")
            || m.contains("is not recognized"))
}

/// Start a download. Spawns yt-dlp in a background thread, parses its
/// `--newline` progress output, and emits `download-progress` events. Returns
/// the job id. `cancel_download` kills the process by pid.
///
/// `playlist_items` selects a single entry of a playlist by index (so each
/// track can be downloaded as its own job / resumed independently). `resume`
/// appends yt-dlp's `--continue` so an interrupted file is resumed. `job_id`
/// lets a resumption reuse the same id as the original (interrupted) job.
#[tauri::command]
pub async fn start_download(
    app: tauri::AppHandle,
    url: String,
    format_id: String,
    fallback_format_ids: Option<Vec<String>>,
    playlist_items: Option<u32>,
    resume: Option<bool>,
    job_id: Option<String>,
    download_dir: Option<String>,
) -> Result<String, String> {
    let app2 = app;
    let settings = settings::load_settings(app2.clone()).await;
    let ytdlp = binary::resolve_binary("yt-dlp", &settings.ytdlp_path).ok_or_else(|| {
        "yt-dlp not found. Install it on PATH or set its path in Settings.".to_string()
    })?;
    let base_dir = match &download_dir {
        Some(d) if !d.trim().is_empty() => d.clone(),
        _ => settings.download_dir.clone(),
    };
    let download_dir = expand_path(&base_dir);
    let outtmpl = if settings.filename_template.trim().is_empty() {
        format!("{}/%(title)s.%(ext)s", download_dir)
    } else {
        format!("{}/{}", download_dir, settings.filename_template)
    };

    let id = job_id.unwrap_or_else(|| {
        format!(
            "dl-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        )
    });

    let dl_dir = download_dir.clone();
    let id_for_thread = id.clone();

    std::thread::spawn(move || {
        // Respect the concurrency cap: block until a slot is free. This is what
        // lets multiple downloads run in parallel (up to `maxConcurrent`) while
        // the rest queue instead of all saturating the network/CPU at once.
        let gate = app2.state::<JobRegistry>().2.clone();
        let _guard = gate.acquire();

        // Cancelled while still queued (no pid yet)? Skip without ever spawning
        // yt-dlp and release the slot via the guard's Drop.
        if app2
            .state::<JobRegistry>()
            .1
            .lock()
            .unwrap()
            .remove(&id_for_thread)
        {
            let _ = app2.emit(
                "download-progress",
                DownloadProgress {
                    id: id_for_thread.clone(),
                    status: DownloadStatus::Cancelled,
                    progress: 0.0,
                    speed: None,
                    eta: None,
                    output_path: None,
                    error: None,
                    format_id: None,
                },
            );
            return;
        }

        // Ordered list of format selectors to try. The frontend may pass a
        // graded ladder (closest resolution down, then up, then best); otherwise
        // we try the requested id followed by a guaranteed `best`.
        let mut candidates: Vec<String> =
            fallback_format_ids.unwrap_or_else(|| vec![format_id.clone()]);
        if candidates.is_empty() {
            candidates.push(format_id.clone());
        }
        if candidates.first() != Some(&format_id) {
            candidates.insert(0, format_id.clone());
        }
        // Always end with the merge-based and pre-merged fallbacks: a plain
        // `-f best` can fail outright on adaptive-only videos, while the
        // merge selector needs ffmpeg — between them one of them works.
        for extra in ["bestvideo*+bestaudio/best", "best"] {
            if !candidates.iter().any(|c| c == extra) {
                candidates.push(extra.to_string());
            }
        }

        let mut last_error: Option<String> = None;

        for (i, fid) in candidates.iter().enumerate() {
            if i > 0 {
                // Switch formats without flashing an error to the UI.
                let _ = app2.emit(
                    "download-progress",
                    DownloadProgress {
                        id: id_for_thread.clone(),
                        status: DownloadStatus::Downloading,
                        progress: 0.0,
                        speed: None,
                        eta: None,
                        output_path: None,
                        error: None,
                        format_id: Some(fid.clone()),
                    },
                );
            }

            let mut cmd = std::process::Command::new(&ytdlp);
            hide_console(&mut cmd);
            cmd.arg("--ignore-config")
                .arg("-f")
                .arg(fid)
                .arg("-o")
                .arg(&outtmpl)
                .arg("--newline");
            if let Some(n) = playlist_items {
                cmd.arg("--playlist-items").arg(n.to_string());
                // Also stop enumeration at this entry: a YouTube Mix/radio
                // (list=RD...) has no end, so yt-dlp would keep paging the
                // list forever before reaching item n.
                cmd.arg("--playlist-end").arg(n.to_string());
            } else {
                cmd.arg("--no-playlist");
            }
            if resume == Some(true) {
                cmd.arg("--continue");
            }
            cmd.arg(&url);
            if !settings.proxy_url.is_empty() {
                cmd.arg("--proxy").arg(&settings.proxy_url);
            }
            if !settings.rate_limit.is_empty() {
                cmd.arg("-r").arg(&settings.rate_limit);
            }
            if settings.embed_metadata {
                cmd.arg("--embed-metadata");
            }
            if settings.embed_thumbnail {
                cmd.arg("--embed-thumbnail");
            }
            if settings.write_subs {
                cmd.arg("--write-subs")
                    .arg("--sub-langs")
                    .arg(&settings.sub_langs);
            }
            if settings.split_chapters {
                cmd.arg("--split-chapters");
            }
            settings::apply_cookies(&mut cmd, &settings);
            if let Some(ffmpeg) = binary::resolve_binary("ffmpeg", &settings.ffmpeg_path) {
                if let Some(dir) = std::path::Path::new(&ffmpeg).parent() {
                    cmd.arg("--ffmpeg-location").arg(dir);
                }
            }
            cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    last_error = Some(format!("Failed to start yt-dlp at '{ytdlp}': {e}"));
                    break;
                }
            };
            let pid = child.id();
            app2.state::<JobRegistry>()
                .0
                .lock()
                .unwrap()
                .insert(id_for_thread.clone(), pid);

            // Capture stderr so we can surface the real yt-dlp failure reason
            // (format unavailable / private / geo-blocked / disk full / merge
            // failure) instead of a generic "Download failed". WARNING/ERROR
            // lines are also classified into postprocess issues.
            let err_buf = Arc::new(Mutex::new(String::new()));
            let issues: Arc<Mutex<Vec<PostprocessIssue>>> = Arc::new(Mutex::new(Vec::new()));
            let stderr_handle = child.stderr.take().map(|stderr| {
                let err_buf = err_buf.clone();
                let issues = issues.clone();
                std::thread::spawn(move || {
                    let reader = std::io::BufReader::new(stderr);
                    for line in reader.lines().flatten() {
                        if let Some(msg) = line.strip_prefix("ERROR:") {
                            *err_buf.lock().unwrap() = msg.trim().to_string();
                        }
                        if let Some(issue) = classify_issue(&line) {
                            let mut list = issues.lock().unwrap();
                            if !list.iter().any(|i| i.message == issue.message) {
                                list.push(issue);
                            }
                        }
                    }
                })
            });

            let mut output_path: Option<String> = None;
            if let Some(stdout) = child.stdout.take() {
                let reader = std::io::BufReader::new(stdout);
                for line in reader.lines().flatten() {
                    if let Some(dest) = line.strip_prefix("[download] Destination: ") {
                        output_path = Some(dest.trim().to_string());
                    } else if let Some(issue) = classify_issue(&line) {
                        let mut list = issues.lock().unwrap();
                        if !list.iter().any(|i| i.message == issue.message) {
                            list.push(issue);
                        }
                    } else if line.contains("Merg") {
                        let _ = app2.emit(
                            "download-progress",
                            DownloadProgress {
                                id: id_for_thread.clone(),
                                status: DownloadStatus::Merging,
                                progress: 100.0,
                                speed: None,
                                eta: None,
                                output_path: None,
                                error: None,
                                format_id: None,
                            },
                        );
                    } else if let Some((pct, speed, eta)) = parse_progress(&line) {
                        let _ = app2.emit(
                            "download-progress",
                            DownloadProgress {
                                id: id_for_thread.clone(),
                                status: DownloadStatus::Downloading,
                                progress: pct,
                                speed,
                                eta,
                                output_path: None,
                                error: None,
                                format_id: None,
                            },
                        );
                    }
                }
            }

            let status = child.wait().map(|s| s.success()).unwrap_or(false);
            if let Some(h) = stderr_handle {
                let _ = h.join();
            }
            let error_msg = if status {
                None
            } else {
                let captured = err_buf.lock().unwrap().clone();
                Some(if captured.is_empty() {
                    "Download failed (yt-dlp exited with an error).".to_string()
                } else {
                    captured
                })
            };

            // Hand everything worth fixing to the frontend (it persists the
            // report against the job's item so failures stay diagnosable).
            {
                let list = issues.lock().unwrap();
                if !list.is_empty() {
                    let _ = app2.emit(
                        "postprocess-issues",
                        PostprocessReport {
                            id: id_for_thread.clone(),
                            issues: list.clone(),
                        },
                    );
                }
            }

            if status {
                let _ = app2.emit(
                    "download-progress",
                    DownloadProgress {
                        id: id_for_thread.clone(),
                        status: DownloadStatus::Done,
                        progress: 100.0,
                        speed: None,
                        eta: None,
                        output_path: output_path.or(Some(dl_dir.clone())),
                        error: None,
                        format_id: None,
                    },
                );
                app2.state::<JobRegistry>()
                    .0
                    .lock()
                    .unwrap()
                    .remove(&id_for_thread);
                return;
            }

            last_error = error_msg.clone();
            let retryable = error_msg
                .as_ref()
                .map(|m| is_format_error(m) || is_ffmpeg_error(m))
                .unwrap_or(false);
            if retryable && i + 1 < candidates.len() {
                continue; // try the next candidate format
            }
            let cancelled = app2
                .state::<JobRegistry>()
                .1
                .lock()
                .unwrap()
                .contains(&id_for_thread);
            let _ = app2.emit(
                "download-progress",
                DownloadProgress {
                    id: id_for_thread.clone(),
                    status: if cancelled {
                        DownloadStatus::Cancelled
                    } else {
                        DownloadStatus::Error
                    },
                    progress: 0.0,
                    speed: None,
                    eta: None,
                    output_path: None,
                    error: if cancelled { None } else { error_msg },
                    format_id: None,
                },
            );
            app2.state::<JobRegistry>()
                .0
                .lock()
                .unwrap()
                .remove(&id_for_thread);
            return;
        }

        // Loop exited without a successful download (e.g. spawn failure).
        let cancelled = app2
            .state::<JobRegistry>()
            .1
            .lock()
            .unwrap()
            .contains(&id_for_thread);
        let _ = app2.emit(
            "download-progress",
            DownloadProgress {
                id: id_for_thread.clone(),
                status: if cancelled {
                    DownloadStatus::Cancelled
                } else {
                    DownloadStatus::Error
                },
                progress: 0.0,
                speed: None,
                eta: None,
                output_path: None,
                error: if cancelled { None } else { last_error },
                format_id: None,
            },
        );
        app2.state::<JobRegistry>()
            .0
            .lock()
            .unwrap()
            .remove(&id_for_thread);
    });

    Ok(id)
}

/// Cancel an in-flight download by killing its process.
#[tauri::command]
pub fn cancel_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, JobRegistry>,
    id: String,
) -> Result<(), String> {
    if let Some(pid) = state.0.lock().unwrap().remove(&id) {
        kill_pid(pid);
        // Mark as cancelled so the worker emits `Cancelled` instead of `Error`
        // once the killed process exits.
        state.1.lock().unwrap().insert(id.clone());
    } else {
        // No pid yet => still queued. Flag it so the worker skips starting and
        // emits `Cancelled` when its slot opens.
        state.1.lock().unwrap().insert(id.clone());
    }
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            id,
            status: DownloadStatus::Cancelled,
            progress: 0.0,
            speed: None,
            eta: None,
            output_path: None,
            error: None,
            format_id: None,
        },
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code_of(line: &str) -> String {
        classify_issue(line).expect("should classify").code
    }

    #[test]
    fn best_selector_advisory_is_not_a_merge_failure() {
        // This exact line was stored as "merge-failed" before.
        assert_eq!(
            code_of(
                r#"WARNING: "-f best" selects the best pre-merged format which is often not the best option."#
            ),
            "format-selector"
        );
    }

    #[test]
    fn js_runtime_warning_gets_its_own_code() {
        assert_eq!(
            code_of("WARNING: [youtube] No supported JavaScript runtime could be found. Only deno is enabled by default"),
            "js-runtime"
        );
    }

    #[test]
    fn ffprobe_message_is_classified_as_ffprobe_missing() {
        assert_eq!(
            code_of("ERROR: Unable to extract metadata: ffprobe not found. Install it or pass --ffmpeg-location"),
            "ffprobe-missing"
        );
    }

    #[test]
    fn format_and_merge_errors_keep_their_codes() {
        assert_eq!(
            code_of("ERROR: [youtube] s3a4OQR-10M: Requested format is not available. Use --list-formats for a list of available formats"),
            "format-unavailable"
        );
        assert_eq!(
            code_of("ERROR: Postprocessing: ffmpeg not found"),
            "ffmpeg-missing"
        );
    }

    #[test]
    fn unknown_lines_are_ignored() {
        assert!(classify_info_is_none());
    }

    fn classify_info_is_none() -> bool {
        classify_issue("[youtube] Extracting URL: https://youtu.be/x").is_none()
            && classify_issue("WARNING: ").is_none()
    }

    #[test]
    fn ffmpeg_and_format_failures_are_retryable() {
        assert!(is_ffmpeg_error("Postprocessing: ffmpeg not found"));
        assert!(is_format_error(
            "Requested format is not available. Use --list-formats"
        ));
        assert!(!is_ffmpeg_error("HTTP Error 403: Forbidden"));
    }
}
