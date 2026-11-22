# Frontend spec (ui/)

This spec builds on three sources, and wherever they conflict the source wins:
- `D:\Coding_Project\MinMusic-notes\design\desktop\desktop-layout-spec.md` (**LS**)
- `desktop-mockups.html` (**MK**)
- `design\design-system.md` (**DS**)

Before building a screen, open its MK frame in Edge at 100 % zoom and match it pixel-for-pixel at 1 CSS px = 1 dp.

## 1. Stack and structure
```
ui/
  index.html               main + mini entry (hash route #/mini selects the mini app)
  src/main.tsx             mounts <App/> or <MiniApp/>
  src/core/                client.ts (ws RPC, reconnect, subs), art.ts, stores/*.ts (player, queue, library, settings, eq, account, downloads)
  src/router/              stack router (§3)
  src/styles/              tokens.css, base.css, fonts.css, motion.css
  src/i18n/                generated {locale}.json + t()/plural()
  src/components/          Button, IconButton, Chip, Seg, Switch, Slider, Stepper, Badge, Art, Row, Card, Tile, Menu, Dialog, Toast, Tooltip, VirtualList, Progress
  src/shell/               TitleBar, Sidebar, Rail, PlayerBar, SupportPane, FullPlayer, Overlays
  src/pages/               Home, Search, Library, Album, Artist, Playlist, UserAlbum, History, Stats, Downloads, Equalizer, Settings/*, ListenTogether, Charts, Browse, Onboarding
  src/mini/                MiniApp
  src/icons/               sprite.svg (generated from @material-symbols/svg-400 rounded + filled variants actually used)
```

Pinned dependencies (exact versions in `package.json`):
- `solid-js@1.9.x`
- `@tanstack/solid-virtual`
- `@tauri-apps/api@2`, `@tauri-apps/plugin-dialog`
- `qrcode-generator`
- Dev: `vite`, `vite-plugin-solid`, `typescript`, `vitest`, `@playwright/test`

Nothing else without an architect note in this file.

## 2. Tokens, fonts, icons
- **`tokens.css`:** every value from DS / the design extract, as custom properties named exactly as in MK (`--bg --s1 --s2 --s3 --ink --ink2 --ink3 --line --hov --acc --acc-t --acc-c --on-acc-c --gold --gold-c --menu-sh --grad`, plus spacing `--sp-4…--sp-64` and radii `--r-xs 4, --r-sm 8, --r-md 12, --r-lg 16, --r-xl 20, --r-sheet 28`).
- **Themes:** `[data-theme=dark|black|light]` on `<html>`. Default follows Windows `prefers-color-scheme`. The setting `selectedThemeMode` overrides it.
- **Fonts:** Be Vietnam Pro 400/600, self-hosted woff2 subset (latin, latin-ext, vietnamese), `font-display:swap`, `<link rel=preload>` for 400 and 600. Use `font-variant-numeric: tabular-nums` on times and EQ values.
  - Type classes: `.t12` 12/18, `.t14` 14/20, `.t20` 20/28, `.t28` 28/36 (-0.2px). The only exception is fullscreen lyrics at 40/52 (owner decision 5).
- **Icons:** Material Symbols Rounded 400 as an SVG sprite (`<use href="#i-home">`), 20 px in 36 px buttons. Filled variants are used only for the active nav item, play/pause/skip, a liked heart and the selected EQ band.
- **Logo:** `minmusic-logo-owner.png` exported to `ui/public/logo-{24,28,48,96}.png` and `.ico`. Always the coloured logo, never recoloured, never a white glyph.

## 3. Routing and navigation
The router is a custom stack (`src/router/`):

```ts
type Route = { name: RouteName; params: Record<string,string>; key: string /* unique per push */ }
navigate(name, params), back(), forward(), replace(...)
```

- **Keep-alive:** the current page and the 4 previous entries stay mounted. Hidden pages get `content-visibility:hidden; visibility:hidden` (not `display:none`), so their scroll position and layout cache survive. Older entries unmount and store `{scrollTop, focusedKey}` to restore.
- **Back and forward input:** mouse XButton1/2, Alt ←/→, and the title-bar arrows. Backspace never navigates.

