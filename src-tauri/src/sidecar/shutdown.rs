//! Normal quit (architecture 3.3): hide windows, `{"cmd":"shutdown"}` on stdin, wait <= 3 s,
//! TerminateProcess, drop the job, exit.
use crate::AppState;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub fn hide_all_windows(app: &AppHandle) {
    for (_, w) in app.webview_windows() {
        let _ = w.hide();
    }
}

/// Asynchronous graceful quit: returns at once (the windows are already hidden), the exit follows
/// within about 4 s. Calling it twice is harmless.
pub fn graceful_quit(app: &AppHandle) {
    let st = app.state::<AppState>();
    if st.quit_started.swap(true, Ordering::SeqCst) {
        return;
    }
    hide_all_windows(app);
    let sup = st.sup.clone();
    let app2 = app.clone();
    std::thread::Builder::new()
        .name("graceful-quit".into())
        .spawn(move || {
            sup.shutdown_blocking();
            app2.exit(0);
            // If the event loop does not wind down, do not leave a zombie shell.
            std::thread::sleep(Duration::from_secs(2));
            std::process::exit(0);
        })
        .ok();
}

/// Synchronous variant for WM_ENDSESSION: returns after the core is gone (<= ~4 s).
pub fn graceful_quit_blocking(app: &AppHandle) {
    let st = app.state::<AppState>();
    st.quit_started.store(true, Ordering::SeqCst);
    hide_all_windows(app);
    st.sup.shutdown_blocking();
}
