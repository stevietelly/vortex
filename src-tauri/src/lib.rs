mod commands;

use tauri::Manager;
use tauri_plugin_sql::{Builder, Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create requests and download_items tables",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(
            Builder::new()
                .add_migrations("sqlite:vortex.db", migrations)
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::download::JobRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::binary::resolve_ytdlp_path,
            commands::binary::resolve_ffmpeg_path,
            commands::binary::get_binary_version,
            commands::binary::validate_path,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::settings::reset_settings,
            commands::metadata::fetch_metadata,
            commands::download::start_download,
            commands::download::cancel_download,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