| RouteName | Params | Page | MK frame |
|---|---|---|---|
| home | – | Home | 1, 6, 7 |
| search | q, source?, type? | Search results | 3 |
| library | filter? | Library | 4 |
| liked, downloads, history, stats | – | Library list views | 4 (table) |
| album | id | Album | 5 (header style) |
| userAlbum | id | Album of mine | 5 |
| artist / artistAbout | id | Artist | (LS §4) |
| playlist / podcast | id | Playlist | 5 |
| charts | source, key? | Source charts | 1 (box, full page) |
| browse | browseId, params? | Browse / mood | 1 (shelves) |
| equalizer | autoEqQuery? | Equalizer | 8 |
| settings | page | Settings (LS §5.7) | 9 |
| listenTogether | – | Listen Together | (v1 screen) |
| onboarding | – | first-run only when the DB does not exist | – |

Overlays are not routes, but they are part of the Esc stack (§7): full player, lyrics fullscreen, support pane, context menus, dialogs, overlay sidebar, Device Connect panel.

## 4. Layout shell
- The app grid matches MK `.win`: columns `var(--sb) minmax(0,1fr) auto`, rows `var(--tb) minmax(0,1fr) var(--pb)`.
- The window has no native decorations. Use the custom TitleBar (LS §5.1), `data-tauri-drag-region` on empty areas, and caption buttons 46 wide with close hover `#C42B1C`.
- **Snap Layouts:** the maximize button must work. The shell answers `WM_NCHITTEST` with `HTMAXBUTTON` for that button's rect, which the UI reports through the command `caption_rects {max:[x,y,w,h]}` on every resize.
- **Width classes** (computed from `innerWidth`, with 16 px hysteresis, debounced to the end of the resize):

| Class | Width | Nav | `--g` | Player bar | Search |
|---|---|---|---|---|---|
| compact | < 840 | Rail64 | 16 | 64 | hidden (Ctrl K overlay) |
| medium | 840–1199 | Rail80 (+ overlay Sidebar on ☰ / Ctrl B) | 24 | 80 | 360 |
| expanded | ≥ 1200 | Sidebar 256 (drag 216–320; collapsible to Rail80, persisted) | 32 | 88 | 480 |

- **Height classes:** short < 760 (title bar 40, player bar 72/72/64), regular, and tall ≥ 1000 (LS §2.2 numbers for album art 168/232, full-player art cap 320/440/520, EQ graph 220/280/360).
- **Expanded content:** max width 1600, centred.
- **Support pane:** 336 wide (drag 280–480). It docks when the content keeps ≥ 760, otherwise it overlays with no scrim. It is closed by default (owner decision 5).
- **Note:** at 3840×2400 with 250 % scaling the CSS viewport is 1536×960 (expanded, regular). At 1920×1200 and 100 % it is 1920×1200 (expanded, tall). Test both.

## 5. Screens (behaviour beyond MK)
**Home (MK 1)**
- Greeting row and mood chips.
- Quick picks: `clamp(floor(W/280),3,6)` columns, or 2/3 in compact/medium.
- Charts box with the Zing/NCT/YT segmented control.
- Shelves of 184 cards with ‹ › 36 buttons. Shelves scroll horizontally only through the buttons, Shift+wheel and touchpad. Use `overflow-x:auto; scroll-snap-type:x proximity`, and never translate a vertical wheel into horizontal scroll.
- Render the cached Home from IndexedDB (`mm.home.v1`) immediately. When `home.updated` arrives, swap shelves by key without a fade.

**Search (MK 3)**
- Ctrl K or `/` focuses the field. Suggestions appear in ≤ 8 rows (120 ms debounce). Enter runs the search.
- Results replace the content: chips (Tất cả, sources, types), top result 5fr / songs 7fr when W ≥ 1024, then the album shelf.

