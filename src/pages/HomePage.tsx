import { useState, useEffect, useRef } from "react";
import { IconDownload, IconLink } from "../icons";
import { invoke } from "@/lib/tauri";
import { saveRequest, saveFailedRequest } from "@/lib/requests";
import { savePlaylistItems } from "@/lib/db";
import type { VideoMetadata } from "@/types/domain";

export default function HomePage({ onFetch }: { onFetch: (metadata: VideoMetadata) => void }) {
  const [url, setUrl] = useState("");
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runFetch = async (target: string) => {
    const trimmed = target.trim();
    if (!trimmed || isFetching) return;
     setIsFetching(true);
    setError(null);
    try {
      const metadata = await invoke<VideoMetadata>("fetch_metadata", { url: trimmed });
      const reqId = metadata.id || metadata.url;
      await saveRequest({
        id: reqId,
        url: metadata.url,
        title: metadata.title,
        uploader: metadata.uploader,
        requestedAt: Date.now(),
        status: "requested",
        metadata,
      });
      if (metadata.isPlaylist && metadata.entries?.length) {
        await savePlaylistItems(
          reqId,
          metadata.url,
          metadata.entries.map((e) => ({ index: e.index, title: e.title })),
        );
      }
      onFetch(metadata);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("not in tauri context")) {
        await saveFailedRequest(trimmed, msg);
      }
      setError(msg.includes("not in tauri context") ? "Run the desktop app to fetch real metadata." : msg);
    } finally {
      setIsFetching(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") runFetch(url);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-16">
      {/* Logo / wordmark */}
      <div className="mb-14 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            <IconDownload size={18} />
          </div>
          <span className="text-2xl font-semibold tracking-tight" style={{ color: "var(--foreground)" }}>
            Downlink
          </span>
        </div>
        <p className="text-sm" style={{ color: "var(--muted-foreground)" }}>
          Paste any video or playlist URL to get started
        </p>
      </div>

      {/* URL Input */}
      <div className="w-full max-w-2xl">
        <div
          className="flex items-center rounded-lg border overflow-hidden transition-all"
          style={{
            backgroundColor: "var(--card)",
            borderColor: error ? "#EF4444" : "var(--border)",
            boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          }}
        >
          <div className="pl-4 flex-shrink-0" style={{ color: "var(--muted-foreground)" }}>
            <IconLink size={16} />
          </div>
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://youtube.com/watch?v=..."
            className="flex-1 px-3 py-3.5 text-sm outline-none bg-transparent mono"
            style={{ color: "var(--foreground)", caretColor: "var(--primary)" }}
            spellCheck={false}
          />
          <button
            onClick={() => runFetch(url)}
            disabled={!url.trim() || isFetching}
            className="m-1.5 px-5 py-2 rounded text-sm font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            {isFetching ? (
              <>
                <div
                  className="w-3.5 h-3.5 rounded-full border-2 border-transparent"
                  style={{ borderTopColor: "currentColor", animation: "spin-slow 0.7s linear infinite" }}
                />
                Fetching
              </>
            ) : (
              "Fetch"
            )}
          </button>
        </div>

        {error && (
          <div
            className="mono text-[11px] mt-2 px-3 py-2 rounded border"
            style={{ backgroundColor: "#EF444418", borderColor: "#EF4444", color: "#EF4444" }}
            title={error}
          >
            {error.toLowerCase().includes("not a bot") || error.toLowerCase().includes("sign in to confirm")
              ? "YouTube is asking you to confirm you're not a bot. Open Settings → Authentication and provide cookies (a browser you're signed into, or a cookies file), then try again."
              : error}
          </div>
        )}

        {/* Supported platforms */}
        <div className="flex items-center gap-2 mt-3 px-1">
          <span className="mono text-[10px]" style={{ color: "var(--muted-foreground)" }}>Supports:</span>
          {["YouTube", "Vimeo", "Twitter/X", "Twitch", "SoundCloud"].map((p) => (
            <span
              key={p}
              className="mono text-[10px] px-1.5 py-0.5 rounded"
              style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}
            >
              {p}
            </span>
          ))}
        </div>
      </div>

    </div>
  );
}
