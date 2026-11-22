//! Spawns the core: CreateProcessW suspended, assigned to the Job Object, then resumed.
//! The token goes over stdin, never on argv. Stdout and stderr share one pipe.
use super::job::JobObject;
use serde::Deserialize;
use std::ffi::{c_void, OsStr, OsString};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::FromRawHandle;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::*;
use windows::Win32::Security::SECURITY_ATTRIBUTES;
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::*;

pub const READY_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct Ready {
    pub port: u16,
    pub pid: u32,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub protocol: u32,
}

/// Parses `READY {"port":..,"pid":..,"version":"..","protocol":1}`.
pub fn parse_ready(line: &str) -> Option<Ready> {
    let rest = line.trim().strip_prefix("READY")?;
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    serde_json::from_str(rest.trim()).ok()
}

/// 64 lowercase hex characters from the OS CSPRNG (256 bit).
pub fn gen_token(bytes: usize) -> String {
    use rand::{rngs::OsRng, RngCore};
    let mut b = vec![0u8; bytes];
    OsRng.fill_bytes(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// The first stdin line: `{"token":"<64 hex>","artToken":"<32 hex>","protocol":1}`.
pub fn hello_line(token: &str, art_token: &str) -> String {
    serde_json::json!({"token": token, "artToken": art_token, "protocol": 1}).to_string()
}

pub struct ProcHandle(pub HANDLE);
unsafe impl Send for ProcHandle {}
unsafe impl Sync for ProcHandle {}
impl Drop for ProcHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

pub struct CoreProcess {
    pub pid: u32,
    pub process: Arc<ProcHandle>,
    stdin: Mutex<Option<File>>,
}

impl CoreProcess {
    pub fn send_line(&self, line: &str) -> std::io::Result<()> {
        let mut g = self.stdin.lock().unwrap();
        match g.as_mut() {
            Some(f) => {
                f.write_all(line.as_bytes())?;
                f.write_all(b"\n")?;
                f.flush()
            }
            None => Err(std::io::Error::new(std::io::ErrorKind::BrokenPipe, "stdin closed")),
        }
    }
    pub fn terminate(&self) {
        unsafe {
            let _ = TerminateProcess(self.process.0, 1);
        }
    }
    /// Waits up to `ms` for exit. Returns true when the process has exited.
    pub fn wait_exit(&self, ms: u32) -> bool {
        unsafe { WaitForSingleObject(self.process.0, ms) == WAIT_OBJECT_0 }
    }
}

pub struct SpawnSpec {
    /// Program. When it has no extension and is not a path, the OS searches PATH (`node`).
    pub program: OsString,
    pub args: Vec<String>,
    pub env_overrides: Vec<(String, String)>,
    pub cwd: Option<PathBuf>,
    pub log_path: PathBuf,
    pub token: String,
    pub art_token: String,
}

pub fn quote_arg(a: &str) -> String {
    if !a.is_empty() && !a.contains([' ', '\t', '"']) {
        return a.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0usize;
    for c in a.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            c => {
                out.push_str(&"\\".repeat(backslashes));
                backslashes = 0;
                out.push(c);
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

fn wide(s: &OsStr) -> Vec<u16> {
    s.encode_wide().chain(std::iter::once(0)).collect()
}

fn env_block(overrides: &[(String, String)]) -> Vec<u16> {
    let mut vars: Vec<(String, String)> = std::env::vars_os()
        .map(|(k, v)| (k.to_string_lossy().into_owned(), v.to_string_lossy().into_owned()))
        .filter(|(k, _)| !k.is_empty() && !overrides.iter().any(|(o, _)| o.eq_ignore_ascii_case(k)))
        .collect();
    vars.extend(overrides.iter().cloned());
    vars.sort_by_key(|(k, _)| k.to_uppercase());
    let mut b: Vec<u16> = Vec::new();
    for (k, v) in vars {
        b.extend(OsStr::new(&format!("{k}={v}")).encode_wide());
        b.push(0);
    }
    b.push(0);
    b
}

pub fn spawn(spec: &SpawnSpec, job: Option<&JobObject>) -> Result<(CoreProcess, Ready), String> {
    if let Some(dir) = spec.log_path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    unsafe {
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: true.into(),
        };
        let (mut in_r, mut in_w, mut out_r, mut out_w) =
            (HANDLE::default(), HANDLE::default(), HANDLE::default(), HANDLE::default());
        CreatePipe(&mut in_r, &mut in_w, Some(&sa), 0).map_err(|e| format!("CreatePipe(stdin): {e}"))?;
        CreatePipe(&mut out_r, &mut out_w, Some(&sa), 0).map_err(|e| format!("CreatePipe(stdout): {e}"))?;
        // Parent ends must not be inherited, otherwise the core would keep its own stdin open.
        let _ = SetHandleInformation(in_w, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0));
        let _ = SetHandleInformation(out_r, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0));

        let mut si = STARTUPINFOW::default();
        si.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        si.dwFlags = STARTF_USESTDHANDLES;
        si.hStdInput = in_r;
        si.hStdOutput = out_w;
        si.hStdError = out_w;

        let mut cmdline = quote_arg(&spec.program.to_string_lossy());
        for a in &spec.args {
            cmdline.push(' ');
            cmdline.push_str(&quote_arg(a));
        }
        let mut cmd_w = wide(OsStr::new(&cmdline));
        let env = env_block(&spec.env_overrides);
        let cwd_w = spec.cwd.as_ref().map(|c| wide(c.as_os_str()));
        let mut pi = PROCESS_INFORMATION::default();

        let created = CreateProcessW(
            PCWSTR::null(),
            Some(PWSTR(cmd_w.as_mut_ptr())),
            None,
            None,
            true,
            CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT,
            Some(env.as_ptr() as *const c_void),
            cwd_w.as_ref().map(|w| PCWSTR(w.as_ptr())).unwrap_or(PCWSTR::null()),
            &si,
            &mut pi,
        );
        // The child owns its ends now; close ours.
        let _ = CloseHandle(in_r);
        let _ = CloseHandle(out_w);
        if let Err(e) = created {
            let _ = CloseHandle(in_w);
            let _ = CloseHandle(out_r);
            return Err(format!("CreateProcessW({cmdline}): {e}"));
        }

        let proc = Arc::new(ProcHandle(pi.hProcess));
        let stdin = File::from_raw_handle(in_w.0);
        let stdout = File::from_raw_handle(out_r.0);

        if let Some(j) = job {
            if let Err(e) = j.assign(pi.hProcess) {
                // Never run an unassigned core: it could outlive us.
                let _ = TerminateProcess(pi.hProcess, 1);
                let _ = CloseHandle(pi.hThread);
                return Err(format!("job assignment failed, core not started: {e}"));
            }
        }
        if ResumeThread(pi.hThread) == u32::MAX {
            let _ = TerminateProcess(pi.hProcess, 1);
            let _ = CloseHandle(pi.hThread);
            return Err("ResumeThread failed".into());
        }
        let _ = CloseHandle(pi.hThread);

        let core = CoreProcess { pid: pi.dwProcessId, process: proc, stdin: Mutex::new(Some(stdin)) };

        // Reader thread: first READY line goes to the channel, everything goes to the log.
        let (tx, rx) = mpsc::channel::<Result<Ready, String>>();
        let log_path = spec.log_path.clone();
        std::thread::Builder::new()
            .name("core-stdout".into())
            .spawn(move || pump_output(stdout, &log_path, tx))
            .ok();

        if let Err(e) = core.send_line(&hello_line(&spec.token, &spec.art_token)) {
            core.terminate();
            return Err(format!("writing the token to the core failed: {e}"));
        }
        match rx.recv_timeout(READY_TIMEOUT) {
            Ok(Ok(r)) => Ok((core, r)),
            Ok(Err(e)) => {
                core.terminate();
                Err(e)
            }
            Err(_) => {
                core.terminate();
                Err(format!("no READY line within {} s", READY_TIMEOUT.as_secs()))
            }
        }
    }
}

fn pump_output(stdout: File, log_path: &Path, tx: mpsc::Sender<Result<Ready, String>>) {
    let mut log = OpenOptions::new().create(true).append(true).open(log_path).ok();
    let mut reader = BufReader::new(stdout);
    let mut buf = Vec::new();
    let mut announced = false;
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let line = String::from_utf8_lossy(&buf).trim_end().to_string();
        if let Some(l) = log.as_mut() {
            let _ = writeln!(l, "{line}");
        }
        if !announced {
            if let Some(r) = parse_ready(&line) {
                announced = true;
                let _ = tx.send(Ok(r));
            }
        }
    }
    if !announced {
        let _ = tx.send(Err("core exited before READY".into()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_parser() {
        let r = parse_ready(r#"READY {"port":51234,"pid":4242,"version":"2.0.0-alpha.0","protocol":1}"#).unwrap();
        assert_eq!(r, Ready { port: 51234, pid: 4242, version: "2.0.0-alpha.0".into(), protocol: 1 });
        assert!(parse_ready("READY\r\n").is_none());
        assert!(parse_ready("READY{\"port\":1,\"pid\":1}").is_none());
        assert!(parse_ready("WARNING: something").is_none());
        assert!(parse_ready(r#"READY {"port":70000,"pid":1}"#).is_none(), "port out of u16 range");
        assert!(parse_ready(r#"READY {"port":1,"pid":2}"#).is_some(), "version and protocol optional");
        assert!(parse_ready("  READY {\"port\":1,\"pid\":2}\r\n").is_some());
    }

    #[test]
    fn token_is_64_hex_and_unique() {
        let a = gen_token(32);
        let b = gen_token(32);
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_ne!(a, b);
        assert_eq!(gen_token(16).len(), 32);
    }

    #[test]
    fn hello_line_shape() {
        let l = hello_line(&"a".repeat(64), &"b".repeat(32));
        let v: serde_json::Value = serde_json::from_str(&l).unwrap();
        assert_eq!(v["token"].as_str().unwrap().len(), 64);
        assert_eq!(v["artToken"].as_str().unwrap().len(), 32);
        assert_eq!(v["protocol"], 1);
        assert!(!l.contains('\n'));
    }

    #[test]
    fn quoting() {
        assert_eq!(quote_arg("abc"), "abc");
        assert_eq!(quote_arg("a b"), "\"a b\"");
        assert_eq!(quote_arg(r"C:\a b\"), r#""C:\a b\\""#);
        assert_eq!(quote_arg(r#"x"y"#), r#""x\"y""#);
        assert_eq!(quote_arg(""), "\"\"");
        assert_eq!(quote_arg(r"C:\dist\lib\*"), r"C:\dist\lib\*");
    }
}
