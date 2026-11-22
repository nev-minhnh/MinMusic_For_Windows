//! `shell.po.*` (architecture 5.2): a hidden, incognito webview on youtube.com that runs the core's PO-token
//! scripts. The raw `ExecuteScript` JSON string is returned unchanged; the core normalises it.
//! The window has no capability and no IPC. Evaluations are serialised (one at a time).
use crate::weblogin::{wv2, ApiErr};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::{Mutex, Notify};

const LABEL: &str = "potoken";
const PAGE: &str = "https://www.youtube.com/robots.txt";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const DEFAULT_TIMEOUT_MS: u64 = 10_000;

struct Page {
    /// The robots.txt page finished loading (false after `reset` and while navigating).
    loaded: AtomicBool,
    notify: Notify,
}

struct State {
    page: Arc<Page>,
    data_dir: Option<PathBuf>,
}

/// Serialises evaluations: the guard is held for a whole `evaluate`.
static STATE: Mutex<Option<State>> = Mutex::const_new(None);

fn parse_timeout(params: &Value) -> Duration {
    let ms = params.get("timeoutMs").and_then(Value::as_u64).filter(|t| *t > 0).unwrap_or(DEFAULT_TIMEOUT_MS);
    Duration::from_millis(ms)
}

fn create_window(app: &AppHandle, page: Arc<Page>, dir: &PathBuf) -> Result<WebviewWindow, String> {
    let url: Url = PAGE.parse().map_err(|e| format!("{e}"))?;
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .visible(false)
        .inner_size(1.0, 1.0)
        .skip_taskbar(true)
        .focused(false)
        .incognito(true)
        .user_agent(UA)
        .data_directory(dir.clone())
        .on_page_load(move |_, p| {
            if matches!(p.event(), PageLoadEvent::Finished) && p.url().as_str() == PAGE {
                page.loaded.store(true, Ordering::SeqCst);
                page.notify.notify_waiters();
            }
        })
        .build()
        .map_err(|e| e.to_string())
}

async fn wait_loaded(page: &Page, until: Instant) -> bool {
    loop {
        // Register interest before checking the flag, so a load between the two is not missed.
        let notified = page.notify.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if page.loaded.load(Ordering::SeqCst) {
            return true;
        }
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() || tokio::time::timeout(left, notified).await.is_err() {
            return page.loaded.load(Ordering::SeqCst);
        }
    }
}

/// `shell.po.evaluate {script, timeoutMs}` -> `{result}`.
pub async fn evaluate(app: AppHandle, params: Value) -> Result<Value, ApiErr> {
    let script = params
        .get("script")
        .and_then(Value::as_str)
        .ok_or_else(|| ApiErr::new("badRequest", "po.evaluate: script is required"))?
        .to_string();
    let timeout = parse_timeout(&params);
    let until = Instant::now() + timeout;

    let mut guard = STATE.lock().await;
    let st = guard.get_or_insert_with(|| State {
        page: Arc::new(Page { loaded: AtomicBool::new(false), notify: Notify::new() }),
        data_dir: None,
    });
    let page = st.page.clone();

    let win = match app.get_webview_window(LABEL) {
        Some(w) => {
            if !page.loaded.load(Ordering::SeqCst) {
                // After `reset`: load the page again.
                let url: Url = PAGE.parse().map_err(|e| ApiErr::new("internal", format!("{e}")))?;
                w.navigate(url).map_err(|e| ApiErr::new("internal", e.to_string()))?;
            }
            w
        }
        None => {
            page.loaded.store(false, Ordering::SeqCst);
            let dir = std::env::temp_dir().join(format!("MinMusic-potoken-{}", std::process::id()));
            st.data_dir = Some(dir.clone());
            create_window(&app, page.clone(), &dir).map_err(|e| ApiErr::new("internal", format!("potoken window: {e}")))?
        }
    };

    if !wait_loaded(&page, until).await {
        return Err(ApiErr::new("timeout", "PO-token page did not load in time"));
    }
    let left = until.saturating_duration_since(Instant::now());
    match wv2::exec_script(&win, &script, left.max(Duration::from_millis(100))).await {
        Ok(raw) => Ok(json!({ "result": raw })),
        Err(e) if e == "timeout" => Err(ApiErr::new("timeout", "PO-token script timed out")),
        Err(e) => Err(ApiErr::new("internal", e)),
    }
}

/// `shell.po.reset`: navigate to `about:blank` and mark the page unloaded (frees the page's memory).
pub async fn reset(app: AppHandle, _params: Value) -> Result<Value, ApiErr> {
    let guard = STATE.lock().await;
    if let Some(st) = guard.as_ref() {
        st.page.loaded.store(false, Ordering::SeqCst);
        if let Some(w) = app.get_webview_window(LABEL) {
            let blank: Url = "about:blank".parse().map_err(|e| ApiErr::new("internal", format!("{e}")))?;
            let _ = w.navigate(blank);
        }
    }
    Ok(json!({}))
}

/// `shell.po.available`: the WebView2 runtime is installed and the app finished starting.
pub async fn available(app: AppHandle, _params: Value) -> Result<Value, ApiErr> {
    let ready = app.try_state::<crate::AppState>().is_some();
    Ok(json!({ "available": ready && wv2::runtime_available() }))
}

/// Destroys the window and its data directory (call from the graceful quit path).
#[allow(dead_code)]
pub async fn shutdown(app: &AppHandle) {
    let mut guard = STATE.lock().await;
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.destroy();
    }
    if let Some(dir) = guard.take().and_then(|s| s.data_dir) {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// e2e / debug: `shell.po.evaluate` without the core.
#[cfg(any(debug_assertions, feature = "e2e"))]
#[tauri::command]
pub async fn test_po_evaluate(app: AppHandle, script: String) -> Result<String, String> {
    match evaluate(app, json!({ "script": script })).await {
        Ok(v) => Ok(v["result"].as_str().unwrap_or_default().to_string()),
        Err(e) => Err(format!("{}: {}", e.code, e.message)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeout_default_and_override() {
        assert_eq!(parse_timeout(&json!({})), Duration::from_millis(10_000));
        assert_eq!(parse_timeout(&json!({"timeoutMs": 0})), Duration::from_millis(10_000));
        assert_eq!(parse_timeout(&json!({"timeoutMs": 2500})), Duration::from_millis(2500));
    }
}
