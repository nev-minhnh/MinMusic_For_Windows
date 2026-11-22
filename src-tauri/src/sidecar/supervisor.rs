//! Core supervisor: Starting -> Ready -> Restarting -> Failed.
//! Exit watcher thread, shell WS client (sys.ping every 5 s, 3 misses = dead), back-off, crash window.
use super::job::JobObject;
use super::spawn::{self, CoreProcess, SpawnSpec};
use super::stale;
use crate::paths::Paths;
use crate::testhooks;
use serde::Serialize;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::watch;

pub const PING_INTERVAL: Duration = Duration::from_secs(5);
pub const PING_MISSES: u32 = 3;
pub const CRASH_WINDOW: Duration = Duration::from_secs(120);
pub const CRASH_LIMIT: usize = 3;
pub const SHUTDOWN_WAIT_MS: u32 = 3000;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CoreState {
    Starting,
    Ready,
    Restarting,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
pub struct CoreStatus {
    pub state: CoreState,
    pub restarts: u32,
    #[serde(rename = "lastError", skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CoreConfig {
    pub port: u16,
    pub token: String,
    #[serde(rename = "artToken")]
    pub art_token: String,
}

#[derive(Clone)]
struct Snapshot {
    status: CoreStatus,
    config: Option<CoreConfig>,
}

// ---------- crash accounting (pure, unit-tested) ----------

#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Restart(Duration),
    Fail,
}

/// Back-off for the n-th crash inside the window (1-based): 0.5 s, 2 s, 5 s, 5 s ...
pub fn backoff(n: usize) -> Duration {
    match n {
        0 | 1 => Duration::from_millis(500),
        2 => Duration::from_secs(2),
        _ => Duration::from_secs(5),
    }
}

#[derive(Default)]
pub struct CrashTracker {
    times: VecDeque<Instant>,
}

impl CrashTracker {
    /// Records a crash at `now`. The third crash within the window is fatal.
    pub fn record(&mut self, now: Instant) -> Decision {
        while let Some(&f) = self.times.front() {
            if now.duration_since(f) > CRASH_WINDOW {
                self.times.pop_front();
            } else {
                break;
            }
        }
        self.times.push_back(now);
        if self.times.len() >= CRASH_LIMIT {
            Decision::Fail
        } else {
            Decision::Restart(backoff(self.times.len()))
        }
    }
    pub fn clear(&mut self) {
        self.times.clear();
    }
}

// ---------- supervisor ----------

enum Ctl {
    Exited(u64),
    PingDead(u64),
    Retry,
    Quit,
}

pub struct Supervisor {
    app: AppHandle,
    paths: Paths,
    job: Mutex<Option<JobObject>>,
    snap_tx: watch::Sender<Snapshot>,
    current: Mutex<Option<Arc<CoreProcess>>>,
    quitting: AtomicBool,
    ctl: Mutex<Sender<Ctl>>,
}

impl Supervisor {
    pub fn start(app: AppHandle, paths: Paths) -> Arc<Supervisor> {
        let (tx, rx) = mpsc::channel();
        let job = match JobObject::new_kill_on_close() {
            Ok(j) => Some(j),
            Err(e) => {
                log::error!("Job Object unavailable, relying on stdin EOF and the parent poll: {e}");
                None
            }
        };
        let (snap_tx, _) = watch::channel(Snapshot {
            status: CoreStatus { state: CoreState::Starting, restarts: 0, last_error: None },
            config: None,
        });
        let sup = Arc::new(Supervisor {
            app,
            paths,
            job: Mutex::new(job),
            snap_tx,
            current: Mutex::new(None),
            quitting: AtomicBool::new(false),
            ctl: Mutex::new(tx),
        });
        let s2 = sup.clone();
        std::thread::Builder::new()
            .name("core-supervisor".into())
            .spawn(move || s2.run(rx))
            .expect("spawn supervisor thread");
        sup
    }

    pub fn status(&self) -> CoreStatus {
        self.snap_tx.borrow().status.clone()
    }

    /// Resolves once the core is READY (again after each restart). Errors when the core is in `Failed`.
    pub async fn config(&self) -> Result<CoreConfig, String> {
        let mut rx = self.snap_tx.subscribe();
        loop {
            {
                let s = rx.borrow_and_update();
                match (&s.status.state, &s.config) {
                    (CoreState::Ready, Some(c)) => return Ok(c.clone()),
                    (CoreState::Failed, _) => {
                        return Err(s.status.last_error.clone().unwrap_or_else(|| "core failed".into()))
                    }
                    _ => {}
                }
            }
            if rx.changed().await.is_err() {
                return Err("supervisor stopped".into());
            }
        }
    }

