//! corelink: the shell's single WS connection to the core (role `shell`).
//!
//! * `CoreLink::call(m, p)` sends a request and waits for the answer (it waits for the connection too).
//! * `CoreLink::subscribe(topic, cb)` registers an event callback; the subscription is re-opened
//!   after every (re)connect, so a core restart is transparent.
//! * `srv` answers core -> shell requests (`SrvReq`).
//!
//! The supervisor calls `attach` when a core is READY and `detach` when it ends; its state machine
//! is untouched. The supervisor's `sys.ping` also goes through this connection.
pub mod builtin;
pub mod srv;

use crate::sidecar::supervisor::CoreConfig;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
pub use srv::{ApiError, BoxFuture};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot, watch};
use tokio_tungstenite::tungstenite::Message;

pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(15);

/// What the rest of the shell needs from the core. Tests implement it with a mock.
pub trait CoreApi: Send + Sync {
    fn call(&self, m: &str, p: Value) -> BoxFuture<Result<Value, ApiError>>;
}

pub type EvCb = Arc<dyn Fn(&str, &Value) + Send + Sync>;

enum Out {
    Frame(String),
    Subscribe(String),
}
type OutTx = mpsc::UnboundedSender<Out>;

struct Shared {
    gen: AtomicU64,
    next_id: AtomicU64,
    conn: watch::Sender<Option<OutTx>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, ApiError>>>>,
    subs: Mutex<HashMap<String, Vec<EvCb>>>,
    cfg: Mutex<Option<CoreConfig>>,
}

#[derive(Clone)]
pub struct CoreLink {
    sh: Arc<Shared>,
}

/// Runtime for everything that talks to the core from the shell side.
pub fn rt() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("corelink")
            .enable_all()
            .build()
            .expect("corelink runtime")
    })
}

pub fn global() -> &'static CoreLink {
    static G: OnceLock<CoreLink> = OnceLock::new();
    G.get_or_init(CoreLink::new)
}

fn err(code: &str, msg: &str) -> ApiError {
    ApiError::new(code, msg)
}

impl CoreLink {
    fn new() -> CoreLink {
        let (conn, _) = watch::channel(None);
        CoreLink {
            sh: Arc::new(Shared {
                gen: AtomicU64::new(0),
                next_id: AtomicU64::new(2),
                conn,
                pending: Mutex::new(HashMap::new()),
                subs: Mutex::new(HashMap::new()),
                cfg: Mutex::new(None),
            }),
        }
    }

    /// Current core config (port, tokens) while a core is attached; used to build art URLs.
    pub fn config(&self) -> Option<CoreConfig> {
        self.sh.cfg.lock().unwrap().clone()
    }

    /// Supervisor hook: a core became READY. Replaces any previous connection.
    pub fn attach(&self, cfg: CoreConfig) {
        let gen = self.sh.gen.fetch_add(1, Ordering::SeqCst) + 1;
        *self.sh.cfg.lock().unwrap() = Some(cfg.clone());
        self.sh.conn.send_replace(None);
        let sh = self.sh.clone();
        rt().spawn(run_conn(sh, cfg, gen));
    }

    /// Supervisor hook: the core ended.
    pub fn detach(&self) {
        self.sh.gen.fetch_add(1, Ordering::SeqCst);
        *self.sh.cfg.lock().unwrap() = None;
        self.sh.conn.send_replace(None);
        fail_pending(&self.sh);
    }

    pub async fn call(&self, m: &str, p: Value) -> Result<Value, ApiError> {
        self.call_timeout(m, p, DEFAULT_TIMEOUT).await
    }

    pub async fn call_timeout(&self, m: &str, p: Value, limit: Duration) -> Result<Value, ApiError> {
        let deadline = tokio::time::Instant::now() + limit;
        let mut rx = self.sh.conn.subscribe();
        let tx = loop {
            if let Some(t) = rx.borrow_and_update().clone() {
                break t;
            }
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            match tokio::time::timeout(left, rx.changed()).await {
                Ok(Ok(())) => {}
                Ok(Err(_)) => return Err(err("network", "corelink stopped")),
                Err(_) => return Err(err("timeout", "core not connected")),
            }
        };
        let id = self.sh.next_id.fetch_add(1, Ordering::SeqCst);
        let (otx, orx) = oneshot::channel();
        self.sh.pending.lock().unwrap().insert(id, otx);
        let frame = json!({"id": id, "m": m, "p": p}).to_string();
        if tx.send(Out::Frame(frame)).is_err() {
            self.sh.pending.lock().unwrap().remove(&id);
            return Err(err("network", "core connection closed"));
        }
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        match tokio::time::timeout(left, orx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err(err("network", "core connection closed")),
            Err(_) => {
                self.sh.pending.lock().unwrap().remove(&id);
                Err(err("timeout", m))
            }
        }
    }

