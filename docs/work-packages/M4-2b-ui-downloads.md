# M4-2b: UI downloads (Library box, Downloads page, queue, folder, save-to) + Storage settings

**Wave 4** (may start before INT-W3; mock-first). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M4-2b`, branch `wp/M4-2b`.
- **Ports:** 5194 / 48014.

Read first:
- `docs/frontend-spec.md` §5 Library (downloads box), Settings
- `docs/api.md` §3.9, §4 `downloads`, §1.9 (`download.progress` ≤ 2 Hz)
- MK 4 (the "Đã tải" box: quality distribution, folder, progress; original format kept, never re-encoded)

## Owned paths
- `ui/src/pages/Downloads/**`: the route `downloads` page. It replaces M1-3c's simple list; take the folder over at INT-W4 (M1-3c is merged by then) and keep its Table usage.
- `ui/src/components/downloads/**` (DownloadsBox used by Library: the one-line mount in `pages/Library` is done by you at INT, owner-approved)
- `ui/src/pages/Settings/{Downloads,Storage}/**`
- `ui/src/menus/download.ts`: the "Tải xuống ›" submenu builder; M1-3a's song/card menus call `downloadMenu()` when it exists (glob `menus/ext/*.ts` → place it at `ui/src/menus/ext/download.ts`)
- `ui/src/state/downloads.ts`
- `mock-core/src/handlers/downloads.ts`, fixtures
- `tests/contract/suites/m4-downloads.mjs`
- `ui/src/i18n/extra/{en,vi}/m4-2b.json`, `ui/src/icons/m4-2b.svg`
- `tests/e2e/web/m4-2b.spec.ts`

## Work
- **DownloadsBox:** count, bytes, quality distribution bars (scaleX), folder + "folderOk" warning, active progress, pause/resume.
- **Downloads page:**
  - tabs Đã tải (`download.window` Table) / Hàng đợi (`download.queue`, per-item progress as a transform, state, error + retry)
  - cancel all, pause/resume, retry failed, remove (confirm, `deleteFiles:true`), "Lưu bản sao…" (`pick_folder` → `download.saveTo`)
- **Menu "Tải xuống ›":** quality list with sizes (from `track.sources` qualities), remembered default; album/playlist/user album → `download.context`.
- **Settings → Tải xuống:** folder (`pick_folder` → `download.setFolder`; errors `not_writable`/`missing` inline; "Mặc định" → null), quality default, plus the related settings keys from the schema.
- **Settings → Bộ nhớ:** `storage.usage` bars + limits, clear buttons (`storage.clear`, confirm).
- **Note:** `menus/ext/*.ts` glob support in M1-3a's menu builders is a one-line change at INT-W4 if M1-3a did not add it; record it in STATUS.

## Verify (cheap)
1. Vitest: progress coalescing (≤ 2 Hz rendering), quality bar maths.
2. Contract `m4-downloads.mjs` green on the mock (including `import.files` shape).
3. Web Playwright E-53 (folder change via a dialog stub) + the queue flows. STATUS line.
