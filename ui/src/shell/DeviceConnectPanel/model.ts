// Pure event -> state reducers of the `dc` and `lt` topics (unit tested; the Solid stores in store.ts only hold the result).
import type { DcState, LtState, Track } from "@minmusic/protocol";

export type DcRequest = { requestId: string; peer: string; sas?: string };
export type DcModel = { state?: DcState; requests: DcRequest[] };
export const dcInitial = (): DcModel => ({ requests: [] });

export function applyDcEvent(m: DcModel, name: string, d: unknown): DcModel {
  switch (name) {
    case "dc.snapshot":
    case "dc.state":
      return { ...m, state: d as DcState };
    case "dc.request": {
      const r = d as DcRequest;
      if (!r?.requestId) return m;
      return { ...m, requests: [...m.requests.filter((x) => x.requestId !== r.requestId), { requestId: r.requestId, peer: r.peer, sas: r.sas }] };
    }
    default:
      return m;
  }
}
export const dropRequest = (m: DcModel, requestId: string): DcModel => ({ ...m, requests: m.requests.filter((x) => x.requestId !== requestId) });

/** "482913" -> "482 913" */
export const sasGroups = (sas: string): string => (sas.length === 6 ? `${sas.slice(0, 3)} ${sas.slice(3)}` : sas);

/** Address as shown: `ip:port`, adding the port when the core sent a bare address. */
export const withPort = (a: string, port: number): string => {
  if (/^(\[.*\]|[^:]+):\d{1,5}$/.test(a)) return a;
  return a.split(":").length > 2 ? `[${a.replace(/^\[|\]$/g, "")}]:${port}` : `${a}:${port}`;
};

export type LtSuggestion = { id: string; trackId: string; by: string; track?: Track };
export type LtModel = { state?: LtState; suggestions: LtSuggestion[] };
export const ltInitial = (): LtModel => ({ suggestions: [] });

export function applyLtEvent(m: LtModel, name: string, d: unknown): LtModel {
  switch (name) {
    case "lt.snapshot":
    case "lt.state": {
      const state = d as LtState;
      // suggestions belong to a hosted room: leaving it (or becoming a guest) drops them
      return { state, suggestions: state.status === "host" ? m.suggestions : [] };
    }
    case "lt.suggestion": {
      const s = d as LtSuggestion;
      if (!s?.id) return m;
      return { ...m, suggestions: [...m.suggestions.filter((x) => x.id !== s.id), { id: s.id, trackId: s.trackId, by: s.by, track: s.track }] };
    }
    default:
      return m;
  }
}
export const dropSuggestion = (m: LtModel, id: string): LtModel => ({ ...m, suggestions: m.suggestions.filter((x) => x.id !== id) });
