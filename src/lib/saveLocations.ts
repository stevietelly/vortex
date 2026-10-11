import type { SaveLocation } from "@/types"

/**
 * Normalized host from a URL or bare domain ("https://www.YouTube.com/watch",
 * "youtube.com", " m.youtube.com " → "youtube.com"). Returns null when the
 * input yields no usable host.
 */
export function domainFromInput(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  let host: string
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname
  } catch {
    return null
  }
  host = host.toLowerCase().replace(/\.$/, "")
  if (!host) return null
  return host.replace(/^www\./, "")
}

/**
 * Find the save location bound to a URL's domain. Matching is by exact host or
 * subdomain suffix, so a "youtube.com" rule also covers m.youtube.com and
 * music.youtube.com. Most specific (longest) rule wins.
 */
export function matchSaveLocation(
  url: string,
  locs: SaveLocation[],
): SaveLocation | null {
  const host = domainFromInput(url)
  if (!host || locs.length === 0) return null
  const sorted = [...locs].sort((a, b) => b.domain.length - a.domain.length)
  return (
    sorted.find(
      (l) => l.domain && (host === l.domain || host.endsWith(`.${l.domain}`)),
    ) ?? null
  )
}
