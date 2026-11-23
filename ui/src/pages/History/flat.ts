// History is one flat list of rows: a 32 px group header ("Hôm nay", "Hôm qua", ...) in front of the first track of each group, then
// 56 px track rows. Heights are fixed, so every position is arithmetic over the sorted `groups` (no measuring).
export const HEAD_H = 32;
export const TRACK_H = 56;

/** `history.window` group: `label` is an i18n key (`w2_hist_*`), `offset` the index of the group's first track. */
export type Group = { label: string; offset: number };
export type FlatRow = { kind: "head"; group: number } | { kind: "track"; index: number };

/** Sorted by offset, one entry per offset, no two neighbours with the same label, nothing at or past `total`. */
export function normalizeGroups(groups: readonly Group[], total: number): Group[] {
  const out: Group[] = [];
  for (const g of [...groups].sort((a, b) => a.offset - b.offset)) {
    if (g.offset >= total || g.offset < 0) continue;
    const last = out[out.length - 1];
    if (last && (last.offset === g.offset || last.label === g.label)) continue;
    out.push(g);
  }
  return out;
}

/** number of rows in the flat list */
export const flatCount = (total: number, groups: readonly Group[]) => total + groups.length;
export const totalHeight = (total: number, groups: readonly Group[]) => total * TRACK_H + groups.length * HEAD_H;

/** how many leading entries (0..n) satisfy `pred`; `pred` must be true for a prefix only */
function prefix(n: number, pred: (k: number) => boolean): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pred(mid)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** What flat row `flat` is. The header of group k sits at flat index `groups[k].offset + k`. */
export function rowAt(flat: number, groups: readonly Group[]): FlatRow {
  const k = prefix(groups.length, (j) => groups[j].offset + j <= flat); // headers at or before `flat`
  if (k > 0 && groups[k - 1].offset + (k - 1) === flat) return { kind: "head", group: k - 1 };
  return { kind: "track", index: flat - k };
}

/** Flat index of track `i`. */
export const flatOfTrack = (i: number, groups: readonly Group[]) => i + prefix(groups.length, (j) => groups[j].offset <= i);

/** Top of flat row `flat` in px. */
export function topOf(flat: number, groups: readonly Group[]): number {
  const r = rowAt(flat, groups);
  if (r.kind === "head") return groups[r.group].offset * TRACK_H + r.group * HEAD_H;
  return r.index * TRACK_H + prefix(groups.length, (j) => groups[j].offset <= r.index) * HEAD_H;
}
export const heightOf = (flat: number, groups: readonly Group[]) => (rowAt(flat, groups).kind === "head" ? HEAD_H : TRACK_H);

/** The flat row that contains the vertical position `y` (clamped to the list). */
export function flatAtY(y: number, total: number, groups: readonly Group[]): number {
  if (total <= 0) return 0;
  const yy = Math.max(0, y);
  const g = prefix(groups.length, (j) => groups[j].offset * TRACK_H + j * HEAD_H <= yy); // headers that start at or above yy
  if (g > 0 && yy < groups[g - 1].offset * TRACK_H + (g - 1) * HEAD_H + HEAD_H) return groups[g - 1].offset + g - 1;
  const i = Math.min(total - 1, Math.floor((yy - g * HEAD_H) / TRACK_H));
  return i + g;
}

/** The track index range [from, to) covered by flat rows [lo, hi) (what to fetch). */
export function trackRange(lo: number, hi: number, groups: readonly Group[]): [number, number] {
  const a = rowAt(lo, groups);
  const b = rowAt(Math.max(lo, hi - 1), groups);
  const from = a.kind === "track" ? a.index : groups[a.group].offset;
  const to = b.kind === "track" ? b.index + 1 : groups[b.group].offset + 1;
  return [from, Math.max(from, to)];
}
