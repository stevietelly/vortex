const DEFAULTS = { transport: "auto", port: 47831, token: "" }
const $ = (id) => document.getElementById(id)

async function init() {
  const stored = await chrome.storage.sync.get(DEFAULTS)
  $("transport").value = stored.transport
  $("port").value = stored.port
  $("token").value = stored.token

  $("save").addEventListener("click", async () => {
    await chrome.storage.sync.set({
      transport: $("transport").value,
      port: Number($("port").value) || DEFAULTS.port,
      token: $("token").value.trim(),
    })
    const r = $("result")
    r.textContent = "Saved ✓"
    r.className = "ok"
    setTimeout(() => {
      r.textContent = ""
      r.className = ""
    }, 1500)
  })

  $("test").addEventListener("click", async () => {
    const r = $("result")
    r.className = ""
    r.textContent = "Testing…"
    try {
      const res = await fetch(
        `http://127.0.0.1:${Number($("port").value) || DEFAULTS.port}/health`,
        { signal: AbortSignal.timeout(800) },
      )
      if (res.ok) {
        const body = await res.json()
        r.textContent = body.app === "vortex" ? "Vortex is reachable ✓" : "Reachable (unexpected app)"
        r.className = body.app === "vortex" ? "ok" : "err"
      } else {
        r.textContent = `Unexpected status ${res.status}`
        r.className = "err"
      }
    } catch {
      r.textContent = "Not reachable — is Vortex running?"
      r.className = "err"
    }
  })
}

init()
