//! Tray menu, tooltip, click behaviour and the first-hide balloon.
//! The tray icon itself (id `main`) is created by `build_tray` in main.rs; this module replaces its
//! menu and handlers (menu ids are `mm-*` so the old handlers never fire).
use crate::corelink;
use crate::window_state;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    Vi,
    En,
}

/// OS UI language: Vietnamese when the primary language id is 0x2A, English otherwise.
pub fn os_lang() -> Lang {
    let id = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
    if id & 0x3ff == 0x2a {
        Lang::Vi
    } else {
        Lang::En
    }
}

pub struct Labels {
    pub play: &'static str,
    pub pause: &'static str,
    pub prev: &'static str,
    pub next: &'static str,
    pub show: &'static str,
    pub quit: &'static str,
    pub balloon: &'static str,
}

/// Mirrors `w2_tray_*` in `ui/src/i18n/extra/{en,vi}/m1-4.json`.
pub fn labels(lang: Lang) -> Labels {
    match lang {
        Lang::Vi => Labels {
            play: "Phát",
            pause: "Tạm dừng",
            prev: "Bài trước",
            next: "Bài tiếp",
            show: "Hiện MinMusic",
            quit: "Thoát",
            balloon: "MinMusic vẫn đang phát trong khay hệ thống",
        },
        Lang::En => Labels {
            play: "Play",
            pause: "Pause",
            prev: "Previous",
            next: "Next",
            show: "Show MinMusic",
            quit: "Quit",
            balloon: "MinMusic is still playing in the system tray",
        },
    }
}

pub fn toggle_label(lang: Lang, playing: bool) -> &'static str {
    let l = labels(lang);
    if playing {
        l.pause
    } else {
        l.play
    }
}

/// "MinMusic — <title> · <artist>", at most 127 UTF-16 units (NOTIFYICONDATA szTip is 128 with the NUL).
pub fn tooltip(title: &str, artist: &str) -> String {
    let title = title.trim();
    if title.is_empty() {
        return "MinMusic".into();
    }
    let artist = artist.trim();
    let full = if artist.is_empty() { format!("MinMusic — {title}") } else { format!("MinMusic — {title} · {artist}") };
    truncate_utf16(&full, 127)
}

pub fn truncate_utf16(s: &str, max: usize) -> String {
    if s.encode_utf16().count() <= max {
        return s.to_string();
    }
    let mut out = String::new();
    let mut n = 0;
    for c in s.chars() {
        let l = c.len_utf16();
        if n + l > max - 1 {
            break;
        }
        out.push(c);
        n += l;
    }
    out.push('…');
    out
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct NowPlaying {
    pub playing: bool,
    pub title: String,
    pub artist: String,
}

/// Reads the parts of a `PlayerState` the tray needs.
pub fn now_playing(state: &Value) -> NowPlaying {
    let track = state.get("track").filter(|t| t.is_object());
    let title = track.and_then(|t| t.get("title")).and_then(Value::as_str).unwrap_or("").to_string();
    let artist = track
        .and_then(|t| t.get("artists"))
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.get("name").and_then(Value::as_str)).collect::<Vec<_>>().join(", "))
        .unwrap_or_default();
    NowPlaying { playing: state.get("playing").and_then(Value::as_bool).unwrap_or(false), title, artist }
}

struct Ctl {
    toggle: MenuItem<Wry>,
    lang: Lang,
    last: Mutex<NowPlaying>,
}

fn apply(app: &AppHandle, ctl: &Ctl, np: NowPlaying) {
    {
        let mut last = ctl.last.lock().unwrap();
        if *last == np {
            return;
        }
        *last = np.clone();
    }
    let _ = ctl.toggle.set_text(toggle_label(ctl.lang, np.playing));
    if let Some(t) = app.tray_by_id("main") {
        let _ = t.set_tooltip(Some(tooltip(&np.title, &np.artist)));
    }
}

fn cmd(m: &'static str) {
    corelink::rt().spawn(async move {
        if let Err(e) = corelink::global().call(m, json!({})).await {
            log::warn!("tray {m}: {} {}", e.code, e.msg);
        }
    });
}

/// Setup block of M1-4.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let lang = os_lang();
    let l = labels(lang);
    let toggle = MenuItem::with_id(app, "mm-toggle", l.play, true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "mm-prev", l.prev, true, None::<&str>)?;
    let next = MenuItem::with_id(app, "mm-next", l.next, true, None::<&str>)?;
    let show = MenuItem::with_id(app, "mm-show", l.show, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "mm-quit", l.quit, true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&toggle, &prev, &next, &sep, &show, &quit])?;
    let Some(tray) = app.tray_by_id("main") else {
        log::warn!("tray icon 'main' missing, tray integration skipped");
        return Ok(());
    };
    tray.set_menu(Some(menu))?;
    tray.on_menu_event(|app, ev| match ev.id().as_ref() {
        "mm-toggle" => cmd("player.toggle"),
        "mm-prev" => cmd("player.prev"),
        "mm-next" => cmd("player.next"),
        "mm-show" => crate::show_main(app),
        "mm-quit" => crate::sidecar::shutdown::graceful_quit(app),
        _ => {}
    });
    tray.on_tray_icon_event(|tray, ev| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
            let app = tray.app_handle();
            let toggle_on_click = window_state::store().is_some_and(|s| s.get_bool("desktopTrayToggleOnClick"));
            let main = app.get_webview_window("main");
            let showing = main
                .as_ref()
                .is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false));
            if toggle_on_click && showing {
                if let Some(w) = main {
                    let _ = w.hide();
                }
            } else {
                crate::show_main(app);
            }
        }
    });

    let ctl = Arc::new(Ctl { toggle, lang, last: Mutex::new(NowPlaying::default()) });
    let app2 = app.clone();
    corelink::global().subscribe(
        "player",
        Arc::new(move |ev, p| {
            // `player.position` carries no track; only full states change the tray.
            if ev == "player.snapshot" || ev == "player.state" {
                apply(&app2, &ctl, now_playing(p));
            }
        }),
    );
    Ok(())
}

