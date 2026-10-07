import { listen } from "@tauri-apps/api/event"
import { notify } from "@/lib/notify"
import type {
  DownloadJob,
  DownloadProgress,
  PostprocessIssue,
  VideoMetadata,
} from "@/types/domain"

type Listener = () => void

const jobs: Record<string, DownloadJob> = {}
const jobOrder: string[] = []
let cached: DownloadJob[] = []
const listeners = new Set<Listener>()

function rebuild() {
  cached = jobOrder.map((id) => jobs[id])
}

function emit() {
  rebuild()
  listeners.forEach((l) => l())
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function getJobs(): DownloadJob[] {
  return cached
}

export function addJob(
  metadata: VideoMetadata,
  formatId: string,
  id: string,
  requestId: string,
): void {
  jobs[id] = {
    id,
    requestId,
    metadata,
    selectedFormatId: formatId,
    status: "queued",
    progress: 0,
    startedAt: new Date(),
    completedAt: undefined,
  }
  jobOrder.unshift(id)
  emit()
}

export function applyProgress(p: DownloadProgress): void {
  const job = jobs[p.id]
  if (!job) return
  const prev = job.status
  job.status = p.status
  job.progress = p.progress
  if (p.speed !== undefined) job.speed = p.speed
  if (p.eta !== undefined) job.eta = p.eta
  if (p.outputPath !== undefined) job.outputPath = p.outputPath
  // The actual format may differ from the selected one (fallback ladder) —
  // keep `selectedFormatId` as the user's choice and record what really ran.
  if (p.formatId !== undefined) job.formatId = p.formatId
  if (p.error !== undefined) job.error = p.error
  if (p.status === "done" || p.status === "error" || p.status === "cancelled") {
    job.completedAt = new Date()
  }
  emit()

  // Native toast on the *transition* into a terminal state (not on every
  // event carrying it). Cancelled is a user action — no toast for that.
  if (p.status === prev) return
  const what = job.metadata.title || job.requestId
  if (p.status === "done") {
    void notify("Download finished", what)
  } else if (p.status === "error") {
    const detail = job.error?.trim()
    const body = detail ? `${what} — ${detail}` : what
    void notify(
      "Download failed",
      body.length > 200 ? `${body.slice(0, 197)}…` : body,
    )
  }
}

export function removeJob(id: string): void {
  delete jobs[id]
  const i = jobOrder.indexOf(id)
  if (i >= 0) jobOrder.splice(i, 1)
  emit()
}

/** Attach the classified WARNING/ERROR report from yt-dlp to a running job. */
export function applyIssues(id: string, issues: PostprocessIssue[]): void {
  const job = jobs[id]
  if (!job) return
  job.issues = issues
  emit()
}

let started = false
export function setupProgressListener(): void {
  if (started) return
  started = true
  listen<DownloadProgress>("download-progress", (e) => applyProgress(e.payload))
}
