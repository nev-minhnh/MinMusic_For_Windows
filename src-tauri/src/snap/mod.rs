//! Snap Layouts for the custom maximize button (frontend-spec 4).
//!
//! Why the first two attempts (INT-W1) failed:
//!  * WebView2 renders in `Chrome_RenderWidgetHostHWND` child windows that belong to ANOTHER thread/process,
//!    so `SetWindowSubclass` on them fails and `HTTRANSPARENT` is not honoured across threads: the
//!    `WM_NCHITTEST` of the cursor always lands in WebView2 (CSS hover fires, no flyout);
//!  * `IsNonClientRegionSupportEnabled` only maps CSS `app-region` values, and the UI had none.
//!
//! The fix is a native overlay: a tiny child window of the top-level window, created on the window thread,
//! stacked above WebView2 and sitting exactly over the maximize button (`caption_rects`). It answers
//! `WM_NCHITTEST` with `HTMAXBUTTON`, which is what makes Windows 11 show the Snap flyout. Because it covers the
//! button, WebView2 no longer sees the mouse, so the overlay reports hover/pressed to the UI with the Tauri event
//! `mm-caption {hover, down}` (the UI keeps the caption hover look through a CSS class). A click toggles
//! maximize through `SC_MAXIMIZE/SC_RESTORE`. The overlay is a layered window with alpha 1/255 (invisible, but
//! hit-testable; fully transparent layered windows are skipped by hit testing).
//!
//! The top-level subclass answering `HTMAXBUTTON` for the same rect is kept as a second path.
//! Strategy (a) (`IsNonClientRegionSupportEnabled`) is now opt-in for diagnosis: set `MINMUSIC_SNAP_NCR=1`.
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::UI::Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::WindowsAndMessaging::*;

const SUBCLASS_TOP: usize = 0x4D4D_5301;
const HTMAXBUTTON_ID: usize = 9;

/// `[x, y, w, h]` in physical client pixels of the top-level window.
static MAX_RECT: Mutex<Option<[i32; 4]>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();
/// The overlay hwnd as an address (0 = none). Only created and moved on the main thread.
static OVERLAY: AtomicUsize = AtomicUsize::new(0);
static TRACKING: AtomicBool = AtomicBool::new(false);
static PRESSED: AtomicBool = AtomicBool::new(false);

pub fn hit_max(rect: [i32; 4], x: i32, y: i32) -> bool {
    rect[2] > 0 && rect[3] > 0 && x >= rect[0] && x < rect[0] + rect[2] && y >= rect[1] && y < rect[1] + rect[3]
}

/// Overlay state -> payload of the `mm-caption` event.
pub fn caption_event(hover: bool, down: bool) -> serde_json::Value {
    json!({ "hover": hover, "down": hover && down })
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

fn toggle_maximize(top: HWND) {
    unsafe {
        let cmd = if IsZoomed(top).as_bool() { SC_RESTORE } else { SC_MAXIMIZE };
        let _ = PostMessageW(Some(top), WM_SYSCOMMAND, WPARAM(cmd as usize), LPARAM(0));
    }
}

fn emit(hover: bool, down: bool) {
    if let Some(app) = APP.get() {
        let _ = app.emit_to("main", "mm-caption", caption_event(hover, down));
    }
}

unsafe extern "system" fn top_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
    match msg {
        WM_NCHITTEST if in_max(hwnd, lp) => return LRESULT(HTMAXBUTTON as isize),
        WM_NCLBUTTONDOWN if wp.0 == HTMAXBUTTON_ID => return LRESULT(0),
        WM_NCLBUTTONUP if wp.0 == HTMAXBUTTON_ID => {
            toggle_maximize(hwnd);
            return LRESULT(0);
        }
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wp, lp)
}

// ---------- overlay window ----------

unsafe extern "system" fn overlay_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_NCHITTEST => return LRESULT(HTMAXBUTTON as isize),
        WM_NCMOUSEMOVE => {
            if !TRACKING.swap(true, SeqCst) {
                let mut t = TRACKMOUSEEVENT {
                    cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                    dwFlags: TME_LEAVE | TME_NONCLIENT,
                    hwndTrack: hwnd,
                    dwHoverTime: 0,
                };
                let _ = TrackMouseEvent(&mut t);
                emit(true, false);
            }
            return DefWindowProcW(hwnd, msg, wp, lp);
        }
        WM_NCMOUSELEAVE => {
            TRACKING.store(false, SeqCst);
            PRESSED.store(false, SeqCst);
            emit(false, false);
            return LRESULT(0);
        }
        WM_NCLBUTTONDOWN if wp.0 == HTMAXBUTTON_ID => {
            PRESSED.store(true, SeqCst);
            emit(true, true);
            return LRESULT(0);
        }
        WM_NCLBUTTONUP if wp.0 == HTMAXBUTTON_ID => {
            let was = PRESSED.swap(false, SeqCst);
            emit(true, false);
            if was {
                if let Ok(top) = GetParent(hwnd) {
                    toggle_maximize(top);
                }
            }
            return LRESULT(0);
        }
        WM_MOUSEACTIVATE => return LRESULT(MA_NOACTIVATE as isize),
        WM_ERASEBKGND => return LRESULT(1),
        _ => {}
    }
    DefWindowProcW(hwnd, msg, wp, lp)
}

