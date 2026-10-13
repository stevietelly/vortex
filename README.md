# Vortex Downloader

A fast, clean desktop video downloader built with **Tauri 2**, **React 19**, and **yt-dlp**. Paste any URL, pick a format, and download. Vortex also ships a browser extension that discovers videos on any page and sends them straight to the app — no clipboard gymnastics needed.

---

## Features

- Download video and audio from [any site yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) (YouTube, Vimeo, Twitch, TikTok, Twitter/X, and 1 800+ more)
- Format picker: Best, per-resolution (2160p → 360p), audio-only
- Per-download and per-domain save locations
- Direct-download override — send a single job to a different folder without changing your defaults
- Playlist support with per-item progress
- Browser extension for Chrome and Firefox (MV3) — send videos from any tab to the app in one click
- Concurrent download queue with cancel support
- Embed metadata and thumbnails via ffmpeg post-processing

---

## Requirements

| Tool | Notes |
|------|-------|
| [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) | Set its path in **Settings → yt-dlp path** |
| [ffmpeg](https://ffmpeg.org/download.html) | Required for merging streams and post-processing |

---

## Running locally

```sh
# Install frontend dependencies
bun install

# Desktop dev (starts Vite + Tauri)
bun run dev

# Frontend-only web preview (no Tauri context)
bun run react:dev
```

### Build

```sh
bun run build        # tauri build — produces MSI/NSIS installer in src-tauri/target/
bun run react:build  # Vite build only (dist/)
```

### Checks

```sh
bun run typecheck    # tsc --noEmit, must stay clean
cd src-tauri && cargo test   # 23 unit tests
```

---

## Browser Extension

The extension lets you send URLs from any browser tab directly to the running Vortex app — without copying, switching windows, or pasting. It supports Chrome, Edge, and Firefox.

### Installing the extension

**Chrome / Edge**

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `extension/` folder in this repo

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…** and select `extension/manifest.json`

> The extension is loaded unpacked/temporarily — it resets on browser restart in Firefox. For a permanent install you would need to sign it via AMO.

---

### How it works

When you click the Vortex toolbar icon the popup does two things in parallel:

1. **Scans the page** via a content script — finds direct `<video>` sources, `og:video` meta tags, embedded iframes pointing at known video sites, and links to video-hosting domains.
2. **Shows a list** of everything it found, plus a "Send page" button for the page URL itself (yt-dlp can resolve ~1 800 sites from just a URL).

Each item has its own **Send** button. If you have multiple items there is a **Send all** button too.

#### Content script scanning

The content script (`extension/src/content.js`) runs at `document_idle` on every http/https page and responds to a `vortex:scan` message from the popup. It looks for:

| Source | Kind |
|--------|------|
| `<video src>`, `<video><source src>`, `<audio src>` | `media` |
| `<meta property="og:video:url">`, `<meta name="twitter:player:stream">` | `media` |
| `<iframe src>` pointing at YouTube, Vimeo, Twitch, TikTok, etc. | `embed` |
| `<a href>` pointing at a known video host or a direct media file (`.mp4`, `.m3u8`, …) | `link` |

Up to 30 items are returned. The page URL is always offered separately.

---

### Two transports

The extension has two ways to hand a URL to the app. They cover each other's weaknesses:

#### `vortex://` deep link *(always available, no setup)*

The extension opens a `vortex://add?url=<encoded-url>` link. The OS hands it to Vortex (registered at `HKCU` on Windows — no admin rights needed). One OS hand-off per URL, so sending a batch fires multiple links with a 250 ms gap between each.

- Works even if the app is not running — it launches Vortex first, then delivers the URL.
- Works without any token configuration.
- Firefox shows a one-time "Open with Vortex?" dialog; Chrome/Edge do not.

#### Localhost bridge *(bulk sends, token-authed)*

The app starts a tiny HTTP server on `127.0.0.1` (port 47831, or the next free port up to 47840). The extension can POST a batch of URLs to it in a single request.

```
POST http://127.0.0.1:47831/add
x-vortex-token: <token>
Content-Type: application/json

{ "urls": ["https://...", "https://..."] }
```

```
GET http://127.0.0.1:47831/health   → 200 OK  (no auth needed)
```

The bridge token is a 32-byte random hex string generated once and stored in the app data directory. Find it in **Vortex → Settings → Browser extension**.

Batches are capped at 50 URLs. Requests without the correct token return `401`. Only `http`/`https` URLs are accepted — `file:`, `javascript:`, and other schemes are rejected before anything reaches yt-dlp.

---

### Extension options

Open the extension options page (**right-click the toolbar icon → Options**, or click the gear icon in the popup) to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| **Transport** | Auto | `Auto` tries the bridge first (bulk, silent), falls back to `vortex://` links. `vortex:// link only` skips the bridge. `Local bridge only` fails hard if the bridge is unreachable. |
| **Bridge port** | `47831` | Must match what the app reports in Settings. Usually stays at the default. |
| **Bridge token** | *(empty)* | Paste from **Vortex → Settings → Browser extension**. Without a token, the bridge path is skipped even in Auto mode. |

The popup shows a green/grey dot indicating whether the bridge is reachable (`/health` check).

---

### What happens when Vortex receives a URL

The app's behavior on receipt is controlled by **Settings → Incoming action**:

| Mode | Behavior |
|------|----------|
| **Prefetch** *(default)* | Saves the request to the queue, fetches metadata in the background, and opens the Info page so you can review the format before downloading. |
| **Download** | Fetches metadata silently and auto-starts the download at the best available quality — no review step. |

Both modes are drain-based: URLs that arrive before the webview is fully ready are held in memory and processed as soon as the frontend mounts. No URLs are lost on cold-start.

---

### Cold-start deep link

When a `vortex://` link launches Vortex from scratch (the app was not already running):

1. The OS passes the URL as a CLI argument to the executable.
2. `tauri-plugin-deep-link` captures it during plugin initialization.
3. The Rust setup calls `get_current()` immediately and pushes the URL into an in-memory `IncomingQueue`.
4. `tauri-plugin-single-instance` ensures a second launch (warm-start) forwards its argv to the already-running instance instead of starting a duplicate.
5. The frontend drains the queue on mount **and** re-drains on every `incoming-urls` event, so the URL is processed exactly once regardless of whether it arrived before or after the webview was ready.

---

## Architecture overview

```
Browser extension
  |
  +-- vortex://add?url=...  --> OS protocol handler --> deep-link plugin
  |                                                          |
  +-- POST /add (bridge) --------------------------------> IncomingQueue (Rust Mutex<Vec<String>>)
                                                            |
                                                     incoming-urls event
                                                            |
                                                     IncomingHandler (React)
                                                            |
                                               +------------+------------+
                                          prefetch mode            download mode
                                               |                        |
                                        save request             fetch metadata
                                        open Info page           auto-start download
```

```
src/
+-- App.tsx                  mount providers + IncomingHandler
+-- pages/                   Home, Info, Downloads, Settings
+-- components/
|   +-- IncomingHandler.tsx  drain-based queue consumer
+-- lib/
|   +-- requests.ts          SQLite-backed request store
|   +-- jobs.ts              download job store (useSyncExternalStore)
+-- downloads/
    +-- provider.tsx         DownloadsContext, startDownload, resolveDir

src-tauri/src/
+-- lib.rs                   Tauri builder, plugin order, setup
+-- commands/
    +-- incoming.rs          IncomingQueue, validate_incoming_url, drain_incoming, setup_deep_link_relay
    +-- bridge.rs            tiny_http server, /health + /add endpoints
    +-- download.rs          start_download, cancel_download, JobRegistry
    +-- metadata.rs          fetch_metadata (yt-dlp -J)
    +-- settings.rs          load/save/reset AppSettings
    +-- binary.rs            resolve_ytdlp_path, resolve_ffmpeg_path
```

---

## Settings reference

| Setting | Description |
|---------|-------------|
| yt-dlp path | Absolute path to the `yt-dlp` binary |
| ffmpeg path | Absolute path to `ffmpeg` |
| Download folder | Default save directory |
| Save locations | Per-domain folder bindings — URLs whose host matches save here automatically |
| Folder profiles | Named destinations you can pick per download |
| Max concurrent | How many downloads run in parallel |
| Embed metadata | Pass `--embed-metadata` to yt-dlp |
| Embed thumbnail | Pass `--embed-thumbnail` (requires ffmpeg) |
| Write subtitles | Download and embed subtitles |
| Subtitle languages | Comma-separated language codes (`en,es`) |
| Rate limit | e.g. `2M` — passed as `--limit-rate` |
| Proxy URL | Passed as `--proxy` |
| Cookies file | Passed as `--cookies` |
| Cookies from browser | Passed as `--cookies-from-browser` |
| Filename template | yt-dlp output template, default `%(uploader)s - %(title)s.%(ext)s` |
| Split chapters | `--split-chapters` |
| Incoming action | `prefetch` or `download` — controls browser-extension behavior |
| Notify on complete | System notification when a download finishes |
| Focus on fetch | Bring the window forward when metadata arrives |