    /// Registers `cb(event_name, payload)` for a topic (`player`, `settings`, ...). Snapshots arrive as
    /// `<topic>.snapshot` events. Survives core restarts.
    pub fn subscribe(&self, topic: &str, cb: EvCb) {
        let first = {
            let mut subs = self.sh.subs.lock().unwrap();
            let e = subs.entry(topic.to_string()).or_default();
            e.push(cb);
            e.len() == 1
        };
        if first {
            if let Some(tx) = self.sh.conn.borrow().clone() {
                let _ = tx.send(Out::Subscribe(topic.to_string()));
            }
        }
    }
}

impl CoreApi for CoreLink {
    fn call(&self, m: &str, p: Value) -> BoxFuture<Result<Value, ApiError>> {
        let me = self.clone();
        let m = m.to_string();
        Box::pin(async move { CoreLink::call(&me, &m, p).await })
    }
}

fn fail_pending(sh: &Shared) {
    let drained: Vec<_> = sh.pending.lock().unwrap().drain().collect();
    for (_, tx) in drained {
        let _ = tx.send(Err(err("network", "core connection closed")));
    }
}

type Ws = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn run_conn(sh: Arc<Shared>, cfg: CoreConfig, gen: u64) {
    let mut delay = Duration::from_millis(100);
    while sh.gen.load(Ordering::SeqCst) == gen {
        match session(&sh, &cfg, gen).await {
            Ok(()) => delay = Duration::from_millis(100),
            Err(e) => log::debug!("corelink: {e}"),
        }
        if sh.gen.load(Ordering::SeqCst) != gen {
            return;
        }
        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(Duration::from_secs(2));
    }
}

async fn hello(cfg: &CoreConfig) -> Result<Ws, String> {
    let url = format!("ws://127.0.0.1:{}/rpc", cfg.port);
    let (mut ws, _) = tokio::time::timeout(Duration::from_secs(3), tokio_tungstenite::connect_async(url))
        .await
        .map_err(|_| "connect timeout".to_string())?
        .map_err(|e| e.to_string())?;
    let hello = json!({
        "id": 1, "m": "sys.hello",
        "p": {"token": cfg.token, "role": "shell", "protocol": 1, "client": "shell/2.0.0", "locale": "vi"}
    });
    ws.send(Message::Text(hello.to_string().into())).await.map_err(|e| e.to_string())?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(4);
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        let msg = tokio::time::timeout(left, ws.next()).await.map_err(|_| "hello timeout".to_string())?;
        match msg {
            None | Some(Ok(Message::Close(_))) => return Err("closed".into()),
            Some(Err(e)) => return Err(e.to_string()),
            Some(Ok(Message::Text(t))) => {
                let Ok(v) = serde_json::from_str::<Value>(t.as_str()) else { continue };
                if v.get("id").and_then(Value::as_u64) == Some(1) {
                    if v.get("e").is_some() {
                        return Err(format!("sys.hello rejected: {v}"));
                    }
                    return Ok(ws);
                }
            }
            Some(Ok(_)) => {}
        }
    }
}

