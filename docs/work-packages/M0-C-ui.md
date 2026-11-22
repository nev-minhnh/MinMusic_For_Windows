# M0-C: UI spike

**Agent:** Sonnet. **Branch:** `wp/M0-C`.

Read first:
- `docs/frontend-spec.md` (all of it, especially §4, §6)
- `docs/api.md` §1.10, §2, §4 `player`
- MK frames 1 (Home 1920×1080), 2 (full player), 4 (Library table), 6 and 7 (medium and compact), in `D:\Coding_Project\MinMusic-notes\design\desktop\desktop-mockups.html`

## Goal
The smallest UI that exercises every performance-critical path at final visual fidelity:
- app frame (title bar, sidebar or rails, player bar)
- the Home page
- a 5,000-row virtualized Library songs table
- an Album page (header + table) for navigation
- player bar ↔ full player transition
- stack navigation with transitions and keep-alive

## Owned paths
`ui/**` except `ui/src/core/**`, which is M0-D's. Import the client from `ui/src/core/index.ts`.

Until it lands, code against the api.md types and use a local stub with the same signatures:
- `client.call(m,p)`
- `client.sub(topic, params, onEvent) → unsubscribe`
- `artUrl(art, cssPx)`

## Files (minimum)
| Path | Content |
|---|---|
| `ui/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html` | Solid + Vite. Dev server on 5173. Build to `ui/dist` |
| `ui/src/styles/{tokens,base,fonts,motion}.css` | every token from frontend-spec §2 and §6.1; Be Vietnam Pro 400/600 woff2 (subset with `pyftsubset` or use the `@fontsource/be-vietnam-pro` files copied into `ui/public/fonts`) |
| `ui/src/icons/sprite.svg` + `Icon.tsx` | only the icons M0 uses (Material Symbols Rounded 400, from `@material-symbols/svg-400`) |
| `ui/src/router/*` | stack router with keep-alive (frontend-spec §3, §6.2) |
| `ui/src/shell/{App,TitleBar,Sidebar,Rail,PlayerBar,FullPlayer}.tsx` | width and height classes with hysteresis; custom caption buttons calling the M0-A commands (`window_minimize`, …); `ui_ready` invoked after the first Home paint |
| `ui/src/components/{VirtualList,Row,Card,Tile,Art,Badge,Progress,IconButton,Chip,Seg}.tsx` | per MK; `Art` uses `artUrl`, `decoding="async"`, `loading="lazy"`, explicit size |
| `ui/src/pages/{Home,Library,Album}.tsx` | Home per MK 1 (greeting, mood chips, quick picks, charts box, 2 card shelves); Library songs table on `library.window` chunks of 100; Album: header + 12-row table |
| `ui/src/i18n/*` | `t()` with the `tools/gen-strings.mjs` output (write the generator here, frontend-spec §9; it is a small Node script) |

Interactions required in M0:
- Click a row or card → navigate.
- Double-click a song → `player.play`.
- Space toggles playback.
- T / click art / expand button → full player. Esc closes.
- Alt ← and XButton1 go back.
- Progress per frontend-spec §6.4: CSS animation, no per-frame JS.

## Hard rules
Everything in frontend-spec §6. The coordinator rejects a PR on any of:
- an animation of non-transform/opacity properties (except the one clip-path)
- a wheel listener
- a scroll handler that writes styles
- an image without a size

## Done criteria
1. `npm run dev` + mock-core: the screens match MK 1, 2 and 4 at 1920×1080 and 1536×960 (DPR 2.5).
   - Screenshot via Playwright (`web` project) and compare side-by-side with the MK frame screenshot.
   - Fix any spacing difference > 2 px.
2. Playwright `web` E-1…E-4 pass (the tests are written by M0-E; coordinate selectors through `data-testid` names: `home`, `qp-tile`, `shelf`, `songs-list`, `song-row`, `player-bar`, `player-art`, `full-player`, `nav-back`).
3. In the real app (M0-A shell + mock or real core), `scripts/perf-trace.ps1 -Scenario P1,P3,P4 -Size 1920 -Runs 1` shows no long tasks and P1 dropped frames ≤ 1 %. Report the numbers.
4. `npm run build` output: JS ≤ 120 KB gzip for M0, CSS ≤ 30 KB gzip.
5. Self-verification as in test-guide §0.
