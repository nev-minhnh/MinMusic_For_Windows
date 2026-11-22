# M4-3b: UI onboarding, Backup page, crash prompt, log viewer, v2 first-run toast

**Wave 4** (may start before INT-W3; mock-first). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M4-3b`, branch `wp/M4-3b`.
- **Ports:** 5195 / 48015.

Read first:
- `docs/frontend-spec.md` §3 (`onboarding` route), §5 Dialogs (backup/restore, log viewer Ctrl Shift L)
- `docs/api.md` §3.1 (`app.logs.tail`), §3.15
- `docs/architecture.md` §3.4 (`w2FirstRunDone`)

## Owned paths
- `ui/src/pages/{Onboarding}/**`, `ui/src/pages/Settings/Backup/**`
- `ui/src/dialogs/{CrashPrompt,LogViewer,RestoreConfirm}.tsx`
- `ui/src/input/commands/logs.ts`
- `ui/src/startup/**`: a startup hook list run by `App` after the first paint. M1-3a's App runs `import.meta.glob("../startup/*.ts")`; if it does not yet, add the one-line glob at INT-W4.
- `mock-core/src/handlers/backup.ts`, fixtures
- `tests/contract/suites/m4-backup.mjs`
- `ui/src/i18n/extra/{en,vi}/m4-3b.json`, `ui/src/icons/m4-3b.svg`
- `tests/e2e/web/m4-3b.spec.ts`

## Work
- **Onboarding** (only when `onboarding.state` says first run, i.e. the DB did not exist):
  - language, theme, sources (link to Nguồn nhạc), YouTube login (optional), import a v1/Android backup (`import.foreignBackup`)
  - finish → `onboarding.complete`
- **First-run toast:** `w2FirstRunDone` false → toast "Đã chuyển sang giao diện mới", then `settings.set {w2FirstRunDone:true}`.
- **Backup page:**
  - Tạo bản sao lưu (`save_file` → `backup.create`, shows bytes)
  - Khôi phục (`pick_file` → `backup.inspect` → confirm dialog with platform/dbVersion/createdAt → `backup.restore` → `invoke('app_restart')`)
  - Nhập từ Android/v1 (`import.foreignBackup`)
- **Crash prompt:** at startup `crash.pending` → dialog with summary, "Mở thư mục", "Bỏ qua" (`crash.dismiss`).
- **Log viewer** (Ctrl Shift L): tabs app/shell/ui → `app.logs.tail {file, lines:2000}`, monospace virtualised (fixed 18 px rows), level filter, copy, "Mở thư mục log" (`open_log_folder`).

## Verify (cheap)
1. Vitest: the onboarding state machine, restore confirm gating.
2. Contract `m4-backup.mjs` green on the mock.
3. Web Playwright E-54…E-55 (backup create + inspect with dialog stubs; log viewer opens with Ctrl Shift L; crash prompt shows from the mock). STATUS line.
