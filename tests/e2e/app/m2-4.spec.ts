import { test, expect } from '../fixtures/app';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

// M2-4 app e2e (integration run: `scripts/e2e.ps1 -Suite app -Spec tests/e2e/app/m2-4.spec.ts`).
//   E-34  Ctrl M opens a 320x88 always-on-top mini window; controls work; Esc returns to the main window.
//   E-35  taskbar thumbnail buttons: WM_COMMAND ids 0/1/2 (what a thumbnail click sends) drive the player.
//   E-36  Snap Layouts overlay exists over the maximize button and answers HTMAXBUTTON to a hit test.
// Real-mouse check of the Snap flyout itself is manual: docs in the M2-4 STATUS notes.

const root = process.env.MINMUSIC_DATA_ROOT;
const probe = path.resolve(__dirname, '../../../tools/taskbar-probe.ps1');

function shellPid(): number {
  const f = root && path.join(root, 'pids.json');
  test.skip(!f || !fs.existsSync(f), 'pids.json of the test app not found (MINMUSIC_DATA_ROOT)');
  return JSON.parse(fs.readFileSync(f!, 'utf8')).shellPid;
}
function ps(args: string[]): any {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probe, ...args], { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`taskbar-probe ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout.trim());
}
const windows = (pid: number): any[] => ps(['-ProcessId', String(pid), '-Action', 'windows']);

/** A second connection to the real core (role ui), used to start playback and to observe `player.state`. */
async function coreConn(app: { invoke: <T>(c: string) => Promise<T> }) {
  const cfg = await app.invoke<{ port: number; token: string }>('core_config');
  const ws = new WebSocket(`ws://127.0.0.1:${cfg.port}/rpc`, { origin: 'http://tauri.localhost' });
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const states: any[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d));
    if (m.id && pending.has(m.id)) pending.get(m.id)!(m);
    else if (m.ev === 'player.state' || m.ev === 'player.snapshot') states.push(m.p);
  });
  await new Promise<void>((res, rej) => (ws.once('open', () => res()), ws.once('error', rej)));
  const call = (m: string, p: object = {}) =>
    new Promise<any>((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, m, p }));
    });
  await call('sys.hello', { token: cfg.token, role: 'ui', protocol: 1, client: 'e2e/m2-4', locale: 'en' });
  await call('sub.open', { topic: 'player' });
  return { call, states, close: () => ws.close() };
}

/** The seeded library has synthetic track ids that YouTube cannot play, so the transport tests play the long-lived live ids. */
const live = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../contract/fixtures/live-ids.json'), 'utf8'));
async function playLibrary(c: Awaited<ReturnType<typeof coreConn>>): Promise<boolean> {
  const ids: string[] = (live.tracks ?? []).map((t: any) => t.id);
  if (!ids.length) return false;
  await c.call('player.play', { context: { kind: 'tracks', ids, title: 'e2e' }, startIndex: 0 });
  return true;
}

