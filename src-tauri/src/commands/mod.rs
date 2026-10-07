pub mod binary;
pub mod download;
pub mod metadata;
pub mod settings;

/// Keep child processes off the screen.
///
/// The release build is a GUI app (`windows_subsystem = "windows"` in
/// `main.rs`) and therefore has no console. Windows gives every
/// console-subsystem child (yt-dlp, ffmpeg, `taskkill`, `where`, …) a console
/// of its own in that case — a blank cmd window flashing on screen on every
/// fetch / download / cancel. In dev the app *has* a console and children
/// attach to it, which is why the flash only shows up "when built".
/// `CREATE_NO_WINDOW` suppresses it; output capture is unaffected because we
/// always pipe stdout/stderr.
pub fn hide_console(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}
