//! Resolves the sidecar dist, the data roots and the log dir.
use crate::testhooks;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct Paths {
    /// `<dist>` holding `runtime\bin\minmusic-core.exe`, `lib\`, `core.args`.
    pub sidecar_dist: PathBuf,
    /// Value of `LOCALAPPDATA` for the shell and the core (the real one unless a test root is set).
    pub local_root: PathBuf,
    /// Value of `APPDATA`.
    pub roaming_root: PathBuf,
    /// Set when `MINMUSIC_DATA_ROOT` is in effect.
    pub test_root: Option<PathBuf>,
}

impl Paths {
    pub fn resolve() -> Paths {
        let test_root = testhooks::data_root();
        let (local_root, roaming_root) = match &test_root {
            Some(r) => (r.join("Local"), r.join("Roaming")),
            None => (
                std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_default(),
                std::env::var_os("APPDATA").map(PathBuf::from).unwrap_or_default(),
            ),
        };
        Paths { sidecar_dist: resolve_dist(), local_root, roaming_root, test_root }
    }
    pub fn app_local(&self) -> PathBuf {
        self.local_root.join("MinMusic")
    }
    /// `%LOCALAPPDATA%\MinMusic\state\metrolist`
    pub fn state_dir(&self) -> PathBuf {
        self.app_local().join("state").join("metrolist")
    }
    pub fn log_dir(&self) -> PathBuf {
        self.state_dir().join("logs")
    }
    pub fn core_pid_file(&self) -> PathBuf {
        self.state_dir().join("core.pid")
    }
    pub fn webview_dir(&self) -> PathBuf {
        self.app_local().join("webview2-ui")
    }
    pub fn core_exe(&self) -> PathBuf {
        self.sidecar_dist.join("runtime").join("bin").join("minmusic-core.exe")
    }
}

fn resolve_dist() -> PathBuf {
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf));
    if let Some(d) = exe_dir.as_ref().map(|d| d.join("core")) {
        if d.join("runtime").exists() {
            return d;
        }
    }
    // Dev and e2e builds: `<repo>/sidecar/dist`.
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("sidecar").join("dist");
    if let Ok(c) = repo.canonicalize() {
        return strip_verbatim(c);
    }
    exe_dir.map(|d| d.join("core")).unwrap_or(repo)
}

/// `\\?\C:\x` becomes `C:\x` (the JVM and CreateProcess are happier without the verbatim prefix).
pub fn strip_verbatim(p: PathBuf) -> PathBuf {
    match p.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(s) if !s.starts_with("UNC") => PathBuf::from(s),
        _ => p,
    }
}

/// FNV-1a 64-bit hash.
pub fn fnv64(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in data {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Single-instance key (architecture section 10): the identifier, or a hashed variant under a test data root.
pub fn instance_key(identifier: &str, test_root: Option<&Path>) -> String {
    match test_root {
        None => identifier.to_string(),
        Some(r) => {
            let norm = r.to_string_lossy().replace('/', "\\").to_lowercase();
            format!("{identifier}.test-{:016x}", fnv64(norm.trim_end_matches('\\').as_bytes()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fnv_known_vectors() {
        assert_eq!(fnv64(b""), 0xcbf29ce484222325);
        assert_eq!(fnv64(b"a"), 0xaf63dc4c8601ec8c);
        assert_eq!(fnv64(b"foobar"), 0x85944171f73967e8);
    }
    #[test]
    fn instance_key_derivation() {
        assert_eq!(instance_key("nev-minhnh.MinMusic", None), "nev-minhnh.MinMusic");
        let a = instance_key("nev-minhnh.MinMusic", Some(Path::new(r"D:\x\.testdata\r1")));
        let b = instance_key("nev-minhnh.MinMusic", Some(Path::new("D:/x/.testdata/R1/")));
        let c = instance_key("nev-minhnh.MinMusic", Some(Path::new(r"D:\x\.testdata\r2")));
        assert!(a.starts_with("nev-minhnh.MinMusic.test-"));
        assert_eq!(a, b, "case, slash and trailing separator do not matter");
        assert_ne!(a, c);
        assert_eq!(a.len(), "nev-minhnh.MinMusic.test-".len() + 16);
    }
    #[test]
    fn verbatim() {
        assert_eq!(strip_verbatim(PathBuf::from(r"\\?\C:\x")), PathBuf::from(r"C:\x"));
        assert_eq!(strip_verbatim(PathBuf::from(r"C:\x")), PathBuf::from(r"C:\x"));
    }
}
