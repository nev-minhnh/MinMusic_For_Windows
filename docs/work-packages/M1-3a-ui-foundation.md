# M1-3a: UI foundation (router registry, menus, selection, drag, dialogs, sidebar)

**Wave 1. Agent:** Sonnet. Conventions apply (`conventions.md`); this WP *implements* the UI side of its shared-file scheme. **Worktree:** `D:\Coding_Project\MinMusic_4_Windows-wp\M1-3a`, branch `wp/M1-3a` from `main`.
**Ports:** web `MM_WEB_PORT=5181`, mock `MOCK_PORT=48001`.

**Push early, in two stages, because M1-3b/c/d build on it:**
- **Stage 1, ≤ 2 h:** registry, folders, i18n/sprite/CSS sections. Push, then append a line to `D:\Coding_Project\MinMusic_4_Windows-wp\STATUS.md`.
- **Stage 2, ≤ 6 h:** Menu, Dialog, Toast, selection, drag, row/card props, sidebar. Push and add a STATUS line.

Read first:
- `docs/frontend-spec.md` §3, §5 (Search and Library intros, Dialogs, Toasts), §6 (all), §7, §8, §9
- `docs/api.md` §1.8B, §2, §3.4 (`userAlbum.*`, `track.like`, `import.files`), §3.6 (`queue.add`, `queue.addContext`), §4 `library`
- LS §5.3 (context menus) and §5.4 (Esc). MK frame 3 (Search, with the open context menu and submenu flipped left) and MK frame 4 (Library, with the drag onto the sidebar album), in `D:\Coding_Project\MinMusic-notes\design\desktop\desktop-mockups.html`

## Goal
Every M1 page WP plugs into shared infrastructure without editing a shared file. This WP delivers:
- a route registry
- the context menu and its builders
- multi-selection
- drag and drop
- dialogs and toasts
- the final sidebar and rail
- the complete M1 keyboard map
- live theme and locale switching

## Owned paths
- `ui/src/router/**`, `ui/src/shell/{App,Sidebar,Rail,TitleBar}.tsx` (TitleBar: everything except the search field component, see M1-3b), `ui/src/input/**`, `ui/src/lib/**`, `ui/src/state/**`
- `ui/src/components/**`. New components go here too. Page WPs never edit this folder. They ask through STATUS.md, or build a page-local component.
- `ui/src/menus/**`, `ui/src/dialogs/{Dialog,Confirm,Prompt}.tsx`, `ui/src/toast/**`
- `ui/src/styles/**`, `ui/src/icons/**`, `ui/src/i18n/{index.ts,en.json,vi.json}`, `ui/src/i18n/extra/{en,vi}.json`, `ui/tools/**`
- `ui/package.json`, `ui/tsconfig.json`, `ui/index.html`, `ui/src/main.tsx`
- `tests/e2e/web/m1-foundation.spec.ts`, `tests/e2e/app/m1-foundation.spec.ts`

**Moves done in stage 1 (`git mv`, no content change):**
- `ui/src/pages/Home.tsx` → `ui/src/pages/Home/index.tsx`
- `Library.tsx` → `Library/index.tsx`
- `Album.tsx` → `Album/index.tsx`

After stage 1 these belong to M1-3b, M1-3c and M1-3d respectively.

