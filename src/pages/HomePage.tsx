import { useState, useEffect, useRef } from "react"
import { IconDownload, IconLink } from "../icons"
import { saveRequest } from "@/lib/requests"
import { parseYoutubeLink, videoOnlyUrl, type YoutubeLink } from "@/lib/youtube"
import type { VideoMetadata } from "@/types/domain"
import { useRouter } from "@/router/provider"

export default function HomePage() {
  const { navigate } = useRouter()
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [choice, setChoice] = useState<{ raw: string; link: YoutubeLink } | null>(
    null,
  )
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const proceed = async (target: string) => {
    const trimmed = target.trim()
    if (!trimmed) return
    setError(null)
    try {
      // Persist the request as soon as we have a URL — InfoPage owns the fetch.
      const uid = await saveRequest({
        url: trimmed,
        title: "",
        uploader: "",
        requestedAt: Date.now(),
        status: "fetching",
        metadata: {} as VideoMetadata,
      })
      navigate("info", { uid })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const submit = async (target: string) => {
    const trimmed = target.trim()
    if (!trimmed) return
    setError(null)

    // YouTube link that carries a *video* plus a list/radio → ask what to
    // fetch (a pure playlist link has no video to fall back to).
    const link = parseYoutubeLink(trimmed)
    if (link.isYoutube && link.listId && link.videoId) {
      setChoice({ raw: trimmed, link })
      return
    }
    await proceed(trimmed)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void submit(url)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-full px-6 py-16">
      {/* Logo / wordmark */}
      <div className="mb-14 text-center">
        <div className="flex items-center justify-center gap-2 mb-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-foreground)",
            }}
          >
            <IconDownload size={18} />
          </div>
          <span
            className="text-2xl font-semibold tracking-tight"
            style={{ color: "var(--foreground)" }}
          >
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
          <div
            className="pl-4 flex-shrink-0"
            style={{ color: "var(--muted-foreground)" }}
          >
            <IconLink size={16} />
          </div>
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setChoice(null)
            }}
            onKeyDown={handleKeyDown}
            placeholder="https://youtube.com/watch?v=..."
            className="flex-1 px-3 py-3.5 text-sm outline-none bg-transparent mono"
            style={{ color: "var(--foreground)", caretColor: "var(--primary)" }}
            spellCheck={false}
          />
          <button
            onClick={() => void submit(url)}
            disabled={!url.trim()}
            className="m-1.5 px-5 py-2 rounded text-sm font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: "var(--primary)",
              color: "var(--primary-foreground)",
            }}
          >
            Fetch
          </button>
        </div>

        {error && (
          <div
            className="mono text-[11px] mt-2 px-3 py-2 rounded border"
            style={{
              backgroundColor: "#EF444418",
              borderColor: "#EF4444",
              color: "#EF4444",
            }}
            title={error}
          >
            {error}
          </div>
        )}

        {/* YouTube link with a list/radio attached — what should we fetch? */}
        {choice && (
          <div
            className="mt-3 rounded-lg border overflow-hidden"
            style={{
              borderColor: "var(--primary)",
              backgroundColor: "var(--card)",
            }}
          >
            <div className="px-4 py-3.5 space-y-1.5">
              <div
                className="mono text-[10px] uppercase tracking-widest"
                style={{ color: "var(--primary)" }}
              >
                {choice.link.isRadio ? "Mix (radio) linked" : "Playlist linked"}
              </div>
              <div className="text-sm" style={{ color: "var(--foreground)" }}>
                This URL carries{" "}
                {choice.link.isRadio
                  ? "an auto-generated YouTube Mix"
                  : "a playlist"}{" "}
                (
                <span className="mono text-[11px]">
                  list={choice.link.listId}
                </span>
                {choice.link.isRadio && (
                  <>
                    {" "}
                    <span className="mono text-[11px]">+ start_radio=1</span>
                  </>
                )}
                ) on top of the video.
              </div>
              <div
                className="text-xs"
                style={{ color: "var(--muted-foreground)" }}
              >
                Open the whole list, or stick to just this video (
                <span className="mono">v={choice.link.videoId}</span>).
              </div>
            </div>
            <div className="flex gap-2 px-4 pb-4">
              <button
                onClick={() => {
                  const raw = choice.raw
                  setChoice(null)
                  void proceed(videoOnlyUrl(raw))
                }}
                className="px-4 py-2 rounded text-sm font-medium transition-all cursor-pointer hover:opacity-90 active:scale-[0.99]"
                style={{
                  backgroundColor: "var(--primary)",
                  color: "var(--primary-foreground)",
                }}
              >
                Just this video
              </button>
              <button
                onClick={() => {
                  const raw = choice.raw
                  setChoice(null)
                  void proceed(raw)
                }}
                className="px-4 py-2 rounded text-sm transition-all cursor-pointer hover:opacity-90"
                style={{
                  border: "1px solid var(--border)",
                  color: "var(--foreground)",
                  backgroundColor: "var(--muted)",
                }}
              >
                Open the list
              </button>
              <button
                onClick={() => setChoice(null)}
                className="px-3 py-2 rounded text-sm transition-all cursor-pointer hover:opacity-90"
                style={{ color: "var(--muted-foreground)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Supported platforms */}
        <div className="flex items-center gap-2 mt-3 px-1">
          <span
            className="mono text-[10px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            Supports:
          </span>
          {["YouTube", "Vimeo", "Twitter/X", "Twitch", "SoundCloud"].map(
            (p) => (
              <span
                key={p}
                className="mono text-[10px] px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: "var(--muted)",
                  color: "var(--muted-foreground)",
                }}
              >
                {p}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  )
}
