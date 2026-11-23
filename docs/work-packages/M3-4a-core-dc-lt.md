# M3-4a: Core Device Connect + Listen Together API

**Wave 4. Agent:** Sonnet. **Repo:** MinMusic. Conventions apply.
- **Worktree:** `D:\Coding_Project\MinMusic-wt-m3-4a`, branch `feat/desktop-core-m3-4a` from `origin/feat/desktop-core` (4bbda71b or later; INT-W1 has landed).
- **Test checkout:** `…-wp\M3-4a-test`, detached at `origin/main` (4c2b47a+). Run `git merge --no-commit origin/wp/M3-4b` there locally to get `tests/contract/suites/m3-dc-lt.mjs`; never commit there.

Read first:
- `docs/api.md` §3.13, §3.14, §4 (`dc`, `lt` topics)
- `docs/architecture.md` §8 (wire-compatible with Android 1.0.2; the QR is byte-identical from the existing encoder; the firewall program is `minmusic-core.exe`)
- `M1-2a-core-browse.md` (the "No Gradle" rules, `ApiModule`, server helpers)
- The UI contract: `origin/wp/M3-4b:mock-core/src/handlers/{dc,lt}.ts` and `tests/contract/suites/m3-dc-lt.mjs`. **Your real handlers must pass that suite.**

## No Gradle
INT-W4 builds. Copy each signature into a comment above its call.

Abbreviations:
- `S` = `shared/src/commonMain/kotlin/com/metrolist/shared`
- `D` = `desktopCore/src/main/kotlin/com/metrolist/desktop` (M1-1 moved these files here; the packages are unchanged)

## Owned paths
- `desktopCore/.../core/api/{dc,lt}/**`: `DcModule : ApiModule` (topic `"dc"`) and `LtModule : ApiModule` (topic `"lt"`), plus tests under `desktopCore/src/test/.../api/{dc,lt}/**`.
- `S/deviceconnect/DeviceConnectPublic.kt` (new, **additive public wrappers only**):
  - `fun deviceConnectLinkFor(addresses: List<String>, port: Int, deviceName: String): String? = buildDeviceConnectLink(addresses, port, deviceName)`. Open `DeviceConnectPeerPolicy.kt:261` and match the parameter types exactly.
  - `fun deviceConnectQrSvg(text: String): String?`: takes `encodeDeviceConnectQr(text)` (`DeviceConnectQrCode.kt:51`, which returns `List<BooleanArray>?`) and renders a single-path SVG: black modules on white, a 4-module quiet zone, `viewBox` in modules, `shape-rendering="crispEdges"`. It returns null when the matrix is null. This is the same encoder as v1, so the code is byte-identical (architecture §8).
- `S/listentogether/ListenTogetherManager.kt`: **one** additive function after `kickUser` (:612): `fun transferHost(userId: String) = launchSend(MessageTypes.TRANSFER_HOST, TransferHostPayload(userId))`. Open `TransferHostPayload` (`network/Protocol.kt:209`) and match its constructor. The server already supports `transfer_host`; the client simply never sent it. This is commonMain, and INT-W4 compiles Android.
- `D/deviceconnect/WindowsFirewallCore.kt` (new; replicates the `internal` desktopApp `WindowsFirewall.status()` script). The program path is `ProcessHandle.current().info().command()`, i.e. `minmusic-core.exe`, or `--exe-path` when given.

## Instances
- **DC:** `com.metrolist.desktop.deviceconnect.DesktopDeviceConnect.manager` (`DeviceConnectManager`) and `manager.remote` (`DeviceConnectRemote`).
- **LT:** `com.metrolist.desktop.state.playback.ListenTogetherState.listenTogetherManager` (`ListenTogetherManager`; `ListenTogetherState.kt:107`).

Both run on their own scopes, so they need no Main. The exception is `ListenTogetherState.isListenTogetherGuest()`, which is `@Composable`: do not call it. Use `manager.role.value` instead.

