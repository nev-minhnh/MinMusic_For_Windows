export type MenuAction = { id: string; label: string; icon?: string; hint?: string; badge?: string; checked?: boolean; disabled?: boolean; danger?: boolean; run?: () => unknown; children?: MenuItem[] | (() => Promise<MenuItem[]>) };
export type MenuSep = { sep: true };
export type MenuItem = MenuAction | MenuSep;
export const isSep = (i: MenuItem): i is MenuSep => "sep" in i;
export const SEP: MenuSep = { sep: true };
/** drop leading, trailing and doubled separators (builders add them unconditionally) */
export function tidy(items: (MenuItem | false | null | undefined)[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const i of items) {
    if (!i) continue;
    if (isSep(i) && (!out.length || isSep(out[out.length - 1]))) continue;
    out.push(i);
  }
  while (out.length && isSep(out[out.length - 1])) out.pop();
  return out;
}
