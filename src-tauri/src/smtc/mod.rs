//! System Media Transport Controls (media keys, lock screen, volume flyout) for the main window.
//! `ISystemMediaTransportControlsInterop::GetForWindow(main hwnd)`; works with the window hidden.
use crate::corelink;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use windows::core::HSTRING;
use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
use windows::Media::{
    MediaPlaybackStatus, MediaPlaybackType, SystemMediaTransportControls, SystemMediaTransportControlsButton,
    SystemMediaTransportControlsButtonPressedEventArgs, SystemMediaTransportControlsTimelineProperties,
};
use windows::Storage::Streams::RandomAccessStreamReference;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

// ---------- pure mapping ----------

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Meta {
    pub track_id: Option<String>,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub art_url: Option<String>,
    pub playing: bool,
    pub has_track: bool,
    pub can_prev: bool,
    pub can_next: bool,
    pub pos_ms: i64,
    pub dur_ms: i64,
}

/// Builds the URL SMTC can fetch for an `Art.src`: https stays as is; `core:<kind>/<id>` goes through the
/// core's art endpoint (api.md 1.10) with the art token. Anything else has no thumbnail.
pub fn art_url(src: &str, port: u16, art_token: &str) -> Option<String> {
    if src.starts_with("https://") {
        return Some(src.to_string());
    }
    let rest = src.strip_prefix("core:")?;
    let (kind, id) = rest.split_once('/')?;
    if kind.is_empty() || id.is_empty() {
        return None;
    }
    Some(format!("http://127.0.0.1:{port}/art/{kind}/{id}?w=512&k={art_token}"))
}

/// Maps a `PlayerState` JSON (api.md 4) to what SMTC shows. `core` is `(port, artToken)`.
pub fn meta_from_state(state: &Value, core: Option<(u16, &str)>) -> Meta {
    let track = state.get("track").filter(|t| t.is_object());
    let s = |k: &str| track.and_then(|t| t.get(k)).and_then(Value::as_str);
    let artist = track
        .and_then(|t| t.get("artists"))
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.get("name").and_then(Value::as_str)).collect::<Vec<_>>().join(", "))
        .unwrap_or_default();
    let album = track
        .and_then(|t| t.get("album"))
        .and_then(|a| a.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let art_url = track
        .and_then(|t| t.get("art"))
        .and_then(|a| a.get("src"))
        .and_then(Value::as_str)
        .and_then(|src| match core {
            Some((port, tok)) => art_url(src, port, tok),
            None => src.starts_with("https://").then(|| src.to_string()),
        });
    let num = |k: &str| state.get(k).and_then(Value::as_f64).unwrap_or(0.0).max(0.0) as i64;
    let dur = {
        let d = num("durMs");
        if d > 0 {
            d
        } else {
            track.and_then(|t| t.get("durationMs")).and_then(Value::as_f64).unwrap_or(0.0).max(0.0) as i64
        }
    };
    Meta {
        track_id: s("id").map(String::from),
        title: s("title").unwrap_or("").to_string(),
        artist,
        album,
        art_url,
        playing: state.get("playing").and_then(Value::as_bool).unwrap_or(false),
        has_track: track.is_some(),
        can_prev: state.get("canPrev").and_then(Value::as_bool).unwrap_or(false),
        can_next: state.get("canNext").and_then(Value::as_bool).unwrap_or(false),
        pos_ms: num("posMs"),
        dur_ms: dur,
    }
}

// ---------- WinRT glue ----------

struct Inner {
    smtc: SystemMediaTransportControls,
    last: Mutex<Option<Meta>>,
    /// (position at `at`, `at`, rate-aware playing flag) for the 5 s extrapolating ticker.
    clock: Mutex<(i64, Instant)>,
    last_timeline: Mutex<Instant>,
}

fn hs(s: &str) -> HSTRING {
    HSTRING::from(s)
}

