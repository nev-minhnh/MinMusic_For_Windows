import { isSep, type MenuItem } from "./types";

// LS 5.3 / MK .menu: width 272, padding 6, item 36, separator 1 + 2 x 6 margin
export const MENU_W = 272;
export const MENU_PAD = 6;
export const ITEM_H = 36;
export const SEP_H = 13;
export const EDGE = 8;

export type Size = { w: number; h: number };
export type Rect = { left: number; top: number; right: number; bottom: number };

export const menuSize = (items: MenuItem[]): Size => ({ w: MENU_W, h: 2 * MENU_PAD + items.reduce((h, i) => h + (isSep(i) ? SEP_H : ITEM_H), 0) });

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Root menu at the pointer, clamped to the window. */
export function placeRoot(pt: { x: number; y: number }, size: Size, vp: Size): { left: number; top: number } {
  return {
    left: clamp(pt.x, EDGE, Math.max(EDGE, vp.w - EDGE - size.w)),
    top: clamp(pt.y, EDGE, Math.max(EDGE, vp.h - EDGE - size.h)),
  };
}

/**
 * Submenu next to its parent item. Opens to the right; flips left when it would overflow the window, and flips up
 * (bottom-aligned with the item) near the bottom. `item` is the parent item rect, `parent` the parent menu rect.
 */
export function placeSub(item: Rect, parent: Rect, size: Size, vp: Size): { left: number; top: number; flipX: boolean; flipY: boolean } {
  let left = parent.right - 2;
  let flipX = false;
  if (left + size.w > vp.w - EDGE) {
    left = parent.left + 2 - size.w;
    flipX = true;
  }
  let top = item.top - MENU_PAD;
  let flipY = false;
  if (top + size.h > vp.h - EDGE) {
    top = item.bottom + MENU_PAD - size.h;
    flipY = true;
  }
  return { left: clamp(left, EDGE, Math.max(EDGE, vp.w - EDGE - size.w)), top: clamp(top, EDGE, Math.max(EDGE, vp.h - EDGE - size.h)), flipX, flipY };
}
