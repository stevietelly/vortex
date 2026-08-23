# vortex-downloader

Tauri 2 desktop app wrapping a React 19 + Vite + Tailwind CSS v4 frontend. It began as a Figma Make scaffold (`.figma/` and Figma-specific Vite plugins are still present), but the real target is a desktop build driven by `src-tauri/`.

## Architecture

- `src/` — React frontend. `src/main.tsx` mounts `src/App.tsx`. There is **no router**: `App.tsx` is a single state-driven view that swaps pages from `src/pages/` (Home, Info, Downloads, Settings). Support files: `src/data.ts` (mocks), `src/types.ts`, `src/icons.tsx`.
- `src-tauri/` — Rust/Tauri 2 backend. `src/main.rs` → `app_lib::run()` (`src/lib.rs`). Crate is `app`/`app_lib`, edition 2021, MSRV 1.77.2. `tauri-plugin-log` is enabled in debug builds only. `capabilities/default.json` currently grants only `core:default` — no custom IPC commands are wired yet.
- `vite.config.ts` — Vite + React + Tailwind, plus Figma Make dev-only plugins (site config, error-overlay replay, React-refresh boundary fallback, make-kit). The dev server ignores `.figma` and `src-tauri` in its watch list.

## Frontend ↔ Tauri IPC

- Rust commands live in `src-tauri/src/commands/` (`binary`, `settings`, `metadata`, `download`), registered in `src-tauri/src/lib.rs` via `invoke_handler`. App-defined commands are permitted by default — **do not** add them to `capabilities/default.json` (only `core:default` belongs there).
- Tauri command names stay `snake_case` (the `commands::` path prefix is ignored, but the fn name is NOT converted to kebab-case). Call them from the frontend as e.g. `invoke("load_settings")`, `invoke("validate_path")`, `invoke("fetch_metadata")`, `invoke("start_download")`.
- The frontend wraps `@tauri-apps/api/core` in `src/lib/tauri.ts`, which throws outside a Tauri context. `src/lib/settings.ts` falls back to `localStorage` in the Figma Make web preview so the UI still runs without the desktop shell.
- `fetch_metadata` (Rust) spawns `yt-dlp -J <url>`, reads the binary path from saved settings, and maps the JSON to `VideoMetadata`/`FormatOption` (see `src/types/domain.ts`). yt-dlp error lines (`ERROR: ...`) surface as command errors so the UI can show invalid/private/geo-blocked states. Format options are collapsed to Best / per-height / audio-only, with each `id` being a ready-to-pass `-f` selector.
- `start_download(url, formatId)` spawns `yt-dlp -f <formatId>`, parses its `--newline` progress output, and emits `download-progress` events (`DownloadProgress` payload) keyed by a returned job id; `cancel_download(id)` kills the process by pid via a `JobRegistry` managed state. The frontend listens in `src/lib/jobs.ts` (flat map keyed by id, `useSyncExternalStore`-backed) and feeds `DownloadsPage` — no per-tick array scans. Legacy mock types (`VideoInfo`/`PlaylistInfo`/`DownloadItem` in `src/types.ts`) are unused; the canonical contract is `src/types/domain.ts`.

## Package manager: use bun, not pnpm

`src-tauri/tauri.conf.json` sets `beforeDevCommand: "bun dev"` and `beforeBuildCommand: "bun build"`, so the frontend must be run/installed with **bun** (`bun.lock` is the live lockfile). `pnpm-lock.yaml` and the `pnpm` entry in `.mise.toml` are stale Figma Make template leftovers — ignore them.

## Commands

- Frontend dev (web / Figma Make preview): `bun dev` → Vite on `$PORT` (default 8443), hot reload.
- Desktop dev: `bun tauri dev` — runs `bun dev`, then launches the Rust app and loads `http://localhost:8443` in a webview.
- Frontend build: `bun build` (= `vite build`).
- Desktop build: `bun tauri build`.
- Format: `bun run format` (oxfmt). No lint or test runner is configured; type-check manually with `tsc --noEmit` (no script exists).

## Build output gotcha

`tauri.conf.json` sets `frontendDist: "../build"`, but `vite build` defaults to `dist`. `bun tauri build` runs `bun build` (output `dist`), so Tauri won't find the frontend unless the output lands in `build` (e.g. `vite build --outDir build`). Fix or account for this before producing a desktop bundle.

## Styling & theming

- Tailwind v4 via `@tailwindcss/vite` — **no** `tailwind.config` or PostCSS config.
- Theme tokens are CSS custom properties defined in `src/index.css` (`:root` = light, `.dark` = dark) and bridged into Tailwind through `@theme inline`. Change colors by editing the CSS variables, not Tailwind config.
- Dark mode is toggled by a `.dark` class on `<html>` (`App.tsx` flips it); it is **not** the Tailwind `dark:` variant.
- Fonts (DM Sans, JetBrains Mono) load via a Google Fonts `@import` at the top of `src/index.css` — keep `@import` rules first in that file.

## Conventions

- Export components as default exports (App and the `src/pages/*` views do).
- Use the `@/` alias for imports from `src`.