**Library (MK 4)**
- Filter chips, the "Album của tôi" shelf with a dashed "Tạo album mới" tile, and the downloads summary box.
- Songs table on VirtualList with `library.window`. Columns: # · Tiêu đề · Album · Đã thêm · ♥ · ⏱ · …. Hide "Đã thêm" below 880 and "Album" below 720.

**Album / UserAlbum / Playlist (MK 5)**
- Header with 168/232 art. It collapses to a sticky 56 bar using `position:sticky` and an IntersectionObserver sentinel, so there are no scroll handlers.
- Gradient "Phát", tonal "Trộn bài", download, edit and more.
- User albums: drag reorder (`queue.move` semantics with `userAlbum.move`), F2 renames, Del removes.

**Artist:** banner 232 (feathered), name 28, Theo dõi, then shelves top songs (5 rows plus "Xem tất cả"), albums, singles, videos, related, and an About card (`artist.about`).

**Full player (MK 2):** two panes when W ≥ 960 and H ≥ 600, otherwise one pane plus a "Lời / Tiếp theo" layer.
- Tint layer from `art.dominant`, clamped by L*, cross-fading over 300 ms.
- Seg tabs: Lời bài hát / Tiếp theo / Liên quan. Chips: Karaoke and Dịch.

**Lyrics**
- Line synced: current line ink, others ink3, past lines at 72 %.
- Word synced: a hard-edge wipe using `background-clip:text` with a 2-stop gradient whose stop is moved by `transform` on a pseudo-element mask. No per-frame JS.
- Click a line to seek. A manual scroll pauses auto-follow for 4 s.
- Auto-follow uses `scrollTo({behavior:"smooth"})` on the lyrics scroller, at most once per line change.
- F11 toggles lyrics fullscreen (40/52 type, centred, max width 960).

**Queue (pane "Tiếp theo")**
- VirtualList of 56 rows. Sections: current row, then "TIẾP THEO · TỪ …", then "Xoá".
- Drag to reorder with a 2 px accent drop line. Del removes. The footer holds the Tự động phát switch.

**Equalizer (MK 8)**
- The graph is one `<canvas>` (not SVG nodes), redrawn only on change. The curve comes from `eq.response`; between responses, while dragging, the UI draws its own local biquad approximation.
- Node hit radius 24. Dragging moves frequency (x, log) and gain (y). Wheel changes Q; Shift+wheel is fine gain. Double-click sets 0 dB.
- Inspector steppers. 11 vertical faders, or horizontal rows below 720.
- Effects card and per-device card. Buttons: Nhập/Xuất APO, AutoEq wizard dialog, profile chips, "+ Lưu hồ sơ".
- Spectrum: an optional `eq.spectrum` sub that draws on the same canvas behind the curve, only while the page is visible.
- Keyboard: Tab/↑↓ selects a band. With a node selected, ←→ moves 1/12 octave and ↑↓ moves 0.5 dB (Shift: 0.1).

**Settings (MK 9)**
- Grid of 248 categories + detail ≤ 760. Categories: Giao diện, Phát nhạc, Nguồn nhạc, Tải xuống, Lời bài hát, Equalizer (link), Bộ nhớ và bộ đệm, Tích hợp (Last.fm, ListenBrainz, Discord, Device Connect, Listen Together, Nhập playlist), Phím tắt, Quyền riêng tư, Sao lưu, Cập nhật, Giới thiệu.
- Rows are generated from `settings.schema` plus a per-page layout table in `src/pages/Settings/layout.ts`. It lists every desktop key from the v1 settings pages: PLAYER, CONTENT, PRIVACY, LYRICS (+AI, romanization, sources), APPEARANCE (+desktop group: `desktopFloatingPlayerBar`, `minimizeToTrayOnClose`, `desktopMiniPlayerWindow`, `desktopMiniPlayerOnMinimize`, `desktopTaskbarButtons`, `desktopTrayToggleOnClick`, `desktopSidebarDocked`), STORAGE, SOURCES, UPDATES, DEVICE_CONNECT.
- Android-only keys (`keepScreenOnMode`, `stopMusicOnTaskClear`, gestures, `forceBottomNavBar`, …) are hidden.
- Settings search filters rows by their translated label.

