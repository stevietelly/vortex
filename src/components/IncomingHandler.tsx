import { useEffect, useRef } from "react"
import { listen } from "@tauri-apps/api/event"
import { invoke, isTauri } from "@/lib/tauri"
import { saveRequest } from "@/lib/requests"
import { fetchAndRecord } from "@/lib/metadata"
import { useDownloads } from "@/downloads/provider"
import { useRouter } from "@/router/provider"
import type { VideoMetadata } from "@/types/domain"

// The pre-merged best selector — what the format picker's "Best available"
// option uses; the fetch may not advertise it, so we fall back to it.
const BEST_FORMAT_ID = "bestvideo*+bestaudio/best"

// Same-URL guard window: the bridge and deep-link paths are drain-based, but
// a page reload or a double click in the extension could still re-deliver.
const DEDUPE_WINDOW_MS = 60_000
const recentlyProcessed = new Map<string, number>()

function isDuplicate(url: string): boolean {
  const now = Date.now()
  for (const [u, ts] of recentlyProcessed) {
    if (now - ts > DEDUPE_WINDOW_MS) recentlyProcessed.delete(u)
  }
  if (recentlyProcessed.has(url)) return true
  recentlyProcessed.set(url, now)
  return false
}

/**
 * Receives URLs funneled in by the browser extension — via the `vortex://`
 * deep link or the localhost bridge — and applies the `incomingAction`
 * setting: prefetch (open Info, review) or download (fetch + auto-start).
 * Mounted once, inside the router and downloads providers.
 */
export default function IncomingHandler() {
  const { settings, startDownload } = useDownloads()
  const { navigate } = useRouter()

  // Mutable refs so the drain/listen effect can stay mounted once while the
  // setting and callbacks evolve underneath it.
  const settingsRef = useRef(settings)
  const navigateRef = useRef(navigate)
  const startRef = useRef(startDownload)
  useEffect(() => {
    settingsRef.current = settings
    navigateRef.current = navigate
    startRef.current = startDownload
  })

  const drainAndProcess = async () => {
    let urls: string[] = []
    try {
      urls = await invoke<string[]>("drain_incoming")
    } catch {
      return // not in a Tauri context
    }
    let navigated = false
    for (const url of urls) {
      if (isDuplicate(url)) continue
      const s = settingsRef.current
      try {
        const uid = await saveRequest({
          url,
          title: "",
          uploader: "",
          requestedAt: Date.now(),
          status: "fetching",
          metadata: {} as VideoMetadata,
        })
        if (s.incomingAction === "download") {
          const md = await fetchAndRecord(uid, url, s.mockMode)
          const fmt =
            md.formats.find((f) => f.id === BEST_FORMAT_ID)?.id ??
            BEST_FORMAT_ID
          await startRef.current(md, fmt, { requestId: uid })
        } else if (!navigated) {
          // Batch prefetch: review the first arrival; the rest stay queued as
          // saved requests (visible under Downloads).
          navigated = true
          navigateRef.current("info", { uid })
        }
      } catch {
        // fetchAndRecord already marked the request as errored.
      }
    }
  }

  useEffect(() => {
    if (!isTauri()) return
    // Anything that arrived before the webview was ready is still queued.
    void drainAndProcess()
    const unlisten = listen("incoming-urls", () => {
      void drainAndProcess()
    })
    return () => {
      unlisten.then((f) => f())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
