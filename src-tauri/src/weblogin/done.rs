//! Pure done-condition evaluator, the cookie header builder and the `allowedHosts` matcher.
//! No I/O and no WebView2 here, so everything is unit tested.
use super::types::DoneCfg;
use serde_json::Value;
use std::collections::HashMap;

/// JavaScript-like truthiness of a parsed `ExecuteScript` result.
pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0 && !f.is_nan()),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// Is the login finished?
/// - `navPrefix` is an independent shortcut: the current URL starts with it.
/// - Otherwise every *specified* condition among `cookies` (any listed name present with a value) and
///   `script` (truthy result) must hold. Nothing specified means "never done" (the user cancels or it times out).
pub fn evaluate(cfg: &DoneCfg, cookies: &HashMap<String, String>, script: Option<&Value>, url: &str) -> bool {
    if let Some(p) = cfg.nav_prefix.as_deref().filter(|p| !p.is_empty()) {
        if url.starts_with(p) {
            return true;
        }
    }
    let mut specified = false;
    if let Some(c) = cfg.cookies.as_ref().filter(|c| !c.names.is_empty()) {
        specified = true;
        if !c.names.iter().any(|n| cookies.get(n).is_some_and(|v| !v.is_empty())) {
            return false;
        }
    }
    if cfg.script.as_deref().is_some_and(|s| !s.is_empty()) {
        specified = true;
        if !script.is_some_and(truthy) {
            return false;
        }
    }
    specified
}

/// `name=value; name2=value2`. Names listed in `order` come first (request order, only those present),
/// then the remaining cookies in their original order.
pub fn build_cookie_header(order: &[String], cookies: &[(String, String)]) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut used = vec![false; cookies.len()];
    for n in order {
        if let Some(i) = cookies.iter().position(|(k, _)| k == n) {
            if !used[i] {
                used[i] = true;
                parts.push(format!("{}={}", cookies[i].0, cookies[i].1));
            }
        }
    }
    for (i, (k, v)) in cookies.iter().enumerate() {
        if !used[i] {
            parts.push(format!("{k}={v}"));
        }
    }
    parts.join("; ")
}

/// Splits `scheme://authority/...` into lower-case `(scheme, host)`. Handles userinfo, ports, IPv6 and
/// backslashes (browsers treat `\` as `/`), so `https://good.com@evil.com/` has the host `evil.com`.
pub fn scheme_host(url: &str) -> Option<(String, String)> {
    let (scheme, rest) = url.split_once("://")?;
    let end = rest.find(['/', '\\', '?', '#']).unwrap_or(rest.len());
    let auth = &rest[..end];
    let auth = auth.rsplit_once('@').map_or(auth, |(_, h)| h);
    let host = if let Some(stripped) = auth.strip_prefix('[') {
        stripped.split(']').next()?.to_string()
    } else {
        auth.split(':').next()?.to_string()
    };
    if host.is_empty() {
        return None;
    }
    Some((scheme.to_ascii_lowercase(), host.to_ascii_lowercase()))
}

