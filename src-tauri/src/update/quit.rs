//! `quit_for_update`: the normal graceful quit, minus the process exit (the installer launch exits
//! the process). Never `app.restart()`: the core must get its stdin shutdown, the 3 s wait and the
//! terminate (architecture 3.3) before the installer replaces files under the install dir.

/// What the quit needs from the shell; the real one wraps `AppState` and the `Supervisor`.
pub trait QuitHost {
    /// Marks the quit as started. Returns false when a quit is already running.
    fn begin_quit(&self) -> bool;
    fn hide_windows(&self);
    /// `{"cmd":"shutdown"}` on stdin, wait <= 3 s, terminate. Blocks until the core is gone.
    fn shutdown_core_blocking(&self);
}

/// Runs the quit and then `launch` (the installer). The installer is not started when another
/// quit already runs, because the process is on its way out anyway.
pub fn quit_for_update<H: QuitHost, T>(host: &H, launch: impl FnOnce() -> T) -> Option<T> {
    if !host.begin_quit() {
        return None;
    }
    host.hide_windows();
    host.shutdown_core_blocking();
    Some(launch())
}

pub struct AppHost(pub tauri::AppHandle);

impl QuitHost for AppHost {
    fn begin_quit(&self) -> bool {
        use std::sync::atomic::Ordering;
        use tauri::Manager;
        !self.0.state::<crate::AppState>().quit_started.swap(true, Ordering::SeqCst)
    }
    fn hide_windows(&self) {
        crate::sidecar::shutdown::hide_all_windows(&self.0);
    }
    fn shutdown_core_blocking(&self) {
        use tauri::Manager;
        self.0.state::<crate::AppState>().sup.shutdown_blocking();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Mock {
        log: RefCell<Vec<&'static str>>,
        already: bool,
    }
    impl QuitHost for Mock {
        fn begin_quit(&self) -> bool {
            self.log.borrow_mut().push("begin");
            !self.already
        }
        fn hide_windows(&self) {
            self.log.borrow_mut().push("hide");
        }
        fn shutdown_core_blocking(&self) {
            self.log.borrow_mut().push("shutdown");
        }
    }

    #[test]
    fn sequence_is_begin_hide_shutdown_then_installer() {
        let m = Mock { log: RefCell::new(vec![]), already: false };
        let r = quit_for_update(&m, || {
            m.log.borrow_mut().push("installer");
            7
        });
        assert_eq!(r, Some(7));
        assert_eq!(*m.log.borrow(), ["begin", "hide", "shutdown", "installer"]);
    }

    #[test]
    fn a_second_quit_does_not_launch_the_installer() {
        let m = Mock { log: RefCell::new(vec![]), already: true };
        let r = quit_for_update(&m, || m.log.borrow_mut().push("installer"));
        assert_eq!(r, None);
        assert_eq!(*m.log.borrow(), ["begin"]);
    }
}
