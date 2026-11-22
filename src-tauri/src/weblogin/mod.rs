//! `shell.webLogin` (architecture 5.1): a generic, incognito login window driven by the core's config.
//!
//! Chrome decision: the login window has the native title bar with the request's `title` and nothing else, so
//! the webview needs no IPC and no local page (simplest, nothing to attack). Closing the window is "Huỷ"
//! (`{cancelled:true}`). A navigation to a host outside `allowedHosts` opens the system browser instead, which
//! covers "Mở bằng trình duyệt". The `banner` text is not rendered.
//!
//! Security: login windows get no capability and no IPC; cookie and script values are never logged
//! (cookie names only); the data directory is always deleted.
pub mod auth_callback;
#[allow(unused_imports)]
pub use auth_callback::on_auth_callback;
pub mod done;
mod poll;
pub mod types;
pub mod window;
pub mod wv2;

use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tokio::sync::Notify;
use types::WebLoginRequest;

/// Error answered to the core: `{code, message}` (maps to `SrvRes.e`).
#[derive(Debug, Clone)]
pub struct ApiErr {
    pub code: String,
    pub message: String,
}
impl ApiErr {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        ApiErr { code: code.into(), message: message.into() }
    }
}

/// State shared between the window callbacks, the poll loop and the deep-link handler.
pub struct Shared {
    pub cancelled: AtomicBool,
    pub nav_prefix: Option<String>,
    pub nav_final: Mutex<Option<String>>,
    pub notify: Notify,
}

impl Shared {
    fn new(nav_prefix: Option<String>) -> Self {
        Shared {
            cancelled: AtomicBool::new(false),
            nav_prefix: nav_prefix.filter(|p| !p.is_empty()),
            nav_final: Mutex::new(None),
            notify: Notify::new(),
        }
    }
    /// If `url` starts with the `navPrefix`, records it as the final URL and wakes the poll loop.
    pub fn complete_nav(&self, url: &str) -> bool {
        match &self.nav_prefix {
            Some(p) if url.starts_with(p.as_str()) => {
                if let Ok(mut g) = self.nav_final.lock() {
                    g.get_or_insert_with(|| url.to_string());
                }
                self.notify.notify_one();
                true
            }
            _ => false,
        }
    }
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_one();
    }
}

/// The login in progress (at most one).
static PENDING: Mutex<Option<Arc<Shared>>> = Mutex::new(None);
static COUNTER: AtomicU32 = AtomicU32::new(1);

pub(crate) fn pending() -> Option<Arc<Shared>> {
    PENDING.lock().ok().and_then(|g| g.clone())
}

/// Releases the single-login slot when dropped.
struct Slot;
impl Slot {
    fn acquire(shared: &Arc<Shared>) -> Result<Slot, ApiErr> {
        let mut g = PENDING.lock().map_err(|_| ApiErr::new("internal", "login state poisoned"))?;
        if g.is_some() {
            return Err(ApiErr::new("busy", "another login is already open"));
        }
        *g = Some(shared.clone());
        Ok(Slot)
    }
}
impl Drop for Slot {
    fn drop(&mut self) {
        if let Ok(mut g) = PENDING.lock() {
            *g = None;
        }
    }
}

fn random_hex() -> String {
    format!("{:016x}", rand::random::<u64>())
}

/// Deletes the directory, retrying 3 times while WebView2 still holds files.
async fn remove_dir_retry(dir: &PathBuf) {
    for attempt in 0..3 {
        if !dir.exists() || std::fs::remove_dir_all(dir).is_ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(500 * (attempt + 1))).await;
    }
    if dir.exists() && std::fs::remove_dir_all(dir).is_err() {
        log::warn!("weblogin: could not delete {}", dir.display());
    }
}

/// The `shell.webLogin` handler body.
pub async fn handle(app: AppHandle, params: Value) -> Result<Value, ApiErr> {
    let req: WebLoginRequest =
        serde_json::from_value(params).map_err(|e| ApiErr::new("badRequest", format!("webLogin params: {e}")))?;
    if req.url.is_empty() {
        return Err(ApiErr::new("badRequest", "webLogin: url is required"));
    }
    let shared = Arc::new(Shared::new(req.done.nav_prefix.clone()));
    let _slot = Slot::acquire(&shared)?;

    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let label = format!("login-{n}");
    let dir = std::env::temp_dir().join(format!("MinMusic-login-{}", random_hex()));
    log::info!("weblogin: opening {label} (host {:?})", done::scheme_host(&req.url).map(|(_, h)| h));

    let win = match window::open(&app, &req, &label, &dir, shared.clone()) {
        Ok(w) => w,
        Err(e) => {
            remove_dir_retry(&dir).await;
            return Err(ApiErr::new("internal", format!("cannot open login window: {e}")));
        }
    };

    let outcome = poll::run(&win, &req, &shared).await;

    let _ = win.destroy();
    drop(win);
    remove_dir_retry(&dir).await;

    Ok(match outcome {
        poll::Outcome::Cancelled => json!({ "cancelled": true }),
        poll::Outcome::Done { final_url, script_result, cookies } => {
            let order = req.done.cookies.as_ref().map(|c| c.names.clone()).unwrap_or_default();
            let header = done::build_cookie_header(&order, &cookies);
            let map: serde_json::Map<String, Value> =
                cookies.iter().map(|(k, v)| (k.clone(), Value::String(v.clone()))).collect();
            let mut out = json!({ "cookies": map, "cookieHeader": header, "finalUrl": final_url });
            if let Some(s) = script_result {
                out["scriptResult"] = s;
            }
            out
        }
    })
}

/// e2e / debug: the same code path as the core's `SrvReq`, without the core.
#[cfg(any(debug_assertions, feature = "e2e"))]
#[tauri::command]
pub async fn test_weblogin(app: AppHandle, request: Value) -> Result<Value, String> {
    handle(app, request).await.map_err(|e| format!("{}: {}", e.code, e.message))
}
