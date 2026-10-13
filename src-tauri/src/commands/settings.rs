use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;
use tauri::Manager;

use crate::commands::download::JobRegistry;

/// A named download destination. Lets the user route a specific download to a
/// particular folder (e.g. "Music", "Work") instead of the global download dir.
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderProfile {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// Domain-bound destination: URLs whose host equals `domain` (or is a
/// subdomain of it) save into `path`. The domain is derived from a URL at
/// creation and doubles as the default title; the binding itself is never
/// exposed to the UI afterwards (only `title`/`path` are edited).
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveLocation {
    pub id: String,
    pub title: String,
    pub path: String,
    pub domain: String,
}

/// Mirrors `AppSettings` in src/types.ts (camelCase keys match the frontend).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub ytdlp_path: String,
    pub ffmpeg_path: String,
    pub download_dir: String,
    pub max_concurrent: u32,
    pub default_format: String,
    pub default_quality: String,
    pub embed_metadata: bool,
    pub embed_thumbnail: bool,
    pub prefer_free_formats: bool,
    pub write_subs: bool,
    pub sub_langs: String,
    pub rate_limit: String,
    pub proxy_url: String,
    pub cookies_file: String,
    #[serde(default)]
    pub cookies_browser: String,
    pub filename_template: String,
    pub split_chapters: bool,
    pub keep_original_audio: bool,
    pub audio_quality: String,
    pub check_for_updates: bool,
    #[serde(default)]
    pub folder_profiles: Vec<FolderProfile>,
    #[serde(default)]
    pub save_locations: Vec<SaveLocation>,
    #[serde(default)]
    pub active_profile_id: String,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_version: Option<String>,
    #[serde(default)]
    pub mock_mode: bool,
    /// Show a native OS notification when a download finishes or fails.
    /// `default_true` so settings.json files stored before this field existed
    /// keep parsing (a missing required field would discard all user settings).
    #[serde(default = "default_true")]
    pub notify_on_complete: bool,
    /// Pull the window into view when a metadata fetch finishes if it isn't
    /// already; on failure, show a notification instead of pulling focus.
    #[serde(default = "default_true")]
    pub focus_on_fetch: bool,
    /// What to do with URLs sent from the browser extension: "prefetch" opens
    /// the Info page (fetch + review), "download" fetches in the background
    /// and starts the download with default (best) quality.
    #[serde(default = "default_incoming_action")]
    pub incoming_action: String,
}

fn default_true() -> bool {
    true
}

fn default_incoming_action() -> String {
    "prefetch".to_string()
}

/// Platform-naive defaults. Binary defaults should ultimately come from
/// `binary::resolve_ytdlp_path` rather than these paths.
pub fn default_settings() -> AppSettings {
    AppSettings {
        ytdlp_path: String::new(),
        ffmpeg_path: String::new(),
        download_dir: "~/Downloads".to_string(),
        max_concurrent: 2,
        default_format: "mp4".to_string(),
        default_quality: "1080p".to_string(),
        embed_metadata: true,
        embed_thumbnail: false,
        prefer_free_formats: false,
        write_subs: false,
        sub_langs: "en".to_string(),
        rate_limit: "".to_string(),
        proxy_url: "".to_string(),
        cookies_file: "".to_string(),
        cookies_browser: String::new(),
        filename_template: "%(uploader)s - %(title)s.%(ext)s".to_string(),
        split_chapters: false,
        keep_original_audio: false,
        audio_quality: "192".to_string(),
        check_for_updates: true,
        folder_profiles: Vec::new(),
        save_locations: Vec::new(),
        active_profile_id: String::new(),
        ytdlp_version: None,
        ffmpeg_version: None,
        mock_mode: false,
        notify_on_complete: true,
        focus_on_fetch: true,
        incoming_action: "prefetch".to_string(),
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
pub async fn load_settings(app: tauri::AppHandle) -> AppSettings {
    tauri::async_runtime::spawn_blocking(move || {
        let s = if let Ok(path) = settings_path(&app) {
            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(s) = serde_json::from_str::<AppSettings>(&data) {
                    s
                } else {
                    default_settings()
                }
            } else {
                default_settings()
            }
        } else {
            default_settings()
        };
        // Keep the parallel-download cap in sync with stored settings.
        app.state::<JobRegistry>()
            .2
            .set_max(s.max_concurrent as usize);
        s
    })
    .await
    .unwrap_or_else(|_| default_settings())
}

#[tauri::command]
pub async fn save_settings(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let max = settings.max_concurrent as usize;
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = dir.join("settings.json");
        let data = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
        fs::write(&path, data).map_err(|e| e.to_string())?;
        app.state::<JobRegistry>().2.set_max(max);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn reset_settings(app: tauri::AppHandle) -> AppSettings {
    let s = default_settings();
    app.state::<JobRegistry>()
        .2
        .set_max(s.max_concurrent as usize);
    s
}

/// Append cookie arguments to a yt-dlp command based on settings.
///
/// A selected browser (`--cookies-from-browser`) takes priority; otherwise a
/// Netscape cookies file (`--cookies`) is used. YouTube in particular throws a
/// "confirm you're not a bot" wall when unauthenticated, which cookies resolve.
pub fn apply_cookies(cmd: &mut Command, settings: &AppSettings) {
    let browser = settings.cookies_browser.as_str();
    // Safari's cookie store only exists on macOS; yt-dlp aborts any other
    // platform with "ERROR: unsupported platform: win32" before doing
    // anything, so a stale Safari selection must not be passed through.
    let usable = !browser.is_empty() && (browser != "safari" || cfg!(target_os = "macos"));
    if usable {
        cmd.arg("--cookies-from-browser")
            .arg(browser);
    } else if !settings.cookies_file.is_empty() {
        cmd.arg("--cookies").arg(&settings.cookies_file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cookie_args(browser: &str, file: &str) -> String {
        let mut s = default_settings();
        s.cookies_browser = browser.to_string();
        s.cookies_file = file.to_string();
        let mut cmd = Command::new("yt-dlp");
        apply_cookies(&mut cmd, &s);
        cmd.get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn safari_cookies_are_only_passed_on_macos() {
        assert_eq!(
            cookie_args("safari", ""),
            if cfg!(target_os = "macos") {
                "--cookies-from-browser safari"
            } else {
                ""
            }
        );
    }

    #[test]
    fn safari_skips_to_the_cookies_file_elsewhere() {
        assert_eq!(
            cookie_args("safari", "c.txt"),
            if cfg!(target_os = "macos") {
                "--cookies-from-browser safari"
            } else {
                "--cookies c.txt"
            }
        );
    }

    #[test]
    fn other_browsers_and_files_still_apply() {
        assert_eq!(cookie_args("chrome", ""), "--cookies-from-browser chrome");
        assert_eq!(cookie_args("", "c.txt"), "--cookies c.txt");
        assert_eq!(cookie_args("", ""), "");
    }

    #[test]
    fn settings_json_from_before_the_new_fields_still_parses() {
        // A settings.json saved before these fields existed must keep parsing
        // — serde defaults fill the gap instead of failing the whole load
        // (which would silently reset every user setting).
        let mut v = serde_json::to_value(default_settings()).unwrap();
        let obj = v.as_object_mut().unwrap();
        obj.remove("focusOnFetch");
        obj.remove("saveLocations");
        obj.remove("incomingAction");
        let s: AppSettings = serde_json::from_value(v).unwrap();
        assert!(s.focus_on_fetch);
        assert!(s.save_locations.is_empty());
        assert_eq!(s.incoming_action, "prefetch");
    }
}
