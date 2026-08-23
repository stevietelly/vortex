import type { DownloadJob, DownloadStatus } from "@/types/domain";
import { formatLabel, STATE_COLOR, STATE_LABEL } from "@/utils";
import Thumbnail from "../Thumbnail";
import { IconX } from "@/icons";




export default function DownloadRow({ job, onClear }: { job: DownloadJob; onClear: (id: string) => void }) {
  const isAudio = !job.metadata.formats.find((f) => f.id === job.selectedFormatId)?.hasVideo;
  const isActive =
    job.status === "queued" ||
    job.status === "fetching-metadata" ||
    job.status === "downloading" ||
    job.status === "merging";

  return (
    <div className="flex items-center gap-4 px-5 py-4 group" style={{ borderBottom: "1px solid var(--border)" }}>
      <div
        className="relative rounded overflow-hidden flex-shrink-0"
        style={{ width: 64, height: 40, backgroundColor: "var(--muted)" }}
      >
        <Thumbnail src={job.metadata.thumbnail} alt={job.metadata.title} className="w-full h-full object-cover" />
        {isActive && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
            <div
              className="w-4 h-4 rounded-full border-2 border-transparent"
              style={{ borderTopColor: "var(--primary)", animation: "spin-slow 0.7s linear infinite" }}
            />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>{job.metadata.title}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>{job.metadata.uploader}</span>
          <span className="mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>·</span>
          <span
            className="mono text-[10px] px-1.5 py-px rounded"
            style={{
              backgroundColor: isAudio ? "#7C3AED22" : "var(--primary)18",
              color: isAudio ? "#A78BFA" : "var(--primary)",
            }}
          >
            {formatLabel(job).toUpperCase()}
          </span>
          {job.formatId && job.formatId !== job.selectedFormatId && (
            <span className="mono text-[10px] ml-1" style={{ color: "var(--muted-foreground)" }}>
              ↻ alt format
            </span>
          )}
        </div>

        {isActive && (
          <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ backgroundColor: "var(--border)" }}>
            {job.status === "merging" ? (
              <div
                className="h-full w-1/3 rounded-full"
                style={{ backgroundColor: "var(--primary)", animation: "progress-slide 1.4s ease-in-out infinite" }}
              />
            ) : (
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${job.progress}%`, backgroundColor: "var(--primary)" }}
              />
            )}
          </div>
        )}

        {job.error && (
          <div className="mono text-[10px] mt-1 truncate" style={{ color: "#EF4444" }} title={job.error}>{job.error}</div>
        )}

        {job.status === "done" && job.outputPath && (
          <div className="mono text-[10px] mt-1 truncate" style={{ color: "var(--muted-foreground)" }} title={job.outputPath}>
            {job.outputPath}
          </div>
        )}

        {job.status === "downloading" && (job.speed || job.eta) && (
          <div className="mono text-[10px] mt-1" style={{ color: "var(--muted-foreground)" }}>
            {job.speed ? `${job.speed}` : ""}{job.speed && job.eta ? " · " : ""}{job.eta ? `ETA ${job.eta}` : ""}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-right">
          <div className="mono text-[10px] font-medium" style={{ color: STATE_COLOR[job.status] }}>
            {STATE_LABEL[job.status]}
          </div>
          {job.status === "downloading" && (
            <div className="mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>
              {Math.round(job.progress)}%
            </div>
          )}
          {job.completedAt && (
            <div className="mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>
              {job.completedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
        </div>
        {!isActive && (
          <button
            onClick={() => onClear(job.id)}
            className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded flex items-center justify-center cursor-pointer"
            style={{ color: "var(--muted-foreground)", backgroundColor: "var(--muted)" }}
          >
            <IconX size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
