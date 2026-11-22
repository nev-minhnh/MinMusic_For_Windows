# M3-4b: UI Device Connect panel + Listen Together page

**Wave 4** (may start before INT-W3; mock-first). **Agent:** Sonnet. Conventions apply.
- **Worktree:** `…-wp\M3-4b`, branch `wp/M3-4b`.
- **Ports:** 5193 / 48013.

Read first:
- `docs/frontend-spec.md` §5 (Dialogs: Device Connect panel), §7 (D key, Esc layer 5)
- `docs/api.md` §3.13, §3.14, §4 `lt`, `dc`
- `docs/architecture.md` §8 (QR byte-identical: use `dc.state.qrSvg`)
- The v1 Listen Together and Device Connect screens for the layout: `rg -l "ListenTogether|DeviceConnect" D:\Coding_Project\MinMusic-wt-core\desktopApp\src\jvmMain\kotlin\com\metrolist\desktop\ui`

## Owned paths
- `ui/src/shell/DeviceConnectPanel/**`. It is an overlay in the Esc stack, opened by D and the player-bar device chip; the chip lives in M2-2's bar and dispatches the `mm-open-dc` event.
- `ui/src/pages/{ListenTogether}/**` (route `listenTogether`)
- `ui/src/pages/Settings/DeviceConnect/**` (category, order 85)
- `ui/src/input/commands/dc.ts`
- `mock-core/src/handlers/{dc,lt}.ts`, fixtures
- `tests/contract/suites/m3-dc-lt.mjs`
- `ui/src/i18n/extra/{en,vi}/m3-4b.json`, `ui/src/icons/m3-4b.svg`
- `tests/e2e/web/m3-4b.spec.ts`

## Work
- **DC panel:**
  - enable switch, QR (`qrSvg` rendered as a sanitised SVG: strip scripts and event attributes), link copy, addresses, port
  - firewall state with a "Mở cài đặt tường lửa" button (`dc.openFirewallSettings`)
  - devices list (online, paired, accountBound) with forget, transfer to, attach/release
  - incoming `dc.request` → approval card with the SAS code (confirm/reject → `dc.confirmSas`, `dc.accept/reject`)
  - "Kết nối bằng liên kết" field → `dc.connectLink` (shows the request; never auto-connects)
- **LT page:**
  - idle: create (name), join (code + name), server picker (`lt.servers` / `lt.setServer`)
  - host: room code + invite link (`lt.invite`), users (kick, transfer host), pending approvals, suggestions (approve/reject), blocked list
  - guest: users, suggest current track (`lt.suggest`), leave
  - events `lt.joinRequest` and `lt.suggestion` show toasts with actions
- Hidden when the `deviceConnect` / `listenTogether` capability is absent.

## Verify (cheap)
1. Vitest: SVG sanitiser, event → state reducers.
2. Contract `m3-dc-lt.mjs` green on the mock; M3-4a must pass it on real.
3. Web Playwright: E-44 (the QR equals `dc.state.link`, decoded with `jsqr` in the test only, or compare the `qrSvg` string from the mock), the approval flow, LT create/join flows. STATUS line.
