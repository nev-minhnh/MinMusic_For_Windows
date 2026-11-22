//! Deep-link entry for `metrolist-auth://` (called by M1-4's deep-link handler).
use super::pending;

/// Completes the pending login whose `navPrefix` matches `url` (Discord OAuth callback). Without a pending
/// login, or a matching prefix, the URL is dropped. The URL carries an OAuth code, so it is never logged.
pub fn on_auth_callback(url: &str) {
    match pending() {
        Some(s) if s.complete_nav(url) => log::info!("weblogin: auth callback matched the pending login"),
        Some(_) => log::warn!("weblogin: auth callback did not match the pending navPrefix"),
        None => log::warn!("weblogin: auth callback without a pending login"),
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Shared, PENDING};
    use std::sync::Arc;

    #[test]
    fn matches_prefix_only() {
        let s = Arc::new(Shared::new(Some("metrolist-auth://discord/callback".into())));
        assert!(!s.complete_nav("https://example.com/"));
        assert!(s.nav_final.lock().unwrap().is_none());
        assert!(s.complete_nav("metrolist-auth://discord/callback?code=1"));
        assert_eq!(s.nav_final.lock().unwrap().as_deref(), Some("metrolist-auth://discord/callback?code=1"));
        // the first final URL wins
        assert!(s.complete_nav("metrolist-auth://discord/callback?code=2"));
        assert_eq!(s.nav_final.lock().unwrap().as_deref(), Some("metrolist-auth://discord/callback?code=1"));
        let _ = &PENDING;
    }

    #[test]
    fn no_prefix_never_matches() {
        assert!(!Shared::new(None).complete_nav("anything://x"));
        assert!(!Shared::new(Some(String::new())).complete_nav("anything://x"));
    }
}
