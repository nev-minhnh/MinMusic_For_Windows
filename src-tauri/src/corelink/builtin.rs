//! Core -> shell requests owned by M1-4: `shell.focusMain`, `shell.openExternal`.
//! (`shell.webLogin` and `shell.po.*` are registered by M3-1.)
use super::srv::{self, ApiError};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::AppHandle;

/// Only absolute https URLs with a host may leave the app.
pub fn external_url_ok(url: &str) -> bool {
    url::Url::parse(url).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some_and(|h| !h.is_empty()))
}

fn open_in_browser(url: &str) -> bool {
    use windows::core::{w, HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let h = HSTRING::from(url);
    let r = unsafe { ShellExecuteW(None, w!("open"), PCWSTR(h.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    r.0 as isize > 32
}

/// Setup block of M1-4.
pub fn register(app: &AppHandle) {
    let a = app.clone();
    srv::register(
        "shell.focusMain",
        Arc::new(move |_p| {
            let a = a.clone();
            Box::pin(async move {
                crate::show_main(&a);
                Ok(json!({}))
            })
        }),
    );
    srv::register(
        "shell.openExternal",
        Arc::new(|p: Value| {
            Box::pin(async move {
                let url = p.get("url").and_then(Value::as_str).unwrap_or("");
                if !external_url_ok(url) {
                    return Err(ApiError::new("bad_request", "only https URLs may be opened"));
                }
                if open_in_browser(url) {
                    Ok(json!({}))
                } else {
                    Err(ApiError::new("internal", "ShellExecute failed"))
                }
            })
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_https_with_host() {
        assert!(external_url_ok("https://music.youtube.com/watch?v=1"));
        assert!(!external_url_ok("http://example.com"));
        assert!(!external_url_ok("file:///C:/Windows/System32/calc.exe"));
        assert!(!external_url_ok("javascript:alert(1)"));
        assert!(!external_url_ok("https://"));
        assert!(!external_url_ok("calc.exe"));
    }
}
