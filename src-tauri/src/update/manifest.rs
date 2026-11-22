//! The `latest.json` contract written by `scripts/make-latest-json.mjs` and read by the updater
//! plugin (static format). Only the pieces the shell itself needs live here: the optional download
//! size (the plugin ignores unknown fields; they stay available in `Update::raw_json`) and a
//! validator that tests use to guard the file the release job publishes.
use serde_json::Value;

pub const TARGET: &str = "windows-x86_64";

/// `platforms["windows-x86_64"].size` (bytes), written by make-latest-json.
pub fn size_of(raw: &Value) -> Option<u64> {
    raw.get("platforms")?.get(TARGET)?.get("size")?.as_u64().or_else(|| raw.get("size")?.as_u64())
}

#[cfg(test)]
pub fn validate(raw: &Value) -> Result<(), String> {
    let v = raw.get("version").and_then(Value::as_str).ok_or("version missing")?;
    if super::version::Ver::parse(v).is_none() {
        return Err(format!("version {v:?} is not semver"));
    }
    raw.get("pub_date").and_then(Value::as_str).filter(|d| d.contains('T')).ok_or("pub_date missing or not RFC 3339")?;
    let p = raw.get("platforms").and_then(|p| p.get(TARGET)).ok_or("platform windows-x86_64 missing")?;
    let url = p.get("url").and_then(Value::as_str).ok_or("url missing")?;
    if !url.starts_with("https://github.com/nev-minhnh/MinMusic_For_Windows/releases/download/") {
        return Err(format!("url {url:?} does not point at this repo's releases"));
    }
    p.get("signature").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("signature missing")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        let p = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("tests").join("fixtures").join("updater").join("latest.json");
        serde_json::from_slice(&std::fs::read(p).expect("fixture latest.json")).expect("valid json")
    }

    #[test]
    fn fixture_is_a_valid_latest_json() {
        let f = fixture();
        validate(&f).unwrap();
        assert_eq!(size_of(&f), Some(73400320));
    }

    #[test]
    fn validator_rejects_foreign_hosts_and_missing_parts() {
        let mut f = fixture();
        f["platforms"][TARGET]["url"] = json!("https://evil.example/x.exe");
        assert!(validate(&f).is_err());
        let mut f = fixture();
        f["platforms"][TARGET]["signature"] = json!("");
        assert!(validate(&f).is_err());
        let mut f = fixture();
        f["platforms"] = json!({});
        assert!(validate(&f).is_err());
        assert_eq!(size_of(&json!({})), None);
    }
}
