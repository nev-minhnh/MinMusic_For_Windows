//! settings_link: the shell's cached view of the few core settings it acts on.
//!
//! The shell subscribes to the core `settings` topic through corelink and keeps the five booleans it needs
//! (below). Everything else about settings goes UI -> core directly; `shell.json` keeps only layout state.
//! * `get_bool(key)` is what call sites read (tray toggle, mini player, taskbar buttons).
//! * `minimizeToTrayOnClose` also drives `AppState::close_to_tray`, which the close handler reads.
//! * `on_change(cb)` lets a module react when one of the keys flips (for example to add or remove taskbar buttons).
//!
//! Before the core is connected the cache holds the core defaults, so the shell behaves like a fresh install.
use crate::corelink;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{AppHandle, Manager};

/// The cached keys and their defaults (the same as `Settings.kt`).
pub const KEYS: &[(&str, bool)] = &[
    ("minimizeToTrayOnClose", true),
    ("desktopMiniPlayerWindow", true),
    ("desktopMiniPlayerOnMinimize", false),
    ("desktopTaskbarButtons", true),
    ("desktopTrayToggleOnClick", true),
];

pub const CLOSE_TO_TRAY: &str = "minimizeToTrayOnClose";
pub const TRAY_TOGGLE_ON_CLICK: &str = "desktopTrayToggleOnClick";
#[allow(dead_code)] // read by the M2-4 mini player at integration
pub const MINI_PLAYER_WINDOW: &str = "desktopMiniPlayerWindow";
#[allow(dead_code)]
pub const MINI_ON_MINIMIZE: &str = "desktopMiniPlayerOnMinimize";
#[allow(dead_code)]
pub const TASKBAR_BUTTONS: &str = "desktopTaskbarButtons";

/// Key -> value cache. Pure apart from the mutex, so it is unit-tested without a core.
pub struct Cache {
    vals: Mutex<HashMap<&'static str, bool>>,
}

impl Default for Cache {
    fn default() -> Self {
        Cache::new()
    }
}

impl Cache {
    pub fn new() -> Cache {
        Cache { vals: Mutex::new(KEYS.iter().copied().collect()) }
    }

    /// Current value; `false` for a key that is not cached.
    pub fn get(&self, key: &str) -> bool {
        self.vals.lock().unwrap().get(key).copied().unwrap_or(false)
    }

    fn merge(&self, values: &Value) -> Vec<&'static str> {
        let mut changed = Vec::new();
        let Some(obj) = values.as_object() else { return changed };
        let mut vals = self.vals.lock().unwrap();
        for (key, _) in KEYS {
            if let Some(b) = obj.get(*key).and_then(Value::as_bool) {
                if vals.insert(key, b) != Some(b) {
                    changed.push(*key);
                }
            }
        }
        changed
    }

    /// Applies a full snapshot (`{values}`).
    pub fn apply_snapshot(&self, payload: &Value) -> Vec<&'static str> {
        self.merge(payload.get("values").unwrap_or(&Value::Null))
    }

    /// Applies a delta (`{changed}`).
    pub fn apply_delta(&self, payload: &Value) -> Vec<&'static str> {
        self.merge(payload.get("changed").unwrap_or(&Value::Null))
    }

    /// Handles a `settings.*` event; returns the cached keys whose value changed.
    pub fn on_event(&self, ev: &str, payload: &Value) -> Vec<&'static str> {
        match ev {
            "settings.snapshot" => self.apply_snapshot(payload),
            "settings.changed" => self.apply_delta(payload),
            _ => Vec::new(),
        }
    }
}

type Listener = Arc<dyn Fn(&str, bool) + Send + Sync>;

fn cache() -> &'static Cache {
    static C: OnceLock<Cache> = OnceLock::new();
    C.get_or_init(Cache::new)
}

fn listeners() -> &'static Mutex<Vec<Listener>> {
    static L: OnceLock<Mutex<Vec<Listener>>> = OnceLock::new();
    L.get_or_init(|| Mutex::new(Vec::new()))
}

