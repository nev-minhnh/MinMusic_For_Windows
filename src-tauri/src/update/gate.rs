//! Who may update, and when: portable builds never auto-update, the `checkForUpdates` setting
//! gates the hourly check, and settings are read from the core (corelink) with a `shell.json`
//! fallback while the core is not connected.
use super::version::Channel;
use crate::paths::Paths;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60);
pub const FIRST_CHECK_DELAY: Duration = Duration::from_secs(45);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Prefs {
    pub check_for_updates: bool,
    pub channel: Channel,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { check_for_updates: true, channel: Channel::Stable }
    }
}

impl Prefs {
    /// From a flat `{checkForUpdates?: bool, updateChannel?: string}` object (a `settings.get`
    /// `values` map or `shell.json`). Missing or mistyped keys keep the defaults.
    pub fn from_values(v: &Value) -> Prefs {
        let d = Prefs::default();
        Prefs {
            check_for_updates: v.get("checkForUpdates").and_then(Value::as_bool).unwrap_or(d.check_for_updates),
            channel: v.get("updateChannel").and_then(Value::as_str).map(Channel::from_setting).unwrap_or(d.channel),
        }
    }
}

pub fn shell_json_path(paths: &Paths) -> PathBuf {
    paths.roaming_root.join("MinMusic").join("config").join("metrolist").join("shell.json")
}

pub fn prefs_from_shell_json(path: &Path) -> Prefs {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .map(|v| Prefs::from_values(&v))
        .unwrap_or_default()
}

/// Core settings first; shell.json when the core is not connected or answers with an error.
pub async fn read_prefs(paths: &Paths) -> Prefs {
    let r = crate::corelink::global()
        .call_timeout("settings.get", json!({"keys": ["checkForUpdates", "updateChannel"]}), Duration::from_secs(3))
        .await;
    match r {
        Ok(v) => Prefs::from_values(v.get("values").unwrap_or(&Value::Null)),
        Err(_) => prefs_from_shell_json(&shell_json_path(paths)),
    }
}

/// `portable.flag` next to the exe marks the portable zip (architecture section 7).
pub fn is_portable(exe_dir: Option<&Path>) -> bool {
    exe_dir.is_some_and(|d| d.join("portable.flag").exists())
}

/// The hourly background check runs only for installed builds with the setting on.
pub fn auto_check_allowed(portable: bool, prefs: &Prefs) -> bool {
    !portable && prefs.check_for_updates
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_never_auto_updates() {
        let on = Prefs::default();
        assert!(auto_check_allowed(false, &on));
        assert!(!auto_check_allowed(true, &on));
        assert!(!auto_check_allowed(false, &Prefs { check_for_updates: false, ..on }));
    }

    #[test]
    fn portable_flag_is_detected_next_to_the_exe() {
        let d = std::env::temp_dir().join(format!("mm-m52-portable-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        assert!(!is_portable(Some(&d)));
        std::fs::write(d.join("portable.flag"), b"").unwrap();
        assert!(is_portable(Some(&d)));
        assert!(!is_portable(None));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn prefs_parse_with_defaults() {
        assert_eq!(Prefs::from_values(&json!({})), Prefs::default());
        let p = Prefs::from_values(&json!({"checkForUpdates": false, "updateChannel": "prerelease"}));
        assert!(!p.check_for_updates);
        assert_eq!(p.channel, Channel::Prerelease);
        assert!(Prefs::from_values(&json!({"checkForUpdates": "yes"})).check_for_updates);
    }

    #[test]
    fn shell_json_fallback_reads_the_mirror_keys() {
        let d = std::env::temp_dir().join(format!("mm-m52-shell-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        let f = d.join("shell.json");
        std::fs::write(&f, br#"{"sidebarWidth":240,"checkForUpdates":false,"updateChannel":"beta"}"#).unwrap();
        let p = prefs_from_shell_json(&f);
        assert!(!p.check_for_updates);
        assert_eq!(p.channel, Channel::Prerelease);
        assert_eq!(prefs_from_shell_json(&d.join("missing.json")), Prefs::default());
        let _ = std::fs::remove_dir_all(&d);
    }
}
