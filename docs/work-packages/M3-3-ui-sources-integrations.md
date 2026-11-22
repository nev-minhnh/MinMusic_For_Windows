# M3-3: UI Settings → Nguồn nhạc, Tích hợp, NCT/Last.fm dialogs, account menu

**Wave 3** (may start before INT-W2; mock-first). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M3-3`, branch `wp/M3-3`.
- **Ports:** 5192 / 48012.

Read first:
- `docs/frontend-spec.md` §5 (Settings, Dialogs, Web logins), §8
- `docs/api.md` §3.11, §3.12 (Last.fm, ListenBrainz, Discord), §4 `account`
- `docs/architecture.md` §9 (passwords never stored or logged)
- MK frame 10 (Đăng nhập nguồn) and MK 9 (Settings light)

## Owned paths
- `ui/src/pages/Settings/{Sources,Integrations}/**`: category folders per the convention. Test them via `#/dev/settings/sources` until M4-1b's shell lands.
- `ui/src/dialogs/{NctLogin,LastfmLogin,TokenLogin}.tsx`
- `ui/src/shell/account/**` (the account menu from the title-bar avatar; `TitleBar` renders `<AccountButton/>` from here. Coordinate the one-line insertion at INT; until then mount it in your dev page)
- `mock-core/src/handlers/{account,integrations}.ts`, fixtures
- `tests/contract/suites/m3-accounts.mjs`
- `ui/src/i18n/extra/{en,vi}/m3-3.json`, `ui/src/icons/m3-3.svg`
- `tests/e2e/web/m3-3.spec.ts`, `tests/e2e/app/m3-3.spec.ts`

## Work
- **Nguồn nhạc:**
  - list from `sources.list`: name, status dot (ok/degraded/off), enabled switch, signed-in account, VIP badge, max quality badge, login/logout
  - priority reorder by drag → `sources.setPriority`
  - "Tự chọn nguồn tốt nhất" / "Tự chuyển nguồn khi lỗi" switches
  - **YouTube:** login → `account.youtube.login` (the shell opens a window; the row shows "Đang chờ đăng nhập…" until it resolves); switch channel; logout; "Đăng nhập bằng token" (advanced dialog → `account.youtube.tokenLogin`)
  - **Zing:** `source.zing.login` (webLogin); logout
  - **NCT:** dialog MK 10 (account, password, optional phone + country code) → `source.nct.login`. The **password field is cleared after the call**, success or failure, and never stored in state or logs. Errors `unauthorized` / `network` show inline.
- **Tích hợp:**
  - Last.fm (dialog username/password, same component, same clearing rule; status `lastfm.status`: user, scrobbling, now playing, pending; logout)
  - ListenBrainz token (`listenbrainz.setToken`; the token field is masked and cleared after save)
  - Discord (login via webLogin, status, logout)
  - links to Device Connect / Listen Together (M3-4b) and Nhập playlist (M4-4b)
- **Account menu:** avatar, name, channel switch, Đăng xuất, Cài đặt.
- **Mock:** stateful `account`, `sources.*`, `source.*`, `lastfm/listenbrainz/discord.*`. The NCT password `"wrong"` → `unauthorized`. A web-login method resolves after 1.5 s (no window in web).

## Verify (cheap)
1. Vitest: password fields cleared (the DOM value is empty after submit; no store holds it), priority reorder maths.
2. Contract `m3-accounts.mjs` green on the mock; M3-2 must pass it on real.
3. Web Playwright E-40…E-46 (NCT validation, inline error, password cleared; Zing login pending state; Last.fm dialog).
4. **R-SEC-3 UI part:** grep the Playwright trace/console for the test password and find nothing. STATUS line.
