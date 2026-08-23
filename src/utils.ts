import type { DownloadJob, DownloadStatus } from "@/types/domain";

export const STATE_LABEL: Record<DownloadStatus, string> = {
  queued: "Queued",
  "fetching-metadata": "Analyzing…",
  downloading: "Downloading",
  merging: "Merging",
  done: "Complete",
  error: "Failed",
  cancelled: "Cancelled",
};

export const STATE_COLOR: Record<DownloadStatus, string> = {
  queued: "var(--muted-foreground)",
  "fetching-metadata": "var(--primary)",
  downloading: "var(--primary)",
  merging: "var(--primary)",
  done: "#22C55E",
  error: "#EF4444",
  cancelled: "var(--muted-foreground)",
};

export function formatLabel(job: DownloadJob): string {
  const id = job.selectedFormatId;
  if (!id) return "—";
  const opt = job.metadata?.formats?.find((f) => f.id === id);
  if (opt) return opt.label;
  if (id === "best") return "Best";
  return id;
}