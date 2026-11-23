//! Mini-player window (architecture 5, frontend-spec 5): a second `WebviewWindow` labelled `mini`,
//! 320x88 (bar) or 320x320 (square), always on top, no decorations, hidden from the taskbar.
//! Position lives in `shell.json` (`miniRect`) through the M1-4 store.
use crate::corelink;
use crate::window_state::{self, Rect};
use crate::{show_main, AppState, MAIN};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const MINI: &str = "mini";
const MARGIN: i32 = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Bar,
    Square,
}

impl Mode {
    pub fn parse(s: &str) -> Option<Mode> {
        match s {
            "bar" => Some(Mode::Bar),
            "square" => Some(Mode::Square),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Mode::Bar => "bar",
            Mode::Square => "square",
        }
    }
    /// Logical size (frontend-spec 5).
    pub fn size(self) -> (f64, f64) {
        match self {
            Mode::Bar => (320.0, 88.0),
            Mode::Square => (320.0, 320.0),
        }
    }
}

/// Setting stand-ins, fed from `shell.json` at start and from the core `settings` topic afterwards.
static ENABLED: AtomicBool = AtomicBool::new(true); // desktopMiniPlayerWindow
static ON_MINIMIZE: AtomicBool = AtomicBool::new(false); // desktopMiniPlayerOnMinimize

/// Applies one `settings` payload (`settings.snapshot {values}` or `settings.changed {changed}`).
pub fn apply_settings(payload: &Value) {
    let m = payload.get("values").or_else(|| payload.get("changed")).unwrap_or(payload);
    if let Some(b) = m.get("desktopMiniPlayerWindow").and_then(Value::as_bool) {
        ENABLED.store(b, Ordering::SeqCst);
    }
    if let Some(b) = m.get("desktopMiniPlayerOnMinimize").and_then(Value::as_bool) {
        ON_MINIMIZE.store(b, Ordering::SeqCst);
    }
}

fn overlap(a: &Rect, b: &Rect) -> i64 {
    let w = (a.x as i64 + a.w as i64).min(b.x as i64 + b.w as i64) - (a.x as i64).max(b.x as i64);
    let h = (a.y as i64 + a.h as i64).min(b.y as i64 + b.h as i64) - (a.y as i64).max(b.y as i64);
    if w > 0 && h > 0 {
        w * h
    } else {
        0
    }
}

/// Clamps a saved top-left so the (physical) window lies inside the work area it overlaps most
/// (the first area when it overlaps none). The size is never changed.
pub fn clamp_mini(pos: (i32, i32), size: (u32, u32), areas: &[Rect]) -> (i32, i32) {
    let Some(first) = areas.first() else { return pos };
    let me = Rect { x: pos.0, y: pos.1, w: size.0, h: size.1 };
    let area = areas.iter().max_by_key(|a| overlap(a, &me)).filter(|a| overlap(a, &me) > 0).unwrap_or(first);
    let max_x = (area.x as i64 + area.w as i64 - size.0 as i64).max(area.x as i64);
    let max_y = (area.y as i64 + area.h as i64 - size.1 as i64).max(area.y as i64);
    ((pos.0 as i64).clamp(area.x as i64, max_x) as i32, (pos.1 as i64).clamp(area.y as i64, max_y) as i32)
}

/// First-run position: bottom-right of the first work area.
pub fn default_pos(size: (u32, u32), areas: &[Rect]) -> (i32, i32) {
    match areas.first() {
        Some(a) => (a.x + a.w as i32 - size.0 as i32 - MARGIN, a.y + a.h as i32 - size.1 as i32 - MARGIN),
        None => (MARGIN, MARGIN),
    }
}

fn saved_pos() -> Option<(i32, i32)> {
    let r = window_state::store()?.get("miniRect")?;
    Some((r.get("x")?.as_i64()? as i32, r.get("y")?.as_i64()? as i32))
}

fn saved_mode() -> Mode {
    window_state::store()
        .and_then(|s| s.get("miniMode"))
        .and_then(|v| v.as_str().and_then(Mode::parse))
        .unwrap_or(Mode::Bar)
}

