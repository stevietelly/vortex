// Scans the top document for anything Vortex could download: the page itself,
// direct media URLs, video-site links, and embedded players. The popup asks
// for a snapshot via the "vortex:scan" message.

(() => {
  const VIDEO_HOST_RE =
    /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com|twitter\.com|x\.com|instagram\.com|facebook\.com|reddit\.com|soundcloud\.com|bandcamp\.com|streamable\.com|ted\.com|bilibili\.com|nicovideo\.jp)$/i
  const MEDIA_EXT_RE = /\.(mp4|webm|mkv|mov|m4v|avi|flv|mp3|m4a|opus|wav|ogg|m3u8|mpd)(\?|#|$)/i
  const MAX_ITEMS = 30

  const abs = (u) => {
    try {
      return new URL(u, location.href).href
    } catch {
      return null
    }
  }

  const hostOf = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, "")
    } catch {
      return null
    }
  }

  const isVideoHost = (u) => {
    const h = hostOf(u)
    return h ? VIDEO_HOST_RE.test(h) : false
  }

  function scan() {
    const items = []
    const seen = new Set()
    const push = (url, kind) => {
      if (!url || seen.has(url) || items.length >= MAX_ITEMS) return
      if (url.startsWith("javascript:") || url.startsWith("data:")) return
      seen.add(url)
      items.push({ url, kind })
    }

    // Direct media in the DOM.
    document
      .querySelectorAll("video[src], video source[src], audio[src]")
      .forEach((el) => push(abs(el.getAttribute("src")), "media"))

    // og:video / twitter:player (embedded players the DOM may not expose).
    document
      .querySelectorAll(
        'meta[property="og:video:url"], meta[property="og:video"], meta[name="twitter:player:stream"]',
      )
      .forEach((el) => push(abs(el.content), "media"))

    // Embedded players (iframes) — embed URLs are directly yt-dlp-able.
    document.querySelectorAll("iframe[src]").forEach((el) => {
      const u = abs(el.getAttribute("src"))
      if (u && isVideoHost(u)) push(u, "embed")
    })

    // Links to known video sites.
    document.querySelectorAll("a[href]").forEach((el) => {
      const u = abs(el.getAttribute("href"))
      if (!u) return
      if (isVideoHost(u) || MEDIA_EXT_RE.test(u)) push(u, "link")
    })

    return {
      pageUrl: location.href,
      pageTitle: document.title,
      items,
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "vortex:scan") {
      sendResponse(scan())
      return true
    }
    return false
  })
})()
