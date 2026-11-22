//! Stale sidecar detection: a core that outlived a previous shell (should not happen, but a v1 crash can).
use serde::Deserialize;
use std::ffi::OsString;
use std::os::windows::ffi::OsStringExt;
use std::path::Path;
use windows::core::PWSTR;
use windows::Win32::Foundation::*;
use windows::Win32::System::Threading::*;

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct CorePid {
    pub pid: u32,
    #[serde(rename = "startTimeMs")]
    pub start_time_ms: i64,
    pub exe: String,
}

pub fn parse_core_pid(s: &str) -> Option<CorePid> {
    serde_json::from_str(s.trim_start_matches('\u{feff}')).ok()
}

fn norm(p: &str) -> String {
    p.replace('/', "\\").to_lowercase()
}

/// What we learned about the live process with that pid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveInfo {
    pub image: String,
    pub start_time_ms: i64,
}

/// Kill only if the pid is alive, its image is our core exe, and its creation time equals `startTimeMs` +- 1 s.
/// The three checks together make PID reuse harmless.
pub fn should_kill(info: &CorePid, live: Option<&LiveInfo>, our_exe: &str) -> bool {
    let Some(live) = live else { return false };
    norm(&live.image) == norm(our_exe)
        && norm(&info.exe) == norm(our_exe)
        && (live.start_time_ms - info.start_time_ms).abs() <= 1000
}

const FILETIME_TO_UNIX_100NS: i64 = 116_444_736_000_000_000;

fn live_info(pid: u32) -> Option<(LiveInfo, HANDLE)> {
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | PROCESS_SYNCHRONIZE, false, pid)
            .ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        if QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_err() {
            let _ = CloseHandle(h);
            return None;
        }
        let image = OsString::from_wide(&buf[..len as usize]).to_string_lossy().into_owned();
        let (mut c, mut e, mut k, mut u) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        if GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u).is_err() {
            let _ = CloseHandle(h);
            return None;
        }
        let ft = ((c.dwHighDateTime as i64) << 32) | c.dwLowDateTime as i64;
        let ms = (ft - FILETIME_TO_UNIX_100NS) / 10_000;
        // Exited-but-not-reaped processes still open; treat them as dead.
        if WaitForSingleObject(h, 0) == WAIT_OBJECT_0 {
            let _ = CloseHandle(h);
            return None;
        }
        Some((LiveInfo { image, start_time_ms: ms }, h))
    }
}

/// Reads `core.pid`, kills a matching stale core, deletes the file. `our_exe` is the expected image path.
/// Returns true when a process was killed.
pub fn kill_stale(core_pid_file: &Path, our_exe: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(core_pid_file) else { return false };
    let mut killed = false;
    match parse_core_pid(&text) {
        Some(info) => {
            if let Some((live, h)) = live_info(info.pid) {
                if should_kill(&info, Some(&live), &our_exe.to_string_lossy()) {
                    log::warn!("stale core pid {} found, killing it", info.pid);
                    unsafe {
                        let _ = TerminateProcess(h, 1);
                        let _ = WaitForSingleObject(h, 3000);
                    }
                    killed = true;
                } else {
                    log::warn!(
                        "core.pid points at pid {} ({}) which is not our core; leaving it alone",
                        info.pid,
                        live.image
                    );
                }
                unsafe {
                    let _ = CloseHandle(h);
                }
            }
        }
        None => log::warn!("core.pid is not parseable, ignoring"),
    }
    let _ = std::fs::remove_file(core_pid_file);
    killed
}

#[cfg(test)]
mod tests {
    use super::*;
    const EXE: &str = r"D:\app\core\runtime\bin\minmusic-core.exe";
    fn info() -> CorePid {
        CorePid { pid: 10, start_time_ms: 1_700_000_000_000, exe: EXE.into() }
    }
    fn live(image: &str, t: i64) -> LiveInfo {
        LiveInfo { image: image.into(), start_time_ms: t }
    }
    #[test]
    fn parse() {
        let p = parse_core_pid("\u{feff}{\"pid\":7,\"startTimeMs\":123,\"exe\":\"C:\\\\x.exe\"}").unwrap();
        assert_eq!(p.pid, 7);
        assert_eq!(p.start_time_ms, 123);
        assert!(parse_core_pid("garbage").is_none());
    }
    #[test]
    fn decision() {
        assert!(should_kill(&info(), Some(&live(EXE, 1_700_000_000_000)), EXE));
        assert!(should_kill(&info(), Some(&live(&EXE.to_uppercase(), 1_700_000_000_900)), EXE), "case and 0.9 s skew ok");
        assert!(!should_kill(&info(), Some(&live(EXE, 1_700_000_001_500)), EXE), "start time off by 1.5 s: pid reused");
        assert!(!should_kill(&info(), Some(&live(r"C:\Windows\notepad.exe", 1_700_000_000_000)), EXE), "other image");
        assert!(!should_kill(&info(), None, EXE), "dead pid");
        let mut other = info();
        other.exe = r"C:\other\minmusic-core.exe".into();
        assert!(!should_kill(&other, Some(&live(EXE, 1_700_000_000_000)), EXE), "file claims another exe");
    }
}
