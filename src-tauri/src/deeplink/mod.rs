//! Deep links (`minmusic://`, `metrolist://`, `metrolist-auth://`).
//! A URL arrives on the start argv or through the single-instance plugin (its `deep-link` feature feeds
//! `tauri-plugin-deep-link`), is resolved by the core (`app.openUrl` -> `{handled, nav?}`) and turned into
//! the UI event `mm-nav`. `metrolist-auth://` goes to the auth handler that M3-1 registers.
use crate::corelink::{self, CoreApi};
use serde_json::{json, Value};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};

pub const SCHEMES: &[&str] = &["minmusic", "metrolist", "metrolist-auth"];
pub const NAV_EVENT: &str = "mm-nav";

pub fn scheme_of(url: &str) -> Option<&str> {
    let (s, rest) = url.split_once(':')?;
    (SCHEMES.contains(&s.to_ascii_lowercase().as_str()) && rest.starts_with("//")).then_some(s)
}

pub fn is_deep_link(url: &str) -> bool {
    scheme_of(url).is_some()
}

/// Deep-link URLs among process arguments.
pub fn urls_from_args<S: AsRef<str>>(args: &[S]) -> Vec<String> {
    args.iter().map(|a| a.as_ref()).filter(|a| is_deep_link(a)).map(String::from).collect()
}

#[derive(Debug, PartialEq)]
pub enum Outcome {
    /// `metrolist-auth://...`, forwarded to `weblogin::on_auth_callback`.
    Auth(String),
    /// The core resolved the link; emit `mm-nav` with this `NavTarget`.
    Nav(Value),
    /// The core did not handle it (or failed); only show the window.
    Unhandled,
    Ignored,
}

pub async fn resolve<C: CoreApi + ?Sized>(core: &C, url: &str) -> Outcome {
    match scheme_of(url) {
        None => Outcome::Ignored,
        Some(s) if s.eq_ignore_ascii_case("metrolist-auth") => Outcome::Auth(url.to_string()),
        Some(_) => match core.call("app.openUrl", json!({ "url": url })).await {
            Ok(r) if r.get("handled").and_then(Value::as_bool).unwrap_or(false) => match r.get("nav") {
                Some(n) if n.is_object() => Outcome::Nav(n.clone()),
                _ => Outcome::Unhandled,
            },
            Ok(_) => Outcome::Unhandled,
            Err(e) => {
                log::warn!("app.openUrl failed: {} {}", e.code, e.msg);
                Outcome::Unhandled
            }
        },
    }
}

type AuthHandler = Box<dyn Fn(String) + Send + Sync>;
static AUTH: OnceLock<AuthHandler> = OnceLock::new();

/// M3-1 calls this once from its setup block: `deeplink::set_auth_handler(Box::new(weblogin::on_auth_callback))`.
/// Until then, auth callbacks are only logged (the URL may carry a code, so it is not logged in full).
#[allow(dead_code)] // called by M3-1
pub fn set_auth_handler(h: AuthHandler) {
    let _ = AUTH.set(h);
}

fn on_auth(url: String) {
    match AUTH.get() {
        Some(h) => h(url),
        None => log::info!("metrolist-auth callback received (no handler yet), {} chars", url.len()),
    }
}

/// Handles one URL: asks the core, then emits `mm-nav` and focuses the main window.
pub fn handle(app: &AppHandle, url: String) {
    let app = app.clone();
    corelink::rt().spawn(async move {
        match resolve(corelink::global(), &url).await {
            Outcome::Auth(u) => on_auth(u),
            Outcome::Nav(nav) => {
                crate::show_main(&app);
                let _ = app.emit_to("main", NAV_EVENT, nav);
            }
            Outcome::Unhandled => crate::show_main(&app),
            Outcome::Ignored => {}
        }
    });
}

/// Setup block of M1-4.
pub fn install(app: &tauri::App) {
    use tauri_plugin_deep_link::DeepLinkExt;
    let dl = app.deep_link();
    // Registry writes only in release builds, so tests never touch HKCU. The installer registers them too.
    #[cfg(not(any(debug_assertions, feature = "e2e")))]
    if let Err(e) = dl.register_all() {
        log::warn!("deep-link scheme registration failed: {e}");
    }
    let mut start: Vec<String> = match dl.get_current() {
        Ok(Some(urls)) => urls.iter().map(|u| u.to_string()).collect(),
        _ => Vec::new(),
    };
    if start.is_empty() {
        start = urls_from_args(&std::env::args().collect::<Vec<_>>());
    }
    for u in start {
        handle(app.handle(), u);
    }
    let h = app.handle().clone();
    dl.on_open_url(move |ev| {
        for u in ev.urls() {
            handle(&h, u.to_string());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::corelink::{ApiError, BoxFuture};
    use std::sync::Mutex;

    struct Mock {
        reply: Result<Value, ApiError>,
        seen: Mutex<Vec<(String, Value)>>,
    }
    impl CoreApi for Mock {
        fn call(&self, m: &str, p: Value) -> BoxFuture<Result<Value, ApiError>> {
            self.seen.lock().unwrap().push((m.to_string(), p));
            let r = self.reply.clone();
            Box::pin(async move { r })
        }
    }
    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().build().unwrap().block_on(f)
    }

    #[test]
    fn recognises_schemes_and_argv() {
        assert!(is_deep_link("minmusic://album/abc"));
        assert!(is_deep_link("MetroList://x"));
        assert!(!is_deep_link("https://example.com"));
        assert!(!is_deep_link("minmusic:album"));
        let args = ["C:\\MinMusic.exe", "--flag", "minmusic://album/1", "metrolist-auth://discord/cb?code=1"];
        assert_eq!(urls_from_args(&args), vec!["minmusic://album/1", "metrolist-auth://discord/cb?code=1"]);
    }

    #[test]
    fn album_link_becomes_open_url_and_nav() {
        let nav = json!({"route": "album", "params": {"id": "MPREb_1"}});
        let m = Mock { reply: Ok(json!({"handled": true, "nav": nav})), seen: Default::default() };
        let out = run(resolve(&m, "minmusic://album/MPREb_1"));
        assert_eq!(out, Outcome::Nav(nav));
        let seen = m.seen.lock().unwrap();
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].0, "app.openUrl");
        assert_eq!(seen[0].1, json!({"url": "minmusic://album/MPREb_1"}));
    }

    #[test]
    fn unhandled_and_errors_only_focus() {
        let m = Mock { reply: Ok(json!({"handled": false})), seen: Default::default() };
        assert_eq!(run(resolve(&m, "metrolist://nothing")), Outcome::Unhandled);
        let m = Mock { reply: Err(ApiError::new("timeout", "x")), seen: Default::default() };
        assert_eq!(run(resolve(&m, "minmusic://album/1")), Outcome::Unhandled);
    }

    #[test]
    fn auth_urls_skip_the_core() {
        let m = Mock { reply: Ok(json!({})), seen: Default::default() };
        let out = run(resolve(&m, "metrolist-auth://discord/cb?code=1"));
        assert_eq!(out, Outcome::Auth("metrolist-auth://discord/cb?code=1".into()));
        assert!(m.seen.lock().unwrap().is_empty());
        assert_eq!(run(resolve(&m, "https://x.y")), Outcome::Ignored);
    }
}