## Stage 1: shared-file rules that make the page WPs conflict-free
| Mechanism | Rule |
|---|---|
| **Route registry** | `router/routes.ts` exports `RouteName` with **every** name from frontend-spec §3: `home search library liked downloads history stats album userAlbum artist artistAbout playlist podcast charts browse equalizer settings listenTogether onboarding`. `router/View.tsx` builds `PAGES` from `import.meta.glob("../pages/*/index.tsx", { eager: true })`. Each page module exports `export const routes: RouteName[]` and `export default` the component (`PageProps`). A route with no page renders `pages/_Missing` (an empty state, `data-testid="missing-page"`). Page WPs never touch the router |
| **Nav helper** | `lib/nav.ts`: `navTo(t: NavTarget)` maps api.md `NavTarget` to `navigate()`. Unknown routes log via `app.log` and do nothing. `openItem(item: Item)` encodes the default click rules: track → album (else artist), album → album, artist → artist, playlist → `userAlbum` if `local` else playlist |
| **i18n** | `tools/gen-strings.mjs` additionally merges every `ui/src/i18n/extra/<locale>/*.json`; on a key clash the build fails, naming both files. Every WP owns `extra/{en,vi}/<wp>.json`. The existing `extra/{en,vi}.json` stay as they are, owned here |
| **Icons** | Icons become one file per WP: `ui/src/icons/<wp>.svg` (only `<symbol>` elements). The existing sprite becomes `icons/m0.svg`. The Icon host injects one hidden `<svg>` built from `import.meta.glob("../icons/*.svg", {query:"?raw", import:"default", eager:true})`, and the build fails on a duplicate `id`. Put the icon list below into `icons/m1-3a.svg` |
| **Settings categories** | `pages/Settings/index.tsx` is a minimal shell for now: it globs `./*/index.tsx` (exports `category = {key, order, icon, titleKey}` + default) and shows a 248 px category list with the detail pane. M4-1b replaces it later. Add `pages/Settings/_dev.tsx`, reachable in dev/e2e builds at `#/dev/settings/<key>`, which renders one category alone |
| **Commands** | `input/keys.ts` maps keys to command ids (the frontend-spec §7 table). Commands come from `import.meta.glob("./commands/*.ts", {eager:true})`, each exporting `commands: {id, run}[]`. M1 commands go in `input/commands/m1.ts`; later WPs add `commands/<area>.ts`. A key whose command id is missing logs once and does nothing |
| **Dependencies** | Add to `ui/package.json` now, for all milestones: `@tauri-apps/api@2`, `@tauri-apps/plugin-dialog@2`, `qrcode-generator`. Nobody else edits `package.json` |
| **CSS** | Page CSS lives next to the page (`pages/<Name>/<name>.css`, imported by the page). Class names are prefixed with the page name (`.srch-`, `.lib-`, `.alb-`, `.art-`). `styles/base.css` is owned here: shared row, table, header and card styles live there |
| **Types** | New code imports types from `@minmusic/protocol`. `lib/types.ts` becomes a re-export shim of the protocol types plus the 2 UI-only types. Fix the existing imports in owned files; the moved pages keep compiling |
| **Store helpers** | `state/library.ts` `createWindowStore(list, sort, filter?)` serves any `LocalList` (including `userAlbum:<id>` and `history`). It drops chunks with an older revision on `library.changed` (topic `library`) and exposes `indexOf(id)` via `library.indexOf`. `state/userAlbums.ts` replaces `albums.ts`: it is fed by `userAlbum.list`, refreshes on `userAlbums.changed`, and provides `pinned()` and `all()` |

Icon list (Material Symbols Rounded 400; filled only where frontend-spec §2 allows): `queue_play_next, playlist_add, library_add, download, link, info, person, album, delete, edit, image, push_pin, check, chevron_right, history, bar_chart, explicit, block, swap_horiz (Chọn nguồn), radio, close, add, open_in_new, sort, filter_list, arrow_back`, plus `music_note` as the empty-art placeholder.

