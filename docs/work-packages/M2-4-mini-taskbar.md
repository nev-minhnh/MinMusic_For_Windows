# M2-4: Mini-player window, taskbar thumbnail buttons and progress, Ctrl M

**Wave 3** (start after INT-W1: needs M1-4 `corelink` and the marked blocks). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M2-4`, branch `wp/M2-4`.
- **Ports:** 5190 / 48010.

Read first:
- `docs/architecture.md` §5 (taskbar, mini player)
- `docs/frontend-spec.md` §5 Mini player, §7 Ctrl M
- `docs/api.md` §4 `player`, §6 `mini_toggle` / `mini_set_mode`
- `src-tauri/src/{corelink,tray}/**` (M1-4)

## Owned paths
- `src-tauri/src/{mini,taskbar}/**`, the `M2-4` blocks in `main.rs`, `src-tauri/capabilities/m2-4.json`, `src-tauri/icons/thumb/*.ico`
- `ui/src/mini/**` (MiniApp; `ui/src/main.tsx` already routes `#/mini`, else M1-3a adds the branch at INT)
- `ui/src/input/commands/mini.ts`, `ui/src/i18n/extra/{en,vi}/m2-4.json`, `ui/src/icons/m2-4.svg`
- `tests/e2e/app/m2-4.spec.ts`, `tools/taskbar-probe.ps1`

## Work
| Part | Content |
|---|---|
| `mini/` | `WebviewWindow` label `mini`: 320×88 (square mode 320×320), `always_on_top`, no decorations, `skip_taskbar`, URL `index.html#/mini`. Position persisted in `shell.json` (`miniRect`) through M1-4's `window_state`. Commands `mini_toggle`, `mini_set_mode {"bar"|"square"}`. Minimise of main with `desktopMiniPlayerOnMinimize` (read from `shell.json` until INT-W4 wires settings) opens mini. Closing mini returns to main |
| `ui/src/mini/` | MiniApp with its own ws client (role `mini`, `player` sub only): art 64, title/artist, prev/play/next, 2 px progress line (CSS animation per frontend-spec §6.4). Double-click or Esc → main + close mini. Square button switches mode. Drag region on the art |
| `taskbar/` | `ITaskbarList3::ThumbBarAddButtons` (prev, play/pause, next) on the main hwnd after `TaskbarButtonCreated`. Icons from `src-tauri/icons/thumb/*.ico` (generate 16/20/24/32 px ICOs from the Material icons; small Node script under `scripts/gen-thumb-icons.mjs`). `WM_COMMAND` via the window subclass (reuse M1-4's `snap` subclass hook if it exists; else a separate `SetWindowSubclass` id). Play/pause icon follows `player.state`. Toggle `desktopTaskbarButtons`. `SetProgressValue/State` **for downloads only** (`downloads` topic: green running, yellow paused, none idle). Until M4-2a it is fed by the mock or absent |
| Ctrl M | Command in `commands/mini.ts` → `invoke('mini_toggle')` |

## Verify (cheap)
1. `cargo check` + `cargo test`: button-state mapping from `PlayerState` JSON, download progress → taskbar state mapping, mini rect clamp.
2. Vitest for MiniApp rendering on the mock; web Playwright of `#/mini` at 320×88 (screenshot).
3. **Specs for integration:** `tests/e2e/app/m2-4.spec.ts` E-34 (Ctrl M opens a 320×88 always-on-top window; its controls work; Esc returns). `tools/taskbar-probe.ps1` + E-35 (buttons present via UI Automation on the taskbar thumbnail, or by sending `WM_COMMAND` ids and observing `player.state`). STATUS line.
