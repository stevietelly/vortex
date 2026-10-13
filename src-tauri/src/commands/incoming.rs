use std::sync::Mutex;

use tauri::{Emitter, Manager};

/// FIFO of validated http(s) URLs handed to the app by the browser extension
/// (via the `vortex://` deep link or the localhost bridge). The frontend
/// drains it — drain-based, so URLs that arrive before the webview is ready
/// aren't lost, and nothing gets processed twice.
#[derive(Default)]
pub struct IncomingQueue(pub Mutex<Vec<String>>);

/// Accept only http/https URLs with a host — a `vortex://add` link or a
/// bridge POST must never smuggle `file:`, `javascript:`, or other schemes
/// into yt-dlp or the router. Returns the trimmed URL, or None when rejected.
pub fn validate_incoming_url(raw: &str) -> Option<String> {
    let t = raw.trim();
    let u = url::Url::parse(t).ok()?;
    if u.scheme() != "http" && u.scheme() != "https" {
        return None;
    }
    let host = u.host_str()?;
    if host.is_empty() {
        return None;
    }
    Some(t.to_string())
}

/// Push validated URLs into the queue and wake the frontend. Invalid entries
/// are dropped silently; an all-invalid batch is a no-op.
pub fn enqueue(app: &tauri::AppHandle, urls: Vec<String>) {
    let validated: Vec<String> = urls
        .iter()
        .filter_map(|u| validate_incoming_url(u))
        .collect();
    if validated.is_empty() {
        return;
    }
    {
        let queue = app.state::<IncomingQueue>();
        let mut q = queue.0.lock().unwrap();
        q.extend(validated.clone());
        log::info!("[incoming] enqueued {:?}", validated);
    }
    let _ = app.emit("incoming-urls", ());
}

/// Extract the inner http(s) URL from a `vortex://add?url=<encoded>` deep
/// link. Returns None if the scheme is not vortex, the host is not add,
/// the link has no `url` param, or the extracted value isn't a valid http/https URL.
pub(crate) fn extract_url_from_vortex_link(deep_link_url: &url::Url) -> Option<String> {
    if deep_link_url.scheme() != "vortex" || deep_link_url.host_str() != Some("add") {
        return None;
    }
    let inner = deep_link_url
        .query_pairs()
        .find(|(k, _)| k == "url")
        .map(|(_, v)| v.into_owned())?;
    validate_incoming_url(&inner)
}

/// Called from the single-instance callback when a second launch's argv is
/// forwarded to the running instance. Scans every argument for `vortex://`
/// URLs and enqueues the extracted http(s) targets — bypassing
/// `handle_cli_arguments` → `on_open_url` which doesn't reliably fire on
/// Windows for the warm-start path.
pub fn handle_warm_argv(app: &tauri::AppHandle, argv: &[String]) {
    log::info!("[incoming] warm argv = {:?}", argv);
    let urls: Vec<String> = argv
        .iter()
        .map(|s| s.trim().trim_matches('"').trim_matches('\''))
        .filter_map(|arg| url::Url::parse(arg).ok())
        .filter_map(|u| extract_url_from_vortex_link(&u))
        .collect();
    if !urls.is_empty() {
        enqueue(app, urls);
    }
}

/// Called from `lib.rs` setup, after the deep-link plugin has initialized:
/// registers the `vortex` scheme (HKCU on Windows — no admin needed), captures
/// the cold-start URL the OS launched us with, and relays every later deep
/// link into the shared queue.
pub fn setup_deep_link_relay(app: &tauri::AppHandle) {
    use tauri_plugin_deep_link::DeepLink;

    let deep_link = app.state::<DeepLink<tauri::Wry>>();
    let reg = deep_link.register_all();
    log::info!("[incoming] register_all = {:?}", reg.as_ref().err());

    // Cold start: the plugin already parsed our CLI args during its own setup
    // (see init_deep_link in the plugin source) — pick the stored URL up here,
    // before the frontend exists to receive events.
    if let Ok(Some(urls)) = deep_link.get_current() {
        let extracted: Vec<String> = urls
            .iter()
            .filter_map(|u| extract_url_from_vortex_link(u))
            .collect();
        if !extracted.is_empty() {
            enqueue(app, extracted);
        }
    }

    // Warm: also register on_open_url as a belt-and-suspenders path for
    // platforms that do deliver OS-level open-url events (macOS, Linux).
    let handle = app.clone();
    deep_link.on_open_url(move |ev| {
        let extracted: Vec<String> = ev
            .urls()
            .iter()
            .filter_map(|u| extract_url_from_vortex_link(u))
            .collect();
        if !extracted.is_empty() {
            enqueue(&handle, extracted);
        }
    });
}

/// Empty the queue. Called by the frontend on mount and whenever the
/// `incoming-urls` event fires.
#[tauri::command]
pub fn drain_incoming(app: tauri::AppHandle) -> Vec<String> {
    let queue = app.state::<IncomingQueue>();
    let mut q = queue.0.lock().unwrap();
    let out = std::mem::take(&mut *q);
    log::info!("[incoming] drain returning {} urls", out.len());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_http_and_https_urls_pass_validation() {
        assert_eq!(
            validate_incoming_url("https://www.youtube.com/watch?v=abc").as_deref(),
            Some("https://www.youtube.com/watch?v=abc")
        );
        assert_eq!(
            validate_incoming_url("  http://example.com/x  ").as_deref(),
            Some("http://example.com/x")
        );
        assert_eq!(validate_incoming_url("file:///etc/passwd"), None);
        assert_eq!(validate_incoming_url("javascript:alert(1)"), None);
        assert_eq!(validate_incoming_url("vortex://add?url=x"), None);
        assert_eq!(validate_incoming_url("not a url"), None);
        assert_eq!(validate_incoming_url(""), None);
    }

    #[test]
    fn urls_without_a_host_are_rejected() {
        // An authority-less URL doesn't parse at all for http(s), and the
        // parser can turn "http:///x" into host "x" (WHATWG rules) — so the
        // empty-host case to assert is the bare scheme with no authority.
        assert_eq!(validate_incoming_url("https://"), None);
        assert_eq!(validate_incoming_url("http://"), None);
        assert_eq!(validate_incoming_url("https:// "), None);
    }
    #[test]
    fn extract_url_from_vortex_link_works() {
        let parse = |s: &str| url::Url::parse(s).unwrap();

        // Percent-encoded inner URL (as the extension sends it)
        assert_eq!(
            extract_url_from_vortex_link(&parse(
                "vortex://add?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ"
            ))
            .as_deref(),
            Some("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        );

        // Unencoded inner URL (as Start-Process sends it)
        assert_eq!(
            extract_url_from_vortex_link(&parse(
                "vortex://add?url=https://example.com/video"
            ))
            .as_deref(),
            Some("https://example.com/video")
        );

        // Missing url param → None
        assert_eq!(
            extract_url_from_vortex_link(&parse("vortex://add")),
            None
        );

        // Non-http inner URL → rejected
        assert_eq!(
            extract_url_from_vortex_link(&parse(
                "vortex://add?url=javascript%3Aalert(1)"
            )),
            None
        );

        // Non-vortex scheme → rejected
        assert_eq!(
            extract_url_from_vortex_link(&parse(
                "https://add?url=https://example.com/video"
            )),
            None
        );

        // Non-add host → rejected
        assert_eq!(
            extract_url_from_vortex_link(&parse(
                "vortex://download?url=https://example.com/video"
            )),
            None
        );
    }
}

