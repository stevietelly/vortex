use serde::Serialize;
use std::process::Command;

use crate::commands::binary;
use crate::commands::hide_console;
use crate::commands::settings;

/// Cap on playlist entries pulled for the Info view. Matches the UI's
/// partial-list rendering and stops YouTube Mix/radio links (which never end)
/// from paging indefinitely during fetch.
const PLAYLIST_ENTRY_LIMIT: u32 = 100;

/// One selectable download format. `id` is the literal yt-dlp `-f` selector.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FormatOption {
    pub id: String,
    pub label: String,
    pub container: String,
    pub ext: String,
    pub filesize: Option<u64>,
    /// True when `filesize` is only an estimate (yt-dlp's `filesize_approx`,
    /// or a sum of streams where at least one part is approximate) — the UI
    /// renders these with a `~` prefix.
    pub size_approx: bool,
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

/// Raw codec strings (a missing field means the container doesn't declare it).
fn vcodec(x: &serde_json::Value) -> &str {
    x.get("vcodec").and_then(|v| v.as_str()).unwrap_or("")
}

fn acodec(x: &serde_json::Value) -> &str {
    x.get("acodec").and_then(|a| a.as_str()).unwrap_or("")
}

/// Storyboards report vcodec=none just like real audio tracks, so filter them
/// out explicitly (otherwise "Audio only (MHTML)" / bogus sizes show up).
fn is_storyboard(x: &serde_json::Value) -> bool {
    x.get("ext").and_then(|e| e.as_str()) == Some("mhtml")
        || x.get("protocol")
            .and_then(|p| p.as_str())
            .map_or(false, |p| p.contains("mhtml"))
        || vcodec(x) == "images"
}

/// `(bytes, is_approx)` — yt-dlp reports an exact `filesize` when known and
/// falls back to `filesize_approx` (e.g. for HLS/m3u8 variants).
fn file_size(x: &serde_json::Value) -> Option<(u64, bool)> {
    if let Some(s) = x.get("filesize").and_then(|v| v.as_u64()) {
        if s > 0 {
            return Some((s, false));
        }
    }
    if let Some(s) = x.get("filesize_approx").and_then(|v| v.as_u64()) {
        if s > 0 {
            return Some((s, true));
        }
    }
    None
}

fn audio_rate(x: &serde_json::Value) -> f64 {
    x.get("abr")
        .or_else(|| x.get("tbr"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0)
}

/// (height, total bitrate) — higher wins when picking a video stream.
fn video_quality(x: &serde_json::Value) -> (u64, f64) {
    let h = x.get("height").and_then(|v| v.as_u64()).unwrap_or(0);
    let tbr = x
        .get("tbr")
        .or_else(|| x.get("vbr"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    (h, tbr)
}

fn cmp_video(a: &&serde_json::Value, b: &&serde_json::Value) -> std::cmp::Ordering {
    let (ah, at) = video_quality(a);
    let (bh, bt) = video_quality(b);
    ah.cmp(&bh)
        .then(at.partial_cmp(&bt).unwrap_or(std::cmp::Ordering::Equal))
}

/// Highest-bitrate real audio track; with `known_size_only` it only considers
/// tracks whose size we actually know (used for size estimates).
fn pick_audio<'a>(
    formats: &[&'a serde_json::Value],
    known_size_only: bool,
) -> Option<&'a serde_json::Value> {
    formats
        .iter()
        .copied()
        .filter(|x| {
            !is_storyboard(x)
                && vcodec(x) == "none"
                && acodec(x) != "none"
                && (!known_size_only || file_size(x).is_some())
        })
        .max_by(|a, b| {
            audio_rate(a)
                .partial_cmp(&audio_rate(b))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
}

/// Highest-bitrate real audio track — what `bestaudio` will pick.
fn best_audio<'a>(formats: &[&'a serde_json::Value]) -> Option<&'a serde_json::Value> {
    pick_audio(formats, false)
}

/// Quality-best candidate, preferring ones whose size we know.
fn pick_video<'a>(xs: &[&'a serde_json::Value]) -> Option<&'a serde_json::Value> {
    xs.iter()
        .copied()
        .filter(|x| file_size(x).is_some())
        .max_by(cmp_video)
        .or_else(|| xs.iter().copied().max_by(cmp_video))
}

