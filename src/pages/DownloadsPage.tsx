import { useEffect } from "react";
import { IconX, IconTray, IconLink } from "../icons";
import Thumbnail from "../components/Thumbnail";
import type { DownloadJob, DownloadStatus, RequestRecord } from "@/types/domain";
import { STATE_LABEL, STATE_COLOR } from "@/utils";
import DownloadRow from "@/components/ui/DownloadRow";
import { useRequests, loadRequests, clearRequests } from "@/lib/requests";

export default function DownloadsPage({
  jobs,
  onClear,
  onClearAll,
  onOpenRequest,
}: {
  jobs: DownloadJob[];
  onClear: (id: string) => void;
  onClearAll: () => void;
  onOpenRequest: (r: RequestRecord) => void;
}) {
  const requests = useRequests();
  useEffect(() => {
    loadRequests();
  }, []);

  const active = jobs.filter(
    (j) =>
      j.status === "queued" ||
      j.status === "fetching-metadata" ||
      j.status === "downloading" ||
      j.status === "merging",
  );
  const finished = jobs.filter(
    (j) =>
      j.status === "done" || j.status === "error" || j.status === "cancelled",
  );

  if (jobs.length === 0 && requests.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-full px-6 py-24 gap-4">
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center"
          style={{
            backgroundColor: "var(--muted)",
            color: "var(--muted-foreground)",
          }}
        >
          <IconTray size={24} />
        </div>
        <div className="text-center">
          <div
            className="text-sm font-medium"
            style={{ color: "var(--foreground)" }}
          >
            No downloads yet
          </div>
          <div
            className="text-xs mt-1"
            style={{ color: "var(--muted-foreground)" }}
          >
            Downloads will appear here as they start
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1
            className="text-base font-semibold"
            style={{ color: "var(--foreground)" }}
          >
            Downloads
          </h1>
          <div
            className="mono text-[10px] mt-0.5"
            style={{ color: "var(--muted-foreground)" }}
          >
            {active.length > 0 ? `${active.length} active · ` : ""}
            {jobs.length} total
          </div>
        </div>
        {finished.length > 0 && (
          <button
            onClick={onClearAll}
            className="text-xs px-3 py-1.5 rounded border transition-colors cursor-pointer"
            style={{
              borderColor: "var(--border)",
              color: "var(--muted-foreground)",
              backgroundColor: "var(--card)",
            }}
          >
            Clear completed
          </button>
        )}
      </div>

      {requests.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center justify-between mb-2">
            <div
              className="mono text-[10px] uppercase tracking-widest"
              style={{ color: "var(--muted-foreground)" }}
            >
              Saved requests
            </div>
            <button
              onClick={() => clearRequests()}
              className="text-xs px-2.5 py-1 rounded border transition-colors cursor-pointer"
              style={{ borderColor: "var(--border)", color: "var(--muted-foreground)", backgroundColor: "var(--card)" }}
            >
              Clear all
            </button>
          </div>
          <div
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
          >
            {requests.map((r) => (
              <button
                key={r.id}
                onClick={r.error ? undefined : () => onOpenRequest(r)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer border-b last:border-b-0"
                style={{ borderColor: "var(--border)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--muted)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
              >
                <div
                  className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: "var(--muted)", color: r.error ? "#EF4444" : "var(--muted-foreground)" }}
                >
                  {r.error ? <IconX size={12} /> : <IconLink size={12} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate font-medium" style={{ color: r.error ? "#EF4444" : "var(--foreground)" }}>
                    {r.title || r.url}
                  </div>
                  <div className="mono text-[10px] truncate mt-0.5" style={{ color: r.error ? "#EF4444" : "var(--muted-foreground)" }}>
                    {r.error ? r.error : `${r.uploader ? `${r.uploader} · ` : ""}${new Date(r.requestedAt).toLocaleString()}`}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div className="mb-5">
          <div
            className="mono text-[10px] uppercase tracking-widest mb-2"
            style={{ color: "var(--muted-foreground)" }}
          >
            Active
          </div>
          <div
            className="rounded-lg border overflow-hidden"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
            }}
          >
            {active.map((job) => (
              <DownloadRow key={job.id} job={job} onClear={onClear} />
            ))}
          </div>
        </div>
      )}

      {finished.length > 0 && (
        <div>
          <div
            className="mono text-[10px] uppercase tracking-widest mb-2"
            style={{ color: "var(--muted-foreground)" }}
          >
            History
          </div>
          <div
            className="rounded-lg border overflow-hidden"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
            }}
          >
            {finished.map((job) => (
              <DownloadRow key={job.id} job={job} onClear={onClear} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
