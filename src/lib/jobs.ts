import { listen } from "@tauri-apps/api/event";
import type { DownloadJob, DownloadProgress, VideoMetadata } from "@/types/domain";

type Listener = () => void;

const jobs: Record<string, DownloadJob> = {};
const jobOrder: string[] = [];
let cached: DownloadJob[] = [];
const listeners = new Set<Listener>();

function rebuild() {
  cached = jobOrder.map((id) => jobs[id]);
}

function emit() {
  rebuild();
  listeners.forEach((l) => l());
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getJobs(): DownloadJob[] {
  return cached;
}

export function addJob(metadata: VideoMetadata, formatId: string, id: string): void {
  jobs[id] = {
    id,
    metadata,
    selectedFormatId: formatId,
    status: "queued",
    progress: 0,
    startedAt: new Date(),
    completedAt: undefined,
  };
  jobOrder.unshift(id);
  emit();
}

export function applyProgress(p: DownloadProgress): void {
  const job = jobs[p.id];
  if (!job) return;
  job.status = p.status;
  job.progress = p.progress;
  if (p.speed !== undefined) job.speed = p.speed;
  if (p.eta !== undefined) job.eta = p.eta;
  if (p.outputPath !== undefined) job.outputPath = p.outputPath;
  if (p.formatId !== undefined) job.selectedFormatId = p.formatId;
  if (p.error !== undefined) job.error = p.error;
  if (p.status === "done" || p.status === "error" || p.status === "cancelled") {
    job.completedAt = new Date();
  }
  emit();
}

export function removeJob(id: string): void {
  delete jobs[id];
  const i = jobOrder.indexOf(id);
  if (i >= 0) jobOrder.splice(i, 1);
  emit();
}

let started = false;
export function setupProgressListener(): void {
  if (started) return;
  started = true;
  listen<DownloadProgress>("download-progress", (e) => applyProgress(e.payload));
}
