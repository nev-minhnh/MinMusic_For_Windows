//! `shell.json` (UI layout state and window placement) and the shell-settings commands.
//! Location: `%APPDATA%\MinMusic\config\metrolist\shell.json` (honours `MINMUSIC_DATA_ROOT` through `Paths`).
use crate::paths::Paths;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow, WindowEvent};

const WRITE_DEBOUNCE: Duration = Duration::from_millis(500);
const MIN_W: u32 = 640;
const MIN_H: u32 = 480;
/// Keys the UI may read and write; anything else (window placement) is shell-private.
const UI_KEYS: &[&str] = &[
    "sidebarWidth",
    "sidebarDocked",
    "paneWidth",
    "trayBalloonShown",
    "desktopTrayToggleOnClick",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

impl Rect {
    fn right(&self) -> i64 {
        self.x as i64 + self.w as i64
    }
    fn bottom(&self) -> i64 {
        self.y as i64 + self.h as i64
    }
    fn overlap(&self, o: &Rect) -> i64 {
        let w = self.right().min(o.right()) - (self.x as i64).max(o.x as i64);
        let h = self.bottom().min(o.bottom()) - (self.y as i64).max(o.y as i64);
        if w > 0 && h > 0 {
            w * h
        } else {
            0
        }
    }
}

/// Fits `r` into the work area it overlaps most (the first area when it overlaps none): the size is
/// capped to the area, the position is moved inside. Pure.
pub fn clamp_to_work_areas(r: Rect, areas: &[Rect]) -> Rect {
    let Some(first) = areas.first() else { return r };
    let area = areas.iter().max_by_key(|a| a.overlap(&r)).filter(|a| a.overlap(&r) > 0).unwrap_or(first);
    let w = r.w.max(MIN_W).min(area.w);
    let h = r.h.max(MIN_H).min(area.h);
    let x = (r.x as i64).clamp(area.x as i64, area.right() - w as i64) as i32;
    let y = (r.y as i64).clamp(area.y as i64, area.bottom() - h as i64) as i32;
    Rect { x, y, w, h }
}

/// Shallow merge: keys of `patch` overwrite, `null` removes. Pure.
pub fn merge_patch(base: &mut Map<String, Value>, patch: &Value) {
    if let Some(p) = patch.as_object() {
        for (k, v) in p {
            if v.is_null() {
                base.remove(k);
            } else {
                base.insert(k.clone(), v.clone());
            }
        }
    }
}

/// Writes to `<path>.tmp` and renames over `path`.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(d) = path.parent() {
        std::fs::create_dir_all(d)?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)
}

pub fn shell_json_path(paths: &Paths) -> PathBuf {
    paths.roaming_root.join("MinMusic").join("config").join("metrolist").join("shell.json")
}

pub struct Store {
    path: PathBuf,
    data: Mutex<Map<String, Value>>,
    gen: AtomicU64,
}

impl Store {
    pub fn load(path: PathBuf) -> Arc<Store> {
        let data = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        Arc::new(Store { path, data: Mutex::new(data), gen: AtomicU64::new(0) })
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        self.data.lock().unwrap().get(key).cloned()
    }

    pub fn get_bool(&self, key: &str) -> bool {
        self.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
    }

    pub fn ui_view(&self) -> Value {
        let d = self.data.lock().unwrap();
        Value::Object(d.iter().filter(|(k, _)| UI_KEYS.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect())
    }

    pub fn patch(self: &Arc<Self>, patch: &Value) {
        merge_patch(&mut self.data.lock().unwrap(), patch);
        self.schedule_write();
    }

    /// Debounced write (500 ms after the last change).
    fn schedule_write(self: &Arc<Self>) {
        let g = self.gen.fetch_add(1, Ordering::SeqCst) + 1;
        let me = self.clone();
        std::thread::spawn(move || {
            std::thread::sleep(WRITE_DEBOUNCE);
            if me.gen.load(Ordering::SeqCst) == g {
                me.flush();
            }
        });
    }

    pub fn flush(&self) {
        let bytes = serde_json::to_vec_pretty(&Value::Object(self.data.lock().unwrap().clone())).unwrap_or_default();
        if let Err(e) = write_atomic(&self.path, &bytes) {
            log::warn!("could not write {}: {e}", self.path.display());
        }
    }
}

static STORE: OnceLock<Arc<Store>> = OnceLock::new();

pub fn store() -> Option<&'static Arc<Store>> {
    STORE.get()
}

// ---------- commands ----------

#[tauri::command]
pub fn shell_settings_get() -> Value {
    store().map(|s| s.ui_view()).unwrap_or_else(|| json!({}))
}

#[tauri::command]
pub fn shell_settings_set(patch: Value) {
    if let (Some(s), Some(obj)) = (store(), patch.as_object()) {
        let allowed: Map<String, Value> =
            obj.iter().filter(|(k, _)| UI_KEYS.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect();
        s.patch(&Value::Object(allowed));
    }
}

// ---------- window placement ----------

fn work_areas(win: &WebviewWindow) -> Vec<Rect> {
    win.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| {
            let a = m.work_area();
            Rect { x: a.position.x, y: a.position.y, w: a.size.width, h: a.size.height }
        })
        .collect()
}

