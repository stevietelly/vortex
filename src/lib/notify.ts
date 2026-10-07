import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"
import { isTauri } from "@/lib/tauri"

// Mirrors the docs' flow: check permission → request if needed → send.
// `permission` is cached so we only ever prompt once per session.

let enabled = true
let permission: boolean | null = null

/** Sync the "Notify when downloads finish" setting (DownloadsProvider). */
export function setNotificationsEnabled(on: boolean): void {
  enabled = on
}

/**
 * Ask for notification permission up-front (fire-and-forget). Called when a
 * download starts so the prompt — where the OS even has one, e.g. macOS —
 * appears on user intent rather than when the download finishes.
 */
export async function primeNotificationPermission(): Promise<void> {
  if (!isTauri() || permission !== null) return
  try {
    let granted = await isPermissionGranted()
    if (!granted) {
      granted = (await requestPermission()) === "granted"
    }
    permission = granted
  } catch {
    permission = false
  }
}

/** Best-effort native notification; never throws, never blocks the caller. */
export async function notify(title: string, body?: string): Promise<void> {
  if (!isTauri() || !enabled) return
  if (permission === null) await primeNotificationPermission()
  if (!permission) return
  try {
    sendNotification({ title, body })
  } catch {
    /* notifications are a nicety — a failure must not break the app */
  }
}
