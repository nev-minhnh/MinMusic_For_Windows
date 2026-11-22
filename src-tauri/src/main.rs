#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core_config;
mod paths;
mod session_end;
mod sidecar;
mod testhooks;

use paths::Paths;
use sidecar::{shutdown, supervisor::Supervisor};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub struct AppState {
    pub sup: Arc<Supervisor>,
    pub paths: Paths,
    /// Setting `minimizeToTrayOnClose` (default true). The core-backed setting arrives with M1.
    pub close_to_tray: AtomicBool,
    pub quit_started: AtomicBool,
    /// Set once the main window has been shown (ui_ready, tray, or the 8 s safety net).
    pub shown_once: AtomicBool,
}

const MAIN: &str = "main";

fn show_main(app: &AppHandle) {
    if let Some(st) = app.try_state::<AppState>() {
        st.shown_once.store(true, Ordering::SeqCst);
    }
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// The x button, Alt+F4 and `window_close` all end up here (architecture 3.3, owner decision 3).
fn handle_close(app: &AppHandle) {
    let st = app.state::<AppState>();
    if st.close_to_tray.load(Ordering::SeqCst) {
        if let Some(w) = app.get_webview_window(MAIN) {
            let _ = w.hide();
        }
    } else {
        shutdown::graceful_quit(app);
    }
}

// ---------- commands (api.md section 6) ----------

#[tauri::command]
fn window_minimize(window: WebviewWindow) {
    let _ = window.minimize();
}

#[tauri::command]
fn window_toggle_maximize(window: WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
fn window_close(app: AppHandle) {
    handle_close(&app);
}

#[tauri::command]
fn window_start_drag(window: WebviewWindow) {
    let _ = window.start_dragging();
}

#[tauri::command]
fn app_quit(app: AppHandle) {
    shutdown::graceful_quit(&app);
}

/// The UI signals its first paint; the window is created hidden to avoid a white flash.
#[tauri::command]
fn ui_ready(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn log_ui(state: tauri::State<'_, AppState>, level: String, msg: String) {
    let dir = state.paths.log_dir();
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("ui.log")) {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let _ = writeln!(f, "{ms} [{}] {}", level.to_uppercase(), msg.replace('\n', "\\n"));
    }
}

#[tauri::command]
fn open_log_folder(state: tauri::State<'_, AppState>) {
    let _ = std::process::Command::new("explorer").arg(state.paths.log_dir()).spawn();
}

#[tauri::command]
fn set_minimize_to_tray(state: tauri::State<'_, AppState>, on: bool) {
    state.close_to_tray.store(on, Ordering::SeqCst);
}

/// e2e / debug only: resize in physical pixels.
#[cfg(any(debug_assertions, feature = "e2e"))]
#[tauri::command]
fn test_set_window_size(window: WebviewWindow, width: u32, height: u32) {
    let _ = window.set_size(tauri::PhysicalSize::new(width, height));
}

// ---------- app ----------

fn create_main_window(app: &tauri::App, paths: &Paths) -> tauri::Result<WebviewWindow> {
    let cfg = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN)
        .cloned()
        .expect("main window config");
    let mut b = WebviewWindowBuilder::from_config(app.handle(), &cfg)?.data_directory(paths.webview_dir());
    if let Some(port) = testhooks::devtools_port() {
        b = b.additional_browser_args(&format!(
            "--remote-debugging-port={port} --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        ));
    }
    b.build()
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Hiện MinMusic", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Thoát", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip("MinMusic")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "show" => show_main(app),
            "quit" => shutdown::graceful_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

#[cfg(any(debug_assertions, feature = "e2e"))]
fn with_commands(b: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    b.invoke_handler(tauri::generate_handler![
        window_minimize,
        window_toggle_maximize,
        window_close,
        window_start_drag,
        app_quit,
        ui_ready,
        log_ui,
        open_log_folder,
        set_minimize_to_tray,
        core_config::core_config,
        core_config::core_status,
        core_config::core_retry,
        test_set_window_size
    ])
}

#[cfg(not(any(debug_assertions, feature = "e2e")))]
fn with_commands(b: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    b.invoke_handler(tauri::generate_handler![
        window_minimize,
        window_toggle_maximize,
        window_close,
        window_start_drag,
        app_quit,
        ui_ready,
        log_ui,
        open_log_folder,
        set_minimize_to_tray,
        core_config::core_config,
        core_config::core_status,
        core_config::core_retry
    ])
}

fn main() {
    let paths = Paths::resolve();
    let _ = std::fs::create_dir_all(paths.log_dir());

    let mut context = tauri::generate_context!();
    // The single-instance key derives from the identifier; a test data root gets its own key,
    // so a test instance never focuses (or kills) the owner's real app.
    let key = paths::instance_key(&context.config().identifier, paths.test_root.as_deref());
    context.config_mut().identifier = key;

    let log_plugin = tauri_plugin_log::Builder::new()
        .targets([
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Folder {
                path: paths.log_dir(),
                file_name: Some("shell".into()),
            }),
            tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
        ])
        .max_file_size(2_000_000)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
        .level(log::LevelFilter::Info)
        .build();

    let setup_paths = paths.clone();
    let app = with_commands(tauri::Builder::default())
        // The single-instance plugin must be registered first.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            log::info!("second instance launched, argv={argv:?}");
            show_main(app); // deep links (argv) are forwarded to the core in M1
        }))
        .plugin(log_plugin)
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if window.label() == MAIN {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    handle_close(window.app_handle());
                }
            }
        })
        .setup(move |app| {
            let paths = setup_paths;
            log::info!("MinMusic shell {} starting; data root {:?}", env!("CARGO_PKG_VERSION"), paths.test_root);
            let sup = Supervisor::start(app.handle().clone(), paths.clone());
            app.manage(AppState {
                sup,
                paths: paths.clone(),
                close_to_tray: AtomicBool::new(true),
                quit_started: AtomicBool::new(false),
                shown_once: AtomicBool::new(false),
            });
            let win = create_main_window(app, &paths)?;
            if let Ok(hwnd) = win.hwnd() {
                session_end::install(app.handle(), windows::Win32::Foundation::HWND(hwnd.0));
            }
            build_tray(app)?;
            // Safety net: never leave the window hidden forever if the UI never signals ui_ready.
            let h = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(8));
                if !h.state::<AppState>().shown_once.load(Ordering::SeqCst) {
                    log::warn!("ui_ready not received within 8 s, showing the window anyway");
                    show_main(&h);
                }
            });
            Ok(())
        })
        .build(context)
        .expect("error while building MinMusic");

    app.run(|app, event| {
        if let RunEvent::ExitRequested { api, code, .. } = event {
            // `None` means "last window closed": we live in the tray instead. An explicit
            // exit code comes from graceful_quit.
            if code.is_none() {
                api.prevent_exit();
                let _ = app;
            }
        }
    });
}
