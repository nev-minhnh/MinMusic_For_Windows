# M3-1: Shell `shell.webLogin` + `shell.po.*` (hidden PO-token webview)

**Wave 1. Agent:** Sonnet. Conventions apply.
- **Worktree:** `D:\Coding_Project\MinMusic_4_Windows-wp\M3-1`, branch `wp/M3-1`.
- **Ports:** web 5186, mock 48006.
- **Depends on** M1-4 stage 1 (Rust marked blocks, `Cargo.toml` deps, `corelink::srv::register`). Write the modules first. When the M1-4 stage-1 STATUS line appears, `git merge origin/wp/M1-4` **once**, then wire your `main.rs` blocks.

Read first:
- `docs/architecture.md` §5, §5.1, §5.2, §9
- `docs/api.md` §5 (`shell.webLogin`, `shell.po.evaluate/reset/available`)
- v1 reference only (do not copy UI): `D:\Coding_Project\MinMusic-wt-core\desktopApp\src\jvmMain\kotlin\com\metrolist\desktop\youtube\DesktopPageBoundTokenRuntime.kt` (script contract, `normalizeJavaScriptResult`, 10 s timeout) and the .NET helper `Program.cs` if present under `D:\Coding_Project\MinMusic\windows` (`rg -l "SAPISID" D:\Coding_Project\MinMusic\windows --glob "*.cs"`)

## Owned paths
- `src-tauri/src/{weblogin,potoken}/**`
- the `M3-1` blocks in `main.rs`
- `src-tauri/capabilities/m3-1.json`. Login and PO-token webviews get **no** capability and no IPC.
- `ui/src/i18n/extra/{en,vi}/m3-1.json` (login window chrome strings, if any are rendered by a local page)
- `tests/e2e/app/m3-1.spec.ts`, `tests/fixtures/weblogin/**`

## Work
| Module | Content |
|---|---|
| `weblogin/mod.rs` | Registers `corelink::srv::register("shell.webLogin", …)`. Parse the request into `WebLoginRequest` (serde, exactly api.md §5). One login at a time: a second request returns `ApiError{code:"busy"}` |
| `weblogin/window.rs` | `WebviewWindowBuilder` label `login-<n>`, `.incognito(true)`, `.data_directory(%TEMP%\MinMusic-login-<guid>)`, user agent if given, size `window.w/h`, not maximizable, centred on main. **Chrome:** a small top bar rendered by a local HTML page in a *separate* 40 px webview or (simpler) native window title + a "Mở bằng trình duyệt" / "Huỷ" pair as tray-style context. Choose the simplest that keeps no IPC in the login webview; document the choice. `on_navigation`: allow only the `allowedHosts` in the top frame (others → open externally via `shell.openExternal`, return false); intercept `done.navPrefix` (e.g. `metrolist-auth://discord/callback`) → done with `finalUrl` |
| `weblogin/poll.rs` | Every 500 ms and on `NavigationCompleted`: cookies via `with_webview` → `ICoreWebView2_2::CookieManager().GetCookies(url)` for each `done.cookies.urls`/`collect.cookieUrls` (httpOnly included); `done.script` via `ExecuteScript` (truthy JSON = done). On done: collect, build `cookieHeader` (`name=value; …` in the request's name order), close the window, delete the data dir (retry 3× after the webview is gone), respond. Window closed or cancelled → `{cancelled:true}`. `timeoutMs` → `{cancelled:true}` + log |
| `weblogin/done.rs` | **Pure** done-condition evaluator `fn evaluate(cfg: &DoneCfg, cookies: &HashMap<String,String>, script: Option<&Value>, url: &str) -> bool` (unit tested: cookie any-of, navPrefix, script truthiness) |
| `weblogin/auth_callback.rs` | `pub fn on_auth_callback(url: &str)` called by M1-4's deep-link handler for `metrolist-auth://`: completes a pending login whose `navPrefix` matches |
| `potoken/mod.rs` | Registers `shell.po.evaluate {script, timeoutMs}`, `shell.po.reset`, `shell.po.available`. Lazily creates a hidden window `potoken` (`visible(false)`, 1×1, `skip_taskbar`, incognito, UA "Chrome 136" string from architecture §5.2, URL `https://www.youtube.com/robots.txt`), waits for `NavigationCompleted`, then `ExecuteScript(script)` → raw JSON string returned unchanged as `{result}`. Serialise evaluations (one at a time), timeout 10 s → `timeout`. `reset` navigates to `about:blank` and marks it unloaded. `available` = WebView2 runtime present && main app ready |
| e2e helper | `#[cfg(any(debug_assertions, feature="e2e"))]` command `test_weblogin {request}` invokes the same code path as the SrvReq (used by tests without the core) |

**Security** (architecture §9, R-SEC):
- no capability for `login-*`/`potoken` windows
- never log cookie values, only names
- the data dir is always deleted
- `allowedHosts` is enforced in the top frame

## Verify (cheap checks only)
1. `cargo check` and `cargo test`: the `done::evaluate` table, request serde (every api.md field), cookie header ordering, `allowedHosts` matcher (subdomains, scheme), and an unknown-field tolerance test.
2. **Fixture pages** for integration: `tests/fixtures/weblogin/{login.html,done.html}` (sets a cookie `test_sid` then navigates). Serve them via a tiny `node tests/fixtures/weblogin/serve.mjs <port>`.
3. **Spec for integration:** `tests/e2e/app/m3-1.spec.ts`:
   - `invoke('test_weblogin', {url:"http://127.0.0.1:<port>/login.html", allowedHosts:["127.0.0.1"], done:{cookies:{names:["test_sid"], urls:["http://127.0.0.1:<port>"]}}, collect:{cookieUrls:["http://127.0.0.1:<port>"]}})` → `cookies.test_sid` present
   - the temp dir is gone
   - a second concurrent call → `busy`
   - a PO evaluate of `"1+1"` → `"2"`
4. STATUS.md line.
