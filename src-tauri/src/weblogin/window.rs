//! Builds the incognito login window (label `login-<n>`). It has no capability, hence no IPC.
use super::done::{host_allowed, scheme_host};
use super::types::WebLoginRequest;
use super::Shared;
use std::path::Path;
use std::sync::Arc;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub fn open(
    app: &AppHandle,
    req: &WebLoginRequest,
    label: &str,
    data_dir: &Path,
    shared: Arc<Shared>,
) -> Result<WebviewWindow, String> {
    let start: Url = req.url.parse().map_err(|e| format!("bad url: {e}"))?;
    let mut allowed = req.allowed_hosts.clone();
    if allowed.is_empty() {
        allowed.extend(scheme_host(&req.url).map(|(_, h)| h));
    }

    let nav_shared = shared.clone();
    let load_shared = shared.clone();
    let mut b = WebviewWindowBuilder::new(app, label, WebviewUrl::External(start))
        .title(if req.title.is_empty() { "MinMusic" } else { req.title.as_str() })
        .inner_size(req.window.w.max(320.0), req.window.h.max(240.0))
        .maximizable(req.window.maximizable)
        .incognito(true)
        .data_directory(data_dir.to_path_buf())
        .focused(true)
        .on_page_load(move |_, p| {
            if matches!(p.event(), PageLoadEvent::Finished) {
                load_shared.notify.notify_one(); // NavigationCompleted: poll now
            }
        })
        .on_navigation(move |url| {
            let s = url.as_str();
            if nav_shared.complete_nav(s) {
                return false; // custom-scheme callback: consumed, never navigated to
            }
            if host_allowed(s, &allowed) {
                return true;
            }
            if s.starts_with("https://") {
                open_external(s);
            }
            false
        });
    if let Some(ua) = req.user_agent.as_deref().filter(|u| !u.is_empty()) {
        b = b.user_agent(ua);
    }
    // Centre on the main window when it is visible, otherwise on the screen.
    match app.get_webview_window("main").filter(|m| m.is_visible().unwrap_or(false) && !m.is_minimized().unwrap_or(true)) {
        Some(m) => {
            if let (Ok(p), Ok(s), Ok(sf)) = (m.outer_position(), m.outer_size(), m.scale_factor()) {
                let x = p.x as f64 / sf + (s.width as f64 / sf - req.window.w) / 2.0;
                let y = p.y as f64 / sf + (s.height as f64 / sf - req.window.h) / 2.0;
                b = b.position(x.max(0.0), y.max(0.0));
            } else {
                b = b.center();
            }
        }
        None => b = b.center(),
    }
    let win = b.build().map_err(|e| e.to_string())?;

    // Closing the window (x button, Alt+F4) is a cancel.
    let close_shared = shared.clone();
    win.on_window_event(move |ev| {
        if matches!(ev, WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed) {
            close_shared.cancel();
        }
    });
    Ok(win)
}

/// Opens an https URL in the default browser (`ShellExecuteW`, no shell parsing, https only).
pub fn open_external(url: &str) {
    use windows::core::{w, HSTRING};
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    if !url.starts_with("https://") {
        return;
    }
    let u = HSTRING::from(url);
    // SAFETY: plain Win32 call with valid, NUL-terminated wide strings.
    unsafe {
        ShellExecuteW(None, w!("open"), &u, None, None, SW_SHOWNORMAL);
    }
}
