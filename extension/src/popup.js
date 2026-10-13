// Popup: ask the content script what's on the page, then funnel selections
// into the Vortex app — bridge first (bulk, silent), vortex:// links as the
// fallback (one OS hand-off per URL).

const $ = (id) => document.getElementById(id)

const DEFAULTS = { transport: "auto", port: 47831, token: "" }
let options = { ...DEFAULTS }

async function loadOptions() {
  const stored = await chrome.storage.sync.get(DEFAULTS)
  options = { ...DEFAULTS, ...stored }
}

const bridgeBase = () => `http://127.0.0.1:${options.port}`

async function bridgeHealthy() {
  try {
    const r = await fetch(`${bridgeBase()}/health`, {
      signal: AbortSignal.timeout(400),
    })
    return r.ok
  } catch {
    return false
  }
}

async function sendViaBridge(urls) {
  const r = await fetch(`${bridgeBase()}/add`, {
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

function sendViaDeepLink(url) {
  // An anchor click triggers the OS external-scheme hand-off (Firefox asks
  // once; Windows launches/focuses Vortex via the registered vortex scheme).
  const a = document.createElement("a")
  a.href = `vortex://add?url=${encodeURIComponent(url)}`
  a.click()
}

async function deliver(urls) {
  const mode = options.transport
  // Bridge-only with no token can never succeed — fail loudly instead of
  // silently falling through to deep links.
  if (mode === "bridge" && !options.token) {
    throw new Error("no bridge token set — paste it in the extension options")
  }
  if (mode !== "deeplink" && options.token) {
    try {
      await sendViaBridge(urls)
      return
    } catch (e) {
      if (mode === "bridge") throw e
      // auto: fall through to deep links
    }
  }
  for (const u of urls) {
    sendViaDeepLink(u)
    await new Promise((r) => setTimeout(r, 250))
  }
}

function toast(msg, isError = false) {
  const el = $("toast")
  el.textContent = msg
  el.classList.toggle("error", isError)
  el.hidden = false
  setTimeout(() => window.close(), isError ? 2200 : 900)
}

const KIND_LABEL = { media: "video", embed: "embed", link: "link" }

async function init() {
  await loadOptions()

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    $("empty").hidden = false
    $("empty").textContent = "This page can't be sent"
    return
  }

  const health = bridgeHealthy()
  health.then((ok) => {
    $("status").querySelector(".dot").classList.toggle("on", ok)
    $("status").querySelector(".status-text").textContent = ok
      ? "app online"
      : "app offline"
  })

  let scan = null
  try {
    scan = await chrome.tabs.sendMessage(tab.id, { type: "vortex:scan" })
  } catch {
    // content script not injected (e.g. just installed) — offer the page only
  }

  const senders = [] // { urls, button }

  // The page itself — yt-dlp handles ~1800 sites from just the URL.
  if (scan?.pageUrl) {
    const row = $("page-row")
    row.hidden = false
    $("page-title").textContent = scan.pageTitle || scan.pageUrl
    const btn = $("send-page")
    btn.addEventListener("click", async () => {
      btn.disabled = true
      try {
        await deliver([scan.pageUrl])
        toast("Sent to Vortex ✓")
      } catch (e) {
        toast(String(e.message || e), true)
        btn.disabled = false
      }
    })
    senders.push({ urls: [scan.pageUrl], button: btn })
  }

  // Discovered media / embeds / links.
  const items = scan?.items ?? []
  $("found-label").hidden = items.length === 0
  if (items.length === 0 && !scan) $("empty").hidden = false
  const list = $("items")
  for (const item of items) {
    const rowEl = document.createElement("div")
    rowEl.className = "row"

    const meta = document.createElement("div")
    meta.className = "meta"
    const label = document.createElement("div")
    label.className = "label truncate"
    label.textContent = item.url
    label.title = item.url
    meta.appendChild(label)

    const kind = document.createElement("span")
    kind.className = "kind"
    kind.textContent = KIND_LABEL[item.kind] || item.kind

    const btn = document.createElement("button")
    btn.className = "btn"
    btn.textContent = "Send"

    rowEl.appendChild(meta)
    rowEl.appendChild(kind)
    rowEl.appendChild(btn)
    list.appendChild(rowEl)

    btn.addEventListener("click", async () => {
      btn.disabled = true
      try {
        await deliver([item.url])
        toast("Sent to Vortex ✓")
      } catch (e) {
        toast(String(e.message || e), true)
        btn.disabled = false
      }
    })
    senders.push({ urls: [item.url], button: btn })
  }

  if (senders.length > 1) {
    const all = $("send-all")
    all.hidden = false
    all.addEventListener("click", async () => {
      all.disabled = true
      const urls = [...new Set(senders.flatMap((s) => s.urls))]
      try {
        await deliver(urls)
        toast(`Sent ${urls.length} to Vortex ✓`)
      } catch (e) {
        toast(String(e.message || e), true)
        all.disabled = false
      }
    })
  }

  $("open-options").addEventListener("click", () => {
    chrome.runtime.openOptionsPage()
  })
}

init()
