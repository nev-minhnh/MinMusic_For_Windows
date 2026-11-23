// Device Connect state: the `dc` topic (snapshot, then dc.state / dc.request) and the panel's open flag.
import { createSignal } from "solid-js";
import type { DcState } from "@minmusic/protocol";
import { client } from "../../lib/core";
import { toast } from "../../toast";
import { applyDcEvent, dcInitial, dropRequest, type DcModel, type DcRequest } from "./model";

const [model, setModel] = createSignal<DcModel>(dcInitial());
export const dcState = (): DcState | undefined => model().state;
export const dcRequests = (): DcRequest[] => model().requests;

const [open, setOpen] = createSignal(false);
export { open as dcOpen };
export const openDc = () => setOpen(true);
export const closeDc = () => setOpen(false);
export const toggleDc = () => setOpen((o) => !o);

let off: (() => void) | null = null;
/** Subscribes once the core advertises `deviceConnect`; an incoming request opens the panel so the SAS code is seen. */
export function startDc() {
  if (off) return;
  off = client.sub("dc", {}, (name, d) => {
    setModel((m) => applyDcEvent(m, name, d));
    if (name === "dc.request") openDc();
  });
}
export function stopDc() {
  off?.();
  off = null;
  setModel(dcInitial());
}

const fail = () => toast({ i18n: "w2_error_generic", level: "error" });
const call = (m: string, p?: unknown) => client.call(m, p);
/** Runs a core call; a failure shows the generic error toast and resolves false. */
async function run(m: string, p?: unknown): Promise<boolean> {
  try {
    await call(m, p);
    return true;
  } catch {
    fail();
    return false;
  }
}

export const dcActions = {
  enable: (on: boolean) => run("dc.enable", { on }),
  setPort: (port: number) => run("dc.setPort", { port }),
  forget: (deviceId: string) => run("dc.forget", { deviceId }),
  transferTo: (deviceId: string) => run("dc.transferTo", { deviceId }),
  attach: (deviceId: string) => run("dc.attach", { deviceId }),
  release: (deviceId: string) => run("dc.release", { deviceId }),
  openFirewall: () => run("dc.openFirewallSettings"),
  /** Shows the request (dc.request event); never connects by itself. Returns an error message for the field, or null. */
  async connectLink(link: string): Promise<string | null> {
    try {
      await call("dc.connectLink", { link: link.trim() });
      return null;
    } catch (e) {
      return (e as { code?: string }).code === "bad_request" ? "bad_request" : "failed";
    }
  },
  /** SAS: the user compared the code. With a code, confirmSas first, then accept (match) or reject (mismatch). */
  async decide(r: DcRequest, match: boolean) {
    try {
      if (r.sas) await call("dc.confirmSas", { requestId: r.requestId, match });
      if (match) await call("dc.accept", { requestId: r.requestId });
      else await call("dc.reject", { requestId: r.requestId }).catch(() => {});
    } catch {
      fail();
    } finally {
      setModel((m) => dropRequest(m, r.requestId));
    }
  },
};
