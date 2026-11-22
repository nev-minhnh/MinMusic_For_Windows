# M4-4b: UI Settings → Nhập playlist

**Wave 5** (may start before INT-W4; mock-first). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M4-4b`, branch `wp/M4-4b`.
- **Ports:** 5196 / 48016.

Read first:
- `docs/api.md` §3.12 `import.*`, §4 `app` (`import.progress`)
- `docs/architecture.md` §5.1 (provider logins through webLogin)
- the v1 import UI for the flow: `D:\Coding_Project\MinMusic-wt-core\desktopApp\src\jvmMain\kotlin\com\metrolist\desktop\spotifyimport\**`

## Owned paths
- `ui/src/pages/Settings/Import/**` (category order 82, linked from Tích hợp)
- `mock-core/src/handlers/import.ts`, fixtures
- `tests/contract/suites/m4-import.mjs`
- `ui/src/i18n/extra/{en,vi}/m4-4b.json`, `ui/src/icons/m4-4b.svg`
- `tests/e2e/web/m4-4b.spec.ts`

## Work
- **Providers list** (`import.providers`): Spotify, Tidal, Deezer, Apple Music, Amazon Music, each with a signed-in state and login (`import.login`, where the shell window shows "Đang chờ đăng nhập…").
- **Playlists picker** (`import.playlists`): multi-select with counts and art. Target is a new user album or an existing one (from `userAlbum.list`).
- **Run:** `import.run` → `{jobId}`; progress from `import.progress` events (done/total/failed bar as a transform). A finished summary lists the failed tracks; the result album opens via `navTo`.

## Verify (cheap)
1. Vitest for the job-state reducer.
2. Contract `m4-import.mjs` green on the mock.
3. Web Playwright flow: login (mock resolves) → pick 2 playlists → run → progress → done. STATUS line.
