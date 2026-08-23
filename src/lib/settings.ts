import { invoke } from "./tauri";
import { DEFAULT_SETTINGS, type AppSettings } from "@/types";
import type { BinaryStatus } from "./tauri";

const LS_KEY = "vortex-settings";

/// Load settings: from the Rust-backed store in the desktop app, or from
/// localStorage when running in the web preview (no Tauri context).
export async function loadSettings(): Promise<AppSettings> {
  if (!isTauriFallback()) {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      } catch {
        /* fall through to defaults */
      }
    }
    return DEFAULT_SETTINGS;
  }
  try {
    return await invoke<AppSettings>("load_settings");
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/// Persist settings via the same context rule as loadSettings.
export async function saveSettings(settings: AppSettings): Promise<void> {
  if (!isTauriFallback()) {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
    return;
  }
  try {
    await invoke("save_settings", { settings });
  } catch {
    /* best-effort */
  }
}

/// Probe a configured binary path for existence + reported version.
export async function validateBinary(path: string): Promise<BinaryStatus> {
  return invoke<BinaryStatus>("validate_path", { path });
}

function isTauriFallback(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