    pub fn retry(&self) {
        let _ = self.ctl.lock().unwrap().send(Ctl::Retry);
    }

    pub fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }

    /// Graceful stop of the core, synchronous (at most ~4 s): `{"cmd":"shutdown"}` on stdin, wait 3 s,
    /// TerminateProcess, then drop the Job Object. Safe to call more than once.
    pub fn shutdown_blocking(&self) {
        self.quitting.store(true, Ordering::SeqCst);
        let _ = self.ctl.lock().unwrap().send(Ctl::Quit);
        let core = self.current.lock().unwrap().take();
        if let Some(core) = core {
            let t0 = Instant::now();
            if core.send_line(r#"{"cmd":"shutdown"}"#).is_err() {
                log::warn!("could not write shutdown to the core stdin");
            }
            if !core.wait_exit(SHUTDOWN_WAIT_MS) {
                log::warn!("core did not exit within 3 s, terminating");
                core.terminate();
                core.wait_exit(1000);
            }
            log::info!("core stopped in {} ms", t0.elapsed().as_millis());
        }
        self.job.lock().unwrap().take(); // closes the handle: KILL_ON_JOB_CLOSE reaps anything left
    }

    fn set_status(&self, state: CoreState, restarts: u32, err: Option<String>, config: Option<CoreConfig>) {
        let status = CoreStatus { state, restarts, last_error: err };
        log::info!("core-status {:?} restarts={} err={:?}", status.state, status.restarts, status.last_error);
        let _ = self.app.emit("core-status", status.clone());
        self.snap_tx.send_replace(Snapshot { status, config });
    }

    fn run(self: Arc<Self>, rx: Receiver<Ctl>) {
        let mut tracker = CrashTracker::default();
        let mut generation: u64 = 0;
        let mut restarts: u32 = 0;
        let mut start_failures: u32 = 0;
        let mut last_err: Option<String> = None;
        let mut first = true;
        loop {
            if self.is_quitting() {
                return;
            }
            self.set_status(
                if first { CoreState::Starting } else { CoreState::Restarting },
                restarts,
                last_err.clone(),
                None,
            );
            first = false;
            generation += 1;
            let gen = generation;

            let crash_reason: String;
            match self.start_core() {
                Ok((core, cfg)) => {
                    start_failures = 0;
                    if self.is_quitting() {
                        core.terminate();
                        return;
                    }
                    *self.current.lock().unwrap() = Some(core.clone());
                    if let Some(p) = testhooks::pidfile() {
                        let _ = std::fs::write(
                            p,
                            serde_json::json!({"shellPid": std::process::id(), "corePid": core.pid}).to_string(),
                        );
                    }
                    crate::corelink::global().attach(cfg.clone());
                    self.set_status(CoreState::Ready, restarts, None, Some(cfg.clone()));
                    let cancel = Arc::new(AtomicBool::new(false));
                    self.spawn_exit_watcher(core.clone(), gen);
                    self.spawn_pinger(cfg, gen, cancel.clone());
                    // Wait for this core to end.
                    let ev = loop {
                        match rx.recv() {
                            Ok(Ctl::Exited(g)) if g == gen => break "core process exited".to_string(),
                            Ok(Ctl::PingDead(g)) if g == gen => break "core stopped answering sys.ping".to_string(),
                            Ok(Ctl::Quit) | Err(_) => {
                                cancel.store(true, Ordering::SeqCst);
                                crate::corelink::global().detach();
                                return;
                            }
                            Ok(_) => {}
                        }
                    };
                    cancel.store(true, Ordering::SeqCst);
                    crate::corelink::global().detach();
                    if self.is_quitting() {
                        return;
                    }
                    // A hung core must not linger next to its replacement.
                    core.terminate();
                    core.wait_exit(2000);
                    *self.current.lock().unwrap() = None;
                    crash_reason = ev;
                }
                Err(e) => {
                    start_failures += 1;
                    crash_reason = e;
                }
            }
            log::error!("core down: {crash_reason}");
            last_err = Some(crash_reason);
            if self.is_quitting() {
                return;
            }
            let decision = if start_failures >= 2 {
                Decision::Fail
            } else {
                tracker.record(Instant::now())
            };
            match decision {
                Decision::Restart(delay) => {
                    restarts += 1;
                    self.set_status(CoreState::Restarting, restarts, last_err.clone(), None);
                    let until = Instant::now() + delay;
                    loop {
                        let left = until.saturating_duration_since(Instant::now());
                        match rx.recv_timeout(left) {
                            Ok(Ctl::Quit) | Err(RecvTimeoutError::Disconnected) => return,
                            Err(RecvTimeoutError::Timeout) => break,
                            Ok(_) => {}
                        }
                    }
                }
                Decision::Fail => {
                    self.set_status(CoreState::Failed, restarts, last_err.clone(), None);
                    loop {
                        match rx.recv() {
                            Ok(Ctl::Retry) => break,
                            Ok(Ctl::Quit) | Err(_) => return,
                            Ok(_) => {}
                        }
                    }
                    tracker.clear();
                    start_failures = 0;
                    restarts += 1;
                }
            }
        }
    }

    fn start_core(&self) -> Result<(Arc<CoreProcess>, CoreConfig), String> {
        let paths = &self.paths;
        let override_cmd = testhooks::sidecar_cmd();
        let core_exe = paths.core_exe();
        // Never act on a stale pid file from a previous run.
        let expected = match &override_cmd {
            Some(c) => resolve_on_path(&c[0]),
            None => core_exe.clone(),
        };
        stale::kill_stale(&paths.core_pid_file(), &expected);

        let token = spawn::gen_token(32);
        let art_token = spawn::gen_token(16);
        let log_dir = paths.log_dir();
        let _ = std::fs::create_dir_all(&log_dir);
        let shell_pid = std::process::id().to_string();

        let (program, mut args, cwd) = match override_cmd {
            Some(mut c) => {
                let p = c.remove(0);
                (std::ffi::OsString::from(p), c, None)
            }
            None => {
                if !core_exe.exists() {
                    return Err(format!("sidecar not found: {}", core_exe.display()));
                }
                let d = &paths.sidecar_dist;
                (
                    core_exe.clone().into_os_string(),
                    vec![
                        format!("@{}", d.join("core.args").display()),
                        // JVM crash log next to the other logs (not part of core.args).
                        format!("-XX:ErrorFile={}", log_dir.join("hs_err_core_%p.log").display()),
                        "-cp".into(),
                        format!("{}", d.join("lib").join("*").display()),
                        "com.metrolist.core.SidecarMainKt".into(),
                    ],
                    Some(d.clone()),
                )
            }
        };
        args.extend([
            "--parent-pid".into(),
            shell_pid,
            "--log-dir".into(),
            log_dir.display().to_string(),
            "--exe-path".into(),
            core_exe.display().to_string(),
        ]);
        // The sidecar keeps all of its data under the test root when one is in effect.
        // `<root>\Local\MinMusic` keeps the v1 layout (`state\metrolist`, `data`, `cache`) that the shell and the tests expect.
        if paths.test_root.is_some() {
            args.extend(["--data-root".into(), paths.app_local().display().to_string()]);
        }
        args.extend(testhooks::core_extra_args());

        let mut env_overrides = Vec::new();
        if paths.test_root.is_some() {
            env_overrides.push(("LOCALAPPDATA".into(), paths.local_root.display().to_string()));
            env_overrides.push(("APPDATA".into(), paths.roaming_root.display().to_string()));
        }
        let spec = SpawnSpec {
            program,
            args,
            env_overrides,
            cwd,
            log_path: log_dir.join("core-stdout.log"),
            token: token.clone(),
            art_token: art_token.clone(),
        };
        let job_guard = self.job.lock().unwrap();
        let job = if testhooks::no_job() {
            log::warn!("MINMUSIC_TEST_NO_JOB set: the core is NOT assigned to the Job Object");
            None
        } else {
            if job_guard.is_none() {
                log::error!("no Job Object: core runs unprotected (see Settings > Chẩn đoán)");
            }
            job_guard.as_ref()
        };
        let (core, ready) = spawn::spawn(&spec, job)?;
        drop(job_guard);
        log::info!("core READY pid={} port={} version={}", ready.pid, ready.port, ready.version);
        Ok((Arc::new(core), CoreConfig { port: ready.port, token, art_token }))
    }

    fn spawn_exit_watcher(&self, core: Arc<CoreProcess>, gen: u64) {
        let tx = self.ctl.lock().unwrap().clone();
        std::thread::Builder::new()
            .name("core-exit-watch".into())
            .spawn(move || {
                core.wait_exit(u32::MAX);
                let _ = tx.send(Ctl::Exited(gen));
            })
            .ok();
    }

    fn spawn_pinger(&self, cfg: CoreConfig, gen: u64, cancel: Arc<AtomicBool>) {
        let tx = self.ctl.lock().unwrap().clone();
        std::thread::Builder::new()
            .name("core-ping".into())
            .spawn(move || {
                let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().expect("tokio rt");
                let dead = rt.block_on(ping_loop(cfg, cancel.clone()));
                if dead && !cancel.load(Ordering::SeqCst) {
                    let _ = tx.send(Ctl::PingDead(gen));
                }
            })
            .ok();
    }
}

