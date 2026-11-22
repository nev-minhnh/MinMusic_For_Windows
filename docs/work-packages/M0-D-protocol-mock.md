# M0-D: Protocol types, TS client, mock core

**Agent:** Sonnet. **Branch:** `wp/M0-D`. **Deliver the types and client first (≤ 2 h, push early)**, because M0-A, M0-C and M0-E use them.

Read first:
- `docs/api.md` (all of it)
- `docs/architecture.md` §3.3 (stdin/READY contract), §4

## Owned paths
- `protocol/**`
- `mock-core/**`
- `ui/src/core/**`
- `tests/contract/**` (the harness; M0-E adds suites)

## Files
| Path | Content |
|---|---|
| `protocol/src/{envelope,errors,models,methods,events}.ts` | every type in api.md, transcribed exactly. `methods.ts` exports `interface Methods { "home.get": {p: HomeGetParams; r: HomeGetResult}; ... }` for **every** method in api.md §3, so `client.call<K extends keyof Methods>` is fully typed |
| `protocol/package.json` | `npm run schema` → ts-json-schema-generator → `protocol/schema/*.json` |
| `ui/src/core/client.ts` | `connect(config)`, `call`, `sub`, reconnect and back-off, re-subscribe, per-call timeouts, `seq` gap → resubscribe, `status` signal (`connecting/ready/reconnecting`). Big frames (> 100 KB) are parsed the same way (just `JSON.parse`); measure it and report the time for a 200-row window |
| `ui/src/core/art.ts` | `artUrl()` with every host rule in api.md §1.10, plus `art.test.ts` |
| `ui/src/core/clock.ts` | interpolated playback clock (frontend-spec §6.4) |
| `ui/src/core/stores/{player,library}.ts` | Solid stores fed by subs; `library.window` chunk cache keyed by revision |
| `ui/src/core/index.ts` | public exports. In Tauri it awaits `invoke("core_config")` and re-awaits it on every reconnect, because the port and token change after a core restart. In Vite dev it uses `import.meta.env.VITE_MM_CORE` (mock port/token) |
| `mock-core/src/server.ts` | `ws` server implementing the api.md envelope, hello/token/Origin, subscriptions; handlers for the M0 methods (`sys.*`, `home.get`, `library.counts`, `library.window`, `album.get`, `player.*`, topic `player` with a simulated clock and 4 Hz/1 s position rules), `bad_request` for everything else |
| `mock-core/fixtures/` | `home.json` (realistic VN content, real-shaped image URLs on `lh3.googleusercontent.com` / `i.ytimg.com` / zing CDN; you may use the placeholder service `https://picsum.photos/seed/<n>/<px>` only if the CSP in M0-A allows it, else ship local images under `ui/public/mock-art/` served by Vite), `album.json` |
| `mock-core/src/gen.ts` | deterministic 5,000-song generator (seeded), Vietnamese and English titles, mixed sources and quality badges |
| `mock-core/bin/sidecar.mjs` | the same stdin/READY contract as the real core: reads the token line, listens on port 0, prints `READY {...}`, exits on stdin EOF or `{"cmd":"shutdown"}` (after 200 ms), and writes `core.pid` under `$LOCALAPPDATA\MinMusic\state\metrolist\` |
| `mock-core/bin/dev.mjs` | for Vite dev: fixed port 47999, token `dev`, allows Origin `http://localhost:5173`, prints the env line for Vite |
| `tests/contract/run.mjs` | `--target mock|real`, `--suite m0|all`. Starts the target (real: `sidecar/dist` + test data root), validates every call against `protocol/schema` with ajv, plus the semantic asserts in test-guide §2 |

## Done criteria
1. `npm -w protocol run schema` emits a schema for every method and event. `tsc --noEmit` is clean.
2. `npx vitest run ui/src/core` is green: art rules, client reconnect (kill the mock mid-sub → snapshot re-received), clock, chunk cache.
3. `node tests/contract/run.mjs --target mock --suite m0` is 100 % green.
4. `mock-core/bin/sidecar.mjs` passes T-P1, T-P5 and T-P8 when launched by the M0-A shell (coordinate, or run it yourself if M0-A is ready).
5. Self-verification as in test-guide §0, where it applies (Vitest and contract output in the report).
