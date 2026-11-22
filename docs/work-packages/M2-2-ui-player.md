# M2-2: UI player complete (full player, queue pane, lyrics, sleep timer, output, volume, bar variants)

**Wave 2** (may start any time after M1-3a stage 1; mock-first). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M2-2`, branch `wp/M2-2`.
- **Ports:** 5188 / 48008.

Read first:
- `docs/frontend-spec.md` §4 (support pane), §5 (Full player, Lyrics, Queue), §6 (especially 6.3, 6.4), §7 (L, Q, T, F11, ←/→, ↑/↓, M, 0–9, S, R)
- `docs/api.md` §3.6, §3.7, §4 (`player`, `queue`, `lyrics`)
- MK frame 2 (full player 1440×900 + the progress-variants strip), MK 1 (queue pane docked)
- `ui/src/shell/{PlayerBar,FullPlayer}.tsx` (M0)

## Owned paths
- `ui/src/shell/{PlayerBar,FullPlayer,SupportPane}.tsx` and `ui/src/shell/player/**`
- `ui/src/pages/Lyrics*/**` (fullscreen lyrics is an overlay component here, not a route)
- `ui/src/state/{queue,lyrics,playerExtra}.ts`, all new. **Do not edit `state/player.ts`** (M1-3a); the extra player calls (mute, sleep, output, speed) go in `playerExtra.ts`. Attach drop targets with M1-3a's `dnd.dropTarget(el, handler)` from your own components.
- `mock-core/src/handlers/queue.ts` exists only after M1-5 stage 2. Merge `origin/wp/M1-5` before editing it.
- `ui/src/input/commands/player.ts`
- `mock-core/src/handlers/lyrics.ts`, `mock-core/fixtures/lyrics/**`
- `mock-core/src/handlers/queue.ts`: add `queue.remove/move/select/clear/radio`, `player.sleepTimer`, `player.output.*`, `player.mute`, `player.setSpeed` if missing
- `tests/contract/suites/m2-player.mjs`
- `ui/src/i18n/extra/{en,vi}/m2-2.json`, `ui/src/icons/m2-2.svg`
- `tests/e2e/web/m2-2.spec.ts`, `tests/e2e/app/m2-2.spec.ts`

## Work
| Part | Behaviour |
|---|---|
| **Full player** (MK 2) | Final fidelity. Two panes when W ≥ 960 and H ≥ 600, else one pane + a "Lời / Tiếp theo" layer. Tint from `art.dominant` clamped to L* ≤ 20, 300 ms crossfade of two stacked layers (opacity). Seg tabs Lời bài hát / Tiếp theo / Liên quan (`related.get`). Chips Karaoke and Dịch. Wavy progress variant. Device chip (output) + EQ chip (`player.state.eq`). Transition per §6.3 (keep the M0 translateY approach) |
| **Queue pane** ("Tiếp theo") | SupportPane 336 (drag 280–480, docks if content keeps ≥ 760, else overlay without scrim). VirtualList of 56 rows on `queue.window` (refetch the visible window on `queue.changed`). Sections: current, "TIẾP THEO · TỪ <context>", footer "Tự động phát" switch → `queue.setAutoplay`. Drag reorder (2 px accent line) → `queue.move {from,to,expectedRevision}`. Del → `queue.remove`. Double-click → `queue.select`. "Xoá" → `queue.clear {keepCurrent:true}`. Drop rows from any page onto the pane → `queue.add end` |
| **Lyrics** | `lyrics` topic. Line sync: current line ink, others ink3, past 72 %. Word sync: hard-edge wipe (background-clip:text, gradient stop moved by a transform on a pseudo-element mask). Scheduling is `setTimeout` to the next boundary from the interpolated clock, re-armed on every position event, with no rAF loop. Click a line → `player.seek`. A manual scroll pauses auto-follow for 4 s. Auto-follow `scrollTo({behavior:"smooth"})` at most once per line. F11 fullscreen (40/52 type, max width 960). Translate/romanize toggles → `lyrics.translate/romanize`; offset ± → `lyrics.setOffset`; "Tìm lời khác" dialog → `lyrics.search` / `choose` |
| **Bar extras** | Volume popover (slider `role=slider`), mute M, sleep timer menu (15/30/45/60/end of track/cancel → `player.sleepTimer`, remaining time shown), output picker (`player.output.list/set`), speed menu, floating player-bar variant (setting `desktopFloatingPlayerBar`, local pref until M4), progress variants (line/wavy/thick) |
| **Keys** | Every player key from §7 via `commands/player.ts` |

## Verify (cheap)
1. Vitest: lyrics scheduler (fake timers: boundaries ±50 ms vs the clock), auto-follow pause, queue window refetch on revision, tint L* clamp.
2. **Contract `m2-player.mjs`:** the mock is 100 % green. Shapes are exact per api.md §3.6/§3.7; M2-1 must pass the same suite on real.
3. **Web Playwright `m2-2.spec.ts`:** E-20…E-27 (queue reorder/remove/clear/autoplay; lyrics line/word timing ±50 ms; click to seek; manual scroll pause 4 s; F11) plus E-3 at final fidelity.
4. **Perf proxy:** CDP trace of 20 full-player open/close cycles in web: ≤ 1 dropped per transition (indicative). Lyrics playing for 60 s: 0 long tasks, no rAF loop (trace check).
5. Screenshots vs MK 2. STATUS line.
