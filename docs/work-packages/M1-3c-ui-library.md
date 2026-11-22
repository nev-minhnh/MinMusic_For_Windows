# M1-3c: UI Library (all filters), Liked/Downloads lists, UserAlbum, History, Stats, song info

**Wave 2** (may start before INT-W1, once M1-3a stage 2 and the M1-5 library mock are pushed). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M1-3c`, branch `wp/M1-3c`.
- **Ports:** 5183 / 48003.

Read first:
- `docs/frontend-spec.md` §5 (Library, Album/UserAlbum), §6, §7 (Del, F2, Enter, Ctrl A, Ctrl I), §8
- `docs/api.md` §1.8B, §3.4, §4 `library`
- MK frame 4 (Library 1280×800), MK frame "Album của tôi 1280×720" (UserAlbum: header 168/232, sticky 56 bar, now-playing row)
- `M1-3a-ui-foundation.md`

## Owned paths
- `ui/src/pages/{Library,Liked,Downloads,History,Stats,UserAlbum}/**`
- `ui/src/dialogs/SongInfo.tsx`
- `ui/src/input/commands/library.ts`
- `ui/src/i18n/extra/{en,vi}/m1-3c.json`, `ui/src/icons/m1-3c.svg`
- `tests/e2e/web/m1-3c.spec.ts`, `tests/e2e/app/m1-3c.spec.ts`

## Work
| Route | Behaviour |
|---|---|
| `library {filter?}` (MK 4) | Title + chips Bài hát · Đã thích · Đã tải · Album · Nghệ sĩ · Playlist. "Album của tôi" grid (from `state/userAlbums`) with the dashed "Tạo album mới" tile (`prompt` → `userAlbum.create`). Downloads summary box: `download.summary` when it answers, hidden on `unsupported` (real core until M4-2a). Song lists use `Table` + `createWindowStore(list, sort, filter)` chunks of 100. Sort by header click. Text filter field (debounced 150 ms → `FilterSpec.text`). Album/Artist/Playlist lists use a virtualised card grid with fixed row height (`library.window` with `albums/artists/playlists`). Double-click a song → `player.play {kind:"library", list, sort, filter}` + `startId`. `library.indexOf` scroll-to-playing button |
| `liked`, `downloads` | The same Table page with a fixed list and a header (count, Phát tất cả, Trộn bài) |
| `userAlbum {id}` | **Header:** art 168/232 by height class, title, count/duration, Phát (gradient), Trộn bài (tonal), ✎ rename (F2), cover (`pick_file` → `userAlbum.setCover`), pin toggle (`userAlbum.pin`), delete (confirm). **Sticky 56 bar** (art 40 + title + Phát) via `position:sticky` + an IntersectionObserver sentinel. Table of `library.window userAlbum:<id>` with sort `custom`. **Drag reorder** (M1-3a dnd `onReorder`) → `userAlbum.move {from,to,expectedRevision}`; `conflict` → refetch + toast. Del → `userAlbum.remove {entryIds}` (`Track.setVideoId` is the entry id). Now-playing row: accent + bars glyph |
| `history` | `history.window` Table with group header rows (Hôm nay / Hôm qua / …; the core returns `w2_hist_*` keys) using a fixed 32 px header row inside the VirtualList (fixed heights, no measuring). Del removes the selection (`history.remove`); "Xoá lịch sử" (confirm) → `history.clear` |
| `stats` | Seg Tuần/Tháng/Năm/Tất cả → `stats.get`. Minutes tile, top tracks (Table, 10), top artists and albums (card rows). No chart library: simple bars are scaleX transforms |
| `SongInfo` dialog | Registered with `setSongInfoOpener`. Ctrl I or the menu → `track.info`: title, artists, album, codec, bitrate, sample rate, loudness, size, path (copy) |

## Verify (cheap)
1. Vitest: group header row placement maths, sort toggling, reorder index translation, filter debounce.
2. **Web Playwright `m1-3c.spec.ts`** (all four viewports):
   - E-2 (End → row 4,999; scroll kept after Album → Back)
   - E-9 (F2 rename, Del remove, drag reorder → persists after reload on the mock)
   - E-8 (from the Library table to a sidebar album)
   - Library filters switch lists
   - History groups render
   - Ctrl I opens SongInfo
3. **Perf proxy:** CDP trace of 40 wheel steps over the 5,000-row Library table in the web project: 0 long tasks, no frame > 16.7 ms.
4. Screenshots vs MK 4 and the UserAlbum frame. STATUS line.
5. **Spec for integration:** `tests/e2e/app/m1-3c.spec.ts` (E-2, E-9 on the real seeded core).
