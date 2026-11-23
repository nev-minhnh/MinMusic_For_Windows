# M3-2: Core accounts, sources, integrations, shell channel (webLogin + PO token runtime), per-track source

**Wave 4. Agent:** Sonnet. **Repo:** MinMusic. Conventions apply.
- **Worktree:** `D:\Coding_Project\MinMusic-wt-m3-2`, branch `feat/desktop-core-m3-2` from `origin/feat/desktop-core` (4bbda71b or later; INT-W1 has landed).
- **Test checkout:** `…-wp\M3-2-test`, detached at `origin/main` (4c2b47a+). Run `git merge --no-commit origin/wp/M3-3` locally to get `tests/contract/suites/m3-accounts.mjs` and the mock; never commit there.

**The W2/W3 Kotlin WPs may not be merged yet** (M1-2b `CorePrefs`, M2-1 `PlayerApi` edits). So:
- do **not** use `CorePrefs`
- do **not** edit `api/PlayerApi.kt`
- keep your state in your own files (below)

Read first:
- `docs/api.md` §1.2 (`SrvReq`/`SrvRes`), §3.4 (`track.sources`/`track.setSource`), §3.11, §3.12 (Last.fm, ListenBrainz, Discord), §4 (`account` topic), §5
- `docs/architecture.md` §5.1, §5.2, §9 (passwords never stored or logged)
- **The shell side (done, M3-1):** `src-tauri/src/{weblogin,potoken}/**` on `main`. The done-condition is `navPrefix` **OR** (all `done.cookies` present **AND** `done.script` truthy). With no `done.script`, cookies alone suffice.
- **The UI contract (done, M3-3):** `origin/wp/M3-3:mock-core/src/handlers/{account,integrations}.ts` + `tests/contract/suites/m3-accounts.mjs`. **Your real handlers must pass that suite.**
- `M1-2a-core-browse.md` (the "No Gradle" rules, `ApiModule`, server helpers)

## No Gradle
INT-W4 builds. Copy each signature into a comment above its call.

Abbreviations:
- `S` = `shared/src/commonMain/kotlin/com/metrolist/shared`
- `C` = `desktopCore/src/main/kotlin/com/metrolist/desktop` (M1-1 moved these files; the packages are unchanged and they are now in the **same module** as your code, so their `internal` symbols are visible; prefer them over replicating, but verify each one exists under `C`)
- `D` = `desktopApp/src/jvmMain/kotlin/com/metrolist/desktop` (still desktopApp; its `internal` symbols are **not** visible)
- `X` = `desktopCore/src/main/kotlin/com/metrolist/core`