fn areas(win: &WebviewWindow) -> Vec<Rect> {
    win.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let a = m.work_area();
            Rect { x: a.position.x, y: a.position.y, w: a.size.width, h: a.size.height }
        })
        .collect()
}

pub fn is_open(app: &AppHandle) -> bool {
    app.get_webview_window(MINI).is_some()
}

fn url_for(mode: Mode) -> String {
    match mode {
        Mode::Bar => "index.html#/mini".into(),
        Mode::Square => "index.html#/mini?mode=square".into(),
    }
}

fn open(app: &AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(MINI) {
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let paths = app.state::<AppState>().paths.clone();
    let mode = saved_mode();
    let (w, h) = mode.size();
    let mut b = WebviewWindowBuilder::new(app, MINI, WebviewUrl::App(url_for(mode).into()))
        .title("MinMusic")
        .inner_size(w, h)
        .resizable(false)
        .maximizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .disable_drag_drop_handler()
        // same WebView2 environment as the main window: identical user-data folder and browser arguments
        .data_directory(paths.webview_dir());
    if let Some(port) = crate::testhooks::devtools_port() {
        b = b.additional_browser_args(&format!(
            "--remote-debugging-port={port} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        ));
    }
    let win = b.build().map_err(|e| e.to_string())?;
    let size = win.outer_size().map(|s| (s.width, s.height)).unwrap_or((320, 88));
    let areas = areas(&win);
    let pos = match saved_pos() {
        Some(p) => clamp_mini(p, size, &areas),
        None => default_pos(size, &areas),
    };
    let _ = win.set_position(PhysicalPosition::new(pos.0, pos.1));
    let app2 = app.clone();
    win.on_window_event(move |ev| match ev {
        WindowEvent::Moved(p) => {
            if let Some(s) = window_state::store() {
                s.patch(&json!({ "miniRect": { "x": p.x, "y": p.y } }));
            }
        }
        // Closing the mini player returns to the main window.
        WindowEvent::Destroyed => {
            if !app2.state::<AppState>().quit_started.load(Ordering::SeqCst) {
                show_main(&app2);
            }
        }
        _ => {}
    });
    let _ = win.show();
    Ok(())
}

fn close(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MINI) {
        let _ = w.destroy();
    }
}

fn enabled() -> bool {
    ENABLED.load(Ordering::SeqCst)
}

/// Ctrl M and the UI button: open the mini player (main minimises), or close it (main returns).
#[tauri::command]
pub async fn mini_toggle(app: AppHandle) -> Result<(), String> {
    if is_open(&app) {
        close(&app);
        return Ok(());
    }
    if !enabled() {
        return Ok(());
    }
    open(&app)?;
    if let Some(m) = app.get_webview_window(MAIN) {
        let _ = m.minimize();
    }
    Ok(())
}

#[tauri::command]
pub async fn mini_set_mode(app: AppHandle, mode: String) -> Result<(), String> {
    let mode = Mode::parse(&mode).ok_or_else(|| format!("bad mode {mode}"))?;
    if let Some(s) = window_state::store() {
        s.patch(&json!({ "miniMode": mode.as_str() }));
    }
    if let Some(w) = app.get_webview_window(MINI) {
        let (lw, lh) = mode.size();
        let _ = w.set_size(tauri::LogicalSize::new(lw, lh));
        // keep the window on screen after growing
        if let (Ok(p), Ok(s)) = (w.outer_position(), w.outer_size()) {
            let c = clamp_mini((p.x, p.y), (s.width, s.height), &areas(&w));
            if c != (p.x, p.y) {
                let _ = w.set_position(PhysicalPosition::new(c.0, c.1));
            }
        }
        let _ = app.emit_to(MINI, "mini-mode", mode.as_str());
    }
    Ok(())
}

/// Setup block of M2-4: settings stand-ins and the minimise-to-mini hook on the main window.
pub fn install(app: &AppHandle, main: &WebviewWindow) {
    if let Some(s) = window_state::store() {
        if let Some(b) = s.get("desktopMiniPlayerWindow").and_then(|v| v.as_bool()) {
            ENABLED.store(b, Ordering::SeqCst);
        }
        if let Some(b) = s.get("desktopMiniPlayerOnMinimize").and_then(|v| v.as_bool()) {
            ON_MINIMIZE.store(b, Ordering::SeqCst);
        }
    }
    corelink::global().subscribe("settings", Arc::new(|_ev, p| apply_settings(p)));
    let app2 = app.clone();
    let w2 = main.clone();
    main.on_window_event(move |ev| {
        if let WindowEvent::Resized(_) = ev {
            if should_open_on_minimize(
                enabled(),
                ON_MINIMIZE.load(Ordering::SeqCst),
                w2.is_minimized().unwrap_or(false),
                is_open(&app2),
            ) {
                let a = app2.clone();
                // never create a window inside a window-event callback
                std::thread::spawn(move || {
                    if let Err(e) = open(&a) {
                        log::warn!("mini on minimize: {e}");
                    }
                });
            }
        }
    });
}

pub fn should_open_on_minimize(enabled: bool, on_minimize: bool, minimized: bool, already_open: bool) -> bool {
    enabled && on_minimize && minimized && !already_open
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(x: i32, y: i32, w: u32, h: u32) -> Rect {
        Rect { x, y, w, h }
    }

    #[test]
    fn modes_and_sizes() {
        assert_eq!(Mode::parse("bar"), Some(Mode::Bar));
        assert_eq!(Mode::parse("square"), Some(Mode::Square));
        assert_eq!(Mode::parse("x"), None);
        assert_eq!(Mode::Bar.size(), (320.0, 88.0));
        assert_eq!(Mode::Square.size(), (320.0, 320.0));
    }

    #[test]
    fn clamp_keeps_a_visible_mini_and_does_not_enlarge_it() {
        let a = [r(0, 0, 1920, 1040)];
        assert_eq!(clamp_mini((100, 100), (320, 88), &a), (100, 100));
        assert_eq!(clamp_mini((5000, 5000), (320, 88), &a), (1600, 952));
        assert_eq!(clamp_mini((-400, -50), (320, 88), &a), (0, 0));
    }

    #[test]
    fn clamp_after_unplugging_a_monitor() {
        let only = [r(0, 0, 1920, 1040)];
        assert_eq!(clamp_mini((-1800, 100), (320, 88), &only), (0, 100));
        let two = [r(0, 0, 1920, 1040), r(-1920, 0, 1920, 1040)];
        assert_eq!(clamp_mini((-1800, 100), (320, 88), &two), (-1800, 100));
    }

    #[test]
    fn default_is_bottom_right_with_margin() {
        assert_eq!(default_pos((320, 88), &[r(0, 0, 1920, 1040)]), (1584, 936));
        assert_eq!(default_pos((320, 88), &[]), (16, 16));
    }

    #[test]
    fn minimize_rule() {
        assert!(should_open_on_minimize(true, true, true, false));
        assert!(!should_open_on_minimize(true, false, true, false));
        assert!(!should_open_on_minimize(false, true, true, false));
        assert!(!should_open_on_minimize(true, true, false, false));
        assert!(!should_open_on_minimize(true, true, true, true));
    }

    #[test]
    fn settings_payloads() {
        apply_settings(&json!({"values": {"desktopMiniPlayerOnMinimize": true, "desktopMiniPlayerWindow": false}}));
        assert!(ON_MINIMIZE.load(Ordering::SeqCst) && !ENABLED.load(Ordering::SeqCst));
        apply_settings(&json!({"changed": {"desktopMiniPlayerWindow": true}}));
        assert!(ENABLED.load(Ordering::SeqCst));
        apply_settings(&json!({"changed": {"other": 1}}));
        assert!(ENABLED.load(Ordering::SeqCst));
        ON_MINIMIZE.store(false, Ordering::SeqCst);
    }
}
