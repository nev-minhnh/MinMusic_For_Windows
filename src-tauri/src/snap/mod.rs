//! Snap Layouts for the custom maximize button (frontend-spec 4).
//!
//! Two strategies, tried together because only a real run shows which one the WebView2 runtime honours:
//!  (a) `ICoreWebView2Settings9::IsNonClientRegionSupportEnabled = true`, so a CSS `app-region` on the
//!      maximize button can map to `HTMAXBUTTON` (needs UI CSS, reported to M1-3a/INT-W1);
//!  (b) a subclass of the top-level window that answers `WM_NCHITTEST` with `HTMAXBUTTON` inside the
//!      rect reported by `caption_rects`, plus `HTTRANSPARENT` on the WebView2 child windows over that
//!      rect so the hit test reaches the top-level window.
//! `WM_NCLBUTTONDOWN/UP` on HTMAXBUTTON toggle maximize through `SC_MAXIMIZE/SC_RESTORE`.
//! If neither shows the flyout, the UI button still maximizes on click (`window_toggle_maximize`).
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::*;

const SUBCLASS_TOP: usize = 0x4D4D_5301;
const SUBCLASS_CHILD: usize = 0x4D4D_5302;
const HTMAXBUTTON_ID: usize = 9;

/// `[x, y, w, h]` in physical client pixels of the top-level window.
static MAX_RECT: Mutex<Option<[i32; 4]>> = Mutex::new(None);

pub fn hit_max(rect: [i32; 4], x: i32, y: i32) -> bool {
    rect[2] > 0 && rect[3] > 0 && x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3]
}

fn client_point(top: HWND, lparam: LPARAM) -> POINT {
    let mut pt = POINT { x: (lparam.0 & 0xffff) as i16 as i32, y: ((lparam.0 >> 16) & 0xffff) as i16 as i32 };
    unsafe {
        let _ = ScreenToClient(top, &mut pt);
    }
    pt
}

fn in_max(top: HWND, lparam: LPARAM) -> bool {
    let Some(r) = *MAX_RECT.lock().unwrap() else { return false };
    let p = client_point(top, lparam);
    hit_max(r, p.x, p.y)
}

unsafe extern "system" fn top_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
    match msg {
        WM_NCHITTEST if in_max(hwnd, lp) => return LRESULT(HTMAXBUTTON as isize),
        WM_NCLBUTTONDOWN if wp.0 == HTMAXBUTTON_ID => return LRESULT(0),
        WM_NCLBUTTONUP if wp.0 == HTMAXBUTTON_ID => {
            let cmd = if IsZoomed(hwnd).as_bool() { SC_RESTORE } else { SC_MAXIMIZE };
            let _ = PostMessageW(Some(hwnd), WM_SYSCOMMAND, WPARAM(cmd as usize), LPARAM(0));
            return LRESULT(0);
        }
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wp, lp)
}

unsafe extern "system" fn child_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, top: usize) -> LRESULT {
    if msg == WM_NCHITTEST && in_max(HWND(top as *mut _), lp) {
        return LRESULT(HTTRANSPARENT as isize);
    }
    DefSubclassProc(hwnd, msg, wp, lp)
}

unsafe extern "system" fn enum_child(child: HWND, lp: LPARAM) -> windows::core::BOOL {
    let _ = SetWindowSubclass(child, Some(child_proc), SUBCLASS_CHILD, lp.0 as usize);
    true.into()
}

/// Runs on the window's thread.
fn install_subclasses(top: HWND) {
    unsafe {
        let _ = SetWindowSubclass(top, Some(top_proc), SUBCLASS_TOP, 0);
        let _ = EnumChildWindows(Some(top), Some(enum_child), LPARAM(top.0 as isize));
    }
}

/// UI command: the maximize button's rect in physical client pixels. Called on every resize.
#[tauri::command]
pub fn caption_rects(window: WebviewWindow, max: [i32; 4]) {
    *MAX_RECT.lock().unwrap() = Some(max);
    if let Ok(h) = window.hwnd() {
        let addr = h.0 as usize;
        // Subclassing must happen on the thread that owns the window.
        let _ = window.app_handle().run_on_main_thread(move || install_subclasses(HWND(addr as *mut _)));
    }
}

/// Strategy (a). Setup block of M1-4.
pub fn enable_non_client_region(app: &AppHandle, win: &WebviewWindow) {
    let _ = app;
    let r = win.with_webview(|wv| {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings9;
        use windows_core::Interface;
        unsafe {
            let res = (|| -> windows_core::Result<()> {
                let core = wv.controller().CoreWebView2()?;
                let settings = core.Settings()?.cast::<ICoreWebView2Settings9>()?;
                settings.SetIsNonClientRegionSupportEnabled(true)
            })();
            match res {
                Ok(()) => log::info!("WebView2 IsNonClientRegionSupportEnabled = true"),
                Err(e) => log::warn!("IsNonClientRegionSupportEnabled unavailable: {e}"),
            }
        }
    });
    if let Err(e) = r {
        log::warn!("with_webview failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hit_test_is_half_open() {
        let r = [100, 0, 46, 32];
        assert!(hit_max(r, 100, 0));
        assert!(hit_max(r, 145, 31));
        assert!(!hit_max(r, 146, 10));
        assert!(!hit_max(r, 99, 10));
        assert!(!hit_max(r, 120, 32));
        assert!(!hit_max([0, 0, 0, 0], 0, 0));
    }
}
