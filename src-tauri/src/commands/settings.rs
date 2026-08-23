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
    pub active_profile_id: String,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_version: Option<String>,
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
        active_profile_id: String::new(),
        ytdlp_version: None,
        ffmpeg_version: None,
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
    if !settings.cookies_browser.is_empty() {
        cmd.arg("--cookies-from-browser")
            .arg(&settings.cookies_browser);
    } else if !settings.cookies_file.is_empty() {
        cmd.arg("--cookies").arg(&settings.cookies_file);
    }
}
