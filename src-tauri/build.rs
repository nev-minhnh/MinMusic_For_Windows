fn main() {
    // Every app command needs an explicit permission, so that `core_config`
    // (which returns the core token) can be limited to the main and mini windows.
    let cmds = &[
        "window_minimize",
        "window_toggle_maximize",
        "window_close",
        "window_start_drag",
        "app_quit",
        "core_status",
        "core_config",
        "core_retry",
        "ui_ready",
        "log_ui",
        "open_log_folder",
        "set_minimize_to_tray",
        "test_set_window_size",
    ];
    let attrs = tauri_build::Attributes::new()
        .app_manifest(tauri_build::AppManifest::new().commands(cmds));
    tauri_build::try_build(attrs).expect("tauri build failed");
}
