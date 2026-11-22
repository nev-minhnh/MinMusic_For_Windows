# M1-3b: UI Home (final), Search, Charts, Browse

**Wave 2** (may start before INT-W1, once M1-3a stage 2 and the M1-5 browse/search mock are pushed). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M1-3b`, branch `wp/M1-3b` from `main`. Then `git merge origin/wp/M1-3a origin/wp/M1-5` if INT-W1 has not landed yet.
- **Ports:** 5182 / 48002.

Read first:
- `docs/frontend-spec.md` §3, §5 (Home, Search), §6, §7 (search keys, Esc), §9
- `docs/api.md` §3.2, §3.3, §3.6 `player.play`, §4 `app` (`home.updated`)
- MK frame 1 (Home 1920×1080), MK frame 3 (Search 1280×800), MK 6/7 (medium and compact) in `desktop-mockups.html`
- `M1-3a-ui-foundation.md`: the registry, Menu, Table, selection, `navTo`/`openItem`

## Owned paths
- `ui/src/pages/{Home,Search,Charts,Browse}/**`
- `ui/src/shell/search/**`: the title-bar search field and the suggestions popover. `TitleBar.tsx` (M1-3a) renders `<SearchBox/>` from `shell/search/SearchBox.tsx`; M1-3a commits a stub file that this WP replaces.
- `ui/src/input/commands/search.ts`
- `ui/src/i18n/extra/{en,vi}/m1-3b.json`, `ui/src/icons/m1-3b.svg`
- `tests/e2e/web/m1-3b.spec.ts`, `tests/e2e/app/m1-3b.spec.ts`

## Work
| Page | Behaviour |
|---|---|
| **Home** (MK 1, 6, 7) | **Greeting + mood chips:** `home.get {chip}`. Chip selection swaps the shelves with no page transition; skeleton within 60 ms. **Quick picks:** `clamp(floor(W/280),3,6)` columns (2/3 in compact/medium). Double-click plays **the whole quick-pick list** with `startIndex` (context `tracks`, all ids). **Charts box:** Seg Zing/NCT/YT → `charts.get`; 2 columns of 5 rows; "Xem tất cả" → route `charts`. Row play sends **the full chart list** as `{kind:"tracks", ids, title}` + `startIndex`, which fixes "only one song plays". **Shelves:** 184 cards, ‹ › 36 buttons that scroll by `scrollBy({left: visibleWidth, behavior:"smooth"})` (button-driven only). Horizontal scroll only via the buttons, Shift+wheel or the touchpad (`overflow-x:auto; scroll-snap-type:x proximity`). Never map a vertical wheel to horizontal. `home.more` loads more shelves when a sentinel at the bottom intersects (IntersectionObserver). `home.updated` swaps shelves by `key` without a fade. IndexedDB cache `mm.home.v1` is painted first (S1). Context menus on cards/rows (M1-3a builders). Selection is not needed on Home |
| **Search** (MK 3) | **SearchBox in the title bar:** Ctrl K, Ctrl F and `/` focus it (command file). Typing debounces 120 ms → `search.suggest` with ≤ 8 rows (queries + items, keyboard ↑↓, Enter); an empty field shows `search.history.list` with a remove ✕ per row. Enter → `navigate("search", {q})`. **Results page:** chips Tất cả · YouTube · SoundCloud · Zing MP3 · NhacCuaTui (source dot colours per DS) and type chips Tất cả/Bài hát/Album/Nghệ sĩ/Playlist. W ≥ 1024: top result 5fr + songs 7fr, then the album shelf, artists and playlists. Below that, stacked. Songs use the M1-3a `Table` with source and quality badges plus "+N" alt sources. Double-click plays the songs section list. Cursor paging on typed results (sentinel). **Esc stack, 3 steps:** clear the field → blur → leave results (back) |
| **Charts** (route `charts {source, key?}`) | Full page: Seg source, tabs from `charts.get().tabs`, a Table of up to 100 ranked rows (rank, trend ▲▼ –/MỚI, delta), "Phát tất cả" / "Trộn bài" |
| **Browse** (route `browse {browseId, params?}`) | `browse.page` header + shelves (same shelf component as Home, so export it from `pages/Home/Shelf.tsx`), cursor via `next`. The moods grid (`moods.list`) is reachable from Home chips "Tâm trạng" |

**Smoothness:**
- Shelves use `content-visibility:auto` below the fold; images through `artUrl(...)` sized.
- Suggestions popover: opacity/translate only.
- No scroll handlers.

## Verify (cheap)
1. `npm -w ui test` (add unit tests: chart `startIndex` context building, suggest debounce/cancel handling, Esc order of search), `npm -w ui run build`, lint-strings.
2. **Web Playwright `m1-3b.spec.ts`** at 1536×960 DPR 2.5, 1920×1200, 1024×768, 800×600:
   - E-1 (Home from cache, quick picks columns)
   - E-6 (Ctrl K, ≤ 8 suggestions, Enter, chips filter, Esc 3 steps)
   - chart row double-click → `player.play` with ≥ 10 ids (spy)
   - shelf ‹ › and the vertical wheel over a shelf scrolls the page (E-10 for Home shelves)
3. **Perf proxy:** CDP trace in the web project of a Home top→bottom wheel scroll: 0 long tasks.
4. Screenshots vs MK 1 and MK 3 (fix > 2 px differences). STATUS line.
5. **Spec for integration:** `tests/e2e/app/m1-3b.spec.ts` (E-1, E-6 on the real core with the fixture Home + live search).
