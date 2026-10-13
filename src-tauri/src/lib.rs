mod commands;

use tauri::Manager;
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
        // single-instance must be first: a second launch (e.g. the OS handing
        // over a vortex:// link while we're already running) must reach this
        // instance instead of starting a duplicate app.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Forward warm argv directly to incoming queue
            commands::incoming::handle_warm_argv(app, &argv);

            // Also hand to deep-link plugin if registered
            if let Some(deep_link) =
                app.try_state::<tauri_plugin_deep_link::DeepLink<tauri::Wry>>()
            {
                deep_link.handle_cli_arguments(argv.into_iter());
            }
            // And surface the existing window.
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            Builder::new()
                .add_migrations("sqlite:vortex.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        // States must be managed before setup() runs so they're available
        // inside setup_deep_link_relay and bridge::start.
        .manage(commands::download::JobRegistry::default())
        .manage(commands::incoming::IncomingQueue::default())
        .setup(|app| {
            // Init the log plugin first so that every log::info! call below
            // (in relay setup and bridge start) is actually captured.
            #[cfg(debug_assertions)]
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            // Register the vortex:// scheme (HKCU on Windows — no admin),
            // capture any cold-start deep link, and relay warm ones.
            commands::incoming::setup_deep_link_relay(app.handle());
            // Localhost bridge for the browser extension (bulk sends).
            commands::bridge::start(app.handle().clone());
            Ok(())
        })
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
            commands::incoming::drain_incoming,
            commands::bridge::get_bridge_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
