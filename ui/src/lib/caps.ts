/** Feature switches for things whose core methods land in a later milestone. */
export const caps = {
  /** download.* (M4-2a). "soon": menus show the entry disabled with the hint "M4"; "unsupported": they hide it. */
  downloads: "ready" as "soon" | "ready" | "unsupported",
};
