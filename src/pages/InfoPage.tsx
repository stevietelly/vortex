import { useState } from "react";
import { IconDownload, IconFilm, IconMusic } from "../icons";
import Thumbnail from "../components/Thumbnail";
import { formatDuration, formatCount, formatFilesize } from "@/lib/format";
import type { VideoMetadata } from "@/types/domain";
import type { FolderProfile } from "@/types";

function DownloadPanel({
  metadata,
  onDownload,
  folderProfiles,
  activeProfileId,
}: {
  metadata: VideoMetadata;
  onDownload: (formatId: string, downloadAll?: boolean, profileId?: string) => void;
  folderProfiles: FolderProfile[];
  activeProfileId: string;
}) {
  const [selectedId, setSelectedId] = useState<string>(() => {
    const byHeight = metadata.formats.find((f) => f.height === 1080);
    return byHeight?.id ?? metadata.formats[metadata.formats.length - 1]?.id ?? "best";
  });
  const [downloadAll, setDownloadAll] = useState(false);
  const [profileId, setProfileId] = useState<string>(activeProfileId);

  const selected = metadata.formats.find((f) => f.id === selectedId);

  return (
    <div
      className="rounded-lg border overflow-hidden"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
    >
      <div className="p-4 space-y-4">
        {/* Format options (collapsed from real yt-dlp formats) */}
        <div>
          <label className="mono text-[10px] uppercase tracking-widest block mb-2" style={{ color: "var(--muted-foreground)" }}>
            Format
          </label>
          <div className="flex gap-1.5 flex-wrap">
            {metadata.formats.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedId(f.id)}
                className="mono text-xs px-3 py-1.5 rounded border transition-all cursor-pointer"
                style={{
                  borderColor: selectedId === f.id ? "var(--primary)" : "var(--border)",
                  backgroundColor: selectedId === f.id ? "var(--primary)18" : "transparent",
                  color: selectedId === f.id ? "var(--primary)" : "var(--muted-foreground)",
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Playlist: download all toggle */}
        {metadata.isPlaylist && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDownloadAll(!downloadAll)}
              className="w-8 h-4.5 rounded-full relative transition-colors cursor-pointer flex-shrink-0"
              style={{ backgroundColor: downloadAll ? "var(--primary)" : "var(--border)" }}
            >
              <div
                className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform"
                style={{ transform: downloadAll ? "translateX(14px)" : "translateX(2px)" }}
              />
            </button>
            <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              Download entire playlist ({metadata.playlistCount} videos)
            </span>
          </div>
        )}

        {/* File size estimate */}
        {selected?.filesize ? (
          <div
            className="mono text-[10px] px-3 py-2 rounded"
            style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}
          >
            Estimated size: <span style={{ color: "var(--foreground)" }}>{formatFilesize(selected.filesize)}</span>
            {" · "}
            {selected.label}
          </div>
        ) : null}

        {/* Destination folder profile */}
        {folderProfiles.length > 0 && (
          <div>
            <label className="mono text-[10px] uppercase tracking-widest block mb-2" style={{ color: "var(--muted-foreground)" }}>
              Save to
            </label>
            <select
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded border outline-none mono bg-transparent"
              style={{ borderColor: "var(--border)", color: "var(--foreground)" }}
            >
              <option value="">Default (app settings)</option>
              {folderProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || p.path}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Download button */}
        <button
          onClick={() => onDownload(selectedId, downloadAll, profileId || undefined)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded font-medium text-sm transition-all cursor-pointer hover:opacity-90 active:scale-[0.99]"
          style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          <IconDownload size={15} />
          {metadata.isPlaylist && downloadAll
            ? `Download playlist · ${selected?.label ?? ""}`
            : `Download · ${selected?.label ?? ""}`}
        </button>
      </div>
    </div>
  );
}

