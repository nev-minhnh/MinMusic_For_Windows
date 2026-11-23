import { createSignal } from "solid-js";
import { client } from "../lib/core";
import { createQueueModel } from "../shell/player/queueModel";
export { CHUNK, type QTrack } from "../shell/player/queueModel";

export const queue = createQueueModel((m, p) => client.call(m, p));

// ---- autoplay switch: PlayerState carries no autoplay flag, so the footer switch is a local mirror (default on)
const AKEY = "mm.autoplay";
const readAuto = (): boolean => {
  try { return localStorage.getItem(AKEY) !== "0"; } catch { return true; }
};
const [autoplay, setAutoplayLocal] = createSignal(readAuto());
export { autoplay };
export function setAutoplay(on: boolean) {
  setAutoplayLocal(on);
  try { localStorage.setItem(AKEY, on ? "1" : "0"); } catch { /* private window */ }
  return client.call("queue.setAutoplay", { on });
}

let started = false;
export function initQueue() {
  if (started) return;
  started = true;
  client.sub("queue", {}, (n, d) => queue.onEvent(n, d));
}

/** Selected row of the pane (qid), for Del. */
const [selectedQid, setSelectedQid] = createSignal<string | null>(null);
export { selectedQid, setSelectedQid };

export const queueApi = {
  select: (qid: string) => client.call("queue.select", { qid }),
  remove: (qids: string[]) => client.call("queue.remove", { qids }),
  clear: () => client.call("queue.clear", { keepCurrent: true }),
  unlock: () => client.call("queue.setLocked", { on: false }),
  radio: (seedId: string) => client.call("queue.radio", { seedId }),
  addEnd: (ids: string[]) => client.call("queue.add", { ids, position: "end" }),
  /** returns false on a revision conflict (the caller refreshes) */
  async move(from: number, to: number): Promise<boolean> {
    try {
      await client.call("queue.move", { from, to, expectedRevision: queue.revision() });
      return true;
    } catch (e: any) {
      if (e?.code === "conflict" || /conflict/.test(String(e?.message))) { queue.refresh(); return false; }
      throw e;
    }
  },
};
