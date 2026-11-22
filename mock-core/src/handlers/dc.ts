// Mock of api.md 3.14 Device Connect (M3-4b). Protocol-compatible with the Android app: link `metrolist://device-connect?a=ip:port,...&n=name`.
// The QR is rendered from the link by qrcode-generator (level M) into a single-path SVG, like the core's byte-identical encoder (architecture 8).
// Test hook (mock only): `mock.dc.incoming` raises an incoming pairing request.
import qrcode from "qrcode-generator";
import type { DcState } from "@minmusic/protocol";
import type { HandlerModule, MockState } from "../state.ts";
import { bad, isObj, notFound, reqBool, reqInt, reqStr } from "../util.ts";

type Dev = DcState["devices"][number];
type Req = { requestId: string; peer: string; sas: string; confirmed: boolean; type: string };
type Dc = { enabled: boolean; port: number; requireApproval: boolean; devices: Dev[]; session?: DcState["session"]; requests: Map<string, Req>; seq: number };

const ADDRESSES = ["192.168.1.23", "10.0.0.5"];
export const DEVICE_NAME = "MinMusic-PC";
const stores = new WeakMap<MockState, Dc>();
function dc(st: MockState): Dc {
  let s = stores.get(st);
  if (!s) {
    s = {
      enabled: false, port: 48765, requireApproval: true, requests: new Map(), seq: 0,
      devices: [
        { id: "dev-pixel", name: "Pixel 8", type: "android", online: true, paired: true, accountBound: false },
        { id: "dev-tab", name: "Galaxy Tab S9", type: "android", online: false, paired: true, accountBound: true },
      ],
    };
    stores.set(st, s);
  }
  return s;
}

/** `metrolist://device-connect?a=<ip:port>,<ip:port>&n=<name>` */
export function makeLink(addresses: string[], port: number, name: string): string {
  return `metrolist://device-connect?a=${addresses.map((a) => `${a}:${port}`).join(",")}&n=${encodeURIComponent(name)}`;
}
/** Single-path SVG of the QR (level M): one `<path d="M x y h1 v1 h-1 z ...">` over a white rect; viewBox = modules + 4 quiet zone. */
export function qrSvgOf(text: string): string {
  const q = qrcode(0, "M");
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const Q = 4;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + Q} ${r + Q}h1v1h-1z`;
  const s = n + Q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

function snapshot(st: MockState): DcState {
  const s = dc(st);
  const link = s.enabled ? makeLink(ADDRESSES, s.port, DEVICE_NAME) : "";
  return {
    enabled: s.enabled, port: s.port, addresses: s.enabled ? ADDRESSES.map((a) => `${a}:${s.port}`) : [], link, qrSvg: link ? qrSvgOf(link) : "",
    firewall: s.enabled ? "no_rule" : "unknown", devices: s.devices.map((d) => ({ ...d })), ...(s.session ? { session: { ...s.session } } : {}),
  };
}
const push = (st: MockState, emit: MockState["emit"]) => emit("dc", "dc.state", snapshot(st));
const raise = (st: MockState, emit: MockState["emit"], peer: string, type = "android") => {
  const s = dc(st);
  const requestId = `req-${++s.seq}`;
  const sas = String(100000 + ((s.seq * 7919 + 482913) % 900000));
  s.requests.set(requestId, { requestId, peer, sas, confirmed: false, type });
  emit("dc", "dc.request", { requestId, peer, sas });
  return requestId;
};
const req = (st: MockState, p: unknown) => {
  const r = dc(st).requests.get(reqStr(p, "requestId"));
  if (!r) throw notFound("request");
  return r;
};
const dev = (st: MockState, p: unknown) => {
  const d = dc(st).devices.find((x) => x.id === reqStr(p, "deviceId"));
  if (!d) throw notFound("device");
  return d;
};

export const handlers: HandlerModule["handlers"] = {
  "dc.state": (_p, { st }) => snapshot(st),
  "dc.enable": (p, { st, emit }) => { dc(st).enabled = reqBool(p, "on"); push(st, emit); return {}; },
  "dc.setPort": (p, { st, emit }) => { dc(st).port = reqInt(p, "port", 1024, 65535); push(st, emit); return {}; },
  "dc.requireApproval": (p, { st }) => { dc(st).requireApproval = reqBool(p, "on"); return {}; },
  "dc.connectLink": (p, { st, emit }) => {
    const link = reqStr(p, "link").trim();
    let u: URL;
    try { u = new URL(link); } catch { throw bad("link: not a URL"); }
    if (u.protocol !== "metrolist:" || u.hostname !== "device-connect") throw bad("link: not a metrolist://device-connect link");
    const a = (u.searchParams.get("a") ?? "").split(",").filter(Boolean);
    if (!a.length || a.some((x) => !/^[\w.:-]+:\d{2,5}$/.test(x))) throw bad("link: a= must be ip:port[,ip:port]");
    raise(st, emit, u.searchParams.get("n") || a[0]!);
    return {};
  },
  "dc.accept": (p, { st, emit }) => {
    const r = req(st, p);
    if (!r.confirmed) throw bad("sas_unconfirmed: confirm the code first");
    const s = dc(st);
    s.requests.delete(r.requestId);
    const known = s.devices.find((d) => d.name === r.peer);
    if (known) { known.paired = true; known.online = true; } else s.devices.push({ id: `dev-${r.requestId}`, name: r.peer, type: r.type, online: true, paired: true, accountBound: false });
    push(st, emit);
    return {};
  },
  "dc.reject": (p, { st }) => { dc(st).requests.delete(reqStr(p, "requestId")); return {}; }, // idempotent
  "dc.confirmSas": (p, { st }) => {
    const r = req(st, p);
    if (reqBool(p, "match")) r.confirmed = true;
    else dc(st).requests.delete(r.requestId);
    return {};
  },
  "dc.forget": (p, { st, emit }) => {
    const s = dc(st);
    const d = dev(st, p);
    s.devices = s.devices.filter((x) => x !== d);
    if (s.session?.peerId === d.id) s.session = undefined;
    push(st, emit);
    return {};
  },
  "dc.transferTo": (p, { st, emit }) => {
    const d = dev(st, p);
    if (!d.online) throw bad("device offline");
    dc(st).session = { peerId: d.id, role: "controller" };
    push(st, emit);
    return {};
  },
  "dc.attach": (p, { st, emit }) => {
    const d = dev(st, p);
    if (!d.online) throw bad("device offline");
    dc(st).session = { peerId: d.id, role: "controller" };
    push(st, emit);
    return {};
  },
  "dc.release": (p, { st, emit }) => { dev(st, p); dc(st).session = undefined; push(st, emit); return {}; },
  "dc.openFirewallSettings": () => ({}),

  /** test hook (mock only): an incoming pairing request from `peer` */
  "mock.dc.incoming": (p, { st, emit }) => ({ requestId: raise(st, emit, isObj(p) && typeof p.peer === "string" ? p.peer : "Pixel 9") }),
};

export const topics: HandlerModule["topics"] = { dc: ({ st }) => snapshot(st) };