function VideoInfoPage({
  metadata,
  onDownload,
  folderProfiles,
  activeProfileId,
}: {
  metadata: VideoMetadata;
  onDownload: (formatId: string, downloadAll?: boolean, profileId?: string) => void;
  folderProfiles: FolderProfile[];
  activeProfileId: string;
}) {
  return (
    <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 340px" }}>
      <div className="space-y-5">
        <div
          className="relative w-full rounded-lg overflow-hidden"
          style={{ aspectRatio: "16/9", backgroundColor: "var(--muted)" }}
        >
          <Thumbnail src={metadata.thumbnail} alt={metadata.title} className="w-full h-full object-cover" />
          <div
            className="absolute bottom-2 right-2 mono text-xs px-2 py-0.5 rounded"
            style={{ backgroundColor: "rgba(0,0,0,0.75)", color: "#fff" }}
          >
            {formatDuration(metadata.duration)}
          </div>
        </div>

        <div>
          <h1 className="text-lg font-semibold leading-snug" style={{ color: "var(--foreground)" }}>
            {metadata.title}
          </h1>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-sm font-medium" style={{ color: "var(--primary)" }}>{metadata.uploader}</span>
            {metadata.uploadDate && (
              <span className="mono text-xs" style={{ color: "var(--muted-foreground)" }}>{metadata.uploadDate}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-px rounded-lg overflow-hidden border" style={{ borderColor: "var(--border)" }}>
          {[
            { label: "Views", value: formatCount(metadata.views) },
            { label: "Likes", value: formatCount(metadata.likes) },
            { label: "Duration", value: formatDuration(metadata.duration) },
          ].map(({ label, value }) => (
            <div key={label} className="px-4 py-3" style={{ backgroundColor: "var(--card)" }}>
              <div className="mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--muted-foreground)" }}>{label}</div>
              <div className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{value}</div>
            </div>
          ))}
        </div>

        {metadata.description && (
          <div>
            <div className="mono text-[10px] uppercase tracking-widest mb-2" style={{ color: "var(--muted-foreground)" }}>Description</div>
            <p className="text-sm leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{metadata.description}</p>
          </div>
        )}

        <div
          className="mono text-[10px] px-3 py-2 rounded border truncate"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}
        >
          {metadata.url}
        </div>
      </div>

      <div className="sticky top-0 self-start">
        <div className="mono text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--muted-foreground)" }}>Download</div>
        <DownloadPanel metadata={metadata} onDownload={onDownload} folderProfiles={folderProfiles} activeProfileId={activeProfileId} />
      </div>
    </div>
  );
}

function PlaylistInfoPage({
  metadata,
  onDownload,
  folderProfiles,
  activeProfileId,
}: {
  metadata: VideoMetadata;
  onDownload: (formatId: string, downloadAll?: boolean, profileId?: string) => void;
  folderProfiles: FolderProfile[];
  activeProfileId: string;
}) {
  const entries = metadata.entries ?? [];
  return (
    <div className="grid gap-6" style={{ gridTemplateColumns: "1fr 340px" }}>
      <div className="space-y-5">
        <div className="flex gap-4">
          <div
            className="relative rounded-lg overflow-hidden flex-shrink-0"
            style={{ width: 120, height: 80, backgroundColor: "var(--muted)" }}
          >
        <Thumbnail src={metadata.thumbnail} alt={metadata.title} className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="mono text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--primary)" }}>
              Playlist · {metadata.playlistCount} videos
            </div>
            <h1 className="text-base font-semibold leading-snug" style={{ color: "var(--foreground)" }}>{metadata.title}</h1>
            <div className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>{metadata.uploader}</div>
          </div>
        </div>

        {metadata.description && (
          <p className="text-sm leading-relaxed" style={{ color: "var(--muted-foreground)" }}>{metadata.description}</p>
        )}

        <div>
          <div
            className="mono text-[10px] uppercase tracking-widest mb-3 flex items-center justify-between"
            style={{ color: "var(--muted-foreground)" }}
          >
            <span>Track listing</span>
            <span>{metadata.playlistCount} total · showing {entries.length}</span>
          </div>
          <div className="rounded-lg border divide-y overflow-hidden" style={{ borderColor: "var(--border)" }}>
            {entries.map((video) => (
              <div key={video.index} className="flex items-center gap-3 px-4 py-2.5" style={{ backgroundColor: "var(--card)" }}>
                <span className="mono text-[10px] w-5 text-right flex-shrink-0" style={{ color: "var(--muted-foreground)" }}>
                  {video.index}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: "var(--foreground)" }}>{video.title}</div>
                  <div className="mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>{video.uploader}</div>
                </div>
                <span className="mono text-[10px] flex-shrink-0" style={{ color: "var(--muted-foreground)" }}>{formatDuration(video.duration)}</span>
              </div>
            ))}
            {entries.length < (metadata.playlistCount ?? 0) && (
              <div className="px-4 py-2.5 text-xs text-center" style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}>
                + {(metadata.playlistCount ?? 0) - entries.length} more videos
              </div>
            )}
          </div>
        </div>

        <div
          className="mono text-[10px] px-3 py-2 rounded border truncate"
          style={{ borderColor: "var(--border)", backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}
        >
          {metadata.url}
        </div>
      </div>

      <div className="sticky top-0 self-start">
        <div className="mono text-[10px] uppercase tracking-widest mb-3" style={{ color: "var(--muted-foreground)" }}>Download</div>
        <DownloadPanel metadata={metadata} onDownload={onDownload} folderProfiles={folderProfiles} activeProfileId={activeProfileId} />
      </div>
    </div>
  );
}

export default function InfoPage({
  metadata,
  onDownload,
  folderProfiles,
  activeProfileId,
}: {
  metadata: VideoMetadata;
  onDownload: (formatId: string, downloadAll?: boolean, profileId?: string) => void;
  folderProfiles: FolderProfile[];
  activeProfileId: string;
}) {
  return metadata.isPlaylist ? (
    <PlaylistInfoPage metadata={metadata} onDownload={onDownload} />
  ) : (
    <VideoInfoPage metadata={metadata} onDownload={onDownload} />
  );
}