const CLASS: PCWSTR = w!("MinMusicSnapHit");

unsafe fn create_overlay(top: HWND, r: [i32; 4], layered: bool) -> windows::core::Result<HWND> {
    let inst = HINSTANCE(GetWindowLongPtrW(top, GWLP_HINSTANCE) as *mut _);
    let ex = if layered { WS_EX_LAYERED | WS_EX_NOACTIVATE } else { WS_EX_NOACTIVATE };
    let hw = CreateWindowExW(
        ex,
        CLASS,
        w!(""),
        WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
        r[0],
        r[1],
        r[2],
        r[3],
        Some(top),
        None,
        Some(inst),
        None,
    )?;
    if layered {
        // alpha 1/255: invisible but hit-testable
        let _ = SetLayeredWindowAttributes(hw, Default::default(), 1, LWA_ALPHA);
    }
    Ok(hw)
}

/// Main thread only. Creates the overlay on first use, then moves it over `r` (physical client px).
fn overlay_place(top: HWND, r: [i32; 4]) {
    unsafe {
        let mut h = OVERLAY.load(SeqCst);
        if h == 0 {
            if r[2] <= 0 || r[3] <= 0 {
                return;
            }
            let inst = HINSTANCE(GetWindowLongPtrW(top, GWLP_HINSTANCE) as *mut _);
            let wc = WNDCLASSEXW {
                cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
                lpfnWndProc: Some(overlay_proc),
                hInstance: inst,
                lpszClassName: CLASS,
                ..Default::default()
            };
            RegisterClassExW(&wc);
            let hw = match create_overlay(top, r, true) {
                Ok(hw) => hw,
                Err(e) => {
                    log::warn!("snap overlay: layered child failed ({e}), trying a plain child");
                    match create_overlay(top, r, false) {
                        Ok(hw) => hw,
                        Err(e) => {
                            log::warn!("snap overlay unavailable: {e}");
                            return;
                        }
                    }
                }
            };
            log::info!("snap overlay created at {r:?}");
            h = hw.0 as usize;
            OVERLAY.store(h, SeqCst);
        }
        let hw = HWND(h as *mut _);
        if r[2] <= 0 || r[3] <= 0 {
            let _ = ShowWindow(hw, SW_HIDE);
        } else {
            // HWND_TOP: above the WebView2 child window, which may have been raised by a resize
            let _ = SetWindowPos(hw, Some(HWND_TOP), r[0], r[1], r[2], r[3], SWP_NOACTIVATE | SWP_SHOWWINDOW);
        }
    }
}

/// UI command: the maximize button's rect in physical client pixels. Called on every resize.
#[tauri::command]
pub fn caption_rects(window: WebviewWindow, max: [i32; 4]) {
    *MAX_RECT.lock().unwrap() = Some(max);
    let _ = APP.set(window.app_handle().clone());
    if let Ok(h) = window.hwnd() {
        let addr = h.0 as usize;
        // Window creation and subclassing must happen on the thread that owns the window.
        let _ = window.app_handle().run_on_main_thread(move || {
            let top = HWND(addr as *mut _);
            unsafe {
                let _ = SetWindowSubclass(top, Some(top_proc), SUBCLASS_TOP, 0);
            }
            overlay_place(top, max);
        });
    }
}

/// Strategy (a), opt-in with `MINMUSIC_SNAP_NCR=1` (diagnosis only; needs CSS `app-region`).
/// Also records the app handle for the overlay events. Setup block of M1-4.
pub fn enable_non_client_region(app: &AppHandle, win: &WebviewWindow) {
    let _ = APP.set(app.clone());
    if std::env::var("MINMUSIC_SNAP_NCR").ok().as_deref() != Some("1") {
        return;
    }
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

    #[test]
    fn caption_event_pressed_needs_hover() {
        assert_eq!(caption_event(true, true), json!({"hover": true, "down": true}));
        assert_eq!(caption_event(false, true), json!({"hover": false, "down": false}));
        assert_eq!(caption_event(true, false), json!({"hover": true, "down": false}));
    }
}
