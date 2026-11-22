//! Request types of `shell.webLogin` (api.md section 5). Unknown fields are ignored (no `deny_unknown_fields`),
//! so a newer core never breaks an older shell.
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CookieCond {
    pub names: Vec<String>,
    pub urls: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DoneCfg {
    pub cookies: Option<CookieCond>,
    pub nav_prefix: Option<String>,
    pub script: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct CollectCfg {
    pub cookie_urls: Vec<String>,
    pub script: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct WindowCfg {
    pub w: f64,
    pub h: f64,
    pub maximizable: bool,
}

impl Default for WindowCfg {
    fn default() -> Self {
        WindowCfg { w: 900.0, h: 700.0, maximizable: false }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct WebLoginRequest {
    pub url: String,
    pub allowed_hosts: Vec<String>,
    pub user_agent: Option<String>,
    pub title: String,
    pub banner: Option<String>,
    pub window: WindowCfg,
    pub done: DoneCfg,
    pub collect: CollectCfg,
    pub timeout_ms: Option<u64>,
}