## Stage 2: components and behaviour
| Path | Content |
|---|---|
| `components/Menu.tsx` + `menus/{song,card,userAlbum,types}.ts` | Context menu per LS §5.3: width 272, item height 36, icon 20, a right-aligned shortcut hint, separators. Submenus open on hover after 200 ms or with →. They **flip left** when they would overflow, and flip up near the bottom. Keyboard: ↑↓, Home/End, Enter, ← closes the submenu, Esc closes (Esc stack). Opened by right-click, Shift F10 or the Menu key on a focused row or card. It is opened at the pointer, clamped to the window. Open: opacity plus `translateY(-4px→0)`, `--m-std-in`. `menus/song.ts` `songMenu(tracks: Track[], ctx: {userAlbumId?, entryIds?})` returns the MK-order items (list below). `card.ts` covers album, playlist and artist cards. `userAlbum.ts` adds Đổi tên (F2), Đổi ảnh bìa and Xoá (Del, with confirmation) |
| `lib/selection.ts` | `createSelection(keys: () => string[])`. Click selects one. Ctrl+click toggles. Shift+click selects a range from the anchor. Ctrl A selects all (only when the list has focus). Esc clears, as one Esc-stack layer while non-empty. Enter plays the selection (the caller supplies the play function). The row gets `aria-selected` and the `.sel` class |
| `lib/dnd.ts` | Native HTML5 drag of selected rows. The payload is MIME `application/x-mm-tracks` = `{ids:string[], from?:string}`, and the drag image is a small pill "N bài hát" (rendered off-screen once). Drop targets: sidebar user albums (`userAlbum.add {id, trackIds, dedupe:true}` → toast "Đã thêm N · bỏ qua M"); the player bar / queue button (`queue.add {ids, position:"end"}`); and, for a page that opts in, reorder within a user album. Reorder shows a 2 px accent drop line placed by `transform`; the page supplies `onReorder(from,to)`. Window drop of audio files (`dataTransfer.files` with an audio extension) calls `import.files {paths}`. Paths come from the Tauri drag-drop event (`tauri://drag-drop` gives real paths); in the web project drop is a no-op. Drag must never start a layout-affecting animation |
| `components/Row.tsx`, `Card.tsx`, `Tile.tsx` | New optional props: `selected`, `onSelect(e)`, `onContext(e)`, `draggable`, `dragIds()`, `playing` (accent text plus the equalizer-bars glyph), `showSource` (source badge). Hover behaviour stays CSS-only (rule 9). No new per-row listeners: delegate at the list container (one `pointerdown`/`contextmenu`/`dragstart` listener per list, row resolved via `data-key`) |
| `components/Table.tsx` | The songs table used by Library, Album, UserAlbum, Playlist, History and Liked. It wraps `VirtualList`, columns per frontend-spec §5 Library (`#`, Tiêu đề, Album, Đã thêm, ♥, ⏱, …) with per-page column sets, hide rules (< 880 hides Đã thêm, < 720 hides Album), a sticky 40 px header with sort-by-click (emits `SortSpec`), `role="grid"`, and arrow-key row navigation. Short lists (≤ 60) render without virtualisation. Exports `data-testid="song-row"` on rows and `data-testid="songs-table"` |
| `dialogs/{Dialog,Confirm,Prompt}.tsx` | 448 wide, r28, scrim 60 % (42 % on light), focus trap, Enter submits, Esc cancels, focus returns to the invoker. Open uses opacity plus `scale(.98→1)`. `prompt({title, label, value})` → `Promise<string|null>` (create and rename album). `confirm({title, body, danger})` |
| `toast/**` | `toast({i18n|text, args, level, action?})`. Placement: bottom-centre, 8 px above the player bar, max 560, surface3. Duration 4 s, paused on hover. At most 1 visible plus a queue of 3. `aria-live=polite`. It also renders `app.toast` events from the `app` topic (`action` → `client.call(action.m, action.p)`) |
| `shell/Sidebar.tsx`, `Rail.tsx` | Final per LS §3.1/§3.2 and MK 1. Nav: Trang chủ, Tìm kiếm, Thư viện. Lối tắt: Đã thích, Đã tải, Gần đây (history), Thống kê, Equalizer (route exists, page in M2). Counts come from `library.counts` and the `library` topic. "Album của tôi": pinned first, then the rest. Each entry is a drop target (hover state = accent outline via an opacity overlay). Right-click opens `userAlbum` menu. "+" creates an album via `prompt` → `userAlbum.create`. Width: drag 216–320, persisted via the shell command `shell_settings_set {sidebarWidth}` (M1-4), falling back to `localStorage` outside Tauri. Ctrl B docks or undocks (expanded) and toggles the overlay sidebar (medium). Remove the hard-coded counts |
| `shell/App.tsx` | Mounts Toasts and the Menu host. Listens for the Tauri event `mm-nav` (payload `NavTarget`, emitted by M1-4 after a deep link) → `navTo`. Applies theme and locale from `state/prefs.ts` |
| `state/prefs.ts` | `theme: "system"|"dark"|"black"|"light"`, `lang`. Live switching, no reload (E-12). Persisted in `localStorage` until M4 binds them to `settings.*`. Exposed as `window.__mmPrefs` in dev/e2e builds for tests |
| `input/keys.ts` | The complete frontend-spec §7 table, routed to commands. Keys whose feature is outside M1 are wired to a no-op that logs and is spied in tests: L/Q/D panes, C/V, Ctrl M, Ctrl E opens the equalizer route, F11, Ctrl , and Ctrl Shift L. Plain keys are ignored in inputs and dialogs. Ctrl C copies a link via `app.copyLink` + `navigator.clipboard`. Ctrl I opens song info (it calls `openSongInfo(id)` from `lib/songInfo.ts`; M1-3c registers the dialog implementation through `setSongInfoOpener`). Ctrl L likes the current track. Del and F2 dispatch `mm-delete` / `mm-rename` CustomEvents to the focused page |
| `state/player.ts` | Add `playNext(ids)`, `addToQueue(ids)` (→ `queue.add`), `addContextToQueue(ctx)` |