/// Test builds only: `node` becomes the full path of node.exe, so the stale-pid image check works.
fn resolve_on_path(program: &str) -> std::path::PathBuf {
    let p = std::path::PathBuf::from(program);
    if p.is_absolute() {
        return p;
    }
    let name = if p.extension().is_some() { program.to_string() } else { format!("{program}.exe") };
    std::env::var_os("PATH")
        .and_then(|path| std::env::split_paths(&path).map(|d| d.join(&name)).find(|c| c.exists()))
        .unwrap_or(p)
}

/// Returns true when the core is considered dead (3 misses), false when cancelled.
async fn ping_loop(_cfg: CoreConfig, cancel: Arc<AtomicBool>) -> bool {
    let link = crate::corelink::global();
    let mut misses = 0u32;
    let mut tick = tokio::time::interval(PING_INTERVAL);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tick.tick().await;
        if cancel.load(Ordering::SeqCst) {
            return false;
        }
        // The shell WS connection (role `shell`) is owned by corelink; ping goes through it.
        let ok = link.call_timeout("sys.ping", serde_json::json!({}), Duration::from_secs(4)).await;
        if cancel.load(Ordering::SeqCst) {
            return false;
        }
        match ok {
            Ok(_) => misses = 0,
            Err(e) => {
                misses += 1;
                log::warn!("core ping miss {misses}/{PING_MISSES}: {}", e.msg);
                if misses >= PING_MISSES {
                    return true;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backoff_schedule() {
        assert_eq!(backoff(1), Duration::from_millis(500));
        assert_eq!(backoff(2), Duration::from_secs(2));
        assert_eq!(backoff(3), Duration::from_secs(5));
        assert_eq!(backoff(9), Duration::from_secs(5));
    }

    #[test]
    fn three_crashes_in_120s_fail() {
        let t0 = Instant::now();
        let mut t = CrashTracker::default();
        assert_eq!(t.record(t0), Decision::Restart(Duration::from_millis(500)));
        assert_eq!(t.record(t0 + Duration::from_secs(10)), Decision::Restart(Duration::from_secs(2)));
        assert_eq!(t.record(t0 + Duration::from_secs(20)), Decision::Fail);
    }

    #[test]
    fn old_crashes_expire() {
        let t0 = Instant::now();
        let mut t = CrashTracker::default();
        t.record(t0);
        t.record(t0 + Duration::from_secs(30));
        // 130 s after the first one: the first has left the window, so this is crash #2 again.
        assert_eq!(t.record(t0 + Duration::from_secs(130)), Decision::Restart(Duration::from_secs(2)));
        // The window is inclusive at exactly 120 s.
        let mut t = CrashTracker::default();
        t.record(t0);
        t.record(t0 + Duration::from_secs(60));
        assert_eq!(t.record(t0 + Duration::from_secs(120)), Decision::Fail);
    }

    #[test]
    fn clear_resets() {
        let t0 = Instant::now();
        let mut t = CrashTracker::default();
        t.record(t0);
        t.record(t0);
        t.clear();
        assert_eq!(t.record(t0), Decision::Restart(Duration::from_millis(500)));
    }

    #[test]
    fn status_serialises_for_the_ui() {
        let s = CoreStatus { state: CoreState::Restarting, restarts: 2, last_error: Some("x".into()) };
        assert_eq!(serde_json::to_string(&s).unwrap(), r#"{"state":"restarting","restarts":2,"lastError":"x"}"#);
        let c = CoreConfig { port: 1, token: "t".into(), art_token: "a".into() };
        assert_eq!(serde_json::to_string(&c).unwrap(), r#"{"port":1,"token":"t","artToken":"a"}"#);
    }
}