## Owned paths
| Path | Content |
|---|---|
| `X/shell/ShellChannel.kt` (new) | `object ShellChannel { suspend fun request(m: String, p: JsonObject, timeoutMs: Long?): JsonElement; val connected: StateFlow<Boolean> }`. It sends `{sid, m, p}` on the **role=shell** connection, completes on the matching `{sid, r}` / `{sid, e}` (`e` → `ApiException(e.code, e.msg)`), and times out (`null` = no timeout, for `shell.webLogin`). No shell connected → `ApiException("unsupported", "shell not connected")` |
| `X/server/ShellFrames.kt` (new) + **two hook lines** in `X/server/CoreServer.kt` | (1) when a connection completes `sys.hello` with `role=="shell"`, register it with `ShellChannel` (unregister on close); (2) an incoming frame with `sid` (no `id`) from that connection → `ShellChannel.complete(frame)`. Keep all logic in the new file |
| `X/server/CoreServer.kt` (third hook) | **Param redaction:** if CoreServer logs request params anywhere (check), redact the params of `source.nct.login`, `lastfm.login`, `listenbrainz.setToken`, `account.youtube.tokenLogin` (log `"<redacted>"`). Add a unit test |
| `X/shell/WebLogin.kt`, `X/shell/WebLoginConfigs.kt` (new) | `object WebLogin { suspend fun request(cfg: WebLoginConfig): WebLoginResult }` where `WebLoginResult(cancelled: Boolean, cookies: Map<String,String>, cookieHeader: String?, scriptResult: JsonElement?, finalUrl: String?)`. `WebLoginConfig` serialises to the api.md §5 `shell.webLogin` params exactly. `WebLoginConfigs` holds `youtube(url = …)`, `zing`, `discord(authorizeUrl)` and a marked block `// <M4-4a>` `// </M4-4a>` left **empty** for M4-4a's import providers |
| `X/shell/ShellPoTokenRuntime.kt` (new) | Implements `com.metrolist.shared.youtube.playback.PageBoundPoTokenJavaScriptRuntime` (`S/youtube/playback/PageBoundPoTokenJavaScriptRuntime.kt:3-9`: `val available: Boolean; suspend fun evaluate(script: String): String; suspend fun reset()`) |
| `X/CoreRuntime.kt` | **One line:** replace `headlessStateModule { DesktopTokenProvider() }` (≈ :129) with `headlessStateModule { DesktopTokenProvider(ShellPoTokenRuntime) { upcomingIds() } }`. `upcomingIds()` = the next 3 YouTube ids from `PlayerState.queue.state.value` after `currentIndex` (pure helper in your file). Public secondary constructor: `DesktopTokenProvider(pageBoundRuntime: DesktopPoTokenJavaScriptRuntime, upcomingVideoIds: () -> List<String> = { emptyList() })` (`shared/src/desktopMain/.../DesktopTokenProvider.kt:81`); `DesktopPoTokenJavaScriptRuntime` is a typealias of the interface |
| `X/api/account/**`, `X/api/sources/**`, `X/api/integrations/**`, `X/api/tracksource/**` | `AccountModule` (topic `"account"`), `SourcesModule`, `IntegrationsModule`, `TrackSourceModule`, + tests in `desktopCore/src/test/.../api/{account,sources,integrations,tracksource,shell}/**` |
| `X/api/sources/SourcePrefs.kt` | A small JSON file `<XdgUtils.getXdgStateHome()>/metrolist/source-prefs.json` (atomic write): `priority: List<String>`, `autoFallback: Boolean`, `trackOverrides: Map<trackId, {source, id}>` |
| `X/api/m0/M0Module.kt` (or whichever module serves them) | Remove `track.sources`/`track.setSource` only if registered there as stubs (M1-2b's stub may land before or after you; the `ApiRegistry` duplicate check at INT will flag it, and the INT agent keeps yours) |

## ShellPoTokenRuntime (architecture §5.2)
- `available`: `ShellChannel.connected.value && cachedAvailable`, where `cachedAvailable` is refreshed by `shell.po.available` on connect.
- `evaluate(script)`:
  1. `Mutex` (one at a time)
  2. `withTimeoutOrNull(10_000) { ShellChannel.request("shell.po.evaluate", {script, timeoutMs: 10000}, 11_000) }`
  3. `null` → `throw IllegalStateException("PO token evaluate timeout")`
  4. return `normalizeJavaScriptResult(r["result"].string)`, a verbatim copy:
     ```kotlin
     private fun normalizeJavaScriptResult(value: String): String {
         val raw = value.trim()
         if (raw == "null" || raw == "undefined") return ""
         return runCatching { Json.decodeFromString<String>(raw) }.getOrDefault(raw.trim('"'))
     }
     ```
- `reset()`: `shell.po.reset`.
- The shell's hidden webview already loads `PAGE_BOUND_TOKEN_ORIGIN_URL` with `PAGE_BOUND_PO_TOKEN_USER_AGENT`. Confirm M3-1's URL/UA equal these public constants (`PageBoundPoTokenJavaScriptRuntime.kt:11,13`, `DesktopPoTokenJavaScriptRuntime.kt:11`). If M3-1 does **not** inject `PAGE_BOUND_TOKEN_SCRIPT` as the init script, send it once per page load as the first `evaluate` (check `DesktopPageBoundTokenRuntime` in `D/youtube/` for how v1 installs it) and note it in the report.

## Web-login configs (`WebLoginConfigs.kt`)
**UA:** Chrome 124 desktop (`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`) for providers. Omit it (WebView2 default) for YouTube and Zing.

| Config | url / allowedHosts | done | collect |
|---|---|---|---|
| `youtube(url = "https://accounts.google.com/ServiceLogin?continue=https://music.youtube.com")` | hosts `music.youtube.com`, `www.youtube.com`, `accounts.google.com`, `google.com`, `*.google.com` | `cookies {names:["SAPISID","__Secure-3PAPISID","__Secure-1PAPISID"], urls:["https://music.youtube.com"]}` **AND** `script` = `(()=>{const c=(window.ytcfg&&ytcfg.data_)\|\|(window.yt&&yt.config_)\|\|{};return location.host==="music.youtube.com"&&c.VISITOR_DATA&&c.DATASYNC_ID&&c.SESSION_INDEX!==undefined?{visitorData:c.VISITOR_DATA,dataSyncId:String(c.DATASYNC_ID).split("\|\|")[0],authUser:String(c.SESSION_INDEX)}:null})()` | `cookieUrls ["https://music.youtube.com","https://www.youtube.com"]`; the script result gives visitorData/dataSyncId/authUser. Window 480×680 |
| `zing()` url `https://zingmp3.vn/` | `zingmp3.vn`, `*.zingmp3.vn`, `id.zalo.me`, `*.zalo.me`, `*.vng.com.vn` | cookies any of `zmp3_sid`, `zpsid` on `https://zingmp3.vn` (no script) | `cookieUrls ["https://zingmp3.vn"]`. Window 560×760 |
| `discord(authorizeUrl)` | `discord.com` | `navPrefix: "metrolist-auth://discord/callback"` | `finalUrl` |

**Semantics (verified in `src-tauri/src/weblogin/done.rs` on `main`):** `cookies` means *any listed name present with a non-empty value*. It is combined with `script` by AND, and `navPrefix` short-circuits by OR. Subdomains of `allowedHosts` are allowed. The configs above rely on exactly this.

## Methods
| Method | Backing (exact) |
|---|---|
| `account.get` / topic `account` | `com.metrolist.shared.auth.AuthManager` (`S/auth/AuthManager.kt:45-67`; construct it as v1 does: `rg -n "AuthManager\(" desktopCore desktopApp`): `isLoggedIn`, `accountName`, `accountEmail`, `accountChannelHandle`, `accountThumbnail` → `{youtube?:{name, email?, handle?, avatar?:{src}}, signedIn}`. `channels` via `suspend fetchAccounts(cookie, visitorData, dataSyncId, authUser): List<AccountsListResponse.Account>` (:92; on demand only, not in the snapshot). Topic: snapshot `account.get` + `sources.list`; deltas `account.changed` (`snapshotFlow { AuthState.profilePicUrl }` on Main + after each login/logout handler) and `sources.changed` (after any sources mutation) |
| `account.youtube.login` | `WebLogin.request(WebLoginConfigs.youtube())`. Cancelled → `{ok:false}` + `ApiException("cancelled")` (match the M3-3 mock). Then `AuthManager().validateAndSaveCredentials(cookie = res.cookieHeader!!, visitorData, dataSyncId, authUser): Boolean` (:108, suspend). Then on Main `AuthState.updateAuth(cookie, visitorData, dataSyncId, authUser)` (`C/state/auth/AuthState.kt:36`). `false` → `unauthorized` |
| `account.youtube.switchChannel` | `fetchAccounts(...)`. If more than one account and none is selected, take the first non-selected. If the chosen account has a `dataSyncId`: `dataSyncId = account.selectionDataSyncId(current)` (`S/auth/AccountSelection.kt:6`) → `validateAndSaveCredentials` → `updateAuth`. Else, if it has `signinUrl`: `WebLogin.request(WebLoginConfigs.youtube(url = "https://music.youtube.com" + signinUrl))` → same save path. (v1's `AuthData.forAccount` / `selectWebViewAccount` are `internal` in `D/ui/screens/LoginDialog.kt:811-840`; copy their logic, ~20 lines, with a comment) |
| `account.youtube.logout` | `AuthManager().clearAllCredentials(): Result<Unit>` (:131), then on Main `AuthState.signOut()` (suspend). Emit `account.changed` |
| `account.youtube.tokenLogin {cookie, visitorData?, dataSyncId?}` | `validateAndSaveCredentials(cookie, visitorData ?: "", dataSyncId ?: "", authUser = "0")` → `updateAuth`. **Never log `cookie`** |
| `sources.list` | Pure `SourcesMapper` over `SourceId.entries - LOCAL` (`S/source/SourceId.kt`). `enabled = Settings.shared.isSourceEnabled(id)` (`S/source/SourceSettings.kt`). `status`: not enabled → `off`; `registry.health(id) == DEGRADED` → `degraded`; else `ok` (`SourceRegistry` via `GlobalContext.get().get<SourceRegistry>()`). `signedIn = DesktopSourceLogins.hasSavedSession(id)` (`C/source/DesktopSourceLogins.kt`; YT → `AuthManager.isLoggedIn`). `vip`/`account` from a cached `DesktopSourceLogins.account(id): Result<SourceAccount?>` (`SourceAccount(source, displayName, entitlement: FREE\|VIP)`), refreshed on login/logout and at most every 10 min, never blocking `sources.list` (stale is fine). `canLogin = id in {ZING, NCT}` (YT logs in via `account.*`). `maxQuality`: yt `{label:"Opus 160"}`, sc `{label:"AAC 160"}` (never Go+), zing/nct `320` if VIP else `128`. `priority = SourcePrefs.priority` (default `["yt","zing","nct","sc"]`), `autoBest = Settings.shared.autoBestSource`, `autoFallback = SourcePrefs.autoFallback` (default true) |
| `sources.setEnabled {id, on}` | YT/LOCAL → `bad_request`. Else `Settings.shared.soundCloudSourceEnabled` / `zingSourceEnabled` / `nctSourceEnabled = on` (Settings.kt:324-326). Emit `sources.changed` |
| `sources.setPriority {order}` | Validate (a permutation of the four) → `SourcePrefs.priority`. **Stored only**: there is no v1 routing hook. Note it in api.md `<!-- M3-2 -->` |
| `sources.setAutoBest {on}` / `setAutoFallback {on}` | `Settings.shared.autoBestSource = on` / `SourcePrefs.autoFallback = on` (stored only, same note) |
| `source.zing.login` | `WebLogin.request(WebLoginConfigs.zing())` → require `DesktopZingCookieStore.hasSessionCookie(header)` (companion, `C/source/DesktopSourceCredentials.kt`) → `DesktopZingCookieStore.save(header)` (suspend) → `ZingClient.account()` (`com.metrolist.shared.source.zing`; get the instance as `DesktopSourceLogins` does, lines ~72-100, and mirror that flow exactly: account non-null && `!loggedIn` → clear + `not_signed_in`; a network failure keeps the session) → `BestSourceSelector.invalidateAccounts()` → `{ok:true, vip}`. **Do not** call `DesktopSourceLogins.loginZing()` (it launches the old .exe helper) |
| `source.zing.logout` / `source.nct.logout` | `DesktopSourceLogins.logout(source): Result<Unit>` → `invalidateAccounts()` |
| `source.nct.login {account, password, phone?, countryCode?}` | `DesktopSourceLogins.loginNct(username = account, password = password): Result<Unit>`. `DesktopSourceLoginException.Reason.AUTH_FAILED` → `unauthorized`, `NETWORK` → `network`. `phone`/`countryCode` are not supported by v1: if given → `bad_request` (unless the M3-3 suite expects them to be ignored; match the suite). Then `account(NCT)` → `{ok, vip}`. **The password is never stored, logged or kept**: read it into a local `val`, pass it, and drop the reference. Strings cannot be zeroed; document that the char-array zeroing in api.md is not achievable with v1's `String` API |
| `lastfm.login {username, password}` | `LastFM.getMobileSession(GlobalYouTube.client, username, password): Result<LastFmAuthResponse>` (`S/api/lastfm/LastFM.kt:200`) → `session?.name` / `?.key` → on Main `ScrobbleSessions.connectLastFm(account = name, credential = key)` (`S/scrobble/ScrobbleSessions.kt:66`). Errors: replicate the internal `lastFmLoginFailure`: `ScrobbleApiException` (`com.metrolist.shared.api`) with `apiErrorCode == 4` → `unauthorized`; `IOException`/`HttpRequestTimeoutException` → `network`; else `internal`. Result `{ok, user}` |
| `lastfm.logout` | `ScrobbleSessions.disconnect(ScrobbleProvider.LAST_FM)` (:95) on Main |
| `lastfm.status` | `ScrobbleSessions.current(ScrobbleProvider.LAST_FM)?.account` (user); `Settings.shared.lastFmSessionExpired`; `lastFmEnabled` (scrobbling); `lastFmUseNowPlaying` (nowPlaying); `pending = PendingScrobbleStore.all().count { it.provider == ScrobbleProvider.LAST_FM }` (`S/scrobble/PendingScrobbleStore.kt:57`, suspend; get it as v1 does) |
| `listenbrainz.setToken {token\|null}` | null → `ScrobbleSessions.disconnect(LISTEN_BRAINZ)`. Else `ListenBrainz.validateToken(GlobalYouTube.client, token): Result<ListenBrainzUser>` (`S/api/listenbrainz/ListenBrainz.kt:33`) → `connectListenBrainz(account = user.name, credential = token)` (:83) on Main. Invalid → `unauthorized` |
| `listenbrainz.status` | `{user: Settings.shared.listenBrainzUsername.ifBlank { null }}` |
| `discord.login` | `DiscordRpcManager.init(GlobalYouTube.client)` if needed → `val s = DiscordRpcManager.auth.createSession()` (`authorizeUrl, redirectUri, pkceVerifier, state`) → `WebLogin.request(WebLoginConfigs.discord(s.authorizeUrl))` → parse `finalUrl` with `parseDiscordLoginCallback(url)` (`C/auth/DiscordLoginCallback.kt`, internal but same module now; else replicate with `java.net.URI`), require `state == s.state` → `DiscordRpcManager.auth.exchangeCode(code, s.pkceVerifier, cbState, s.state): DiscordAuthResult` → `DiscordRpcManager.storeAndConnect(accessToken, refreshToken, expiresInSec)` (:227). Mirror `C/auth/DesktopDiscordLogin.kt` |
| `discord.logout` / `discord.status` | `DiscordRpcManager.logout()` (:668); status from `currentUser.value` (`username`, `name`) and `Settings.shared.enableDiscordIntegration` |
| `track.sources {id}` | Resolve the `SongItem` (DB, else YouTube metadata as M1-2a `resolve` does; replicate a minimal resolver here to avoid editing `PlayerApi.kt`). The current source is an option with `auto:true`. For each other `id in SourceId.entries - LOCAL` with `registry.available(id) != null`: `registry.call(id) { it.search("${song.title} ${song.artists.firstOrNull()?.name.orEmpty()}", SearchFilter.SONG, 0) }.items.filterIsInstance<SongItem>().firstOrNull { BestSourceSelector.isSameRecording(song, it) }` (public). Quality: `registry.call(id) { it.stream(match.id, SourceQuality.HIGH) }` → `QualityRanker.tier(resource)` → label (pure mapper), with a 4 s timeout per source; on timeout, `quality` = that source's `maxQuality` from `sources.list`. `available=false` + `hint:"vip_login"` when the stream needs VIP and the account is FREE. Run sources in parallel (`supervisorScope`), cache 10 min per id |
| `track.setSource {id, source}` | Validate against the last `track.sources` result → `SourcePrefs.trackOverrides[id] = {source, matchId}`. Replace every queue entry with that id with the matched `SongItem`, by queue key (`PlayerState.queue.state.value.entries`; there is no public "replace entry" API: **check** `MusicQueue` for a public `replace`/`set`; if none, only persist and note it). Provide `object TrackSourceOverrides { fun apply(songs: List<SongItem>): List<SongItem> }`. **INT-W4 adds one line in `PlayerApi.resolve`** to call it |

## Verify (no builds)
1. **JUnit (pure):**
   - `ShellChannelTest`: sid correlation, error → `ApiException`, timeout, no shell → `unsupported`, uses fake frames
   - `WebLoginConfigTest`: JSON equals the api.md §5 shape; youtube script result parsing
   - `NormalizeJsTest`
   - `SourcesMapperTest`
   - `LastFmErrorMapTest`
   - `DiscordCallbackTest`
   - `RedactionTest`
   - `TrackSourceLabelTest`
   - `UpcomingIdsTest`
2. **Self-review checklist** in the report: every file, imports, and every backing signature copied from source. Also list which `C/` internals you used.
3. **At INT-W4:**
   - `m3-accounts.mjs` is green on the real target (web logins answer `cancelled` in CI-less runs; the suite tolerates that per M3-3)
   - a PO-token playback via the shell (log line)
   - R-SEC-3 grep
   - manual logins listed for Minh
4. STATUS line.
