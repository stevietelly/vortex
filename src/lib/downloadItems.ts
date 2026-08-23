import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import type { DownloadItem, DownloadProgress } from "@/types/domain";
import { listPendingItems, upsertDownloadItem } from "@/lib/db";

// Metadata we need to write a download_items row, captured at download start.
// The progress event only carries the job id + status, so we remember the rest.
export interface JobMeta {
  requestId: string;
  url: string;
  title: string;
  index?: number;
  formatId: string;
  addedAt: number;
}

const jobMeta = new Map<string, JobMeta>();

export function registerJobMeta(id: string, meta: JobMeta): void {
  jobMeta.set(id, meta);
}

function buildItem(p: DownloadProgress): DownloadItem | null {
  const meta = jobMeta.get(p.id);
  if (!meta) return null; // not a tracked download (e.g. a synthetic error job)
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
    addedAt: meta.addedAt,
    updatedAt: Date.now(),
  };
}

/** Persist a progress tick into the download_items table (best-effort). */
export async function persistProgress(p: DownloadProgress): Promise<void> {
  const item = buildItem(p);
  if (!item) return;
  try {
    await upsertDownloadItem(item);
  } catch {
    /* not in a Tauri context */
  }
}

// Pending (resumable) items, surfaced as a resume banner on startup.
type Listener = () => void;

let pending: DownloadItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribePending(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getPending(): DownloadItem[] {
  return pending;
}

export function usePendingItems(): DownloadItem[] {
  return useSyncExternalStore(subscribePending, getPending);
}

export async function refreshPending(): Promise<void> {
  try {
    pending = await listPendingItems();
  } catch {
    pending = [];
  }
  emit();
}

export function clearPending(): void {
  pending = [];
  emit();
}

let started = false;
export function setupItemProgressListener(): void {
  if (started) return;
  started = true;
  listen<DownloadProgress>("download-progress", (e) => {
    void persistProgress(e.payload);
  });
}