**Dialogs:** NCT login (MK 10), Last.fm login (same component), create/rename album, confirm delete, AutoEq, song info (Ctrl I), shortcuts sheet (Ctrl `), backup/restore, Device Connect panel (QR, devices, SAS confirm), log viewer (Ctrl Shift L). All use 448 width, r28, scrim 60 % (42 % on light), focus trap, Enter submits, Esc cancels.

**Web logins** (Google, Zing, Spotify, …) are shell windows. The UI only shows a "Đang chờ đăng nhập…" inline state on the Settings row.

**Mini player** (`#/mini`, 320×88 window): art 64, title/artist, prev/play/next, 2 px progress line. Double-click or Esc returns to the main window; the "square" button switches to 320×320 art mode. It has its own ws client with role `mini` and subscribes to `player` only.

**Toasts:** bottom-centre, 8 px above the player bar, max 560, surface3, 4 s (paused on hover), at most 1 visible plus a queue of 3.

**Close behaviour (owner decision 3):**
- × hides the main window to the tray. Music keeps playing and both processes stay alive.
- The first time per install, show the tray balloon "MinMusic vẫn đang phát trong khay hệ thống".
- Quitting happens only from the tray "Thoát", Ctrl Q, or × when `minimizeToTrayOnClose=false`.
- Minimise with `desktopMiniPlayerOnMinimize=true` opens the mini player.

## 6. Performance rules (enforced in review, measured in perf tests)
1. **Animate only `transform` and `opacity`.** Never animate width, height, top, left, margin, padding, border, box-shadow, filter, clip-path (except the full-player transition, see 6.3) or background-position.
2. **No `backdrop-filter`.** No `filter:blur` over 8 px, and no blur at all on anything that moves or scrolls. No `background-attachment:fixed`.
3. **`will-change: transform`** is set only for the duration of an animation, by adding a class on start and removing it on `transitionend`. Permanent exceptions: the player-bar progress fill and the full-player layer.
4. **Scrollers** use `overflow-y:auto; overscroll-behavior:contain`. Never put a non-passive `wheel`, `touchmove` or `scroll` listener on them, and never write layout-affecting styles inside `scroll` handlers (use IntersectionObserver).
5. **Wheel and smooth scrolling:** WebView2 (Chromium) smooth-scrolls wheel notches on the compositor thread by default. Do not add JS smooth-scroll, do not call `preventDefault` on wheel, do not set `scroll-behavior:smooth` on main scrollers, and do not change `--disable-smooth-scrolling`. M0 confirms the result with traces (perf criterion P1).
6. **Containment:** sections below the fold use `content-visibility:auto; contain-intrinsic-size:auto 320px`. Rows and cards use `contain: layout paint style`.
7. **VirtualList** for every list that can exceed 60 items:
   - fixed row heights (56 table, 48 sidebar, 56 queue)
   - overscan of 1 viewport
   - row components are pure and keyed by id
   - art is `loading="lazy" decoding="async"` with explicit `width`/`height`
8. **Images:** always request `artUrl(art, displayCssPx)`. No image wider than 2× its display size, and no CSS resizing of large images.
9. **Hover:** use the CSS `:hover` opacity of a pre-rendered overlay, not JS.
10. **Shadows** are static, never animated. Large shadows go on a pseudo-element whose opacity is animated instead.
11. **No main-thread task over 50 ms** during interaction. Parse big JSON (≥ 100 KB) in the ws client only, and keep list chunks at ≤ 100 items.
12. **Fonts** are loaded before the first paint (preload). There is no layout shift from font swaps.

### 6.1 Motion tokens (`motion.css`)
| Token | Duration | Easing | Use |
|---|---|---|---|
| `--m-fast` | 120 ms | `cubic-bezier(0.4,0,0.2,1)` | hover overlays, press, chip/switch |
| `--m-std-in` | 240 ms | `cubic-bezier(0.05,0.7,0.1,1)` | fades in, tabs, menus open |
| `--m-std-out` | 160 ms | `cubic-bezier(0.3,0,0.8,0.15)` | fades out, menus close |
| `--m-nav` | 300 ms | `cubic-bezier(0.05,0.7,0.1,1)` | page push: incoming `translateX(30px)→0` + opacity 0→1; outgoing opacity 1→0 in 100 ms. Pop mirrors with −30px |
| `--m-container` | 380 ms | `cubic-bezier(0.2,0.9,0.1,1)` (CSS approximation of spring damping 0.85 / stiffness 380) | mini ↔ full player, album tile → detail art |
| press | 0.96 scale | 90 ms down, 160 ms up `cubic-bezier(0.3,1.4,0.6,1)` | art in rows, tiles, play buttons |

- **Reduced motion** (`prefers-reduced-motion` or the in-app setting): every transform animation snaps (0 ms), fades become 120 ms, and the wavy progress is static.

### 6.2 Page transition
- Implemented with the Web Animations API on the page wrapper elements.
- The outgoing page is never unmounted during the animation. A newly mounted page renders first, then animates after one `requestAnimationFrame` so the first frame is not spent on layout.
- If the new page's data is not ready within 60 ms, the animation runs anyway with a skeleton (12 px r6 surface3 bars).

### 6.3 Mini player bar ↔ full player (container transform)
- The full player is a fixed layer `position:fixed; inset:0` that is always mounted after first use, with `visibility:hidden` and no layout cost while hidden.
- **Opening:**
  1. Measure the player-bar art rect A and the full-player art rect B. Both are already laid out because the layer is mounted.
  2. Set the art to `transform: translate(A−B) scale(A.w/B.w)` and the layer background to `opacity:0`.
  3. Animate to identity and `opacity:1` over `--m-container`.
  4. Player-bar content fades out over 0–25 % of the timeline. Full-player controls fade in and `translateY(16px→0)` over 35–100 %.
  5. The layer's `clip-path: inset(calc(100% - var(--pb)) 0 0 0 round 0) → inset(0)` is the single allowed clip-path animation. It is compositor-friendly in Chromium when combined with `will-change:transform` on the layer. If M0 traces show main-thread paint, replace it with a `translateY(100% - pb)` slide of the layer.
- **Closing** reverses the sequence. Esc, the collapse chevron, T or a click on the background close it.
- The artwork uses the same `artUrl(…, 520)` image in both places, so there is no decode during the transition. The bar `<img>` and full `<img>` share the URL, which is pre-requested when the bar art loads.

### 6.4 Progress and time without per-frame JS
- **Progress fill:** a `scaleX` transform on an absolutely positioned bar. On each `player.position`/`player.state`, set:
  - `--p0 = pos/dur` and `animation: mm-progress linear (dur-pos)ms forwards` from `scaleX(var(--p0))` to `scaleX(1)`
  - `animation-play-state: running|paused`
  This runs entirely on the compositor.
- **Time labels:** one `setInterval` aligned to the next whole second of the interpolated position. Paused when the window is hidden (`document.visibilityState`).
- **Interpolated clock:** `pos(now) = posMs + (performance.now() - receivedAt) * rate`, clamped to `durMs`.
- **Wavy progress:** an SVG path pattern twice the width, animated by `translateX` (CSS `linear infinite`). The played part is clipped by the same `scaleX` mask. It is paused when not playing.
- **Lyrics:** schedule `setTimeout` to the next line or word boundary from the interpolated clock, and re-schedule on every position event. Never use a rAF loop.

## 7. Keyboard, mouse, Esc stack
Shortcuts are global within the main window. Plain keys are ignored while focus is in a text field or a dialog is open (Esc still works).

| Key | Action |
|---|---|
| Space | play/pause |
| ← / → | seek −/+ `seekDurationSeconds` (default 10 s) |
| ↑ / ↓, + / − | volume ± 10 % |
| M | mute |
| 0, 1–9 | seek to 0 %, 10–90 % |
| Ctrl → / N, Ctrl ← / P | next / previous |
| S / R | shuffle / cycle repeat |
| T | toggle full player |
| L / Q / D | lyrics pane / queue pane / Device Connect panel |
| C | captions (lyrics overlay in video) |
| V / F | video mode / window fullscreen (capability `video`) |
| Ctrl K, Ctrl F, / | search |
| Ctrl , | settings |
| Ctrl ` and Ctrl / | shortcuts sheet |
| Ctrl Shift L | log viewer |
| Ctrl M | mini player window |
| Ctrl B | sidebar: expanded docks or undocks; medium toggles the overlay |
| Ctrl E | Equalizer |
| F11 | lyrics fullscreen (in the full player), otherwise window fullscreen |
| F5 | refresh current page |
| Ctrl L | like/unlike current track |
| Ctrl I | song info |
| Ctrl C | copy link of the selected item |
| Del | remove from user album / queue |
| F2 | rename user album |
| Enter | play selection |
| Ctrl A | select all in list |
| Ctrl Q | quit (new; normal-quit path) |
| Alt ← / → | back / forward |

**Esc peels one layer per press, in this order:**
1. context menu, then popovers
2. dialog
3. search: clear, then blur, then leave results
4. overlay sidebar, then overlay pane
5. Device Connect panel
6. lyrics fullscreen, then the full player
7. back stack

At the root, Esc does nothing.

**Mouse:**
- Click selects. Double-click plays the context. Ctrl+click toggles, Shift+click selects a range.
- Middle-click opens without losing scroll.
- Right-click (or Shift F10 / the Menu key) opens the context menu (MK 3: 272 wide, 36 items, submenu after 200 ms, flips left).
- Drag rows to a sidebar album or the queue. Drop audio files to import them.

## 8. Accessibility
- **Roles:** a real `<button>` for every control, `role="slider"` with `aria-valuetext` for progress, volume and faders, `role="grid"` for tables (with arrow-key row navigation), `role="tablist"` for seg controls, `aria-live="polite"` for toasts and the track-change announcement.
- **Focus:** a visible ring (2 px `--acc`, offset 2) on `:focus-visible` only. Focus is trapped in dialogs and returns to the invoker.
- **Contrast:** DS ratios. Never use the gradient for text.
- **Motion:** honour `prefers-reduced-motion` (§6.1).
- **Scaling:** at 200 % text scaling the layout must not clip. Use rem for type with `html{font-size:100%}`; layout px stay px.

## 9. Strings (i18n)
- **Source:** `core/MinMusic/shared/src/commonMain/composeResources/values*/strings.xml`. The base `values` file is English (2838 strings, 51 plurals); `values-vi` has 2571. Reuse existing keys: `home`, `search`, `library`, `settings`, `equalizer`, `lyrics`, `queue`, `liked_songs`, `downloads`, `history`, `play_next`, `add_to_queue`, `shuffle`, `sleep_timer`, `desktop_close_to_tray`, `repeat_mode_off`, …
- **Generator:** `tools/gen-strings.mjs` runs at `npm run build` and in `predev`. It writes `ui/src/i18n/<locale>.json` containing only the keys referenced in `ui/src` (static scan for `t("key"` / `plural("key"`), and converts:
  - `%1$s` / `%1$d` → `{0}`
  - escaped `\'` and `\n`
  - XML entities
  Missing keys fall back from locale to `values` (English).
- **New UI-only strings:** `ui/src/i18n/extra/{en,vi}.json`, keys prefixed `w2_` (for example `w2_core_restarting`, `w2_tray_balloon`, `w2_v1_running`). Every new key needs both EN and VI.
- **Locale:** from the setting `appLanguage` (`SYSTEM` → `navigator.language`). The app reloads its strings in place without a restart.
- **Hard-coded user-visible text in TSX is forbidden.** A lint rule (`tools/lint-strings.mjs`) fails on JSX text nodes containing letters.
