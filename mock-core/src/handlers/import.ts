// Mock of api.md 3.12 import.*: provider sign-in state, playlist lists, a timed import job with `import.progress` on the `app` topic.
// Beyond the protocol type, the final event may carry `failedTracks` (titles) and `albumId` (the result user album); see M4-4b notes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, type HandlerModule, type MockState } from "../state.ts";
import { ApiErr, bad, reqStr } from "../util.ts";

type PL = { id: string; title: string; count: number; art?: unknown };
const fixture = (JSON.parse(readFileSync(join(FIXTURES, "import", "playlists.json"), "utf8")) as { playlists: Record<string, PL[]> }).playlists;
const PROVIDERS = ["spotify", "tidal", "deezer", "apple", "amazon"] as const;
export const IMPORT_STEP_MS = 120;
export const IMPORT_LOGIN_MS = 350;

const signed = new WeakMap<MockState, Set<string>>();
const signedOf = (st: MockState) => { let s = signed.get(st); if (!s) signed.set(st, (s = new Set())); return s; };
const provider = (p: unknown): string => {
  const v = reqStr(p, "provider");
  if (!(PROVIDERS as readonly string[]).includes(v)) throw bad("provider: unknown");
  return v;
};
let nextJob = 1;

export const handlers: HandlerModule["handlers"] = {
  "import.providers": (_p, { st }) => ({ items: PROVIDERS.map((id) => ({ id, signedIn: signedOf(st).has(id) })) }),
  "import.login": async (p, { st }) => {
    const id = provider(p);
    await new Promise((r) => setTimeout(r, IMPORT_LOGIN_MS)); // the shell window "Waiting for sign-in..."
    signedOf(st).add(id);
    return {};
  },
  "import.playlists": (p, { st }) => {
    const id = provider(p);
    if (!signedOf(st).has(id)) throw new ApiErr("not_signed_in", "not signed in");
    return { items: fixture[id] };
  },
  "import.run": (p, { st, emit }) => {
    const id = provider(p);
    if (!signedOf(st).has(id)) throw new ApiErr("not_signed_in", "not signed in");
    if (!Array.isArray(p.playlistIds) || !p.playlistIds.length || p.playlistIds.some((x: unknown) => typeof x !== "string")) throw bad("playlistIds: non-empty string[] required");
    const lists = p.playlistIds.map((x: string) => fixture[id].find((l) => l.id === x) ?? (() => { throw bad(`unknown playlist ${x}`); })());
    const tgt = p.target;
    if (tgt !== "newUserAlbum" && !(typeof tgt === "string" && /^lp:.+/.test(tgt) && st.userAlbums.has(tgt))) throw bad("target");
    const total = lists.reduce((n, l) => n + l.count, 0);
    const jobId = `imp-${nextJob++}`;
    const failedTracks: string[] = [];
    let n = 0;
    const timer = setInterval(() => {
      const step = Math.min(total - n, Math.max(1, Math.ceil(total / 12)));
      for (let i = 0; i < step; i++) { n++; if (n % 9 === 0) failedTracks.push(`Unavailable track ${n}`); }
      const ev: Record<string, unknown> = { jobId, done: n, total, failed: failedTracks.length };
      if (n >= total) {
        clearInterval(timer);
        let albumId: string = tgt;
        if (tgt === "newUserAlbum") {
          albumId = st.nextUaId();
          st.userAlbums.set(albumId, { id: albumId, title: `Imported from ${id}`, pinned: false, entries: [] });
        }
        st.bumpLibrary([`userAlbum:${albumId}`, "playlists"], true);
        ev.failedTracks = failedTracks;
        ev.albumId = albumId;
      }
      emit("app", "import.progress", ev);
    }, IMPORT_STEP_MS);
    timer.unref?.();
    return { jobId };
  },
};
