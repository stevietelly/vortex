// Background service worker: sets up the "Send to Vortex" context menu
// and handles delivering right-clicked URLs (page, link, video, audio)
// to the desktop app via bridge (if configured) or vortex:// deep links.

const DEFAULTS = { transport: "auto", port: 47831, token: "" }

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "send-to-vortex",
    title: "Send to Vortex",
    contexts: ["page", "link", "video", "audio"],
  })
})

function flashBadge(text, color, tabId) {
  if (tabId) {
    chrome.action.setBadgeText({ text, tabId })
    chrome.action.setBadgeBackgroundColor({ color, tabId })
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "", tabId })
    }, 1500)
  }
}

async function loadOptions() {
  const stored = await chrome.storage.sync.get(DEFAULTS)
  return { ...DEFAULTS, ...stored }
}

async function sendViaBridge(urls, options) {
  const base = `http://127.0.0.1:${options.port}`
  const r = await fetch(`${base}/add`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vortex-token": options.token,
    },
    body: JSON.stringify({ urls }),
    signal: AbortSignal.timeout(1500),
  })
  if (!r.ok) throw new Error(`bridge ${r.status}`)
}

async function sendViaDeepLink(url, tabId) {
  const deepLinkUrl = `vortex://add?url=${encodeURIComponent(url)}`
  if (tabId) {
    try {
      await chrome.tabs.update(tabId, { url: deepLinkUrl })
      return
    } catch {
      // Fall through to tab creation if update is blocked
    }
  }
  const tab = await chrome.tabs.create({ url: deepLinkUrl, active: false })
  setTimeout(() => {
    chrome.tabs.remove(tab.id).catch(() => {})
  }, 1000)
}

async function deliver(url, tabId) {
  const options = await loadOptions()
  const mode = options.transport
  if (mode !== "deeplink" && options.token) {
    try {
      await sendViaBridge([url], options)
      flashBadge("\u2713", "#22c55e", tabId)
      return
    } catch (e) {
      if (mode === "bridge") {
        flashBadge("!", "#ef4444", tabId)
        return
      }
      // auto: fall through to deep links
    }
  }
  try {
    await sendViaDeepLink(url, tabId)
    flashBadge("\u2713", "#22c55e", tabId)
  } catch {
    flashBadge("!", "#ef4444", tabId)
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "send-to-vortex") return
  const targetUrl = info.linkUrl || info.srcUrl || info.pageUrl
  if (!targetUrl || !/^https?:/i.test(targetUrl)) {
    if (tab?.id) flashBadge("!", "#ef4444", tab.id)
    return
  }
  await deliver(targetUrl, tab?.id)
})
