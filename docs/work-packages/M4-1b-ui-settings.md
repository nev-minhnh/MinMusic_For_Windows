# M4-1b: UI Settings shell + every general settings page + settings search

**Wave 3** (may start before INT-W2; mock-first). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M4-1b`, branch `wp/M4-1b`.
- **Ports:** 5191 / 48011.

Read first:
- `docs/frontend-spec.md` §5 Settings (category list, android-only keys hidden), §2 themes, §9 locale
- `docs/api.md` §3.10, §4 `settings`
- MK 9 (Settings light 1440×900)
- the v1 settings pages for the key list: `rg -l "SettingsScreen|Settings\.shared\." D:\Coding_Project\MinMusic-wt-core\desktopApp\src\jvmMain\kotlin\com\metrolist\desktop\ui\screens\settings`
- `shared/.../settings/Settings.kt` (the `by preference(...)` keys)

## Owned paths
- `ui/src/pages/Settings/{index.tsx,_dev.tsx,layout.ts,Row*.tsx,search.ts}` (replaces M1-3a's minimal shell, same glob contract)
- `ui/src/pages/Settings/{Appearance,Playback,Lyrics,Content,Privacy,Shortcuts,About}/**`
- `ui/src/state/settings.ts`: the store fed by the `settings` topic. It replaces `state/prefs.ts` usage for theme and locale (M1-3a); keep `prefs.ts` as a thin adapter
- `mock-core/src/handlers/settings.ts`, `mock-core/fixtures/settings/schema.json`
- `tests/contract/suites/m4-settings.mjs`
- `ui/src/i18n/extra/{en,vi}/m4-1b.json`, `ui/src/icons/m4-1b.svg`
- `tests/e2e/web/m4-1b.spec.ts`, `tests/e2e/app/m4-1b.spec.ts`

Not yours: `Settings/{Sources,Integrations}` (M3-3), `Storage`/`Downloads` (M4-2b), `Backup` (M4-3b), `Import` (M4-4b), `Updates` (M5-2), `DeviceConnect` (M3-4b).

## Work
- **Shell:** grid of a 248 px category list + a detail pane ≤ 760. Categories come from the glob, ordered by `category.order`:
  - Giao diện 10, Phát nhạc 20, Nguồn nhạc 30, Tải xuống 40, Lời bài hát 50, Equalizer 60 (link to the route), Bộ nhớ 70, Tích hợp 80, Phím tắt 90, Quyền riêng tư 100, Sao lưu 110, Cập nhật 120, Giới thiệu 130
  - Ctrl , opens; route `settings {page}`
- **Rows:** generated from `settings.schema` + `layout.ts`. The layout lists every desktop key of the v1 pages PLAYER, CONTENT, PRIVACY, LYRICS (+AI keys via `lyrics.ai.setKey`, romanization, sources), APPEARANCE (+desktop group: `desktopFloatingPlayerBar`, `minimizeToTrayOnClose`, `desktopMiniPlayerWindow`, `desktopMiniPlayerOnMinimize`, `desktopTaskbarButtons`, `desktopTrayToggleOnClick`, `desktopSidebarDocked`), UPDATES-independent keys. Android-only keys (`platform:"android"`) are hidden.
- **Row types:** Switch, Seg/Select (enum), Slider/Stepper (int/float with min/max/step), text, secret (`{set}` → "Đã đặt" + change/clear via dedicated methods). `settings.set` is optimistic with rollback on `bad_request`.
- **Search:** filters rows by translated label across categories and highlights the match. Esc clears.
- **Shortcuts page:** the frontend-spec §7 table, read-only. Ctrl ` / Ctrl / open the same sheet as a dialog.
- **About:** `app.info`, versions, data dirs (open folder via `open_log_folder`-style commands), licenses, Chẩn đoán (job-assignment status from `core_status`).
- **Theme/locale:** `themeMode` (enum `LIGHT|DARK|PURE_BLACK|AUTO`: `PURE_BLACK` → `data-theme=black`, `AUTO` → system) and `appLanguage` from the `settings` store drive `<html data-theme>` and i18n live.
- **Mock schema:** generate `fixtures/settings/schema.json` with `mock-core/scripts/gen-settings-schema.mjs`. It parses `Settings.kt` delegates (key, type, default, enum values) by regex from the MinMusic worktree, marks android-only keys from a list in the script, and is committed. M4-1a must produce the same keys on real.

## Verify (cheap)
1. Vitest: layout table covers every schema key exactly once, or lists it in `layout.ts` `hidden` with a reason (the test fails on an unknown key); search filter; optimistic rollback.
2. Contract `m4-settings.mjs` green on the mock (`settings.get` of a secret → `{set}` only; `bad_request` on a type/range violation).
3. Web Playwright E-50…E-52 (every key rendered once on its page; search filters; theme/lang switch live). STATUS line.