## Device Connect (`DeviceConnectManager`, `S/deviceconnect/DeviceConnectManager.kt`)
| Method | Backing / rule |
|---|---|
| `dc.state` / topic `dc` | Built by a pure `DcStateMapper(state: DeviceConnectManager.State, sync: DcSyncState, firewall)` from `manager.state.value` and `manager.remote.state.value`. Fields: `enabled` ← `state.enabled`; `port` ← `state.serverPort` (the actual port, which can differ from the setting); `addresses` ← `state.reachableAddresses.map { "$it:$port" }`; `link` ← `deviceConnectLinkFor(state.reachableAddresses, port, state.localDeviceName) ?: ""`; `qrSvg` ← `deviceConnectQrSvg(link) ?: ""`; `firewall` ← `WindowsFirewallCore.status()` (cached 60 s, refreshed on `dc.enable`), mapped `ALLOWED→"allowed"`, `BLOCKED→"blocked"`, `NO_RULE→"no_rule"`, else `"unknown"`. `devices`: the union of `state.pairedDevices` (`paired=true`) and `state.peers` (by id). `online = peer.state in {DISCOVERED, CONNECTING, HANDSHAKING, CONNECTED}`, `accountBound = peer.state != ACCOUNT_MISMATCH && !state.anonymous`, `type = deviceType.name.lowercase()`. `session`: when `sync.sessionId != null`, `{peerId: sync.targetId, role: if (sync.targetId == state.localDeviceId) "player" else "controller"}`. Add the additive field `fixedPortUnavailable` (api.md `<!-- M3-4a -->` section). **Topic:** snapshot, then `combine(manager.state, manager.remote.state)` with `sample(250)` → `dc.state`. Newly appearing `state.pairingRequests` entries with `requiresApproval == true` → `dc.request {requestId, peer: deviceName, sas}`. A link offer (`state.linkOffer`) → `dc.request {requestId: "link:" + sha1(address).take(12), peer: offer.deviceName, sas: ""}` |
| `dc.enable {on}` | `on` → `manager.enable(context = Unit)` (`suspend fun enable(context: Any?)` :262; v1 passes `Unit`). Off → `manager.disable()` (:424) |
| `dc.setPort {port}` | Validate `port in 1024..65535`, else `bad_request` (this matches the M3-4b mock; the manager also allows 0, but the API does not expose it). Then `manager.updateListeningPort(port)` (:353, which silently ignores invalid values and restarts the listener if enabled) |
| `dc.requireApproval {on}` | **`unsupported`.** v1 always requires approval for code pairing; there is no setting. Note it in api.md under your section, and accept `unsupported` for this method in the real-target run of `m3-dc-lt.mjs` (one-line tolerance list, as M1-5 did for `track.setSource`) |
| `dc.connectLink {link}` | `manager.offerConnectionLink(link): Boolean` (:366). `false` → `bad_request` ("not a device-connect link or no reachable endpoint"). It never auto-connects: the offer surfaces as a `link:` request |
| `dc.confirmSas {requestId, match}` | **The manager has no separate SAS step:** `approvePairing` is "the codes match". To keep the M3-4b contract (accept is valid only after `confirmSas {match:true}`), keep a core-side `confirmed: MutableSet<String>`. `match:true` → add `requestId` and return `{}`; this does **not** approve yet. `match:false` → `manager.rejectPairing(requestId)` (:595) and remove it from the set. Unknown `requestId` (not in `state.pairingRequests`) → `not_found` |
| `dc.accept {requestId}` | `link:` ids → `manager.acceptConnectionLink()` (:374). Pairing ids: unknown → `not_found`; the request has a non-empty `sas` and the id is not in `confirmed` → `bad_request "sas_unconfirmed"` (same text as the mock); otherwise `manager.approvePairing(requestId)` (:589, fire-and-forget; the session's `approvePairing()` is itself idempotent). Requests with an empty `sas` (code pairing not required) may be accepted directly |
| `dc.reject {requestId}` | **Idempotent and always `{}`.** `link:` ids → `manager.dismissConnectionLink()`; others → `manager.rejectPairing(requestId)` (an unknown id is a silent no-op inside the manager); drop the id from `confirmed` |
| `dc.forget {deviceId}` | `manager.forget(deviceId)` (`suspend`, :601) |
| `dc.transferTo {deviceId}` | Offline device → `bad_request "device offline"` (matches the mock). Else `manager.remote.transferTo(deviceId)` (`DeviceConnectRemote.kt:223`) |
| `dc.attach {deviceId}` | Control the target's playback: `Settings.shared.deviceConnectDefaultDeviceId = deviceId`, then `manager.remote.discoverPlayback()` (:229). Offline → `bad_request "device offline"`. Read `discoverPlayback()` first and record in the report whether it targets the default device; if it does not, report it and use `transferTo` semantics only |
| `dc.release {deviceId}` | `manager.remote.leaveRemoteSession()` (:269) |
| `dc.openFirewallSettings` | `ProcessBuilder("control.exe", "/name", "Microsoft.WindowsFirewall", "/page", "pageConfigureApps").start()`. This is what v1 does; confirm by grepping `pageConfigureApps` in the repo and use the same arguments |

## Listen Together (`ListenTogetherManager`, `S/listentogether/ListenTogetherManager.kt`)
| Method | Backing / rule |
|---|---|
| `lt.state` / topic `lt` | Built by a pure `LtStateMapper` from the manager flows: `connectionState: StateFlow<ListenTogetherConnectionState>` (`DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING, ERROR`), `role` (`HOST, GUEST, NONE`), `roomState: StateFlow<RoomState?>` (`roomCode`, `hostId`, `users: List<UserInfo(userId, username, isHost, isConnected)>`), `pendingJoinRequests: StateFlow<List<ListenTogetherJoinRequest(userId, username)>>`, `serverUrl`, `roomRequestPending`, `joinRequestPending`. Status: role HOST → `"host"`; GUEST → `"guest"`; else CONNECTING/RECONNECTING or `roomRequestPending`/`joinRequestPending` → `"connecting"`; else `"idle"`. `error` when ERROR. **Topic:** `combine` the flows with `sample(250)` → `lt.state`. New `pendingJoinRequests` entries → `lt.joinRequest {id: userId, name: username}`. New `pendingSuggestions` entries (`ListenTogetherSuggestion(id, fromUserId, fromUsername, trackInfo)`) → `lt.suggestion {id, from, track}`; map `TrackInfo` → `Track` with a pure mapper, reading `Protocol.kt` for its fields |
| `lt.create {name}` | `manager.setUsername(name)` (:731) then `manager.createRoom(overrideUsername = name): Boolean` (:493). `false` → `conflict` (already in or pending a room) or `unsupported` when `Settings.shared.listenTogetherEnabled` is false |
| `lt.join {code, name}` | `manager.joinRoom(roomCode = code, overrideUsername = name): Boolean` (:510). `false` → `bad_request` (blank code or name), else `conflict` |
| `lt.leave` | `manager.leaveRoomAndWait()` (`suspend`, :572) |
| `lt.approve` / `lt.reject {userId}` | `approveJoin(userId)` (:597) / `rejectJoin(userId, reason = null)` (:603) |
| `lt.kick {userId}` | `kickUser(userId, reason = null)` (:612) |
| `lt.transferHost {userId}` | The new `manager.transferHost(userId)` (see Owned paths). Not host → `bad_request` |
| `lt.suggest {trackId}` | Resolve the `SongItem` (M1-2a `PlayerApi.resolve`, made `internal`), then `manager.suggestTrack(song: SongItem)` (:642) |
| `lt.suggestion.approve` / `.reject {id}` | `approveSuggestion(suggestionId)` (:617) / `rejectSuggestion(suggestionId, reason = null)` (:630) |
| `lt.servers` / `lt.setServer {url}` | `manager.servers.value` (`ListenTogetherServer(name?, url, location: StringResource, operator?, isCustom)`) → `{items: [{name, url, operator, custom}], current: serverUrl.value}`. Skip `location` (a Compose `StringResource`). `setServer` → `manager.setServerUrl(url)` (:736); if `url` is not in the list, call `addCustomServer(url)` (:763) first |
| `lt.blocked` / `lt.unblock {id}` | `blockedUsernames.value` (`Set<String>`) → `{items: [{id: name, name}]}`. `unblockUser(username)` (:824); the id is the username |
| `lt.invite` | `{url: manager.roomLink(useParty = false)}` (:829); `null` → `bad_request "not in a room"` |

**Do not call:** `ListenTogetherState.isListenTogetherGuest()` (Composable), `WindowsFirewall` (internal, desktopApp), `buildDeviceConnectLink`/`encodeDeviceConnectQr` directly (internal; use the new public wrappers), `DEVICE_CONNECT_MIN_FIXED_PORT` (internal; hard-code 1024).

## Verify (no builds)
1. **JUnit (pure):**
   - `DcStateMapperTest`: devices union and online/accountBound, session role, `link:` request ids
   - `DcPairingRulesTest`, as a pure state machine over `(confirmed set, request sas)`: accept before confirm → `sas_unconfirmed`; confirm then accept → approve called; reject twice → both `{}`; `match:false` → reject
   - `PortRangeTest`: 1023 rejected; 1024 and 65535 accepted; 0 rejected
   - `QrSvgTest`, in shared desktopTest: the SVG has a quiet zone, and the same text gives the same SVG
   - `LtStateMapperTest`: the status table
   - `LtEventDiffTest`: new join requests and suggestions emitted once
2. **Self-review checklist** in the report, including the exact shared diff (`git diff origin/feat/desktop-core -- shared`), which must be additive only.
3. **At INT-W4:** `m3-dc-lt.mjs` is green on the real target, apart from the documented `dc.requireApproval` `unsupported`. Android-pairing manual QA is listed for Minh.
4. STATUS line.
