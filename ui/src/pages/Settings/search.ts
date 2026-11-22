import type { SettingEntry } from "@minmusic/protocol";
import { hidden, type GroupDef, type PageId, type RowDef } from "./layout";

/** lower-case, diacritics stripped (vi), char for char so match offsets map back onto the original label. */
export const fold = (s: string): string =>
  Array.from(s.normalize("NFC"), (c) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase() || c).join("");

/** [start, end) of the first match of `q` in `label`, or null. Both sides folded. */
export function matchRange(label: string, q: string): [number, number] | null {
  const needle = fold(q.trim());
  if (!needle) return null;
  const at = fold(label).indexOf(needle);
  return at < 0 ? null : [at, at + needle.length];
}

export type Highlighted = { before: string; hit: string; after: string };
export function highlight(label: string, q: string): Highlighted | null {
  const r = matchRange(label, q);
  if (!r) return null;
  const chars = Array.from(label.normalize("NFC"));
  // fold() maps one char to one char, so indices line up
  return { before: chars.slice(0, r[0]).join(""), hit: chars.slice(r[0], r[1]).join(""), after: chars.slice(r[1]).join("") };
}

export type RowHit = { page: PageId; group: GroupDef; row: RowDef };

/** Rows (across every page of `layout`) whose translated label matches `q`. `visible` drops keys the desktop never shows. */
export function filterRows(layout: Record<PageId, GroupDef[]>, q: string, visible: (key: string) => boolean = () => true): RowHit[] {
  const out: RowHit[] = [];
  if (!q.trim()) return out;
  for (const page of Object.keys(layout) as PageId[]) {
    for (const group of layout[page]) {
      for (const row of group.rows) if (visible(row.key) && matchRange(row.label(), q)) out.push({ page, group, row });
    }
  }
  return out;
}

/** Schema keys neither laid out (exactly once) nor hidden with a reason; the layout test fails on any of these. */
export function coverage(schema: SettingEntry[], layout: Record<PageId, GroupDef[]>) {
  const laid = new Map<string, number>();
  for (const page of Object.keys(layout) as PageId[]) for (const g of layout[page]) for (const r of g.rows) laid.set(r.key, (laid.get(r.key) ?? 0) + 1);
  const keys = new Set(schema.map((e) => e.key));
  const isHidden = (k: string) => hidden.some((h) => h.match.test(k));
  return {
    unknown: schema.filter((e) => e.platform !== "android" && !laid.has(e.key) && !isHidden(e.key)).map((e) => e.key),
    twice: [...laid].filter(([, n]) => n > 1).map(([k]) => k),
    notInSchema: [...laid.keys()].filter((k) => !keys.has(k)),
    laidAndHidden: [...laid.keys()].filter(isHidden),
    androidLaid: schema.filter((e) => e.platform === "android" && laid.has(e.key)).map((e) => e.key),
  };
}