/// The cached value of one of [`KEYS`].
pub fn get_bool(key: &str) -> bool {
    cache().get(key)
}

/// Calls `cb(key, value)` whenever a cached key changes (not for the initial defaults).
#[allow(dead_code)] // used by M2-4 (taskbar buttons) at integration
pub fn on_change(cb: Listener) {
    listeners().lock().unwrap().push(cb);
}

fn handle_event(app: &AppHandle, ev: &str, payload: &Value) {
    let changed = cache().on_event(ev, payload);
    if changed.is_empty() {
        return;
    }
    if changed.contains(&CLOSE_TO_TRAY) {
        if let Some(st) = app.try_state::<crate::AppState>() {
            st.close_to_tray.store(get_bool(CLOSE_TO_TRAY), Ordering::SeqCst);
        }
    }
    let cbs: Vec<Listener> = listeners().lock().unwrap().clone();
    for key in changed {
        let v = get_bool(key);
        for cb in &cbs {
            cb(key, v);
        }
    }
}

/// Setup block of M4-1a: subscribes to the core `settings` topic (re-opened after every core restart).
pub fn install(app: &AppHandle) {
    let app = app.clone();
    corelink::global().subscribe("settings", Arc::new(move |ev, p| handle_event(&app, ev, p)));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn starts_with_the_core_defaults() {
        let c = Cache::new();
        assert!(c.get(CLOSE_TO_TRAY));
        assert!(c.get(TRAY_TOGGLE_ON_CLICK));
        assert!(c.get(MINI_PLAYER_WINDOW));
        assert!(c.get(TASKBAR_BUTTONS));
        assert!(!c.get(MINI_ON_MINIMIZE));
        assert!(!c.get("somethingElse"));
    }

    #[test]
    fn snapshot_sets_the_cached_keys_and_ignores_the_rest() {
        let c = Cache::new();
        let ch = c.on_event(
            "settings.snapshot",
            &json!({"values": {"minimizeToTrayOnClose": false, "desktopMiniPlayerOnMinimize": true, "themeMode": "DARK", "hideExplicit": true}}),
        );
        assert_eq!(ch, vec![CLOSE_TO_TRAY, MINI_ON_MINIMIZE]);
        assert!(!c.get(CLOSE_TO_TRAY));
        assert!(c.get(MINI_ON_MINIMIZE));
        assert!(!c.get("hideExplicit"));
    }

    #[test]
    fn delta_updates_one_key_and_reports_only_real_changes() {
        let c = Cache::new();
        assert_eq!(c.on_event("settings.changed", &json!({"changed": {"desktopTaskbarButtons": false}})), vec![TASKBAR_BUTTONS]);
        assert!(!c.get(TASKBAR_BUTTONS));
        assert!(c.on_event("settings.changed", &json!({"changed": {"desktopTaskbarButtons": false}})).is_empty());
        assert!(c.on_event("settings.changed", &json!({"changed": {"themeMode": "AUTO"}})).is_empty());
    }

    #[test]
    fn mistyped_values_and_other_events_are_ignored() {
        let c = Cache::new();
        assert!(c.on_event("settings.changed", &json!({"changed": {"minimizeToTrayOnClose": "no"}})).is_empty());
        assert!(c.get(CLOSE_TO_TRAY));
        assert!(c.on_event("settings.snapshot", &json!({})).is_empty());
        assert!(c.on_event("settings.snapshot", &Value::Null).is_empty());
        assert!(c.on_event("player.state", &json!({"values": {"minimizeToTrayOnClose": false}})).is_empty());
        assert!(c.get(CLOSE_TO_TRAY));
    }

    #[test]
    fn a_snapshot_after_a_core_restart_restores_values() {
        let c = Cache::new();
        c.on_event("settings.changed", &json!({"changed": {"desktopTrayToggleOnClick": false}}));
        let ch = c.on_event("settings.snapshot", &json!({"values": {"desktopTrayToggleOnClick": true}}));
        assert_eq!(ch, vec![TRAY_TOGGLE_ON_CLICK]);
        assert!(c.get(TRAY_TOGGLE_ON_CLICK));
    }
}
