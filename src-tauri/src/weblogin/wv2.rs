//! Thin WebView2 helpers shared by the login window and the PO-token window.
//! Values returned here (cookies, script results) are secrets: they are never logged.
use std::time::Duration;
use tauri::{Url, WebviewWindow};
use webview2_com::{CoTaskMemPWSTR, ExecuteScriptCompletedHandler};

/// `ICoreWebView2::ExecuteScript`. Returns the raw JSON string WebView2 produces (`"2"`, `"null"`, `"\"a\""`).
pub async fn exec_script(win: &WebviewWindow, script: &str, timeout: Duration) -> Result<String, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    let script = script.to_string();
    win.with_webview(move |wv| unsafe {
        let core = match wv.controller().CoreWebView2() {
            Ok(c) => c,
            Err(e) => {
                let _ = tx.send(Err(format!("CoreWebView2: {e}")));
                return;
            }
        };
        let js = CoTaskMemPWSTR::from(script.as_str());
        let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
        let tx2 = tx.clone();
        let handler = ExecuteScriptCompletedHandler::create(Box::new(move |err, res| {
            if let Some(t) = tx2.lock().ok().and_then(|mut g| g.take()) {
                let _ = t.send(match err {
                    Ok(()) => Ok(res),
                    Err(e) => Err(format!("ExecuteScript: {e}")),
                });
            }
            Ok(())
        }));
        if let Err(e) = core.ExecuteScript(*js.as_ref().as_pcwstr(), &handler) {
            if let Some(t) = tx.lock().ok().and_then(|mut g| g.take()) {
                let _ = t.send(Err(format!("ExecuteScript: {e}")));
            }
        }
    })
    .map_err(|e| format!("with_webview: {e}"))?;
    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(r)) => r,
        Ok(Err(_)) => Err("script callback dropped".into()),
        Err(_) => Err("timeout".into()),
    }
}

/// Like [`exec_script`], parsed as JSON. A non-JSON or empty result becomes `Null`.
pub async fn exec_script_json(win: &WebviewWindow, script: &str, timeout: Duration) -> Result<serde_json::Value, String> {
    let raw = exec_script(win, script, timeout).await?;
    Ok(serde_json::from_str(&raw).unwrap_or(serde_json::Value::Null))
}

/// Cookies (httpOnly included) visible to `url`, as `(name, value)` in WebView2 order.
/// Uses Tauri's `cookies_for_url`, which is `ICoreWebView2CookieManager::GetCookies` underneath.
/// It blocks the calling thread, so it runs on the blocking pool (it deadlocks on the main thread).
pub async fn cookies_for_url(win: &WebviewWindow, url: &str) -> Result<Vec<(String, String)>, String> {
    let u: Url = url.parse().map_err(|e| format!("bad cookie url: {e}"))?;
    let w = win.clone();
    tauri::async_runtime::spawn_blocking(move || {
        w.cookies_for_url(u)
            .map(|v| v.iter().map(|c| (c.name().to_string(), c.value().to_string())).collect())
            .map_err(|e| format!("cookies: {e}"))
    })
    .await
    .map_err(|e| format!("join: {e}"))?
}

/// True when an Evergreen WebView2 runtime is installed.
pub fn runtime_available() -> bool {
    use webview2_com::Microsoft::Web::WebView2::Win32::GetAvailableCoreWebView2BrowserVersionString;
    let null = CoTaskMemPWSTR::default();
    let mut ver = Default::default();
    // SAFETY: `ver` receives a CoTaskMem string that `take_pwstr` copies and frees.
    let ok = unsafe { GetAvailableCoreWebView2BrowserVersionString(*null.as_ref().as_pcwstr(), &mut ver) }.is_ok();
    ok && !webview2_com::take_pwstr(ver).is_empty()
}
