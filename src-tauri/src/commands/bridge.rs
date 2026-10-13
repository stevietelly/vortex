use std::io::Read;
use std::path::PathBuf;
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tiny_http::{Header, Method, Response, Server};

use super::incoming;

/// Connection details for the localhost bridge, shown in Settings so the
/// browser extension can be pointed at this install (port + paste-once token).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BridgeInfo {
    pub port: u16,
    pub token: String,
}

/// First port the bridge tries; scans a few in case it's taken.
const PORT_RANGE_START: u16 = 47831;
const PORT_TRIES: u16 = 10;
/// Caps that keep the local endpoint cheap to abuse-proof: a handful of URLs
/// per request, a small JSON body.
const MAX_URLS: usize = 50;
const MAX_BODY: u64 = 64 * 1024;

fn token_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bridge-token"))
}

fn new_token() -> String {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("OS RNG unavailable");
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// The bridge token, stable per install, created on first run. The extension's
/// options page is pasted with it once.
pub fn load_or_create_token(app: &tauri::AppHandle) -> Result<String, String> {
    let path = token_path(app)?;
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim().to_string();
        if existing.len() >= 32 {
            return Ok(existing);
        }
    }
    let token = new_token();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &token).map_err(|e| e.to_string())?;
    Ok(token)
}

#[derive(Deserialize)]
struct AddBody {
    urls: Vec<String>,
}

/// Parse a POST /add body: JSON `{"urls": [...]}`, capped in count; each URL
/// validated (http/https only). A partially valid batch accepts the valid
/// subset; an entirely invalid batch is rejected.
fn parse_add_body(body: &str) -> Result<Vec<String>, ()> {
    let parsed: AddBody = serde_json::from_str(body).map_err(|_| ())?;
    if parsed.urls.len() > MAX_URLS {
        return Err(());
    }
    let urls: Vec<String> = parsed
        .urls
        .iter()
        .filter_map(|u| incoming::validate_incoming_url(u))
        .collect();
    if urls.is_empty() {
        return Err(());
    }
    Ok(urls)
}

fn cors_headers() -> Vec<Header> {
    [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        ("Access-Control-Allow-Headers", "content-type, x-vortex-token"),
    ]
    .iter()
    .map(|(k, v)| Header::from_bytes(k.as_bytes(), v.as_bytes()).unwrap())
    .collect()
}

/// Start the localhost bridge on 127.0.0.1 (first free port in a small range).
/// Endpoints: `GET /health` (liveness, no auth) and `POST /add`
/// (`x-vortex-token` required) which funnels URLs into the incoming queue.
/// Managed `BridgeInfo` is only registered if the server actually bound — the
/// Settings UI treats a missing value as "bridge unavailable".
pub fn start(app: tauri::AppHandle) {
    let token = match load_or_create_token(&app) {
        Ok(t) => t,
        Err(_) => return,
    };

    let mut server: Option<Server> = None;
    let mut port: u16 = 0;
    for p in PORT_RANGE_START..PORT_RANGE_START + PORT_TRIES {
        if let Ok(s) = Server::http(("127.0.0.1", p)) {
            server = Some(s);
            port = p;
            break;
        }
    }
    let Some(server) = server else { return };

    app.manage(BridgeInfo {
        port,
        token: token.clone(),
    });

    thread::spawn(move || {
        for mut req in server.incoming_requests() {
            let path = req.url().to_string();
            let method = req.method().clone();
            let token_hdr = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("x-vortex-token"))
                .map(|h| h.value.to_string().trim().to_string());

            let mut body = String::new();
            if matches!(method, Method::Post) {
                let _ = req.as_reader().take(MAX_BODY).read_to_string(&mut body);
            }

            let (status, payload) = match (&method, path.as_str()) {
                (_, _) if method == Method::Options => (200, String::new()),
                (Method::Get, "/health") => (200, r#"{"ok":true,"app":"vortex"}"#.to_string()),
                (Method::Post, "/add") => {
                    if token_hdr.as_deref() != Some(token.as_str()) {
                        (401, r#"{"error":"bad token"}"#.to_string())
                    } else {
                        match parse_add_body(&body) {
                            Ok(urls) => {
                                let n = urls.len();
                                incoming::enqueue(&app, urls);
                                (202, format!(r#"{{"accepted":{n}}}"#))
                            }
                            Err(()) => (400, r#"{"error":"no valid urls"}"#.to_string()),
                        }
                    }
                }
                _ => (404, r#"{"error":"not found"}"#.to_string()),
            };

            let mut resp = Response::from_string(payload).with_status_code(status);
            for h in cors_headers() {
                resp.add_header(h);
            }
            let _ = req.respond(resp);
        }
    });
}

/// Port + token for the running bridge, or None when it failed to start.
#[tauri::command]
pub fn get_bridge_info(app: tauri::AppHandle) -> Option<BridgeInfo> {
    app.try_state::<BridgeInfo>().map(|s| s.inner().clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_body_parses_and_validates_urls() {
        let body = r#"{"urls":["https://youtube.com/watch?v=a","file:///etc","http://x.test/y"]}"#;
        assert_eq!(
            parse_add_body(body).unwrap(),
            vec![
                "https://youtube.com/watch?v=a".to_string(),
                "http://x.test/y".to_string()
            ]
        );
    }

    #[test]
    fn add_body_rejects_garbage_and_empty_batches() {
        assert!(parse_add_body("not json").is_err());
        assert!(parse_add_body(r#"{"urls":[]}"#).is_err());
        assert!(parse_add_body(r#"{"urls":["file:///x"]}"#).is_err());
    }

    #[test]
    fn add_body_caps_batch_size() {
        let many = serde_json::json!({
            "urls": vec!["https://x.test/v"; MAX_URLS + 1]
        });
        assert!(parse_add_body(&many.to_string()).is_err());
    }
}