test('E-34: Ctrl M opens the 320x88 always-on-top mini window, controls work, Esc returns', async ({ app }) => {
  const pid = shellPid();
  const conn = await coreConn(app);
  try {
    const seeded = await playLibrary(conn);
    // Ctrl M on the main window
    await app.page.keyboard.press('Control+M');
    await expect.poll(() => windows(pid).filter((w) => w.visible).length, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
    const mini = windows(pid).find((w) => w.right - w.left < 600 && w.visible)!;
    expect(mini.topmost).toBe(true);

    // the mini page (CDP target with #/mini)
    const miniPage = await expect
      .poll(() => app.browser.contexts().flatMap((c) => c.pages()).find((p) => /#\/mini/.test(p.url())) ?? null, { timeout: 10000 })
      .not.toBeNull()
      .then(() => app.browser.contexts().flatMap((c) => c.pages()).find((p) => /#\/mini/.test(p.url()))!);
    await expect(miniPage.getByTestId('mini')).toBeVisible();
    // size contract: 320x88 CSS px. The probe is DPI-unaware, so its window rects are already in logical units (and include the
    // invisible resize frame); dividing them by the page DPR (the old check) halved them on a 200% display.
    expect(await miniPage.evaluate(() => [innerWidth, innerHeight])).toEqual([320, 88]);
    await app.shot('e34-mini-bar');
    if (seeded) {
      const play = miniPage.getByTestId('mini-play');
      const before = await play.getAttribute('aria-label');
      await play.click();
      await expect(play).not.toHaveAttribute('aria-label', before!);
      await miniPage.getByTestId('mini-next').click();
    } else {
      test.info().annotations.push({ type: 'note', description: 'library empty on this root: transport controls not exercised (needs M1-2b seeding)' });
    }
    // square mode and back
    await miniPage.getByTestId('mini-mode').click();
    await expect.poll(() => windows(pid).find((w) => w.right - w.left < 600 && w.visible && w.bottom - w.top > 200) ?? null).not.toBeNull();
    await miniPage.getByTestId('mini-mode').click();

    // Esc returns to the main window and closes the mini window
    await miniPage.keyboard.press('Escape');
    // visible only: the shell keeps a hidden 'Tauri App' helper window (a pre-created webview) that is also narrower than 600
    await expect.poll(() => windows(pid).filter((w) => w.visible && w.right - w.left < 600).length, { timeout: 10000 }).toBe(0);
    const main = windows(pid).find((w) => w.visible);
    expect(main).toBeTruthy();
  } finally {
    conn.close();
  }
});

test('E-35: thumbnail button commands drive the player (WM_COMMAND ids 0, 1, 2)', async ({ app }) => {
  const pid = shellPid();
  const conn = await coreConn(app);
  try {
    test.skip(!(await playLibrary(conn)), 'library empty on this root: needs a seeded library (M1-2b)');
    await expect.poll(() => conn.states.at(-1)?.playing, { timeout: 15000 }).toBe(true);
    const n = conn.states.length;
    ps(['-ProcessId', String(pid), '-Action', 'command', '-ButtonId', '1']); // play/pause
    await expect.poll(() => conn.states.slice(n).some((s) => s.playing === false), { timeout: 8000 }).toBe(true);
    ps(['-ProcessId', String(pid), '-Action', 'command', '-ButtonId', '1']);
    await expect.poll(() => conn.states.at(-1)?.playing, { timeout: 8000 }).toBe(true);
    const idBefore = conn.states.at(-1)?.track?.id;
    ps(['-ProcessId', String(pid), '-Action', 'command', '-ButtonId', '2']); // next
    await expect.poll(() => conn.states.at(-1)?.track?.id, { timeout: 8000 }).not.toBe(idBefore);
    ps(['-ProcessId', String(pid), '-Action', 'command', '-ButtonId', '0']); // previous
    await expect.poll(() => conn.states.at(-1)?.track?.id, { timeout: 8000 }).toBe(idBefore);
  } finally {
    conn.close();
  }
  // UI Automation view of the thumbnail (only present while hovered): informational
  test.info().annotations.push({ type: 'uia', description: JSON.stringify(ps(['-Action', 'thumbnail'])) });
});

async function placeOverlay(app: any, pid: number) {
  const r = await app.page.evaluate(() => {
    const b = document.querySelector('[data-testid="caption-max"]') as HTMLElement;
    const x = b.getBoundingClientRect();
    return { l: x.left, t: x.top, w: x.width, h: x.height, dpr: window.devicePixelRatio };
  });
  await app.invoke('caption_rects', { max: [Math.round(r.l * r.dpr), Math.round(r.t * r.dpr), Math.round(r.w * r.dpr), Math.round(r.h * r.dpr)] });
  await expect.poll(() => ps(['-ProcessId', String(pid), '-Action', 'children']).overlay.length, { timeout: 8000 }).toBe(1);
  return ps(['-ProcessId', String(pid), '-Action', 'children']).overlay[0];
}

test('E-36a: the Snap Layouts overlay window exists over the maximize button', async ({ app }) => {
  const pid = shellPid();
  const ov = await placeOverlay(app, pid);
  expect(ov.visible).not.toBe(false);
  expect(ov.right - ov.left).toBeGreaterThan(0);
});

// WindowFromPoint at the overlay centre returns whichever window is topmost there on the test machine (here the shell's CoreWindow,
// not the overlay), so the HTMAXBUTTON answer cannot be read back with synthetic input; the real-mouse Snap flyout check is on the
// owner's manual QA list (M2-4 STATUS notes).
test.fixme('E-36b: the Snap Layouts overlay answers HTMAXBUTTON to a hit test (needs a real mouse / foreground main window)', async ({ app }) => {
  const pid = shellPid();
  const ov = await placeOverlay(app, pid);
  const cx = Math.round((ov.left + ov.right) / 2), cy = Math.round((ov.top + ov.bottom) / 2);
  const hit = ps(['-ProcessId', String(pid), '-Action', 'hittest', '-X', String(cx), '-Y', String(cy)]);
  expect(hit.class).toBe('MinMusicSnapHit');
  expect(hit.ncHitTest).toBe(9); // HTMAXBUTTON
  // hover reaches the UI through the mm-caption event (cannot be raised without a real mouse; the event contract is unit tested)
});