Song menu items, in MK order:
1. Phát tiếp theo (`queue.add next`)
2. Thêm vào hàng đợi (`queue.add end`)
3. Thêm vào album của tôi ›: lists user albums plus "+ Album mới"
4. separator
5. Tải xuống ›: disabled with the hint "M4" until the `download.*` methods exist (hidden when `unsupported`)
6. **Chọn nguồn ›**: lazy `track.sources` showing each option's real quality badge, ✓ on `auto`, disabled with a VIP/region hint when `available:false`; selection calls `track.setSource`
7. separator
8. Đi tới nghệ sĩ
9. Đi tới album
10. Sao chép liên kết (Ctrl C)
11. Thông tin bài hát (Ctrl I)
12. Inside a user album only: Xoá khỏi album (Del) → `userAlbum.remove`

For a multi-selection: drop Chọn nguồn, Đi tới …, Thông tin. Card menu: Phát, Trộn bài, Thêm vào hàng đợi (`queue.addContext`), Tải xuống ›, Ghim vào sidebar (user albums), Sao chép liên kết.

## Tests
- **Vitest:**
  - `router` registry: an unknown route falls back to `_Missing`; keep-alive is unchanged
  - `selection` (click, ctrl, shift range, ctrl A, Esc)
  - `menu` placement maths: flip left/up at all four edges
  - `nav.openItem` rules
  - `gen-strings` merge with a clash → fail
  - Esc order: menu → dialog → selection → back
- **Playwright web (`m1-foundation.spec.ts`):**
  - E-5 breakpoints
  - E-7 song context menu (all items in MK order, submenu flips left near the right edge)
  - E-8 drag 3 selected rows onto a sidebar album → `userAlbum.add` called plus a toast
  - E-11 the shortcut table (spy on `client.call`; plain keys ignored in inputs)
  - E-12 theme dark/black/light and VI/EN live
- **App project (`m1-foundation.spec.ts`):** context menu at 1536×960 DPR 2.5. Screenshot of the menu against the MK 3 crop.

## Done criteria (Verify: cheap checks only; integration does app builds and perf)
1. Stage 1 is pushed within 2 h. The moved pages render unchanged, and `npm -w ui test` and `npm -w ui run build` are green.
2. The tests above pass on the mock. The web suite runs with `MM_WEB_PORT=5181 MOCK_PORT=48001`.
3. `node ui/tools/lint-strings.mjs` is clean. Every new string has both EN and VI.
4. **Perf proxy (no app build):** in the web project at 1536×960 DPR 2.5, record a CDP trace of 40 wheel steps over the 5,000-row list and of opening the context menu (`tools/perf/analyze.mjs` works on any trace). The result is 0 long tasks and no frame > 16.7 ms on menu open. Wave-1 integration runs the real P1/P5.
5. JS ≤ 160 KB gzip and CSS ≤ 36 KB gzip for the whole app after this WP (report the numbers).
6. Screenshots (Playwright web) of the menu, the dialog, the toast and the sidebar drop state, compared with MK 3 and MK 4. STATUS.md line.