fn placement_of(v: &Value) -> Option<(Rect, bool)> {
    let w = v.get("window")?;
    let rect = Rect {
        x: w.get("x")?.as_i64()? as i32,
        y: w.get("y")?.as_i64()? as i32,
        w: w.get("w")?.as_u64()? as u32,
        h: w.get("h")?.as_u64()? as u32,
    };
    Some((rect, w.get("maximized").and_then(Value::as_bool).unwrap_or(false)))
}

/// Setup block of M1-4: loads `shell.json`, restores the placement of the (still hidden) main window
/// and keeps it up to date.
pub fn install(win: &WebviewWindow, paths: &Paths) {
    let st = STORE.get_or_init(|| Store::load(shell_json_path(paths))).clone();
    let saved = Value::Object(st.data.lock().unwrap().clone());
    if let Some((rect, maximized)) = placement_of(&saved) {
        let areas = work_areas(win);
        let r = clamp_to_work_areas(rect, &areas);
        let _ = win.set_size(PhysicalSize::new(r.w, r.h));
        let _ = win.set_position(PhysicalPosition::new(r.x, r.y));
        if maximized {
            let _ = win.maximize();
        }
    }
    let w2 = win.clone();
    win.on_window_event(move |ev| match ev {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => record(&w2, &st),
        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => st.flush(),
        _ => {}
    });
}

fn record(win: &WebviewWindow, st: &Arc<Store>) {
    if win.is_minimized().unwrap_or(false) || !win.is_visible().unwrap_or(true) {
        return;
    }
    let maximized = win.is_maximized().unwrap_or(false);
    let mut cur = st.get("window").and_then(|v| v.as_object().cloned()).unwrap_or_default();
    cur.insert("maximized".into(), json!(maximized));
    if !maximized {
        if let (Ok(p), Ok(s)) = (win.outer_position(), win.inner_size()) {
            if s.width > 0 && s.height > 0 {
                cur.insert("x".into(), json!(p.x));
                cur.insert("y".into(), json!(p.y));
                cur.insert("w".into(), json!(s.width));
                cur.insert("h".into(), json!(s.height));
            }
        }
    }
    st.patch(&json!({ "window": Value::Object(cur) }));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(x: i32, y: i32, w: u32, h: u32) -> Rect {
        Rect { x, y, w, h }
    }

    #[test]
    fn clamp_keeps_a_visible_rect() {
        let a = [r(0, 0, 1920, 1040)];
        assert_eq!(clamp_to_work_areas(r(100, 50, 1280, 800), &a), r(100, 50, 1280, 800));
    }

    #[test]
    fn clamp_moves_an_offscreen_rect_inside() {
        let a = [r(0, 0, 1920, 1040)];
        assert_eq!(clamp_to_work_areas(r(3000, -500, 1280, 800), &a), r(640, 0, 1280, 800));
    }

    #[test]
    fn clamp_shrinks_to_a_smaller_monitor() {
        let a = [r(0, 0, 1366, 728)];
        assert_eq!(clamp_to_work_areas(r(50, 50, 1600, 1000), &a), r(0, 0, 1366, 728));
    }

    #[test]
    fn clamp_prefers_the_monitor_with_most_overlap_and_handles_negative_origin() {
        let a = [r(0, 0, 1920, 1040), r(-1920, 0, 1920, 1040)];
        assert_eq!(clamp_to_work_areas(r(-1800, 100, 1000, 700), &a), r(-1800, 100, 1000, 700));
        // Monitor unplugged: the saved rect was on a monitor that is gone.
        let only = [r(0, 0, 1920, 1040)];
        assert_eq!(clamp_to_work_areas(r(-1800, 100, 1000, 700), &only), r(0, 100, 1000, 700));
    }

    #[test]
    fn clamp_enforces_the_minimum_size() {
        let a = [r(0, 0, 1920, 1040)];
        assert_eq!(clamp_to_work_areas(r(10, 10, 100, 100), &a), r(10, 10, 640, 480));
    }

    #[test]
    fn merge_overwrites_and_null_removes() {
        let mut m = serde_json::from_str::<Map<String, Value>>(r#"{"a":1,"b":2}"#).unwrap();
        merge_patch(&mut m, &json!({"b":3,"c":4,"a":null}));
        assert_eq!(Value::Object(m), json!({"b":3,"c":4}));
    }

    #[test]
    fn atomic_write_replaces_and_leaves_no_tmp() {
        let dir = std::env::temp_dir().join(format!("mm-ws-{}", std::process::id()));
        let p = dir.join("sub").join("shell.json");
        write_atomic(&p, b"{\"a\":1}").unwrap();
        write_atomic(&p, b"{\"a\":2}").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{\"a\":2}");
        assert!(!p.with_extension("json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn store_round_trip_filters_private_keys() {
        let dir = std::env::temp_dir().join(format!("mm-ws2-{}", std::process::id()));
        let p = dir.join("shell.json");
        let s = Store::load(p.clone());
        s.patch(&json!({"sidebarWidth": 240, "window": {"x": 1}}));
        s.flush();
        let s2 = Store::load(p);
        assert_eq!(s2.ui_view(), json!({"sidebarWidth": 240}));
        assert!(s2.get("window").is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn placement_parses() {
        let v = json!({"window": {"x": -5, "y": 7, "w": 800, "h": 600, "maximized": true}});
        assert_eq!(placement_of(&v), Some((r(-5, 7, 800, 600), true)));
        assert_eq!(placement_of(&json!({})), None);
    }
}
