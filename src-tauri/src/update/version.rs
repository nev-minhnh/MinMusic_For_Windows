//! Semver comparison (pre-releases included) and the update channel rule.
//! The updater plugin hands us versions as strings; `semver` is not a direct dependency, so this is
//! a small, fully tested implementation of the semver 2.0 precedence rules.
use std::cmp::Ordering;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Channel {
    /// Only final releases (no pre-release suffix).
    Stable,
    /// Final releases and pre-releases (`2.1.0-beta.1`).
    Prerelease,
}

impl Channel {
    /// The `updateChannel` setting: empty or `stable` means stable, anything else opts into pre-releases.
    pub fn from_setting(s: &str) -> Channel {
        match s.trim().to_ascii_lowercase().as_str() {
            "" | "stable" | "release" => Channel::Stable,
            _ => Channel::Prerelease,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Channel::Stable => "stable",
            Channel::Prerelease => "prerelease",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Ident {
    Num(u64),
    Text(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ver {
    core: [u64; 3],
    pre: Vec<Ident>,
}

impl Ver {
    /// Parses `1.2.3`, `v1.2.3`, `1.2.3-beta.1`, `1.2.3+build` (build metadata is ignored).
    pub fn parse(s: &str) -> Option<Ver> {
        let s = s.trim().trim_start_matches('v');
        let s = s.split('+').next()?;
        let (core, pre) = match s.split_once('-') {
            Some((c, p)) => (c, Some(p)),
            None => (s, None),
        };
        let mut it = core.split('.');
        let mut nums = [0u64; 3];
        for n in nums.iter_mut() {
            *n = it.next()?.parse().ok()?;
        }
        if it.next().is_some() {
            return None;
        }
        let pre = match pre {
            None => Vec::new(),
            Some(p) => {
                let mut out = Vec::new();
                for part in p.split('.') {
                    if part.is_empty() {
                        return None;
                    }
                    out.push(match part.parse::<u64>() {
                        Ok(n) => Ident::Num(n),
                        Err(_) => Ident::Text(part.to_string()),
                    });
                }
                out
            }
        };
        Some(Ver { core: nums, pre })
    }

    pub fn is_prerelease(&self) -> bool {
        !self.pre.is_empty()
    }
}

impl Ord for Ver {
    fn cmp(&self, o: &Self) -> Ordering {
        self.core.cmp(&o.core).then_with(|| match (self.pre.is_empty(), o.pre.is_empty()) {
            (true, true) => Ordering::Equal,
            (true, false) => Ordering::Greater, // 1.0.0 > 1.0.0-rc.1
            (false, true) => Ordering::Less,
            (false, false) => {
                for (a, b) in self.pre.iter().zip(o.pre.iter()) {
                    let c = match (a, b) {
                        (Ident::Num(x), Ident::Num(y)) => x.cmp(y),
                        (Ident::Num(_), Ident::Text(_)) => Ordering::Less,
                        (Ident::Text(_), Ident::Num(_)) => Ordering::Greater,
                        (Ident::Text(x), Ident::Text(y)) => x.cmp(y),
                    };
                    if c != Ordering::Equal {
                        return c;
                    }
                }
                self.pre.len().cmp(&o.pre.len())
            }
        })
    }
}
impl PartialOrd for Ver {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

/// Is `remote` an update for `current` on this channel? Unparsable versions never update.
pub fn is_newer(current: &str, remote: &str, channel: Channel) -> bool {
    let (Some(c), Some(r)) = (Ver::parse(current), Ver::parse(remote)) else {
        return false;
    };
    if r.is_prerelease() && channel == Channel::Stable {
        return false;
    }
    r > c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn precedence_follows_semver() {
        let order = [
            "1.0.0-alpha",
            "1.0.0-alpha.1",
            "1.0.0-alpha.beta",
            "1.0.0-beta",
            "1.0.0-beta.2",
            "1.0.0-beta.11",
            "1.0.0-rc.1",
            "1.0.0",
            "1.0.1",
            "1.1.0",
            "2.0.0",
        ];
        for w in order.windows(2) {
            assert!(Ver::parse(w[0]).unwrap() < Ver::parse(w[1]).unwrap(), "{} < {}", w[0], w[1]);
        }
    }

    #[test]
    fn build_metadata_and_v_prefix_are_ignored() {
        assert_eq!(Ver::parse("v2.0.1+abc").unwrap(), Ver::parse("2.0.1").unwrap());
    }

    #[test]
    fn rejects_garbage() {
        for s in ["", "2", "2.0", "2.0.x", "1.2.3.4", "1.0.0-", "1.0.0-a..b"] {
            assert!(Ver::parse(s).is_none(), "{s}");
        }
        assert!(!is_newer("2.0.0", "garbage", Channel::Prerelease));
    }

    #[test]
    fn stable_channel_skips_prereleases() {
        assert!(is_newer("2.0.0", "2.0.1", Channel::Stable));
        assert!(!is_newer("2.0.0", "2.1.0-beta.1", Channel::Stable));
        assert!(is_newer("2.0.0", "2.1.0-beta.1", Channel::Prerelease));
        assert!(is_newer("2.1.0-beta.1", "2.1.0-beta.2", Channel::Prerelease));
        assert!(is_newer("2.1.0-beta.2", "2.1.0", Channel::Stable));
    }

    #[test]
    fn same_or_older_is_not_an_update() {
        assert!(!is_newer("2.0.0", "2.0.0", Channel::Stable));
        assert!(!is_newer("2.0.1", "2.0.0", Channel::Prerelease));
        assert!(!is_newer("2.0.0", "2.0.0-rc.1", Channel::Prerelease));
    }

    #[test]
    fn channel_setting_mapping() {
        assert_eq!(Channel::from_setting(""), Channel::Stable);
        assert_eq!(Channel::from_setting(" Stable "), Channel::Stable);
        assert_eq!(Channel::from_setting("prerelease"), Channel::Prerelease);
        assert_eq!(Channel::from_setting("NIGHTLY"), Channel::Prerelease);
    }
}