async fn session(sh: &Arc<Shared>, cfg: &CoreConfig, gen: u64) -> Result<(), String> {
    let mut ws = hello(cfg).await?;
    if sh.gen.load(Ordering::SeqCst) != gen {
        return Ok(());
    }
    sh.next_id.store(2, Ordering::SeqCst);
    let (otx, mut orx) = mpsc::unbounded_channel::<Out>();
    let mut sub_req: HashMap<u64, String> = HashMap::new();
    let mut sub_topic: HashMap<u64, String> = HashMap::new();
    let mut opened: HashSet<String> = HashSet::new();
    let topics: Vec<String> = sh.subs.lock().unwrap().keys().cloned().collect();
    for t in topics {
        open_sub(sh, &mut ws, &mut sub_req, &t).await?;
        opened.insert(t);
    }
    sh.conn.send_replace(Some(otx.clone()));
    let mut tick = tokio::time::interval(Duration::from_millis(500));
    let result = loop {
        tokio::select! {
            _ = tick.tick() => {
                if sh.gen.load(Ordering::SeqCst) != gen { break Ok(()); }
            }
            out = orx.recv() => match out {
                None => break Ok(()),
                Some(Out::Frame(f)) => {
                    if let Err(e) = ws.send(Message::Text(f.into())).await { break Err(e.to_string()); }
                }
                Some(Out::Subscribe(t)) => {
                    if opened.insert(t.clone()) {
                        if let Err(e) = open_sub(sh, &mut ws, &mut sub_req, &t).await { break Err(e); }
                    }
                }
            },
            msg = ws.next() => match msg {
                None | Some(Ok(Message::Close(_))) => break Err("closed".to_string()),
                Some(Err(e)) => break Err(e.to_string()),
                Some(Ok(Message::Text(t))) => {
                    if let Ok(v) = serde_json::from_str::<Value>(t.as_str()) {
                        on_frame(sh, &otx, &mut sub_req, &mut sub_topic, v);
                    }
                }
                Some(Ok(_)) => {}
            },
        }
    };
    if sh.gen.load(Ordering::SeqCst) == gen {
        sh.conn.send_replace(None);
    }
    fail_pending(sh);
    result
}

async fn open_sub(
    sh: &Shared,
    ws: &mut Ws,
    sub_req: &mut HashMap<u64, String>,
    topic: &str,
) -> Result<(), String> {
    let id = sh.next_id.fetch_add(1, Ordering::SeqCst);
    sub_req.insert(id, topic.to_string());
    let f = json!({"id": id, "m": "sub.open", "p": {"topic": topic}});
    ws.send(Message::Text(f.to_string().into())).await.map_err(|e| e.to_string())
}

fn on_frame(
    sh: &Arc<Shared>,
    otx: &OutTx,
    sub_req: &mut HashMap<u64, String>,
    sub_topic: &mut HashMap<u64, String>,
    v: Value,
) {
    if let Some(sid) = v.get("sid").cloned() {
        let m = v.get("m").and_then(Value::as_str).unwrap_or("").to_string();
        let p = v.get("p").cloned().unwrap_or(Value::Null);
        let otx = otx.clone();
        rt().spawn(async move {
            let frame = match srv::dispatch(&m, p).await {
                Ok(r) => json!({"sid": sid, "r": r}),
                Err(e) => json!({"sid": sid, "e": e}),
            };
            let _ = otx.send(Out::Frame(frame.to_string()));
        });
    } else if let Some(id) = v.get("id").and_then(Value::as_u64) {
        if let Some(topic) = sub_req.remove(&id) {
            if let Some(sub) = v.get("r").and_then(|r| r.get("sub")).and_then(Value::as_u64) {
                sub_topic.insert(sub, topic);
            }
            return;
        }
        let tx = sh.pending.lock().unwrap().remove(&id);
        if let Some(tx) = tx {
            let res = match v.get("e") {
                Some(e) => Err(serde_json::from_value::<ApiError>(e.clone())
                    .unwrap_or_else(|_| err("internal", "malformed error"))),
                None => Ok(v.get("r").cloned().unwrap_or(Value::Null)),
            };
            let _ = tx.send(res);
        }
    } else if let Some(ev) = v.get("ev").and_then(Value::as_str) {
        let topic = v
            .get("sub")
            .and_then(Value::as_u64)
            .and_then(|s| sub_topic.get(&s).cloned())
            .unwrap_or_else(|| ev.split('.').next().unwrap_or("").to_string());
        let p = v.get("p").cloned().unwrap_or(Value::Null);
        let cbs: Vec<EvCb> = sh.subs.lock().unwrap().get(&topic).cloned().unwrap_or_default();
        for cb in cbs {
            cb(ev, &p);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_srv_method_is_unsupported() {
        let r = rt().block_on(srv::dispatch("shell.nope", Value::Null));
        assert_eq!(r.unwrap_err().code, "unsupported");
    }

    #[test]
    fn registered_srv_method_runs() {
        srv::register("shell.test", Arc::new(|p| Box::pin(async move { Ok(json!({"echo": p})) })));
        let r = rt().block_on(srv::dispatch("shell.test", json!(1))).unwrap();
        assert_eq!(r, json!({"echo": 1}));
    }

    #[test]
    fn call_without_core_times_out() {
        let l = CoreLink::new();
        let r = rt().block_on(l.call_timeout("sys.ping", json!({}), Duration::from_millis(50)));
        assert_eq!(r.unwrap_err().code, "timeout");
    }
}
