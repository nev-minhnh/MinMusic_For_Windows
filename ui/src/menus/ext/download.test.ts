import { beforeEach, describe, expect, it } from "vitest";
import { qualityItems } from "./download";
import { setDownloadQuality } from "../../state/downloads";
import type { MenuAction } from "../types";
import type { SourceOption, Track } from "../../lib/types";

const track = { id: "t1", title: "T", artists: [{ name: "A" }], source: "yt", durationMs: 200_000 } as Track;
const opts: SourceOption[] = [
  { source: "yt", id: "t1", quality: { label: "Opus 160", lossless: false, kbps: 160 }, auto: true, available: true },
  { source: "zing", id: "zing:t1", quality: { label: "320", lossless: false, kbps: 320 }, auto: false, available: true },
  { source: "nct", id: "nct:t1", quality: { label: "FLAC", lossless: true }, auto: false, available: false, hint: "vip_login" },
];
const act = (x: unknown) => x as MenuAction;

describe("download menu: quality list with sizes", () => {
  beforeEach(() => setDownloadQuality("best"));
  it("lists best first with the auto source's badge, then the other available sources; unavailable ones are left out", () => {
    const items = qualityItems(track, opts).map(act);
    expect(items.map((i) => i.id)).toEqual(["dl-best", "dl-zing-320"]);
    expect(items[0]!.badge).toBe("Opus 160");
    expect(items[0]!.checked).toBe(true);
    expect(items[1]!.checked).toBe(false);
    // sizes: kbps x duration (200 s): 160 kbps = 4 MB, 320 kbps = 8 MB
    expect(items[0]!.hint).toMatch(/^~3[.,]8 MB$/);
    expect(items[1]!.hint).toMatch(/^~7[.,]6 MB$/);
  });
  it("the remembered default is checked when the track offers that quality, else best stays checked", () => {
    setDownloadQuality("320");
    let items = qualityItems(track, opts).map(act);
    expect(items.find((i) => i.id === "dl-zing-320")!.checked).toBe(true);
    expect(items.find((i) => i.id === "dl-best")!.checked).toBe(false);
    setDownloadQuality("FLAC"); // not offered (unavailable)
    items = qualityItems(track, opts).map(act);
    expect(items.find((i) => i.id === "dl-best")!.checked).toBe(true);
  });
});
