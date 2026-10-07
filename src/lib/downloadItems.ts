import { useEffect, useSyncExternalStore } from "react"
import { listen } from "@tauri-apps/api/event"
import type {
  DownloadItem,
  DownloadProgress,
  PostprocessIssue,
} from "@/types/domain"
import {
  listDownloadItems,
  listPendingItems,
  listPostprocessIssues,
  replacePostprocessIssues,
  upsertDownloadItem,
} from "@/lib/db"
import { applyIssues } from "@/lib/jobs"

// Metadata we need to write a download_items row, captured at download start.
// The progress event only carries the job id + status, so we remember the rest.
export interface JobMeta {
  requestId: string
  url: string
  title: string
  index?: number
  formatId: string
  outputDir?: string
  addedAt: number
  startedAt?: number
}

const jobMeta = new Map<string, JobMeta>()

export function registerJobMeta(id: string, meta: JobMeta): void {
  jobMeta.set(id, meta)
}

const TERMINAL: ReadonlySet<string> = new Set(["done", "error", "cancelled"])

function buildItem(p: DownloadProgress): DownloadItem | null {
  const meta = jobMeta.get(p.id)
  if (!meta) return null // not a tracked download (e.g. a synthetic error job)
  const terminal = TERMINAL.has(p.status)
  return {
    id: p.id,
    requestId: meta.requestId,
    url: meta.url,
    title: meta.title,
    index: meta.index,
    formatId: p.formatId ?? meta.formatId,
    status: p.status,
    progress: p.progress,
    speed: p.speed,
    eta: p.eta,
    outputPath: p.outputPath,
    error: p.error,
    outputDir: meta.outputDir,
    addedAt: meta.addedAt,
    startedAt: meta.startedAt ?? meta.addedAt,
    completedAt: terminal ? Date.now() : undefined,
    updatedAt: Date.now(),
  }
}

// Live items for the request currently shown on the Info page. In the desktop
// shell this mirrors download_items as progress events arrive; in the web
// preview (no SQL) it stays empty and the jobs store covers the UI instead.
type Listener = () => void

let watched: string | null = null
let requestItems: DownloadItem[] = []
const requestListeners = new Set<Listener>()

function emitRequestItems() {
  requestListeners.forEach((l) => l())
}

function subscribeRequestItems(l: Listener): () => void {
  requestListeners.add(l)
  return () => {
    requestListeners.delete(l)
  }
}

function getRequestItems(): DownloadItem[] {
  return requestItems
}

function mergeLive(item: DownloadItem): void {
  if (watched !== item.requestId) return
  const i = requestItems.findIndex((x) => x.id === item.id)
  if (i >= 0) {
    const prev = requestItems[i]
    requestItems = requestItems.map((x, xi) =>
      xi === i
        ? { ...x, ...item, outputDir: item.outputDir ?? prev.outputDir }
        : x,
    )
  } else {
    requestItems = [...requestItems, item].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    )
  }
  emitRequestItems()
}

export async function loadRequestItems(requestId: string): Promise<void> {
  watched = requestId
  try {
    requestItems = await listDownloadItems(requestId)
  } catch {
    requestItems = []
  }
  emitRequestItems()
}

export function useRequestItems(requestId: string): DownloadItem[] {
  useEffect(() => {
    void loadRequestItems(requestId)
  }, [requestId])
  return useSyncExternalStore(subscribeRequestItems, getRequestItems)
}

// Postprocess issues (classified yt-dlp WARNING/ERROR lines) for the watched
// request, keyed by item id — persisted so failures stay diagnosable.
let requestIssues: Record<string, PostprocessIssue[]> = {}
const issueListeners = new Set<Listener>()

function emitIssues() {
  issueListeners.forEach((l) => l())
}

function subscribeIssues(l: Listener): () => void {
  issueListeners.add(l)
  return () => {
    issueListeners.delete(l)
  }
}

function getIssuesSnapshot(): Record<string, PostprocessIssue[]> {
  return requestIssues
}

export async function loadRequestIssues(requestId: string): Promise<void> {
  watched = requestId
  try {
    requestIssues = await listPostprocessIssues(requestId)
  } catch {
    requestIssues = {}
  }
  emitIssues()
}

export function useRequestIssues(
  requestId: string,
): Record<string, PostprocessIssue[]> {
  useEffect(() => {
    void loadRequestIssues(requestId)
  }, [requestId])
  return useSyncExternalStore(subscribeIssues, getIssuesSnapshot)
}

/** Attach a job's report to the job store, the live view and the DB. */
async function handleReport(
  itemId: string,
  issues: PostprocessIssue[],
): Promise<void> {
  applyIssues(itemId, issues)
  const meta = jobMeta.get(itemId)
  if (!meta) return
  if (watched === meta.requestId) {
    requestIssues = { ...requestIssues, [itemId]: issues }
    emitIssues()
  }
  try {
    await replacePostprocessIssues(itemId, meta.requestId, issues)
  } catch {
    /* not in a Tauri context */
  }
}

let issuesStarted = false
export function setupIssuesListener(): void {
  if (issuesStarted) return
  issuesStarted = true
  listen<{ id: string; issues: PostprocessIssue[] }>(
    "postprocess-issues",
    (e) => {
      void handleReport(e.payload.id, e.payload.issues)
    },
  )
}

/** Persist a progress tick into the download_items table (best-effort). */
export async function persistProgress(p: DownloadProgress): Promise<void> {
  const item = buildItem(p)
  if (!item) return
  try {
    await upsertDownloadItem(item)
  } catch {
    /* not in a Tauri context */
  }
  mergeLive(item)
}

// Pending (resumable) items, surfaced as a resume banner on startup.
let pending: DownloadItem[] = []
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l())
}

export function subscribePending(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function getPending(): DownloadItem[] {
  return pending
}

export function usePendingItems(): DownloadItem[] {
  return useSyncExternalStore(subscribePending, getPending)
}

export async function refreshPending(): Promise<void> {
  try {
    pending = await listPendingItems()
  } catch {
    pending = []
  }
  emit()
}

export function clearPending(): void {
  pending = []
  emit()
}

let started = false
export function setupItemProgressListener(): void {
  if (started) return
  started = true
  listen<DownloadProgress>("download-progress", (e) => {
    void persistProgress(e.payload)
  })
}
