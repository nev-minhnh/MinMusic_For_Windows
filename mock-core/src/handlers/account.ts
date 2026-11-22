// Accounts and sources (api.md 3.11), stateful per MockState. Topic `account`: account.snapshot, then account.changed / sources.changed.
// Web-login methods (YouTube, Zing) resolve after 1.5 s: there is no shell window in the web build.
// NCT: the account "vip*" gets a VIP login, "offline" answers `network`, the password "wrong" answers `unauthorized`.
// The password is never stored, logged or echoed: it is read, compared and dropped.
import type { AccountGetResult, Quality, SourceId, SourceInfo, SourcesListResult, YoutubeAccount } from "@minmusic/protocol";
import type { HandlerModule, MockState } from "../state.ts";
import { ApiErr, bad, isObj, reqBool, reqStr } from "../util.ts";

export const WEBLOGIN_MS = 1500;
const IDS: SourceId[] = ["yt", "sc", "zing", "nct"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const q = (label: string, kbps: number): Quality => ({ label, lossless: false, kbps });
const CHANNELS = [{ id: "ch-main", name: "Test User" }, { id: "ch-music", name: "Test Music Channel" }];

interface AccState {
  yt: { signedIn: boolean; channel: number };
  zing: { signedIn: boolean; vip: boolean; account?: string };
  nct: { signedIn: boolean; vip: boolean; account?: string };
  enabled: Record<string, boolean>;
  priority: SourceId[];
  autoBest: boolean;
  autoFallback: boolean;
}
const states = new WeakMap<MockState, AccState>();
function acc(st: MockState): AccState {
  let s = states.get(st);
  if (!s) {
    s = {
      yt: { signedIn: false, channel: 0 },
      zing: { signedIn: false, vip: false },
      nct: { signedIn: false, vip: false },
      enabled: { yt: true, sc: true, zing: true, nct: true },
      priority: ["yt", "zing", "nct", "sc"],
      autoBest: true,
      autoFallback: true,
    };
    states.set(st, s);
  }
  return s;
}

function accountOf(st: MockState): AccountGetResult {
  const a = acc(st);
  if (!a.yt.signedIn) return { signedIn: false };
  const yt: YoutubeAccount = { name: CHANNELS[a.yt.channel]!.name, email: "test.user@example.test", handle: "@testuser", channels: CHANNELS.map((c) => ({ ...c })) };
  return { youtube: yt, signedIn: true };
}
export function sourcesOf(st: MockState): SourcesListResult {
  const a = acc(st);
  const items = [
    { id: "yt", name: "YouTube Music", enabled: a.enabled.yt!, status: a.enabled.yt ? "ok" : "off", signedIn: a.yt.signedIn, account: a.yt.signedIn ? "test.user@example.test" : undefined, maxQuality: q("Opus 160", 160), canLogin: true },
    { id: "sc", name: "SoundCloud", enabled: a.enabled.sc!, status: a.enabled.sc ? "degraded" : "off", maxQuality: q("AAC 160", 160), canLogin: false },
    { id: "zing", name: "Zing MP3", enabled: a.enabled.zing!, status: a.enabled.zing ? "ok" : "off", signedIn: a.zing.signedIn, vip: a.zing.vip, account: a.zing.account, maxQuality: a.zing.vip ? q("320", 320) : q("128", 128), canLogin: true },
    { id: "nct", name: "NhacCuaTui", enabled: a.enabled.nct!, status: a.enabled.nct ? "ok" : "off", signedIn: a.nct.signedIn, vip: a.nct.vip, account: a.nct.account, maxQuality: a.nct.vip ? q("320", 320) : q("128", 128), canLogin: true },
  ] as SourceInfo[];
  for (const it of items) for (const k of Object.keys(it) as (keyof SourceInfo)[]) if (it[k] === undefined) delete it[k];
  return { items, priority: a.priority.slice(), autoBest: a.autoBest, autoFallback: a.autoFallback };
}
function announce(st: MockState, what: "account" | "sources" | "both") {
  if (what !== "sources") st.emit("account", "account.changed", accountOf(st));
  if (what !== "account") st.emit("account", "sources.changed", sourcesOf(st));
}
const reqId = (p: any): SourceId => {
  const id = reqStr(p, "id");
  if (!IDS.includes(id as SourceId)) throw bad("id: unknown source");
  return id as SourceId;
};

export const handlers: HandlerModule["handlers"] = {
  "account.get": (_p, { st }) => accountOf(st),
  "account.youtube.login": async (_p, { st }) => {
    await sleep(WEBLOGIN_MS);
    acc(st).yt.signedIn = true;
    announce(st, "both");
    return { ok: true };
  },
  "account.youtube.switchChannel": async (_p, { st }) => {
    const a = acc(st);
    if (!a.yt.signedIn) throw new ApiErr("not_signed_in", "not signed in");
    await sleep(WEBLOGIN_MS);
    a.yt.channel = (a.yt.channel + 1) % CHANNELS.length;
    announce(st, "account");
    return {};
  },
  "account.youtube.logout": (_p, { st }) => {
    const a = acc(st);
    a.yt.signedIn = false;
    a.yt.channel = 0;
    announce(st, "both");
    return {};
  },
  "account.youtube.tokenLogin": (p, { st }) => {
    reqStr(p, "cookie");
    acc(st).yt.signedIn = true;
    announce(st, "both");
    return {};
  },

  "sources.list": (_p, { st }) => sourcesOf(st),
  "sources.setEnabled": (p, { st }) => {
    const id = reqId(p);
    acc(st).enabled[id] = reqBool(p, "on");
    announce(st, "sources");
    return {};
  },
  "sources.setPriority": (p, { st }) => {
    const order = p?.order;
    if (!Array.isArray(order) || order.length !== IDS.length || new Set(order).size !== IDS.length || order.some((x) => !IDS.includes(x))) throw bad("order: permutation of the source ids required");
    acc(st).priority = order.slice();
    announce(st, "sources");
    return {};
  },
  "sources.setAutoBest": (p, { st }) => { acc(st).autoBest = reqBool(p, "on"); announce(st, "sources"); return {}; },
  "sources.setAutoFallback": (p, { st }) => { acc(st).autoFallback = reqBool(p, "on"); announce(st, "sources"); return {}; },

  "source.zing.login": async (_p, { st }) => {
    await sleep(WEBLOGIN_MS);
    Object.assign(acc(st).zing, { signedIn: true, vip: false, account: "zing.test@example.test" });
    announce(st, "sources");
    return { ok: true, vip: false };
  },
  "source.zing.logout": (_p, { st }) => {
    Object.assign(acc(st).zing, { signedIn: false, vip: false, account: undefined });
    announce(st, "sources");
    return {};
  },
  "source.nct.login": async (p, { st }) => {
    if (!isObj(p)) throw bad("params required");
    const account = reqStr(p, "account");
    const wrong = reqStr(p, "password") === "wrong"; // read once, never kept
    await sleep(120);
    if (account === "offline") throw new ApiErr("network", "network unreachable", { retryable: true });
    if (wrong) throw new ApiErr("unauthorized", "wrong account or password");
    const vip = account.startsWith("vip");
    Object.assign(acc(st).nct, { signedIn: true, vip, account });
    announce(st, "sources");
    return { ok: true, vip };
  },
  "source.nct.logout": (_p, { st }) => {
    Object.assign(acc(st).nct, { signedIn: false, vip: false, account: undefined });
    announce(st, "sources");
    return {};
  },
};

export const topics: HandlerModule["topics"] = {
  account: ({ st }) => ({ account: accountOf(st), sources: sourcesOf(st) }),
};
