//! Test hooks (architecture section 10). Compiled out of release builds that lack the `e2e` feature.
use std::path::PathBuf;

#[cfg(any(debug_assertions, feature = "e2e"))]
fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}
#[cfg(not(any(debug_assertions, feature = "e2e")))]
fn env(_name: &str) -> Option<String> {
    None
}

/// `MINMUSIC_DATA_ROOT`: redirect all user data.
pub fn data_root() -> Option<PathBuf> {
    env("MINMUSIC_DATA_ROOT").map(PathBuf::from)
}
/// `MINMUSIC_DEVTOOLS_PORT`: remote debugging port for CDP.
pub fn devtools_port() -> Option<u16> {
    env("MINMUSIC_DEVTOOLS_PORT").and_then(|v| v.parse().ok())
}
/// `MINMUSIC_TEST_PIDFILE`: file that receives `{shellPid, corePid}`.
pub fn pidfile() -> Option<PathBuf> {
    env("MINMUSIC_TEST_PIDFILE").map(PathBuf::from)
}
/// `MINMUSIC_TEST_NO_JOB`: skip the Job Object assignment (tests the stdin-EOF safety net).
pub fn no_job() -> bool {
    env("MINMUSIC_TEST_NO_JOB").is_some_and(|v| v != "0")
}
/// `MINMUSIC_CORE_EXTRA_ARGS`: extra sidecar args (whitespace separated).
pub fn core_extra_args() -> Vec<String> {
    env("MINMUSIC_CORE_EXTRA_ARGS")
        .map(|v| v.split_whitespace().map(String::from).collect())
        .unwrap_or_default()
}
/// `MINMUSIC_SIDECAR_CMD`: replaces the sidecar program and its leading arguments,
/// for example `node D:\repo\mock-core\bin\sidecar.mjs`.
pub fn sidecar_cmd() -> Option<Vec<String>> {
    env("MINMUSIC_SIDECAR_CMD")
        .map(|v| split_command(&v))
        .filter(|v| !v.is_empty())
}

/// Splits a command line on whitespace, honouring double quotes.
pub fn split_command(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_q = false;
    let mut has = false;
    for c in s.chars() {
        match c {
            '"' => {
                in_q = !in_q;
                has = true;
            }
            c if c.is_whitespace() && !in_q => {
                if has {
                    out.push(std::mem::take(&mut cur));
                    has = false;
                }
            }
            c => {
                cur.push(c);
                has = true;
            }
        }
    }
    if has {
        out.push(cur);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_quotes() {
        assert_eq!(
            split_command(r#"node "C:\a b\x.mjs" --k"#),
            vec!["node", r"C:\a b\x.mjs", "--k"]
        );
        assert!(split_command("   ").is_empty());
    }
}
