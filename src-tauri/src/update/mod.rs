//! Updater (architecture section 7, api.md 3.15 / 6): `update_check`, `update_status`,
//! `update_install`, the hourly background check and the tray balloon.
//!
//! - Only this repo's GitHub releases are read (`plugins.updater.endpoints`). No other host is
//!   contacted and nothing is reported anywhere.
//! - Install path: download (the plugin verifies the minisign signature) -> `quit_for_update`
//!   (the normal graceful quit) -> run the installer. `app.restart()` is never used.
//! - Portable builds (`portable.flag`) never auto-update; the UI opens the release page instead.
mod balloon;
mod gate;
mod manifest;
mod quit;
mod version;

use gate::Prefs;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

pub const RELEASES_PAGE: &str = "https://github.com/nev-minhnh/MinMusic_For_Windows/releases/latest";
const PUBKEY_PLACEHOLDER: &str = "REPLACE_AT_INT_W5";

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdState {
    Idle,
    Checking,
    Downloading,
    Ready,
    Error,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Available {
    pub version: String,
    pub notes: String,
    pub size: Option<u64>,
}

/// The `update.status` shape (api.md 3.15) plus `currentVersion`, `portable` and `error`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub channel: String,
    pub last_check: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available: Option<Available>,
    pub state: UpdState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    pub current_version: String,
    pub portable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct Inner {
    status: Status,
    pending: Option<Update>,
}

pub struct UpdateState {
    inner: Mutex<Inner>,
    portable: bool,
}

impl UpdateState {
    fn new(current_version: String, portable: bool) -> UpdateState {
        UpdateState {
            portable,
            inner: Mutex::new(Inner {
                status: Status {
                    channel: version::Channel::Stable.as_str().into(),
                    last_check: None,
                    available: None,
                    state: UpdState::Idle,
                    progress: None,
                    current_version,
                    portable,
                    error: None,
                },
                pending: None,
            }),
        }
    }

    fn snapshot(&self) -> Status {
        self.inner.lock().unwrap().status.clone()
    }

    fn mutate(&self, f: impl FnOnce(&mut Inner)) -> Status {
        let mut g = self.inner.lock().unwrap();
        f(&mut g);
        g.status.clone()
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn publish(app: &AppHandle, s: &Status) {
    let _ = app.emit("update-status", s);
}

/// A pubkey that was never replaced (INT-W5) or is empty makes every check fail with a clear error.
pub fn pubkey_configured(pubkey: &str) -> bool {
    let p = pubkey.trim();
    !p.is_empty() && !p.starts_with(PUBKEY_PLACEHOLDER)
}

/// `plugins.minmusic.displayVersion` when present, else the numeric package version.
fn current_version(app: &AppHandle) -> String {
    app.config()
        .plugins
        .0
        .get("minmusic")
        .and_then(|v| v.get("displayVersion"))
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_else(|| app.package_info().version.to_string())
}

fn configured_pubkey(app: &AppHandle) -> String {
    app.config().plugins.0.get("updater").and_then(|v| v.get("pubkey")).and_then(|v| v.as_str()).unwrap_or("").to_string()
}

/// e2e builds only: `MINMUSIC_UPDATER_ENDPOINT` / `MINMUSIC_UPDATER_PUBKEY` (compiled out of release).
#[cfg(any(debug_assertions, feature = "e2e"))]
fn test_override(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}
#[cfg(not(any(debug_assertions, feature = "e2e")))]
fn test_override(_name: &str) -> Option<String> {
    None
}

async fn run_check(app: &AppHandle, prefs: Prefs) -> Result<Option<Update>, String> {
    let pubkey_override = test_override("MINMUSIC_UPDATER_PUBKEY");
    if pubkey_override.is_none() && !pubkey_configured(&configured_pubkey(app)) {
        return Err("updater public key is not configured".into());
    }
    let channel = prefs.channel;
    // The comparison uses the display version (`2.0.0-alpha.0`) so pre-release builds see the final release.
    let current = current_version(app);
    let mut b = app.updater_builder().version_comparator(move |_plugin_current, rem| {
        version::is_newer(&current, &rem.version.to_string(), channel)
    });
    if let Some(k) = pubkey_override {
        b = b.pubkey(k);
    }
    if let Some(e) = test_override("MINMUSIC_UPDATER_ENDPOINT") {
        let url = e.parse().map_err(|e| format!("bad MINMUSIC_UPDATER_ENDPOINT: {e}"))?;
        b = b.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    b.build().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())
}

/// One check. `manual` checks also run for portable builds and ignore `checkForUpdates`.
pub async fn check(app: &AppHandle, manual: bool) -> Status {
    let st = app.state::<UpdateState>();
    let paths = app.state::<crate::AppState>().paths.clone();
    let prefs = gate::read_prefs(&paths).await;
    if !manual && !gate::auto_check_allowed(st.portable, &prefs) {
        return st.snapshot();
    }
    {
        let cur = st.snapshot();
        if matches!(cur.state, UpdState::Checking | UpdState::Downloading) {
            return cur;
        }
    }
    let s = st.mutate(|i| {
        i.status.state = UpdState::Checking;
        i.status.error = None;
        i.status.channel = prefs.channel.as_str().into();
    });
    publish(app, &s);
    let result = run_check(app, prefs).await;
    let prev_version = st.snapshot().available.map(|a| a.version);
    let s = match result {
        Ok(Some(u)) => {
            let av = Available { version: u.version.clone(), notes: u.body.clone().unwrap_or_default(), size: manifest::size_of(&u.raw_json) };
            let is_new = prev_version.as_deref() != Some(av.version.as_str());
            let s = st.mutate(|i| {
                i.status.available = Some(av.clone());
                i.status.state = UpdState::Idle;
                i.status.last_check = Some(now_ms());
                i.pending = Some(u);
            });
            if is_new {
                announce(app, &av, st.portable);
            }
            s
        }
        Ok(None) => st.mutate(|i| {
            i.status.available = None;
            i.status.state = UpdState::Idle;
            i.status.last_check = Some(now_ms());
            i.pending = None;
        }),
        Err(e) => {
            log::warn!("update check failed: {e}");
            st.mutate(|i| {
                i.status.state = UpdState::Error;
                i.status.error = Some(e);
                i.status.last_check = Some(now_ms());
            })
        }
    };
    publish(app, &s);
    s
}

/// `update.available` event for the UI; a tray balloon while the main window is hidden.
fn announce(app: &AppHandle, av: &Available, portable: bool) {
    let _ = app.emit("update.available", av);
    let hidden = app.get_webview_window("main").is_some_and(|w| !w.is_visible().unwrap_or(true));
    if hidden {
        if let Some(w) = app.get_webview_window("main") {
            if let Ok(h) = w.hwnd() {
                balloon::show(windows::Win32::Foundation::HWND(h.0), &balloon::text(crate::tray::os_lang(), &av.version, portable));
            }
        }
    }
}

fn fail(app: &AppHandle, msg: String) {
    let st = app.state::<UpdateState>();
    let s = st.mutate(|i| {
        i.status.state = UpdState::Error;
        i.status.progress = None;
        i.status.error = Some(msg);
    });
    publish(app, &s);
}

async fn download_and_install(app: AppHandle, update: Update) {
    let st = app.state::<UpdateState>();
    let s = st.mutate(|i| {
        i.status.state = UpdState::Downloading;
        i.status.progress = Some(0.0);
        i.status.error = None;
    });
    publish(&app, &s);
    let mut got: u64 = 0;
    let mut last_pct: i64 = -1;
    let app2 = app.clone();
    let bytes = update
        .download(
            move |chunk, total| {
                got += chunk as u64;
                if let Some(t) = total.filter(|t| *t > 0) {
                    let frac = (got as f64 / t as f64).min(1.0);
                    let pct = (frac * 100.0) as i64;
                    if pct != last_pct {
                        last_pct = pct;
                        let s = app2.state::<UpdateState>().mutate(|i| i.status.progress = Some(frac));
                        publish(&app2, &s);
                    }
                }
            },
            || {},
        )
        .await;
    let bytes = match bytes {
        Ok(b) => b,
        Err(e) => return fail(&app, format!("download failed: {e}")),
    };
    let s = st.mutate(|i| {
        i.status.state = UpdState::Ready;
        i.status.progress = Some(1.0);
    });
    publish(&app, &s);
    // Blocking: the graceful quit takes up to ~4 s. The installer launch exits the process.
    let app3 = app.clone();
    let r = tauri::async_runtime::spawn_blocking(move || {
        quit::quit_for_update(&quit::AppHost(app3.clone()), || update.install(&bytes))
    })
    .await;
    match r {
        Ok(Some(Ok(()))) | Ok(None) => {}
        Ok(Some(Err(e))) => {
            // The core is already gone; an app without a core is useless, so finish the quit.
            log::error!("installer launch failed: {e}");
            fail(&app, format!("installer failed: {e}"));
            app.exit(1);
        }
        Err(e) => {
            log::error!("update task failed: {e}");
            app.exit(1);
        }
    }
}

// ---------- commands ----------

#[tauri::command]
pub fn update_status(state: tauri::State<'_, UpdateState>) -> Status {
    state.snapshot()
}

#[tauri::command]
pub async fn update_check(app: AppHandle) -> Status {
    check(&app, true).await
}

#[tauri::command]
pub fn update_install(app: AppHandle, state: tauri::State<'_, UpdateState>) -> Result<(), String> {
    if state.portable {
        return Err("portable builds are updated by hand".into());
    }
    let update = {
        let g = state.inner.lock().unwrap();
        if matches!(g.status.state, UpdState::Downloading | UpdState::Checking | UpdState::Ready) {
            return Err("busy".into());
        }
        g.pending.clone().ok_or_else(|| "no update available".to_string())?
    };
    tauri::async_runtime::spawn(download_and_install(app, update));
    Ok(())
}

/// The release page is a constant URL of this repo; the UI cannot choose another one.
#[tauri::command]
pub fn update_open_release_page() {
    let _ = std::process::Command::new("explorer").arg(RELEASES_PAGE).spawn();
}

// ---------- setup ----------

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry, tauri_plugin_updater::Config> {
    tauri_plugin_updater::Builder::new().build()
}

/// Setup block: manages the state and starts the hourly check.
pub fn register(app: &AppHandle) {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(std::path::Path::to_path_buf));
    let portable = gate::is_portable(exe_dir.as_deref());
    app.manage(UpdateState::new(current_version(app), portable));
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(gate::FIRST_CHECK_DELAY).await;
        loop {
            check(&app, false).await;
            tokio::time::sleep(gate::CHECK_INTERVAL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_pubkey_is_not_configured() {
        assert!(!pubkey_configured(""));
        assert!(!pubkey_configured("  "));
        assert!(!pubkey_configured("REPLACE_AT_INT_W5"));
        assert!(pubkey_configured("dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDEyMw=="));
    }

    #[test]
    fn status_serialises_to_the_api_shape() {
        let st = UpdateState::new("2.0.0".into(), false);
        let s = st.mutate(|i| {
            i.status.available = Some(Available { version: "2.0.1".into(), notes: "n".into(), size: None });
            i.status.last_check = Some(5);
        });
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["state"], "idle");
        assert_eq!(v["channel"], "stable");
        assert_eq!(v["lastCheck"], 5);
        assert_eq!(v["available"]["version"], "2.0.1");
        assert_eq!(v["currentVersion"], "2.0.0");
        assert!(v.get("progress").is_none() && v.get("error").is_none());
    }
}
