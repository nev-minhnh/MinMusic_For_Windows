//! Poll loop of a login: every 500 ms (and whenever a page finishes loading or a callback arrives) it reads the
//! cookies and the done script, then asks `done::evaluate`.
use super::done::evaluate;
use super::types::WebLoginRequest;
use super::{wv2, Shared};
use serde_json::Value;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tauri::WebviewWindow;

pub enum Outcome {
    Cancelled,
    Done { final_url: String, script_result: Option<Value>, cookies: Vec<(String, String)> },
}

const TICK: Duration = Duration::from_millis(500);
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(5);

fn urls_for(req: &WebLoginRequest) -> Vec<String> {
    let mut urls: Vec<String> = req.collect.cookie_urls.clone();
    if urls.is_empty() {
        urls = req.done.cookies.as_ref().map(|c| c.urls.clone()).unwrap_or_default();
    }
    if urls.is_empty() {
        urls.push(req.url.clone());
    }
    urls
}

/// All cookies of `urls`, de-duplicated by name (the first URL wins).
async fn gather(win: &WebviewWindow, urls: &[String]) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    for u in urls {
        match wv2::cookies_for_url(win, u).await {
            Ok(v) => {
                for (k, val) in v {
                    if !out.iter().any(|(n, _)| *n == k) {
                        out.push((k, val));
                    }
                }
            }
            Err(e) => log::warn!("weblogin: cookie read failed: {e}"),
        }
    }
    out
}

pub async fn run(win: &WebviewWindow, req: &WebLoginRequest, shared: &Shared) -> Outcome {
    let deadline = req.timeout_ms.filter(|t| *t > 0).map(|t| Instant::now() + Duration::from_millis(t));
    let done_urls: Vec<String> = {
        let u = req.done.cookies.as_ref().map(|c| c.urls.clone()).unwrap_or_default();
        if u.is_empty() { urls_for(req) } else { u }
    };
    let watch_cookies = req.done.cookies.as_ref().is_some_and(|c| !c.names.is_empty());
    let done_script = req.done.script.as_deref().filter(|s| !s.is_empty());

    loop {
        if shared.cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            return Outcome::Cancelled;
        }
        if deadline.is_some_and(|d| Instant::now() >= d) {
            log::warn!("weblogin: timed out");
            return Outcome::Cancelled;
        }

        let nav_final = shared.nav_final.lock().ok().and_then(|g| g.clone());
        let url = nav_final.clone().unwrap_or_else(|| win.url().map(|u| u.to_string()).unwrap_or_default());

        let cmap: HashMap<String, String> =
            if watch_cookies && nav_final.is_none() { gather(win, &done_urls).await.into_iter().collect() } else { HashMap::new() };
        let mut script_val: Option<Value> = None;
        if let (Some(s), None) = (done_script, &nav_final) {
            script_val = wv2::exec_script_json(win, s, SCRIPT_TIMEOUT).await.ok();
        }

        if evaluate(&req.done, &cmap, script_val.as_ref(), &url) {
            let cookies = gather(win, &urls_for(req)).await;
            let mut script_result = script_val;
            if let Some(s) = req.collect.script.as_deref().filter(|s| !s.is_empty()) {
                match wv2::exec_script_json(win, s, SCRIPT_TIMEOUT).await {
                    Ok(v) => script_result = Some(v),
                    Err(e) => log::warn!("weblogin: collect script failed: {e}"),
                }
            }
            let names: Vec<&str> = cookies.iter().map(|(k, _)| k.as_str()).collect();
            log::info!("weblogin: done, cookie names {names:?}");
            return Outcome::Done { final_url: url, script_result, cookies };
        }

        // Sleep until the next tick, or earlier on a callback / cancel.
        let _ = tokio::time::timeout(TICK, shared.notify.notified()).await;
    }
}
