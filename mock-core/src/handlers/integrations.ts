// Last.fm, ListenBrainz and Discord (api.md 3.12), stateful per MockState.
// The Last.fm password is read once to decide the outcome and is never stored, logged or echoed. The token "bad" answers `unauthorized`.
import type { HandlerModule, MockState } from "../state.ts";
import { ApiErr, bad, isObj, reqStr } from "../util.ts";
import { WEBLOGIN_MS } from "./account.ts";

interface IntState { lastfmUser?: string; lbUser?: string; discordUser?: string }
const states = new WeakMap<MockState, IntState>();
const get = (st: MockState): IntState => { let s = states.get(st); if (!s) { s = {}; states.set(st, s); } return s; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const handlers: HandlerModule["handlers"] = {
  "lastfm.login": async (p, { st }) => {
    if (!isObj(p)) throw bad("params required");
    const user = reqStr(p, "username");
    const wrong = reqStr(p, "password") === "wrong";
    await sleep(120);
    if (user === "offline") throw new ApiErr("network", "network unreachable", { retryable: true });
    if (wrong) throw new ApiErr("unauthorized", "wrong username or password");
    get(st).lastfmUser = user;
    return { ok: true, user };
  },
  "lastfm.logout": (_p, { st }) => { get(st).lastfmUser = undefined; return {}; },
  "lastfm.status": (_p, { st }) => {
    const user = get(st).lastfmUser;
    return user ? { user, expired: false, scrobbling: true, nowPlaying: true, pending: 2 } : { expired: false, scrobbling: false, nowPlaying: false, pending: 0 };
  },
  "listenbrainz.setToken": (p, { st }) => {
    const tok = p?.token;
    if (tok === null) { get(st).lbUser = undefined; return {}; }
    if (typeof tok !== "string" || tok === "") throw bad("token: string or null required");
    if (tok === "bad") throw new ApiErr("unauthorized", "invalid token");
    get(st).lbUser = "lb_test_user";
    return {};
  },
  "listenbrainz.status": (_p, { st }) => (get(st).lbUser ? { user: get(st).lbUser } : {}),
  "discord.login": async (_p, { st }) => { await sleep(WEBLOGIN_MS); get(st).discordUser = "TestUser"; return {}; },
  "discord.logout": (_p, { st }) => { get(st).discordUser = undefined; return {}; },
  "discord.status": (_p, { st }) => (get(st).discordUser ? { user: get(st).discordUser, enabled: true } : { enabled: false }),
};
