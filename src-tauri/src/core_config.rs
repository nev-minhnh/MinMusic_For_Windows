//! `core_config` and `core_status` commands. The window is never gated on READY:
//! the UI paints cached Home first, then awaits `core_config`.
use crate::sidecar::supervisor::{CoreConfig, CoreStatus};
use crate::AppState;
use tauri::State;

/// Resolves once the core is READY, and again with the new port/token after each restart.
/// Granted by capability only to the `main` and `mini` windows.
#[tauri::command]
pub async fn core_config(state: State<'_, AppState>) -> Result<CoreConfig, String> {
    let sup = state.sup.clone();
    sup.config().await
}

#[tauri::command]
pub fn core_status(state: State<'_, AppState>) -> CoreStatus {
    state.sup.status()
}

/// "Thử lại" on the fatal screen.
#[tauri::command]
pub fn core_retry(state: State<'_, AppState>) {
    state.sup.retry();
}
