import { describe, expect, it } from "vitest";
import type { DcState, LtState } from "@minmusic/protocol";
import { applyDcEvent, applyLtEvent, dcInitial, dropRequest, dropSuggestion, ltInitial, sasGroups, withPort } from "./model";

const dcs = (o: Partial<DcState> = {}): DcState => ({ enabled: true, port: 48765, addresses: [], link: "metrolist://device-connect?a=1.2.3.4:48765&n=PC", qrSvg: "", firewall: "allowed", devices: [], ...o });
const lts = (o: Partial<LtState> = {}): LtState => ({ status: "idle", server: "wss://x", ...o });

describe("dc reducer", () => {
  it("snapshot and state replace the state, requests are kept", () => {
    let m = applyDcEvent(dcInitial(), "dc.request", { requestId: "r1", peer: "Pixel", sas: "123456" });
    m = applyDcEvent(m, "dc.snapshot", dcs({ port: 1111 }));
    expect(m.state?.port).toBe(1111);
    m = applyDcEvent(m, "dc.state", dcs({ port: 2222 }));
    expect(m.state?.port).toBe(2222);
    expect(m.requests).toHaveLength(1);
  });
  it("a request is added once per id (a repeat replaces it) and can be dropped", () => {
    let m = applyDcEvent(dcInitial(), "dc.request", { requestId: "r1", peer: "A" });
    m = applyDcEvent(m, "dc.request", { requestId: "r2", peer: "B", sas: "000111" });
    m = applyDcEvent(m, "dc.request", { requestId: "r1", peer: "A2", sas: "999888" });
    expect(m.requests.map((r) => [r.requestId, r.peer])).toEqual([["r2", "B"], ["r1", "A2"]]);
    expect(dropRequest(m, "r2").requests.map((r) => r.requestId)).toEqual(["r1"]);
  });
  it("ignores unknown events and malformed requests", () => {
    const m = dcInitial();
    expect(applyDcEvent(m, "dc.nope", {})).toBe(m);
    expect(applyDcEvent(m, "dc.request", {})).toBe(m);
  });
  it("sasGroups and withPort", () => {
    expect(sasGroups("482913")).toBe("482 913");
    expect(sasGroups("1234")).toBe("1234");
    expect(withPort("192.168.1.5", 48765)).toBe("192.168.1.5:48765");
    expect(withPort("192.168.1.5:9000", 48765)).toBe("192.168.1.5:9000");
    expect(withPort("fe80::1", 48765)).toBe("[fe80::1]:48765");
    expect(withPort("[fe80::1]:9", 48765)).toBe("[fe80::1]:9");
  });
});

describe("lt reducer", () => {
  it("suggestions accumulate while hosting and are dropped when the room ends", () => {
    let m = applyLtEvent(ltInitial(), "lt.state", lts({ status: "host", room: { code: "AAAAAA", users: [], pending: [] } }));
    m = applyLtEvent(m, "lt.suggestion", { id: "s1", trackId: "t1", by: "Hùng" });
    m = applyLtEvent(m, "lt.suggestion", { id: "s2", trackId: "t2", by: "Mai" });
    m = applyLtEvent(m, "lt.suggestion", { id: "s1", trackId: "t1", by: "Hùng" });
    expect(m.suggestions.map((s) => s.id)).toEqual(["s2", "s1"]);
    m = applyLtEvent(m, "lt.state", lts({ status: "host", room: { code: "AAAAAA", users: [], pending: [] } }));
    expect(m.suggestions).toHaveLength(2);
    expect(dropSuggestion(m, "s2").suggestions.map((s) => s.id)).toEqual(["s1"]);
    m = applyLtEvent(m, "lt.state", lts());
    expect(m.suggestions).toEqual([]);
    expect(m.state?.status).toBe("idle");
  });
  it("becoming a guest (host transfer) clears suggestions", () => {
    let m = applyLtEvent(ltInitial(), "lt.snapshot", lts({ status: "host" }));
    m = applyLtEvent(m, "lt.suggestion", { id: "s1", trackId: "t", by: "x" });
    m = applyLtEvent(m, "lt.state", lts({ status: "guest" }));
    expect(m.suggestions).toEqual([]);
  });
});
