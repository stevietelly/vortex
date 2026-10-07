// Canonical contract for the Tauri backend layer.
// Replaces the mock-only types (VideoInfo / PlaylistInfo / DownloadItem) as the
// app is wired to real yt-dlp metadata and download jobs. Frontend code should
// migrate to these types screen-by-screen (see migration steps in chat).

export type MediaType = "video" | "playlist"

export interface FormatOption {
  // yt-dlp `-f` selector, e.g. "bestvideo[height<=1080]+bestaudio/best".
  // The id IS the argument passed to yt-dlp — no second mapping step.
  id: string
  label: string // "1080p MP4" / "Audio only (m4a)"
  container: string // mp4 | webm | mkv | m4a | mp3 ...
  ext: string
  filesize?: number // bytes
  sizeApprox?: boolean // filesize is an estimate — render with a "~" prefix
  hasAudio: boolean
  hasVideo: boolean
  height?: number // 1080, 720...
}

export interface PlaylistEntry {
  index: number
  title: string
  duration: number // seconds
  uploader: string
}

export interface VideoMetadata {
  id: string
  url: string
  title: string
  uploader: string
  uploadDate?: string
  duration: number // seconds (format at render with formatDuration)
  views?: number // ints, format at render with formatCount
  likes?: number
  description?: string
  thumbnail: string
  isPlaylist: boolean
  playlistCount?: number
  entries?: PlaylistEntry[] // present for playlist Info view
  formats: FormatOption[]
}

export type DownloadStatus = "queued" | "fetching-metadata" | "downloading" | "merging" | "done" | "error" | "cancelled"

// A problem reported by yt-dlp during a run — captured from its WARNING/ERROR
// output so we can tell the user *what* to fix (missing ffmpeg, unavailable
// format, auth needed, ...) instead of a generic failure.
export type IssueLevel = "warning" | "error"

export interface PostprocessIssue {
  level: IssueLevel
  stage: string // "postprocess" | "format" | "network" | "access" | "storage" | "download" | "general"
  code: string // machine-readable: "ffmpeg-missing", "merge-failed", ...
  message: string
}

export interface DownloadProgress {
  id: string
  status: DownloadStatus
  progress: number // 0..100
  speed?: string // "2.3 MiB/s"
  eta?: string // "00:12"
  outputPath?: string
  error?: string
  formatId?: string
}

export interface DownloadJob extends DownloadProgress {
  requestId: string // uid of the request that started this job
  metadata: VideoMetadata
  selectedFormatId: string
  startedAt: Date
  completedAt?: Date
  issues?: PostprocessIssue[] // WARNING/ERROR lines reported by yt-dlp
}

// A URL request captured at fetch time. Persisted by the backend so its
// metadata can be re-opened without re-hitting yt-dlp.
export interface RequestRecord {
  id: string
  url: string
  title: string
  uploader: string
  requestedAt: number // unix millis
  status: string
  error?: string
  metadata: VideoMetadata
}

// One individually-downloadable unit. For a single video this is the video
// itself; for a playlist it is one entry (keyed by `requestId#<index>`). These
// rows are what make resumption possible: an interrupted item can be restarted
// with `--continue` using its stored url/formatId/index.
export interface DownloadItem {
  id: string
  requestId: string
  url: string
  title: string
  index?: number // playlist position (1-based); absent for a single video
  formatId: string
  status: DownloadStatus
  progress: number // 0..100
  speed?: string
  eta?: string
  outputPath?: string
  error?: string
  outputDir?: string // destination folder chosen for this item (folder profile)
  addedAt: number // unix millis
  startedAt?: number // unix millis when the download actually began
  completedAt?: number // unix millis when the item reached a terminal state
  updatedAt: number // unix millis
}
