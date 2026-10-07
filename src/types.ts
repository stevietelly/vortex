export type Page = "home" | "info" | "downloads" | "settings"
export type Format = "mp4" | "webm" | "mkv" | "mp3" | "wav" | "m4a" | "opus"

// A named download destination the user can pick per download.
export interface FolderProfile {
  id: string
  name: string
  path: string
}

export interface AppSettings {
  ytdlpPath: string
  ffmpegPath: string
  downloadDir: string
  maxConcurrent: number
  defaultFormat: Format
  defaultQuality: string
  embedMetadata: boolean
  embedThumbnail: boolean
  preferFreeFormats: boolean
  writeSubs: boolean
  subLangs: string
  rateLimit: string
  proxyUrl: string
  cookiesFile: string
  cookiesBrowser: string
  filenameTemplate: string
  splitChapters: boolean
  keepOriginalAudio: boolean
  audioQuality: string
  checkForUpdates: boolean
  folderProfiles: FolderProfile[]
  activeProfileId: string
  ytdlpVersion?: string
  ffmpegVersion?: string
  mockMode: boolean
  notifyOnComplete: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  ytdlpPath: "/usr/local/bin/yt-dlp",
  ffmpegPath: "/usr/local/bin/ffmpeg",
  downloadDir: "~/Downloads",
  maxConcurrent: 2,
  defaultFormat: "mp4",
  defaultQuality: "1080p",
  embedMetadata: true,
  embedThumbnail: false,
  preferFreeFormats: false,
  writeSubs: false,
  subLangs: "en",
  rateLimit: "",
  proxyUrl: "",
  cookiesFile: "",
  cookiesBrowser: "",
  filenameTemplate: "%(uploader)s - %(title)s.%(ext)s",
  splitChapters: false,
  keepOriginalAudio: false,
  audioQuality: "192",
  checkForUpdates: true,
  folderProfiles: [],
  activeProfileId: "",
  mockMode: false,
  notifyOnComplete: true,
}
