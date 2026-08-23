use serde::Serialize;
use std::process::Command;

use crate::commands::binary;
use crate::commands::settings;

/// One selectable download format. `id` is the literal yt-dlp `-f` selector.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FormatOption {
    pub id: String,
    pub label: String,
    pub container: String,
    pub ext: String,
    pub filesize: Option<u64>,
    pub has_audio: bool,
    pub has_video: bool,
    pub height: Option<u32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistEntry {
    pub index: u32,
    pub title: String,
    pub duration: u64,
    pub uploader: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub id: String,
    pub url: String,
    pub title: String,
    pub uploader: String,
    pub upload_date: Option<String>,
    pub duration: u64,
    pub views: Option<u64>,
    pub likes: Option<u64>,
    pub description: Option<String>,
    pub thumbnail: String,
    pub is_playlist: bool,
    pub playlist_count: Option<u32>,
    pub entries: Option<Vec<PlaylistEntry>>,
    pub formats: Vec<FormatOption>,
}

fn format_upload_date(raw: &str) -> String {
    // yt-dlp emits YYYYMMDD; normalize to YYYY-MM-DD.
    if raw.len() == 8 {
        format!("{}-{}-{}", &raw[0..4], &raw[4..6], &raw[6..8])
    } else {
        raw.to_string()
    }
}

fn as_u64_secs(v: &serde_json::Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_f64().map(|d| d as u64))
}

/// Collapse yt-dlp's raw `formats[]` into a small, selectable set: one
/// audio-only option, one per common height (combined video+audio selector),
/// and a "best" fallback. Each `id` is a ready-to-pass `-f` argument.
fn build_formats(info: &serde_json::Value) -> Vec<FormatOption> {
    let mut out = Vec::new();

    if let Some(best_audio) = info
        .get("formats")
        .and_then(|f| f.as_array())
        .and_then(|f| {
            f.iter()
                .find(|x| x.get("vcodec").and_then(|v| v.as_str()) == Some("none"))
        })
    {
        let ext = best_audio
            .get("ext")
            .and_then(|e| e.as_str())
            .unwrap_or("m4a")
            .to_string();
        out.push(FormatOption {
            id: "bestaudio/best".to_string(),
            label: format!("Audio only ({})", ext.to_uppercase()),
            container: ext.clone(),
            ext,
            filesize: best_audio
                .get("filesize")
                .and_then(|s| s.as_u64())
                .or(best_audio.get("filesize_approx").and_then(|s| s.as_u64())),
            has_audio: true,
            has_video: false,
            height: None,
        });
    }

    let heights = [2160u32, 1440, 1080, 720, 480, 360, 240];
    for h in heights {
        let has = info
            .get("formats")
            .and_then(|f| f.as_array())
            .map(|f| {
                f.iter().any(|x| {
                    x.get("vcodec").and_then(|v| v.as_str()) != Some("none")
                        && x.get("height").and_then(|hh| hh.as_u64()) == Some(h as u64)
                })
            })
            .unwrap_or(false);
        if has {
            out.push(FormatOption {
                id: format!("bestvideo[height<={h}]+bestaudio/best[height<={h}]/best"),
                label: format!("{h}p"),
                container: "mp4".to_string(),
                ext: "mp4".to_string(),
                filesize: None,
                has_audio: true,
                has_video: true,
                height: Some(h),
            });
        }
    }

    out.push(FormatOption {
        id: "best".to_string(),
        label: "Best available".to_string(),
        container: "mp4".to_string(),
        ext: "mp4".to_string(),
        filesize: None,
        has_audio: true,
        has_video: true,
        height: None,
    });
    out
}

fn map_entry(entry: &serde_json::Value, index: u32) -> PlaylistEntry {
    PlaylistEntry {
        index,
        title: entry
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("Untitled")
            .to_string(),
        duration: as_u64_secs(entry.get("duration").unwrap_or(&serde_json::Value::Null))
            .unwrap_or(0),
        uploader: entry
            .get("uploader")
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .to_string(),
    }
}

