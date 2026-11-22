# M1-3d: UI Album, Artist (+ About), Playlist, Podcast

**Wave 2** (may start before INT-W1, once M1-3a stage 2 and the M1-5 pages mock are pushed). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M1-3d`, branch `wp/M1-3d`.
- **Ports:** 5187 / 48007.

Read first:
- `docs/frontend-spec.md` §5 (Album/UserAlbum/Playlist, Artist), §6
- `docs/api.md` §3.4 (`album.save`, `artist.subscribe`, `playlist.save`), §3.5, §3.6 `player.play` (album/playlist/artist/radio contexts)
- MK "Album của tôi" frame (header style shared by Album/Playlist), LS §4 (Artist)
- `M1-3a-ui-foundation.md`

## Owned paths
- `ui/src/pages/{Album,Artist,ArtistAbout,Playlist,Podcast}/**`
- `ui/src/components/pages/**`: the shared `CollectionHeader` (art, title, meta, actions, sticky bar). M1-3c imports it read-only, or keeps its own if timing requires; note which in STATUS.
- `ui/src/i18n/extra/{en,vi}/m1-3d.json`, `ui/src/icons/m1-3d.svg`
- `tests/e2e/web/m1-3d.spec.ts`, `tests/e2e/app/m1-3d.spec.ts`

## Work
| Route | Behaviour |
|---|---|
| `album {id}` | `album.get`. `CollectionHeader`: art 168/232, sticky 56 bar via an IntersectionObserver sentinel, Phát / Trộn bài (`player.play {kind:"album", id}` with shuffle), ♥ save (`album.save`), download (disabled until M4), more menu (card menu). Track Table (no virtualisation ≤ 60). "Phiên bản khác" shelf, "Thêm từ <artist>" shelf (`moreBy`). Double-click a row → album context + `startId` |
| `artist {id}` | `artist.get`: banner 232 (feathered mask is static CSS, no filter animation), name 28, Theo dõi (`artist.subscribe`), Phát (`{kind:"artist"}`), Radio (`{kind:"radio", id}`). Shelves: top songs (5 rows + "Xem tất cả" → `artist.tracks` cursor list page within the same route, as a sub-view), albums, singles, videos, related, using the same Shelf component as Home (import `pages/Home/Shelf.tsx`, read-only). About card → route `artistAbout` (`artist.about`: bio, listeners, playcount, tags) |
| `playlist {id}` | `playlist.get` with cursor paging (sentinel; more than 60 rows switches to VirtualList with fixed rows). Save (`playlist.save`), Phát/Trộn bài (`{kind:"playlist"}`) |
| `podcast {id}` | `podcast.get` + `podcast.episodes` cursor; episode rows with a duration/progress line |

All rows use the M1-3a Table with selection, context menu, drag to the sidebar and Del where applicable.

**P3 scenario support:** Home → Album → Artist → back ×2 must be keep-alive instant: data stays in the page store, and there is no refetch on back.

## Verify (cheap)
1. Vitest: header collapse sentinel logic, cursor paging store, play-context construction per page.
2. **Web Playwright `m1-3d.spec.ts`:**
   - E-4 extended (Home → Album → Artist → Back → Back; Alt ← and XButton1; no fetch on back, spied)
   - E-10 (Artist shelves ‹ ›; a vertical wheel over a shelf scrolls the page)
   - save/subscribe toggles call the right methods
   - sticky bar appears after scrolling
3. **Perf proxy:** CDP trace of 20 push/pop transitions in the web project: ≤ 1 dropped frame per transition (indicative).
4. Screenshots vs MK headers. STATUS line.
5. **Spec for integration:** `tests/e2e/app/m1-3d.spec.ts` (E-4, E-10 on real live ids from `tests/contract/fixtures/live-ids.json`).
