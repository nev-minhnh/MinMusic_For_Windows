import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createQueueModel, CHUNK, type QTrack } from "./queueModel";

const mk = (i: number): QTrack => ({ id: `t${i}`, qid: `q${i}`, title: `T${i}`, artists: [], source: "yt" } as QTrack);

function fake(total0 = 250) {
  let revision = 1;
  let total = total0;
  let cur = 0;
  const calls: { offset: number; limit: number }[] = [];
  const call = async (m: string, p: any) => {
    expect(m).toBe("queue.window");
    calls.push(p);
    const items = [];
    for (let i = p.offset; i < Math.min(total, p.offset + p.limit); i++) items.push(mk(i + (revision - 1) * 1000));
    return { total, revision, currentIndex: cur, items };
  };
  return { call: call as any, calls, setCur: (i: number) => { cur = i; }, bump: (d = 0) => { revision++; total += d; }, rev: () => revision };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("queue model", () => {
  it("fetches the 100-aligned chunks that cover the visible range", async () => {
    await createRoot(async (dispose) => {
      const f = fake();
      const q = createQueueModel(f.call);
      q.setVisible(90, 130);
      await flush();
      expect(f.calls.map((c) => c.offset).sort()).toEqual([0, 100]);
      expect(f.calls.every((c) => c.limit === CHUNK)).toBe(true);
      expect(q.total()).toBe(250);
      expect(q.item(95)?.id).toBe("t95");
      expect(q.item(120)?.id).toBe("t120");
      expect(q.item(250)).toBeUndefined();
      dispose();
    });
  });
  it("refetches the visible window when queue.changed carries a new revision", async () => {
    await createRoot(async (dispose) => {
      const f = fake();
      const q = createQueueModel(f.call);
      q.setVisible(0, 20);
      await flush();
      expect(f.calls).toHaveLength(1);
      expect(q.item(0)?.id).toBe("t0");
      f.bump(-1);
      q.onEvent("queue.changed", { revision: f.rev(), currentIndex: 0 });
      expect(q.item(0)?.id).toBe("t0"); // the old row stays until the new chunk lands
      await flush();
      expect(f.calls).toHaveLength(2);
      expect(f.calls[1]!.offset).toBe(0);
      expect(q.item(0)?.id).toBe("t1000");
      expect(q.total()).toBe(249);
      expect(q.revision()).toBe(2);
      dispose();
    });
  });
  it("same revision only moves the current index (no fetch)", async () => {
    await createRoot(async (dispose) => {
      const f = fake();
      const q = createQueueModel(f.call);
      q.setVisible(0, 20);
      await flush();
      q.onEvent("queue.changed", { revision: f.rev(), currentIndex: 7 });
      await flush();
      expect(f.calls).toHaveLength(1);
      expect(q.currentIndex()).toBe(7);
      dispose();
    });
  });
  it("scrolling to an unseen chunk fetches only that chunk; a revision change refetches what is visible", async () => {
    await createRoot(async (dispose) => {
      const f = fake(500);
      const q = createQueueModel(f.call);
      q.setVisible(0, 50);
      await flush();
      q.setVisible(300, 340);
      await flush();
      expect(f.calls.map((c) => c.offset)).toEqual([0, 300]);
      f.bump();
      q.onEvent("queue.changed", { revision: f.rev(), currentIndex: 0 });
      await flush();
      expect(f.calls.at(-1)!.offset).toBe(300);
      expect(q.item(310)?.id).toBe("t1310");
      dispose();
    });
  });
  it("snapshot sets the meta and triggers a fetch of what is visible", async () => {
    await createRoot(async (dispose) => {
      const f = fake(30);
      f.setCur(4);
      const q = createQueueModel(f.call);
      q.setVisible(0, 10);
      q.onEvent("queue.snapshot", { total: 30, revision: 1, currentIndex: 4, head: [] });
      await flush();
      expect(q.currentIndex()).toBe(4);
      expect(q.total()).toBe(30);
      expect(q.item(29)?.id).toBe("t29");
      dispose();
    });
  });
});