fn is_playlist(info: &serde_json::Value) -> bool {
    info.get("_type").and_then(|t| t.as_str()) == Some("playlist")
}

pub fn map_metadata(url: &str, info: &serde_json::Value) -> VideoMetadata {
    let playlist = is_playlist(info);
    let entries: Option<Vec<PlaylistEntry>> = if playlist {
        info.get("entries").and_then(|e| e.as_array()).map(|arr| {
            arr.iter()
                .filter(|e| e.get("title").is_some())
                .enumerate()
                .map(|(i, e)| map_entry(e, (i + 1) as u32))
                .collect()
        })
    } else {
        None
    };

    VideoMetadata {
        id: info
            .get("id")
            .and_then(|i| i.as_str())
            .unwrap_or("")
            .to_string(),
        url: info
            .get("webpage_url")
            .and_then(|u| u.as_str())
            .unwrap_or(url)
            .to_string(),
        title: info
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("Untitled")
            .to_string(),
        uploader: info
            .get("uploader")
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .to_string(),
        upload_date: info
            .get("upload_date")
            .and_then(|d| d.as_str())
            .map(format_upload_date),
        duration: as_u64_secs(info.get("duration").unwrap_or(&serde_json::Value::Null))
            .unwrap_or(0),
        views: info.get("view_count").and_then(|v| v.as_u64()),
        likes: info.get("like_count").and_then(|v| v.as_u64()),
        description: info
            .get("description")
            .and_then(|d| d.as_str())
            .map(|s| s.to_string()),
        thumbnail: info
            .get("thumbnail")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string(),
        is_playlist: playlist,
        playlist_count: if playlist {
            Some(entries.as_ref().map(|e| e.len() as u32).unwrap_or_else(|| {
                info.get("playlist_count")
                    .and_then(|c| c.as_u64())
                    .unwrap_or(0) as u32
            }))
        } else {
            None
        },
        entries,
        formats: build_formats(info),
    }
}

/// Fetch metadata for a URL via `yt-dlp -J <url>` and map it to `VideoMetadata`.
///
/// Error states (private/age-restricted, geo-blocked, invalid URL, missing
/// binary) surface as `Err` with yt-dlp's "ERROR: ..." line so the UI can show
/// them. yt-dlp path comes from saved settings, falling back to the default.
#[tauri::command]
pub async fn fetch_metadata(
    app: tauri::AppHandle,
    url: String,
) -> Result<VideoMetadata, String> {
    let settings = settings::load_settings(app.clone()).await;
    let ytdlp = match binary::resolve_binary("yt-dlp", &settings.ytdlp_path) {
        Some(p) => p,
        None => {
            let msg =
                "yt-dlp not found. Install it on PATH or set its path in Settings.".to_string();
            return Err(msg);
        }
    };

    // --ignore-config keeps yt-dlp from inheriting a default `-f` (or other
    // options) from a user/global config file, which would otherwise be applied
    // to our `-J` fetch and can surface as spurious "Requested format is not
    // available" errors for videos lacking the configured tracks.
    let mut cmd = Command::new(&ytdlp);
    cmd.arg("--ignore-config").arg("-J").arg(&url);
    settings::apply_cookies(&mut cmd, &settings);
    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            let msg = format!("Failed to run yt-dlp at '{ytdlp}': {e}");
            return Err(msg);
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let msg = stderr
            .lines()
            .find(|l| l.starts_with("ERROR:"))
            .unwrap_or("yt-dlp exited with an error")
            .to_string();
        return Err(msg);
    }

    let info: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(v) => v,
        Err(e) => {
            let msg = format!("Failed to parse yt-dlp output: {e}");
            return Err(msg);
        }
    };

    let metadata = map_metadata(&url, &info);

    Ok(metadata)
}