/// Size for `bestvideo[height<=h]+bestaudio` — the sum of the chosen video
/// and audio streams, or of the single pre-merged file when the site offers no
/// separate streams. `(bytes, is_approx)`; `None` when either part's size is
/// unknown (no fake precision).
///
/// Streams with a known size win over higher-quality ones without: YouTube's
/// HLS (m3u8) variants report no size at all while same-height DASH files do,
/// and plain quality-sorting would land on a sizeless stream and yield nothing.
fn selector_size(formats: &[&serde_json::Value], max_height: Option<u32>) -> Option<(u64, bool)> {
    let fits = |x: &serde_json::Value| -> bool {
        let h = x.get("height").and_then(|v| v.as_u64()).map(|v| v as u32);
        match max_height {
            Some(cap) => h.map_or(false, |hh| hh <= cap),
            None => h.is_some(),
        }
    };
    let lower_than_cap = |x: &serde_json::Value| -> bool {
        match max_height {
            Some(cap) => video_quality(x).0 < u64::from(cap),
            None => false,
        }
    };

    let sized: Vec<&serde_json::Value> = formats
        .iter()
        .copied()
        .filter(|x| !is_storyboard(x) && vcodec(x) != "none" && fits(x))
        .collect();
    let dash: Vec<&serde_json::Value> = sized
        .iter()
        .copied()
        .filter(|x| acodec(x) == "none")
        .collect();
    let merged: Vec<&serde_json::Value> = sized
        .iter()
        .copied()
        .filter(|x| acodec(x) != "none")
        .collect();

    // DASH: video + audio summed. A stream picked from a *lower* height than
    // the option promises (the right one was sizeless) also degrades the
    // figure to an approximation.
    if let (Some(v), Some(audio)) = (pick_video(&dash), pick_audio(formats, true)) {
        if let (Some((vb, v_ap)), Some((ab, a_ap))) = (file_size(v), file_size(audio)) {
            let approx = v_ap || a_ap || lower_than_cap(v);
            return Some((vb + ab, approx));
        }
    }

    // Only pre-merged files available (or no usable DASH pair) → that size.
    let m = pick_video(&merged)?;
    let (b, ap) = file_size(m)?;
    Some((b, ap || lower_than_cap(m)))
}