impl Inner {
    fn apply_meta(&self, m: &Meta) -> windows::core::Result<()> {
        let smtc = &self.smtc;
        smtc.SetIsPlayEnabled(true)?;
        smtc.SetIsPauseEnabled(true)?;
        smtc.SetIsNextEnabled(m.can_next || !m.has_track)?;
        smtc.SetIsPreviousEnabled(m.can_prev || !m.has_track)?;
        let status = if !m.has_track {
            MediaPlaybackStatus::Closed
        } else if m.playing {
            MediaPlaybackStatus::Playing
        } else {
            MediaPlaybackStatus::Paused
        };
        smtc.SetPlaybackStatus(status)?;
        let prev = self.last.lock().unwrap().clone();
        let changed_track = prev.as_ref().map(|p| (&p.track_id, &p.title, &p.artist, &p.album, &p.art_url))
            != Some((&m.track_id, &m.title, &m.artist, &m.album, &m.art_url));
        if changed_track {
            let du = smtc.DisplayUpdater()?;
            if m.has_track {
                du.SetType(MediaPlaybackType::Music)?;
                let mp = du.MusicProperties()?;
                mp.SetTitle(&hs(&m.title))?;
                mp.SetArtist(&hs(&m.artist))?;
                mp.SetAlbumTitle(&hs(&m.album))?;
                match m.art_url.as_deref().and_then(|u| Uri::CreateUri(&hs(u)).ok()) {
                    Some(uri) => du.SetThumbnail(&RandomAccessStreamReference::CreateFromUri(&uri)?)?,
                    None => du.SetThumbnail(None)?,
                }
            } else {
                du.ClearAll()?;
            }
            du.Update()?;
        }
        *self.last.lock().unwrap() = Some(m.clone());
        Ok(())
    }

    fn apply_timeline(&self, pos_ms: i64, dur_ms: i64) -> windows::core::Result<()> {
        let tl = SystemMediaTransportControlsTimelineProperties::new()?;
        let ms = |v: i64| TimeSpan { Duration: v.max(0) * 10_000 };
        tl.SetStartTime(ms(0))?;
        tl.SetMinSeekTime(ms(0))?;
        tl.SetEndTime(ms(dur_ms))?;
        tl.SetMaxSeekTime(ms(dur_ms))?;
        tl.SetPosition(ms(pos_ms.min(dur_ms.max(0))))?;
        self.smtc.UpdateTimelineProperties(&tl)?;
        *self.last_timeline.lock().unwrap() = Instant::now();
        Ok(())
    }

    fn on_event(&self, ev: &str, p: &Value) {
        let link = corelink::global();
        let cfg = link.config();
        let core = cfg.as_ref().map(|c| (c.port, c.art_token.as_str()));
        match ev {
            "player.snapshot" | "player.state" => {
                let m = meta_from_state(p, core);
                if let Err(e) = self.apply_meta(&m) {
                    log::warn!("smtc metadata: {e}");
                }
                *self.clock.lock().unwrap() = (m.pos_ms, Instant::now());
                if let Err(e) = self.apply_timeline(m.pos_ms, m.dur_ms) {
                    log::warn!("smtc timeline: {e}");
                }
            }
            "player.position" => {
                let pos = p.get("posMs").and_then(Value::as_i64).unwrap_or(0);
                let dur = p.get("durMs").and_then(Value::as_i64).unwrap_or(0);
                let playing = p.get("playing").and_then(Value::as_bool).unwrap_or(false);
                let jumped = {
                    let c = self.clock.lock().unwrap();
                    let expected = c.0 + c.1.elapsed().as_millis() as i64;
                    (pos - expected).abs() > 2000
                };
                *self.clock.lock().unwrap() = (pos, Instant::now());
                // Seeks and pauses update at once; steady playback every 5 s.
                if jumped || !playing || self.last_timeline.lock().unwrap().elapsed() >= Duration::from_secs(5) {
                    let _ = self.apply_timeline(pos, dur);
                }
            }
            _ => {}
        }
    }

    fn tick(&self) {
        let (playing, dur) = match self.last.lock().unwrap().as_ref() {
            Some(m) => (m.playing && m.has_track, m.dur_ms),
            None => return,
        };
        if playing {
            let (pos, at) = *self.clock.lock().unwrap();
            let _ = self.apply_timeline(pos + at.elapsed().as_millis() as i64, dur);
        }
    }
}

