import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/// True when running inside the Tauri webview (desktop build).
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/// Invoke a Tauri command. Throws if not in a Tauri context so callers can
/// fall back (e.g. to localStorage in the Figma Make web preview).
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri()) throw new Error("not in tauri context");
  return tauriInvoke<T>(cmd, args);
}

export interface BinaryStatus {
  path: string;
  exists: boolean;
  version: string | null;
  error?: string | null;
}

/// Open a native file/directory picker. Returns the chosen path, or null if
/// cancelled. No-op (returns null) outside a Tauri context (web preview).
export async function pickPath(opts?: {
  directory?: boolean;
  extensions?: string[];
}): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const selected = await open({
      directory: opts?.directory ?? false,
      multiple: false,
      filters:
        opts?.directory || !opts?.extensions?.length
          ? undefined
          : [{ name: "Files", extensions: opts.extensions }],
    });
    return typeof selected === "string" ? selected : null;
  } catch {
    return null;
  }
}

