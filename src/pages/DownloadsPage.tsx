import { useEffect, useState } from "react"
import { IconX, IconTray, IconLink } from "../icons"
import type { RequestRecord, DownloadItem } from "@/types/domain"
import { STATE_LABEL, STATE_COLOR } from "@/utils"
import DownloadRow from "@/components/ui/DownloadRow"
import { useRequests, loadRequests, clearRequests } from "@/lib/requests"
import { listDownloadItems } from "@/lib/db"
import { useDownloads } from "@/downloads/provider"
import { useRouter } from "@/router/provider"

function RequestRow({
  r,
  onOpenRequest,
  onResumeItem,
}: {
  r: RequestRecord
  onOpenRequest: (r: RequestRecord) => void
  onResumeItem?: (it: DownloadItem) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState<DownloadItem[] | null>(null)

  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = !expanded
    setExpanded(next)
    if (next && items === null) {
      try {
        setItems(await listDownloadItems(r.id))
      } catch {
        setItems([])
      }
    }
  }

  return (
    <div
      className="border-b last:border-b-0"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        onClick={r.error ? undefined : () => onOpenRequest(r)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
        onMouseEnter={(e) => {
          ;(e.currentTarget as HTMLElement).style.backgroundColor =
            "var(--muted)"
        }}
        onMouseLeave={(e) => {
          ;(e.currentTarget as HTMLElement).style.backgroundColor =
            "transparent"
        }}
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
          style={{
            backgroundColor: "var(--muted)",
            color: r.error ? "#EF4444" : "var(--muted-foreground)",
          }}
        >
          {r.error ? <IconX size={12} /> : <IconLink size={12} />}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-sm truncate font-medium"
            style={{ color: r.error ? "#EF4444" : "var(--foreground)" }}
          >
            {r.title || r.url}
          </div>
          <div
            className="mono text-[10px] truncate mt-0.5"
            style={{ color: r.error ? "#EF4444" : "var(--muted-foreground)" }}
          >
            {r.error
              ? r.error
              : `${
                  r.uploader ? `${r.uploader} · ` : ""
                }${new Date(r.requestedAt).toLocaleString()}`}
          </div>
        </div>
        <button
          onClick={toggle}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded transition-transform cursor-pointer"
          style={{ color: "var(--muted-foreground)" }}
          title={expanded ? "Hide tracks" : "Show tracks"}
        >
          <span
            style={{
              transform: expanded ? "rotate(90deg)" : "none",
              display: "inline-block",
              transition: "transform 0.15s",
            }}
          >
            ›
          </span>
        </button>
      </div>

      {expanded && (
        <div style={{ backgroundColor: "var(--muted)" }}>
          {items === null ? (
            <div
              className="px-4 py-2 mono text-[10px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              Loading tracks…
            </div>
          ) : items.length === 0 ? (
            <div
              className="px-4 py-2 mono text-[10px]"
              style={{ color: "var(--muted-foreground)" }}
            >
              No tracks saved
            </div>
          ) : (
            items.map((it) => (
              <div
                key={it.id}
                onClick={() => onOpenRequest(r)}
                className="px-4 py-2 border-t cursor-pointer"
                style={{ borderColor: "var(--border)" }}
                onMouseEnter={(e) => {
                  ;(e.currentTarget as HTMLElement).style.backgroundColor =
                    "var(--muted)"
                }}
                onMouseLeave={(e) => {
                  ;(e.currentTarget as HTMLElement).style.backgroundColor =
                    "transparent"
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="mono text-[10px] w-5 text-right flex-shrink-0"
                    style={{ color: "var(--muted-foreground)" }}
                  >
                    {it.index ?? ""}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-xs truncate"
                      style={{ color: "var(--foreground)" }}
                    >
                      {it.title || it.url}
                    </div>
                  </div>
                  <span
                    className="mono text-[10px] flex-shrink-0"
                    style={{
                      color:
                        STATE_COLOR[it.status] ?? "var(--muted-foreground)",
                    }}
                  >
                    {STATE_LABEL[it.status] ?? it.status}
                  </span>
                  {onResumeItem && it.status !== "done" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void onResumeItem(it)
                      }}
                      className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded border cursor-pointer"
                      style={{
                        borderColor: "var(--border)",
                        color: "var(--primary)",
                      }}
                    >
                      Resume
                    </button>
                  )}
                </div>
                <div
                  className="mt-1.5 h-1 rounded-full overflow-hidden"
                  style={{ backgroundColor: "var(--background)" }}
                >
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${Math.min(100, it.progress || 0)}%`,
                      backgroundColor:
                        STATE_COLOR[it.status] ?? "var(--primary)",
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function DownloadsPage() {
  const { jobs, removeJob, clearFinished, resumeItem } = useDownloads()
  const { navigate } = useRouter()
  const requests = useRequests()
  useEffect(() => {
    loadRequests()
  }, [])

  const active = jobs.filter(
    (j) =>
      j.status === "queued" ||
      j.status === "fetching-metadata" ||
      j.status === "downloading" ||
      j.status === "merging",
  )
  const finished = jobs.filter(
    (j) =>
      j.status === "done" || j.status === "error" || j.status === "cancelled",
  )

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
    )
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
            onClick={clearFinished}
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
              style={{
                borderColor: "var(--border)",
                color: "var(--muted-foreground)",
                backgroundColor: "var(--card)",
              }}
            >
              Clear all
            </button>
          </div>
          <div
            className="rounded-lg border overflow-hidden"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--card)",
            }}
          >
            {requests.map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                onOpenRequest={(rec) => navigate("info", { uid: rec.id })}
                onResumeItem={resumeItem}
              />
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
              <DownloadRow
                key={job.id}
                job={job}
                onClear={removeJob}
                onOpen={(j) => navigate("info", { uid: j.requestId })}
              />
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
              <DownloadRow
                key={job.id}
                job={job}
                onClear={removeJob}
                onOpen={(j) => navigate("info", { uid: j.requestId })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