fn button_command(b: SystemMediaTransportControlsButton) -> Option<&'static str> {
    match b {
        SystemMediaTransportControlsButton::Play => Some("player.resume"),
        SystemMediaTransportControlsButton::Pause => Some("player.pause"),
        SystemMediaTransportControlsButton::Next => Some("player.next"),
        SystemMediaTransportControlsButton::Previous => Some("player.prev"),
        _ => None,
    }
}

/// Setup block of M1-4. `hwnd` is the main window.
pub fn install(hwnd: HWND) {
    if let Err(e) = try_install(hwnd) {
        log::warn!("SMTC unavailable: {e}");
    }
}

fn try_install(hwnd: HWND) -> windows::core::Result<()> {
    let interop = windows::core::factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
    let smtc: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd)? };
    smtc.SetIsEnabled(true)?;
    smtc.SetIsPlayEnabled(true)?;
    smtc.SetIsPauseEnabled(true)?;
    smtc.SetIsNextEnabled(true)?;
    smtc.SetIsPreviousEnabled(true)?;
    smtc.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;
    smtc.ButtonPressed(&TypedEventHandler::new(
        |_, args: windows::core::Ref<SystemMediaTransportControlsButtonPressedEventArgs>| {
            if let Some(a) = args.as_ref() {
                if let Some(m) = a.Button().ok().and_then(button_command) {
                    corelink::rt().spawn(async move {
                        if let Err(e) = corelink::global().call(m, json!({})).await {
                            log::warn!("smtc {m}: {} {}", e.code, e.msg);
                        }
                    });
                }
            }
            Ok(())
        },
    ))?;
    let inner = Arc::new(Inner {
        smtc,
        last: Mutex::new(None),
        clock: Mutex::new((0, Instant::now())),
        last_timeline: Mutex::new(Instant::now()),
    });
    let i2 = inner.clone();
    corelink::global().subscribe("player", Arc::new(move |ev, p| i2.on_event(ev, p)));
    let i3 = inner;
    corelink::rt().spawn(async move {
        let mut t = tokio::time::interval(Duration::from_secs(5));
        loop {
            t.tick().await;
            i3.tick();
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn art_url_https_and_core() {
        assert_eq!(art_url("https://i.ytimg.com/a.jpg", 1, "k").as_deref(), Some("https://i.ytimg.com/a.jpg"));
        assert_eq!(
            art_url("core:playlist_covers/abc123", 4567, "tok").as_deref(),
            Some("http://127.0.0.1:4567/art/playlist_covers/abc123?w=512&k=tok")
        );
        assert_eq!(art_url("http://evil/x.jpg", 1, "k"), None);
        assert_eq!(art_url("core:nokind", 1, "k"), None);
        assert_eq!(art_url("core:/id", 1, "k"), None);
    }

    #[test]
    fn maps_a_player_state() {
        let st = json!({
            "track": {"id": "t1", "title": "Tên", "artists": [{"name": "A"}, {"name": "B"}],
                      "album": {"title": "Al"}, "art": {"src": "core:local/x1"}, "durationMs": 200000},
            "playing": true, "posMs": 5000, "durMs": 0, "canPrev": true, "canNext": false
        });
        let m = meta_from_state(&st, Some((9, "tk")));
        assert_eq!(m.title, "Tên");
        assert_eq!(m.artist, "A, B");
        assert_eq!(m.album, "Al");
        assert_eq!(m.art_url.as_deref(), Some("http://127.0.0.1:9/art/local/x1?w=512&k=tk"));
        assert!(m.playing && m.has_track && m.can_prev && !m.can_next);
        assert_eq!((m.pos_ms, m.dur_ms), (5000, 200000));
    }

    #[test]
    fn maps_no_track() {
        let m = meta_from_state(&json!({"track": null, "playing": false}), None);
        assert!(!m.has_track && !m.playing);
        assert_eq!(m.title, "");
        assert_eq!(m.art_url, None);
    }

    #[test]
    fn core_art_without_core_config_has_no_thumbnail() {
        let st = json!({"track": {"id": "t", "title": "x", "art": {"src": "core:local/x1"}}});
        assert_eq!(meta_from_state(&st, None).art_url, None);
    }
}
