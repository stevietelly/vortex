import type { FormatOption } from "@/types/domain"

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00"
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  const ss = String(s).padStart(2, "0")
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`
  return `${m}:${ss}`
}

export function formatCount(n?: number): string {
  if (n == null) return ""
  if (n >= 1_000_000_000)
    return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return String(n)
}

export function formatFilesize(bytes?: number, approx = false): string {
  if (bytes == null) return ""
  const units = ["B", "KB", "MB", "GB", "TB"]
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  const prefix = approx ? "~" : ""
  return `${prefix}${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatBitrate(kbps?: string): string {
  if (!kbps) return ""
  if (kbps === "0") return "Best (VBR)"
  return `${kbps} kbps`
}

// Build an ordered fallback ladder of format ids to try if the chosen one is
// unavailable: the selected id first, then the closest other resolutions
// (nearest height, whether lower or higher), ending in `best`.
export function buildFallbackChain(
  formats: FormatOption[],
  selectedId: string,
): string[] {
  const selected = formats.find((f) => f.id === selectedId)
  // An audio-only selection must never fall back to video formats — build the
  // ladder only for selections that actually include video.
  if (selected && !selected.hasVideo) return [selectedId]
  const video = formats.filter((f) => f.hasVideo && f.id !== "bestaudio/best")
  const others = video
    .filter((f) => f.id !== selectedId)
    .sort((a, b) => {
      // No concrete height on the selection (e.g. "Best available") → try
      // the *highest* quality first, not the lowest.
      if (selected?.height == null) return (b.height ?? 0) - (a.height ?? 0)
      const d = heightDelta(a, selected) - heightDelta(b, selected)
      return d !== 0 ? d : (b.height ?? 0) - (a.height ?? 0)
    })
  const chain = [selectedId, ...others.map((f) => f.id)]
  if (!chain.includes("best")) chain.push("best")
  return chain
}

function heightDelta(f: FormatOption, selected?: FormatOption): number {
  const h = f.height ?? 0
  const s = selected?.height ?? 0
  return Math.abs(h - s)
}
