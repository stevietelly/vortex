import type { DownloadJob, DownloadStatus } from "@/types/domain"

export const STATE_LABEL: Record<DownloadStatus, string> = {
  queued: "Queued",

  "fetching-metadata": "Analyzing…",

  downloading: "Downloading",

  merging: "Merging",

  done: "Complete",

  error: "Failed",

  cancelled: "Cancelled",
}

export const STATE_COLOR: Record<DownloadStatus, string> = {
  queued: "var(--muted-foreground)",

  "fetching-metadata": "var(--primary)",

  downloading: "var(--primary)",

  merging: "var(--primary)",

  done: "#22C55E",

  error: "#EF4444",

  cancelled: "var(--muted-foreground)",
}

// Translate a raw `-f` selector into a readable label when it isn't in the
// (possibly cached) format list.
export function labelForSelector(id: string): string {
  if (!id) return "—"
  const h = /\[height<=(\d+)\]/.exec(id)?.[1]
  if (h) return `${h}p`
  if (id.startsWith("bestaudio")) return "Audio only"
  if (id === "best" || id === "b") return "Best"
  if (id.startsWith("bestvideo") || id.startsWith("bv")) return "Best (merged)"
  return id
}

export function formatLabel(job: DownloadJob): string {
  const id = job.selectedFormatId

  if (!id) return "—"

  const opt = job.metadata?.formats?.find((f) => f.id === id)

  if (opt) return opt.label

  return labelForSelector(id)
}

// Actionable fix per postprocess issue code (see classify_issue in
// src-tauri/src/commands/download.rs) — tells the user what to do next.
export const ISSUE_HINT: Record<string, string> = {
  "ffmpeg-missing":
    "FFmpeg not found — install it or set its path in Settings → Binaries.",
  "ffprobe-missing":
    "ffprobe not found — put ffprobe.exe next to ffmpeg.exe (both are needed for merging/metadata).",
  "format-unavailable":
    "No matching format — the download retried other formats; if it keeps failing, update yt-dlp in Settings → Binaries.",
  "format-selector":
    "Pre-merged formats only — the app downloads video + audio separately and merges them.",
  "js-runtime":
    "No JavaScript runtime for YouTube — install deno so yt-dlp can list every quality.",
  "merge-failed":
    "Merging video + audio failed — check the FFmpeg install in Settings.",
  "postprocess-failed":
    "Post-processing failed — check FFmpeg and the post-processing toggles in Settings.",
  "subtitle-failed":
    "Subtitle download failed — check the subtitle languages in Settings.",
  "embed-failed":
    "Embedding metadata/thumbnail failed — try another container or disable embedding in Settings.",
  "network-error":
    "Network problem — check your connection, proxy, or rate limit in Settings.",
  "auth-required":
    "Sign-in required — pick a cookies browser in Settings → Authentication.",
  "geo-blocked": "Content is geo-blocked in your region.",
  "disk-full": "Not enough disk space — free space or change the download directory.",
  "unavailable": "The video is private or unavailable.",
  "download-failed": "yt-dlp reported an error during the download.",
  general: "yt-dlp reported a warning.",
}
