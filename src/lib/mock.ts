import { emit } from "@tauri-apps/api/event"
import type { VideoMetadata, FormatOption, PlaylistEntry } from "@/types/domain"
import { applyProgress } from "@/lib/jobs"
import { isTauri } from "./tauri"

const FORMATS: FormatOption[] = [
  {
    id: "bestvideo[height<=2160]+bestaudio/best",
    label: "2160p",
    container: "mp4",
    ext: "mp4",
    hasAudio: true,
    hasVideo: true,
    height: 2160,
    filesize: 4_200_000_000,
  },
  {
    id: "bestvideo[height<=1440]+bestaudio/best",
    label: "1440p",
    container: "mp4",
    ext: "mp4",
    hasAudio: true,
    hasVideo: true,
    height: 1440,
    filesize: 2_800_000_000,
  },
  {
    id: "bestvideo[height<=1080]+bestaudio/best",
    label: "1080p",
    container: "mp4",
    ext: "mp4",
    hasAudio: true,
    hasVideo: true,
    height: 1080,
    filesize: 1_500_000_000,
  },
  {
    id: "bestvideo[height<=720]+bestaudio/best",
    label: "720p",
    container: "mp4",
    ext: "mp4",
    hasAudio: true,
    hasVideo: true,
    height: 720,
    filesize: 800_000_000,
  },
  {
    id: "bestvideo[height<=480]+bestaudio/best",
    label: "480p",
    container: "mp4",
    ext: "mp4",
    hasAudio: true,
    hasVideo: true,
    height: 480,
    filesize: 400_000_000,
  },
  {
    id: "bestaudio",
    label: "Audio only (opus)",
    container: "webm",
    ext: "opus",
    hasAudio: true,
    hasVideo: false,
    filesize: 50_000_000,
  },
  {
    id: "best",
    label: "Best",
    container: "mp4",
    ext: "mp4",
    hasAudio: true,
    hasVideo: true,
    height: 1080,
    filesize: 1_500_000_000,
  },
]

const MOCK_ENTRIES: PlaylistEntry[] = [
  {
    index: 1,
    title: "Introduction to Rust Async",
    duration: 847,
    uploader: "Code Explainer",
  },
  {
    index: 2,
    title: "Ownership and Borrowing Deep Dive",
    duration: 1243,
    uploader: "Code Explainer",
  },
  {
    index: 3,
    title: "Building a CLI Tool with Clap",
    duration: 634,
    uploader: "Code Explainer",
  },
  {
    index: 4,
    title: "Testing Patterns in Rust",
    duration: 921,
    uploader: "Code Explainer",
  },
  {
    index: 5,
    title: "Deploying Rust to the Edge",
    duration: 558,
    uploader: "Code Explainer",
  },
]

export function mockFetchMetadata(url: string): Promise<VideoMetadata> {
  const delay = 400 + Math.random() * 800
  const isPl = /playlist|list=/i.test(url)
  return new Promise((resolve) =>
    setTimeout(() => {
      if (isPl) {
        resolve({
          id: "MOCK-PLAYLIST-001",
          url,
          title: "Rust Fundamentals (Mock Playlist)",
          uploader: "Code Explainer",
          uploadDate: "2025-06-15",
          duration: MOCK_ENTRIES.reduce((s, e) => s + e.duration, 0),
          views: 1_284_000,
          likes: 48_200,
          description:
            "A 5-part series covering Rust from zero to production.\n\nThis is mock data for offline development.",
          thumbnail: "",
          isPlaylist: true,
          playlistCount: MOCK_ENTRIES.length,
          entries: MOCK_ENTRIES,
          formats: FORMATS,
        })
      } else {
        resolve({
          id: "MOCK-VID-001",
          url,
          title: "Building a Video Downloader in Rust (Mock)",
          uploader: "Tech Creator",
          uploadDate: "2025-09-01",
          duration: 1327,
          views: 482_000,
          likes: 21_400,
          description:
            "We build a Tauri desktop app that wraps yt-dlp.\n\nThis is mock data for offline development.\n\nTimestamps:\n0:00 Intro\n1:30 Architecture\n4:15 Implementation\n8:00 Demo",
          thumbnail: "",
          isPlaylist: false,
          formats: FORMATS,
        })
      }
    }, delay),
  )
}

const SPEEDS = [
  "1.2 MiB/s",
  "2.4 MiB/s",
  "3.1 MiB/s",
  "4.8 MiB/s",
  "6.2 MiB/s",
  "8.0 MiB/s",
]

function emitProgress(
  p: { id: string } & Partial<import("@/types/domain").DownloadProgress>,
) {
  const full: import("@/types/domain").DownloadProgress = {
    id: p.id,
    status: p.status ?? "downloading",
    progress: p.progress ?? 0,
    speed: p.speed,
    eta: p.eta,
    outputPath: p.outputPath,
    error: p.error,
    formatId: p.formatId,
  }
  applyProgress(full)
  if (isTauri()) {
    emit("download-progress", full).catch(() => {})
  }
}

export function mockStartDownload(opts: {
  url: string
  formatId: string
  title: string
  index?: number
  jobId?: string
  downloadDir: string
}): string {
  const id =
    opts.jobId ?? `mock-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const duration = 30 + Math.floor(Math.random() * 180) // 30s–3min simulated
  const speed = SPEEDS[Math.floor(Math.random() * SPEEDS.length)]
  const ext = opts.formatId.includes("audio") ? "opus" : "mp4"
  const safeTitle = opts.title.replace(/[<>:"/\\|?*]/g, "_")
  const idx = opts.index != null ? `${opts.index} - ` : ""
  const outputPath = `${opts.downloadDir}/${idx}${safeTitle}.${ext}`

  // Kick off simulated progress after a short delay.
  setTimeout(
    () => {
      emitProgress({
        id,
        status: "queued",
        progress: 0,
        formatId: opts.formatId,
      })

      let progress = 0
      const interval = setInterval(
        () => {
          // Variable speed: finish faster near the end.
          const increment = 1 + Math.random() * 4 + (progress > 80 ? 3 : 0)
          progress = Math.min(100, progress + increment)
          const etaSec = Math.max(
            0,
            Math.round((duration * (100 - progress)) / 100 / 3),
          )

          if (progress < 95) {
            emitProgress({
              id,
              status: "downloading",
              progress,
              speed: SPEEDS[Math.floor(Math.random() * SPEEDS.length)],
              eta: `${String(Math.floor(etaSec / 60)).padStart(2, "0")}:${String(etaSec % 60).padStart(2, "0")}`,
              formatId: opts.formatId,
            })
          } else {
            emitProgress({
              id,
              status: "merging",
              progress,
              speed: undefined,
              eta: "",
              formatId: opts.formatId,
            })
          }

          if (progress >= 100) {
            clearInterval(interval)
            setTimeout(
              () => {
                emitProgress({
                  id,
                  status: "done",
                  progress: 100,
                  outputPath,
                  formatId: opts.formatId,
                })
              },
              300 + Math.random() * 500,
            )
          }
        },
        400 + Math.random() * 600,
      )
    },
    200 + Math.random() * 300,
  )

  return id
}