/// Top-frame navigation policy: only `http(s)` URLs whose host equals an allowed host or is a subdomain of it.
/// `about:blank` is allowed (initial and in-page blank documents).
pub fn host_allowed(url: &str, allowed: &[String]) -> bool {
    if url == "about:blank" {
        return true;
    }
    let Some((scheme, host)) = scheme_host(url) else { return false };
    if scheme != "http" && scheme != "https" {
        return false;
    }
    allowed.iter().any(|a| {
        let a = a.trim().to_ascii_lowercase();
        let a = match scheme_host(&a) {
            Some((_, h)) => h,
            None => a.trim_start_matches("*.").trim_start_matches('.').to_string(),
        };
        !a.is_empty() && (host == a || host.ends_with(&format!(".{a}")))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::weblogin::types::{CookieCond, WebLoginRequest};
    use serde_json::json;

    fn cfg(names: &[&str], nav: Option<&str>, script: Option<&str>) -> DoneCfg {
        DoneCfg {
            cookies: if names.is_empty() {
                None
            } else {
                Some(CookieCond { names: names.iter().map(|s| s.to_string()).collect(), urls: vec![] })
            },
            nav_prefix: nav.map(String::from),
            script: script.map(String::from),
        }
    }
    fn ck(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect()
    }

    #[test]
    fn cookie_any_of() {
        let c = cfg(&["SAPISID", "__Secure-3PAPISID"], None, None);
        assert!(!evaluate(&c, &ck(&[]), None, "https://x"));
        assert!(!evaluate(&c, &ck(&[("other", "1")]), None, "https://x"));
        assert!(!evaluate(&c, &ck(&[("SAPISID", "")]), None, "https://x"));
        assert!(evaluate(&c, &ck(&[("__Secure-3PAPISID", "v")]), None, "https://x"));
    }

    #[test]
    fn nav_prefix_is_independent() {
        let c = cfg(&["a"], Some("metrolist-auth://discord/callback"), Some("1"));
        assert!(evaluate(&c, &ck(&[]), None, "metrolist-auth://discord/callback?code=1"));
        assert!(!evaluate(&c, &ck(&[]), None, "https://discord.com/oauth2"));
        assert!(!evaluate(&cfg(&[], Some(""), None), &ck(&[]), None, "anything"));
    }

    #[test]
    fn script_truthiness() {
        let c = cfg(&[], None, Some("x"));
        for (v, want) in [
            (json!(null), false),
            (json!(false), false),
            (json!(0), false),
            (json!(""), false),
            (json!(true), true),
            (json!(1), true),
            (json!("a"), true),
            (json!({}), true),
            (json!([]), true),
        ] {
            assert_eq!(evaluate(&c, &ck(&[]), Some(&v), ""), want, "{v}");
        }
        assert!(!evaluate(&c, &ck(&[]), None, ""));
    }

    #[test]
    fn cookie_and_script_must_both_hold() {
        let c = cfg(&["sid"], None, Some("x"));
        assert!(!evaluate(&c, &ck(&[("sid", "1")]), Some(&json!(false)), ""));
        assert!(!evaluate(&c, &ck(&[]), Some(&json!(true)), ""));
        assert!(evaluate(&c, &ck(&[("sid", "1")]), Some(&json!({"v": 1})), ""));
    }

    #[test]
    fn nothing_specified_never_done() {
        assert!(!evaluate(&DoneCfg::default(), &ck(&[("a", "1")]), Some(&json!(true)), "u"));
    }

    #[test]
    fn cookie_header_order() {
        let cookies = vec![
            ("b".to_string(), "2".to_string()),
            ("a".to_string(), "1".to_string()),
            ("z".to_string(), "9".to_string()),
        ];
        let order = vec!["a".to_string(), "missing".to_string(), "b".to_string(), "a".to_string()];
        assert_eq!(build_cookie_header(&order, &cookies), "a=1; b=2; z=9");
        assert_eq!(build_cookie_header(&[], &cookies), "b=2; a=1; z=9");
        assert_eq!(build_cookie_header(&order, &[]), "");
    }

    #[test]
    fn hosts() {
        let a = vec!["google.com".to_string(), "accounts.youtube.com".to_string()];
        assert!(host_allowed("https://accounts.google.com/x", &a));
        assert!(host_allowed("https://google.com", &a));
        assert!(host_allowed("http://GOOGLE.com:8080/p?q=1", &a));
        assert!(host_allowed("https://accounts.youtube.com/", &a));
        assert!(!host_allowed("https://www.youtube.com/", &a));
        assert!(!host_allowed("https://evilgoogle.com/", &a));
        assert!(!host_allowed("https://google.com.evil.org/", &a));
        assert!(!host_allowed("https://google.com@evil.org/", &a));
        assert!(!host_allowed("https://evil.org\\@google.com/", &a));
        assert!(!host_allowed("https://evil.org/?u=google.com", &a));
        assert!(!host_allowed("file:///c:/x", &a));
        assert!(!host_allowed("javascript:alert(1)", &a));
        assert!(!host_allowed("metrolist-auth://google.com/cb", &a));
        assert!(host_allowed("about:blank", &a));
        assert!(host_allowed("https://a.b.google.com/", &["*.google.com".into()]));
        assert!(host_allowed("http://127.0.0.1:5000/login.html", &["127.0.0.1".into()]));
        assert!(host_allowed("http://[::1]:5000/", &["::1".into()]));
        assert!(!host_allowed("https://google.com/", &[]));
    }

    #[test]
    fn request_serde_all_fields_and_unknown_tolerance() {
        let v = json!({
            "url": "https://accounts.google.com/", "allowedHosts": ["google.com"], "userAgent": "UA", "title": "T", "banner": "B",
            "window": {"w": 800, "h": 600, "maximizable": false, "future": 1},
            "done": {"cookies": {"names": ["a", "b"], "urls": ["https://x"]}, "navPrefix": "m://", "script": "1", "x": 1},
            "collect": {"cookieUrls": ["https://x"], "script": "2"},
            "timeoutMs": 5000, "unknownTop": {"a": 1}
        });
        let r: WebLoginRequest = serde_json::from_value(v).unwrap();
        assert_eq!(r.url, "https://accounts.google.com/");
        assert_eq!(r.allowed_hosts, vec!["google.com"]);
        assert_eq!(r.user_agent.as_deref(), Some("UA"));
        assert_eq!((r.title.as_str(), r.banner.as_deref()), ("T", Some("B")));
        assert_eq!((r.window.w, r.window.h, r.window.maximizable), (800.0, 600.0, false));
        let c = r.done.cookies.unwrap();
        assert_eq!((c.names, c.urls), (vec!["a".to_string(), "b".to_string()], vec!["https://x".to_string()]));
        assert_eq!((r.done.nav_prefix.as_deref(), r.done.script.as_deref()), (Some("m://"), Some("1")));
        assert_eq!(r.collect.cookie_urls, vec!["https://x"]);
        assert_eq!(r.collect.script.as_deref(), Some("2"));
        assert_eq!(r.timeout_ms, Some(5000));
    }

    #[test]
    fn request_minimal() {
        let r: WebLoginRequest = serde_json::from_value(json!({"url": "https://a"})).unwrap();
        assert!(r.done.cookies.is_none() && r.timeout_ms.is_none() && r.collect.cookie_urls.is_empty());
    }
}