pub fn install_close_balloon(win: &tauri::WebviewWindow) {
    let app = win.app_handle().clone();
    win.on_window_event(move |ev| {
        if let tauri::WindowEvent::CloseRequested { .. } = ev {
            on_close_requested(&app);
        }
    });
}

/// First hide to the tray per install: one balloon (flag `trayBalloonShown` in shell.json).
pub fn on_close_requested(app: &AppHandle) {
    let Some(st) = app.try_state::<crate::AppState>() else { return };
    if !st.close_to_tray.load(Ordering::SeqCst) {
        return;
    }
    let Some(store) = window_state::store() else { return };
    if store.get_bool("trayBalloonShown") {
        return;
    }
    store.patch(&json!({"trayBalloonShown": true}));
    if let Some(w) = app.get_webview_window("main") {
        if let Ok(h) = w.hwnd() {
            balloon(windows::Win32::Foundation::HWND(h.0), labels(os_lang()).balloon);
        }
    }
}

fn copy_wide(dst: &mut [u16], s: &str) {
    let n = dst.len() - 1;
    for (i, u) in s.encode_utf16().take(n).enumerate() {
        dst[i] = u;
    }
}

/// Shows a balloon through a short-lived second notify icon on the main window (the Tauri tray icon
/// does not expose its handle), removed after 8 s.
fn balloon(hwnd: windows::Win32::Foundation::HWND, text: &str) {
    use windows::Win32::UI::Shell::*;
    use windows::Win32::UI::WindowsAndMessaging::*;
    unsafe {
        let r = SendMessageW(hwnd, WM_GETICON, Some(windows::Win32::Foundation::WPARAM(ICON_BIG as usize)), None);
        let hicon = if r.0 != 0 {
            HICON(r.0 as *mut _)
        } else {
            LoadIconW(None, IDI_APPLICATION).unwrap_or_default()
        };
        let mut nid = NOTIFYICONDATAW {
            cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: hwnd,
            uID: 0x4D4D,
            uFlags: NIF_ICON | NIF_TIP | NIF_INFO,
            hIcon: hicon,
            dwInfoFlags: NIIF_INFO,
            ..Default::default()
        };
        copy_wide(&mut nid.szTip, "MinMusic");
        copy_wide(&mut nid.szInfoTitle, "MinMusic");
        copy_wide(&mut nid.szInfo, text);
        if !Shell_NotifyIconW(NIM_ADD, &nid).as_bool() {
            log::warn!("tray balloon: Shell_NotifyIcon(NIM_ADD) failed");
            return;
        }
        let addr = hwnd.0 as usize;
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(8));
            let nid = NOTIFYICONDATAW {
                cbSize: std::mem::size_of::<NOTIFYICONDATAW>() as u32,
                hWnd: windows::Win32::Foundation::HWND(addr as *mut _),
                uID: 0x4D4D,
                ..Default::default()
            };
            let _ = Shell_NotifyIconW(NIM_DELETE, &nid);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_follow_language_and_state() {
        assert_eq!(toggle_label(Lang::Vi, false), "Phát");
        assert_eq!(toggle_label(Lang::Vi, true), "Tạm dừng");
        assert_eq!(toggle_label(Lang::En, false), "Play");
        assert_eq!(toggle_label(Lang::En, true), "Pause");
        assert_eq!(labels(Lang::Vi).quit, "Thoát");
        assert_eq!(labels(Lang::En).show, "Show MinMusic");
    }

    #[test]
    fn tooltip_formats() {
        assert_eq!(tooltip("", ""), "MinMusic");
        assert_eq!(tooltip("Bài", "Ca sĩ"), "MinMusic — Bài · Ca sĩ");
        assert_eq!(tooltip("Bài", ""), "MinMusic — Bài");
    }

    #[test]
    fn tooltip_truncates_to_127_utf16_units() {
        let t = tooltip(&"x".repeat(300), "a");
        assert_eq!(t.encode_utf16().count(), 127);
        assert!(t.ends_with('…'));
        // A surrogate pair is never split.
        let t = tooltip(&"😀".repeat(200), "");
        assert!(t.encode_utf16().count() <= 127);
        assert!(t.ends_with('…'));
        // Exactly at the limit stays untouched.
        let s = "y".repeat(127);
        assert_eq!(truncate_utf16(&s, 127), s);
    }

    #[test]
    fn now_playing_reads_player_state() {
        let v = json!({"playing": true, "track": {"title": "T", "artists": [{"name": "A"}, {"name": "B"}]}});
        assert_eq!(now_playing(&v), NowPlaying { playing: true, title: "T".into(), artist: "A, B".into() });
        assert_eq!(now_playing(&json!({"playing": false, "track": null})), NowPlaying::default());
    }
}
