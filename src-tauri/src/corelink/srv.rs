//! Core -> shell requests (api.md 1.2 `SrvReq`). Other WPs register their methods here.
use serde_json::Value;
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send + 'static>>;

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct ApiError {
    pub code: String,
    #[serde(default)]
    pub msg: String,
    #[serde(default)]
    pub retryable: bool,
}

impl ApiError {
    pub fn new(code: &str, msg: impl Into<String>) -> Self {
        ApiError { code: code.into(), msg: msg.into(), retryable: false }
    }
}

pub type Handler = Arc<dyn Fn(Value) -> BoxFuture<Result<Value, ApiError>> + Send + Sync>;

fn registry() -> &'static Mutex<HashMap<String, Handler>> {
    static R: OnceLock<Mutex<HashMap<String, Handler>>> = OnceLock::new();
    R.get_or_init(Default::default)
}

/// Registers the handler of a core -> shell method such as `shell.focusMain`.
pub fn register(method: &str, handler: Handler) {
    registry().lock().unwrap().insert(method.to_string(), handler);
}

pub fn lookup(method: &str) -> Option<Handler> {
    registry().lock().unwrap().get(method).cloned()
}

/// Runs the handler of `m`; unknown methods answer `unsupported`.
pub async fn dispatch(m: &str, p: Value) -> Result<Value, ApiError> {
    match lookup(m) {
        Some(h) => h(p).await,
        None => Err(ApiError::new("unsupported", format!("{m} is not implemented in this shell"))),
    }
}
