// YouTube share links often carry a `list=` playlist id — and frequently a
// radio/Mix (`start_radio=1`, or an `RD`-prefixed list). yt-dlp treats those
// as a playlist request, and a Mix is effectively unbounded (it pages forever),
// so the user should choose between "just the video" and "the whole list"
// before we fetch anything.

export interface YoutubeLink {
  isYoutube: boolean
  videoId: string | null
  listId: string | null
  /** Auto-generated Mix/radio: `start_radio=1` or an RD-prefixed list id. */
  isRadio: boolean
}

const YT_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
])

export function parseYoutubeLink(raw: string): YoutubeLink {
  const empty: YoutubeLink = {
    isYoutube: false,
    videoId: null,
    listId: null,
    isRadio: false,
  }
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return empty
  }
  if (!YT_HOSTS.has(u.hostname.toLowerCase())) return empty

  const videoId =
    u.searchParams.get("v") ??
    (u.hostname.toLowerCase().includes("youtu.be")
      ? u.pathname.replace(/^\//, "") || null
      : null)
  const listId = u.searchParams.get("list")
  const isRadio =
    u.searchParams.get("start_radio") === "1" ||
    (listId?.startsWith("RD") ?? false)

  return { isYoutube: true, videoId, listId, isRadio }
}

/**
 * The URL with the list stripped — "just the first parameter" (`v=...`),
 * which yt-dlp fetches as a single video in seconds.
 */
export function videoOnlyUrl(raw: string): string {
  const l = parseYoutubeLink(raw)
  if (!l.isYoutube) return raw
  if (l.videoId) return `https://www.youtube.com/watch?v=${l.videoId}`
  return raw
}
