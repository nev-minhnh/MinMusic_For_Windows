//! Windows logoff, shutdown or restart: subclass the main window.
//! WM_QUERYENDSESSION: ShutdownBlockReasonCreate + TRUE.
//! WM_ENDSESSION(TRUE): graceful quit synchronously (<= ~4 s), then ShutdownBlockReasonDestroy.
use crate::sidecar::shutdown;
use std::sync::OnceLock;
use tauri::AppHandle;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Shutdown::{ShutdownBlockReasonCreate, ShutdownBlockReasonDestroy};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};

static APP: OnceLock<AppHandle> = OnceLock::new();

const WM_QUERYENDSESSION: u32 = 0x0011;
const WM_ENDSESSION: u32 = 0x0016;
const SUBCLASS_ID: usize = 0x4D4D_5345; // "MMSE"

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    match msg {
        WM_QUERYENDSESSION => {
            let _ = ShutdownBlockReasonCreate(hwnd, w!("Đang lưu hàng đợi…"));
            return LRESULT(1);
        }
        WM_ENDSESSION if wparam.0 != 0 => {
            log::info!("WM_ENDSESSION: graceful quit");
            if let Some(app) = APP.get() {
                shutdown::graceful_quit_blocking(app);
            }
            let _ = ShutdownBlockReasonDestroy(hwnd);
            // The OS ends us next; do not wait for it (a test harness sends this message by hand).
            std::process::exit(0);
        }
        _ => {}
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

pub fn install(app: &AppHandle, hwnd: HWND) {
    let _ = APP.set(app.clone());
    unsafe {
        if !SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0).as_bool() {
            log::error!("SetWindowSubclass failed: session-end handling disabled");
        }
    }
}