/// Collapse yt-dlp's raw `formats[]` into a small, selectable set: one
/// audio-only option, one per height the video *actually* offers (a
/// `bestvideo[height<=h]+bestaudio` selector), and a "best" fallback that
/// merges streams. Each `id` is a ready-to-pass `-f` argument. Sizes are
/// exact when yt-dlp reports `filesize`; `size_approx` is set when only
/// `filesize_approx` exists or when the option sums two streams.
fn build_formats(info: &serde_json::Value) -> Vec<FormatOption> {
    let mut out = Vec::new();
    let raw: Vec<&serde_json::Value> = info
        .get("formats")
        .and_then(|f| f.as_array())
        .map(|f| f.iter().collect())
        .unwrap_or_default();

    if let Some(a) = best_audio(&raw) {
        let ext = a
            .get("ext")
            .and_then(|e| e.as_str())
            .unwrap_or("m4a")
            .to_string();
        let size = file_size(a);
        out.push(FormatOption {
            id: "bestaudio/best".to_string(),
            label: format!("Audio only ({})", ext.to_uppercase()),
            container: ext.clone(),
            ext,
            filesize: size.map(|s| s.0),
            size_approx: size.map_or(false, |s| s.1),
            has_audio: true,
            has_video: false,
            height: None,
        });
    }

    // Heights offered by *this* video — don't assume 144/240/360/720/1080;
    // odd aspect ratios yield 128/174/262/350/526/788 and would produce no
    // options at all against a hardcoded list.
    let mut heights: Vec<u32> = raw
        .iter()
        .filter(|x| !is_storyboard(x) && vcodec(x) != "none")
        .filter_map(|x| x.get("height").and_then(|h| h.as_u64()).map(|h| h as u32))
        .collect();
    heights.sort_unstable();
    heights.dedup();
    heights.reverse(); // highest first
    heights.truncate(8);
    for h in heights {
        let size = selector_size(&raw, Some(h));
        out.push(FormatOption {
            id: format!("bestvideo[height<={h}]+bestaudio/best[height<={h}]/best"),
            label: format!("{h}p"),
            container: "mp4".to_string(),
            ext: "mp4".to_string(),
            filesize: size.map(|s| s.0),
            size_approx: size.map_or(false, |s| s.1),
            has_audio: true,
            has_video: true,
            height: Some(h),
        });
    }

    // Plain `-f best` only matches *pre-merged* files; many YouTube videos
    // have none at all (adaptive-only), which yt-dlp reports as "Requested
    // format is not available". Selecting best video + audio (merged via
    // ffmpeg) works everywhere, falling back to a pre-merged file if needed.
    let best_size = selector_size(&raw, None);
    out.push(FormatOption {
        id: "bestvideo*+bestaudio/best".to_string(),
        label: "Best available".to_string(),
        container: "mp4".to_string(),
        ext: "mp4".to_string(),
        filesize: best_size.map(|s| s.0),
        size_approx: best_size.map_or(false, |s| s.1),
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
            // Prefer the count yt-dlp reports for the whole playlist, but
            // never claim fewer entries than the ones actually fetched (the
            // preview is capped at PLAYLIST_ENTRY_LIMIT).
            let fetched = entries.as_ref().map(|e| e.len() as u32).unwrap_or(0);
            let reported = info
                .get("playlist_count")
                .and_then(|c| c.as_u64())
                .unwrap_or(0) as u32;
            Some(reported.max(fetched))
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
pub async fn fetch_metadata(app: tauri::AppHandle, url: String) -> Result<VideoMetadata, String> {
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
    //
    // --flat-playlist + --playlist-end keep list fetches bounded: full
    // extraction of every entry takes minutes, and YouTube Mix/radio links
    // (list=RD...&start_radio=1) page forever without a cap. The UI already
    // renders partial listings ("+N more videos").
    let mut cmd = Command::new(&ytdlp);
    hide_console(&mut cmd);
    cmd.arg("--ignore-config")
        .arg("-J")
        .arg("--flat-playlist")
        .arg("--playlist-end")
        .arg(PLAYLIST_ENTRY_LIMIT.to_string())
        .arg(&url);
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

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> serde_json::Value {
        serde_json::json!({
            "id": "abc", "title": "t", "uploader": "u",
            "formats": [
                // storyboard: vcodec=none like real audio, must be ignored
                {"format_id": "sb0", "ext": "mhtml", "vcodec": "none", "acodec": "none"},
                {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "abr": 129.0, "filesize_approx": 1_500_000},
                // best audio (abr 160): exact size → not approximate
                {"format_id": "251", "ext": "webm", "vcodec": "none", "acodec": "opus", "abr": 160.0, "filesize": 4_000_000},
                // odd aspect-ratio heights not in any hardcoded list
                {"format_id": "396", "ext": "mp4", "vcodec": "av01", "acodec": "none", "height": 128},
                {"format_id": "397", "ext": "mp4", "vcodec": "av01", "acodec": "none", "height": 350, "filesize_approx": 200_000_000},
                {"format_id": "398", "ext": "mp4", "vcodec": "av01", "acodec": "none", "height": 788, "tbr": 1500.0, "filesize": 700_000_000},
                {"format_id": "616", "ext": "mp4", "vcodec": "av01", "acodec": "none", "height": 788, "tbr": 900.0, "filesize_approx": 650_000_000},
            ]
        })
    }

    #[test]
    fn audio_option_skips_storyboards_and_uses_best_bitrate() {
        let out = build_formats(&fixture());
        let audio = out.iter().find(|f| !f.has_video).expect("audio option");
        assert_eq!(audio.label, "Audio only (WEBM)");
        assert_eq!(audio.id, "bestaudio/best");
    }

    #[test]
    fn heights_come_from_the_video_not_a_hardcoded_list() {
        let out = build_formats(&fixture());
        let heights: Vec<Option<u32>> = out
            .iter()
            .filter(|f| f.height.is_some())
            .map(|f| f.height)
            .collect();
        assert_eq!(heights, vec![Some(788), Some(350), Some(128)]);
        let top = out.iter().find(|f| f.height == Some(788)).unwrap();
        assert_eq!(
            top.id,
            "bestvideo[height<=788]+bestaudio/best[height<=788]/best"
        );
    }

    #[test]
    fn best_available_merges_instead_of_using_pre_merged_best() {
        let out = build_formats(&fixture());
        let best = out.last().unwrap();
        assert_eq!(best.id, "bestvideo*+bestaudio/best");
        assert_eq!(best.label, "Best available");
    }

    #[test]
    fn sizes_sum_video_plus_audio_and_flag_approximations() {
        let out = build_formats(&fixture());

        // 788p: exact video (700 MB) + exact audio (4 MB) → exact sum.
        let top = out.iter().find(|f| f.height == Some(788)).unwrap();
        assert_eq!(top.filesize, Some(704_000_000));
        assert!(!top.size_approx);

        // 350p: video only has filesize_approx → the sum is approximate.
        let mid = out.iter().find(|f| f.height == Some(350)).unwrap();
        assert_eq!(mid.filesize, Some(204_000_000));
        assert!(mid.size_approx);

        // Audio option: best track (251, exact 4 MB), not the approx 140.
        let audio = out.iter().find(|f| !f.has_video).unwrap();
        assert_eq!(audio.filesize, Some(4_000_000));
        assert!(!audio.size_approx);

        // Best available picks the same 788p stream.
        let best = out.last().unwrap();
        assert_eq!(best.filesize, Some(704_000_000));
        assert!(!best.size_approx);
    }

    #[test]
    fn height_with_no_known_size_reports_none_not_a_guess() {
        let out = build_formats(&fixture());
        let n = out.iter().find(|f| f.height == Some(128)).unwrap();
        assert_eq!(n.filesize, None);
        assert!(!n.size_approx);
    }

    #[test]
    fn size_prefers_dash_streams_with_a_size_over_sizeless_hls() {
        // YouTube serves HLS (m3u8, no size reported) at a much higher tbr
        // than same-height DASH files — pure quality-sorting would pick the
        // sizeless stream and the estimate would vanish.
        let fx = serde_json::json!({
            "formats": [
                {"format_id": "232", "ext": "mp4", "vcodec": "avc1", "acodec": "none",
                 "height": 720, "tbr": 1265.9, "protocol": "m3u8_native"},
                {"format_id": "136", "ext": "mp4", "vcodec": "avc1", "acodec": "none",
                 "height": 720, "tbr": 489.6, "filesize": 11_237_381},
                {"format_id": "251", "ext": "webm", "vcodec": "none", "acodec": "opus",
                 "abr": 160.0, "filesize": 3_133_552},
            ]
        });
        let out = build_formats(&fx);
        let top = out.iter().find(|f| f.height == Some(720)).unwrap();
        assert_eq!(top.filesize, Some(11_237_381 + 3_133_552));
        assert!(!top.size_approx);
    }

    #[test]
    fn playlist_count_prefers_reported_total_but_never_undercounts() {
        let entries = || {
            serde_json::json!([
                {"id": "a", "title": "v1"},
                {"id": "b", "title": "v2"},
                {"id": "c", "title": "v3"}
            ])
        };

        // Reported total wins when the preview fetch was capped below it.
        let fx = serde_json::json!({
            "_type": "playlist", "id": "pl", "title": "t",
            "playlist_count": 500, "entries": entries(),
        });
        assert_eq!(map_metadata("u", &fx).playlist_count, Some(500));

        // No usable reported count → fall back to what we fetched.
        let fx = serde_json::json!({
            "_type": "playlist", "id": "pl", "title": "t",
            "entries": entries(),
        });
        assert_eq!(map_metadata("u", &fx).playlist_count, Some(3));

        // A bogus reported count must never undercut the fetched entries.
        let fx = serde_json::json!({
            "_type": "playlist", "id": "pl", "title": "t",
            "playlist_count": 2, "entries": entries(),
        });
        assert_eq!(map_metadata("u", &fx).playlist_count, Some(3));
    }

    #[test]
    fn size_from_a_lower_height_than_requested_is_flagged_approx() {
        // The 720p option can only be met by a 480p stream with a known size
        // (the real 720p is sizeless HLS) → an underestimate, so "~".
        let fx = serde_json::json!({
            "formats": [
                {"format_id": "232", "ext": "mp4", "vcodec": "avc1", "acodec": "none",
                 "height": 720, "tbr": 1265.9, "protocol": "m3u8_native"},
                {"format_id": "135", "ext": "mp4", "vcodec": "avc1", "acodec": "none",
                 "height": 480, "tbr": 293.2, "filesize": 6_729_627},
                {"format_id": "251", "ext": "webm", "vcodec": "none", "acodec": "opus",
                 "abr": 160.0, "filesize": 3_133_552},
            ]
        });
        let out = build_formats(&fx);
        let top = out.iter().find(|f| f.height == Some(720)).unwrap();
        assert_eq!(top.filesize, Some(6_729_627 + 3_133_552));
        assert!(top.size_approx);
    }
}
