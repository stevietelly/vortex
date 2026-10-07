mod commands;

use tauri_plugin_sql::{Builder, Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create requests and download_items tables",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add start/completion timing to download_items",
            sql: include_str!("../migrations/0002_download_timing.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add postprocess_issues table",
            sql: include_str!("../migrations/0003_postprocess_issues.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
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
