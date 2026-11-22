import { For, Index, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "./Icon";
import { pushEsc } from "../lib/esc";
import { t } from "../i18n";
import { menuSize, placeRoot, placeSub } from "../menus/place";
import { isSep, type MenuAction, type MenuItem } from "../menus/types";

type Level = { items: MenuItem[]; left: number; top: number; flipX?: boolean; flipY?: boolean; token: number };

const [levels, setLevels] = createSignal<Level[]>([]);
const [active, setActive] = createSignal<number[]>([]); // highlighted item per level, -1 none
export const menuOpen = () => levels().length > 0;

let invoker: HTMLElement | null = null;
let popEsc: (() => void) | null = null;
let token = 0;

const vp = () => ({ w: window.innerWidth, h: window.innerHeight });
const enabled = (it: MenuItem | undefined): it is MenuAction => !!it && !isSep(it) && !it.disabled;
const stepIndex = (items: MenuItem[], from: number, dir: 1 | -1): number => {
  for (let k = 1; k <= items.length; k++) {
    const i = (((from + dir * k) % items.length) + items.length) % items.length;
    if (enabled(items[i])) return i;
  }
  return -1;
};

/** Opens a context menu at a viewport point (clamped to the window). Replaces any open menu. */
export function openMenu(items: MenuItem[], at: { x: number; y: number }) {
  if (!items.length) return;
  closeMenu(false);
  invoker = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const p = placeRoot(at, menuSize(items), vp());
  setLevels([{ items, ...p, token: ++token }]);
  setActive([-1]);
  popEsc = pushEsc(() => closeMenu());
}

export function closeMenu(restoreFocus = true) {
  if (popEsc) {
    popEsc();
    popEsc = null;
  }
  clearTimeout(hoverT);
  if (levels().length) {
    setLevels([]);
    setActive([]);
    if (restoreFocus && invoker && document.contains(invoker)) invoker.focus({ preventScroll: true });
  }
  invoker = null;
}

let hoverT = 0;
const root = () => document.querySelector<HTMLElement>('[data-testid="menu-layer"]');

/** Opens the submenu of item `i` at level `lv`. Children may be a lazy loader (track.sources). */
function openSub(lv: number, i: number, focusFirst: boolean) {
  const cur = levels()[lv];
  const it = cur?.items[i];
  if (!it || isSep(it) || !it.children) return;
  const host = root();
  const itemEl = host?.querySelector<HTMLElement>(`.mn[data-level="${lv}"] .mn-it[data-i="${i}"]`);
  const parentEl = host?.querySelector<HTMLElement>(`.mn[data-level="${lv}"]`);
  if (!itemEl || !parentEl) return;
  const ir = itemEl.getBoundingClientRect();
  const pr = parentEl.getBoundingClientRect();
  const tk = ++token;
  const put = (items: MenuItem[]) => {
    const p = placeSub(ir, pr, menuSize(items), vp());
    setLevels((ls) => [...ls.slice(0, lv + 1), { items, ...p, token: tk }]);
    setActive((a) => [...a.slice(0, lv), i, focusFirst ? items.findIndex(enabled) : -1]);
  };
  if (typeof it.children === "function") {
    put([{ id: "loading", label: t("w2_loading"), disabled: true }]);
    it.children().then(
      (items) => levels()[lv + 1]?.token === tk && put(items.length ? items : [{ id: "empty", label: t("w2_none"), disabled: true }]),
      () => levels()[lv + 1]?.token === tk && put([{ id: "err", label: t("w2_error_generic"), disabled: true }])
    );
  } else put(it.children);
}

function trimTo(lv: number) {
  setLevels((ls) => ls.slice(0, lv + 1));
  setActive((a) => a.slice(0, lv + 1));
}

function runItem(lv: number, i: number) {
  const it = levels()[lv]?.items[i];
  if (!enabled(it)) return;
  if (it.children) return openSub(lv, i, true);
  closeMenu();
  Promise.resolve(it.run?.()).catch(() => {});
}

function onKey(e: KeyboardEvent) {
  const ls = levels();
  if (!ls.length) return;
  const lv = ls.length - 1;
  const items = ls[lv].items;
  const cur = active()[lv] ?? -1;
  const setCur = (i: number) => setActive((a) => a.map((v, k) => (k === lv ? i : v)));
  let handled = true;
  switch (e.key) {
    case "ArrowDown":
      setCur(stepIndex(items, cur < 0 ? -1 : cur, 1));
      break;
    case "ArrowUp":
      setCur(stepIndex(items, cur < 0 ? 0 : cur, -1));
      break;
    case "Home":
      setCur(stepIndex(items, -1, 1));
      break;
    case "End":
      setCur(stepIndex(items, 0, -1));
      break;
    case "Enter":
    case " ":
      if (cur >= 0) runItem(lv, cur);
      break;
    case "ArrowRight": {
      const it = items[cur];
      if (it && !isSep(it) && it.children) openSub(lv, cur, true);
      break;
    }
    case "ArrowLeft":
      if (lv > 0) trimTo(lv - 1);
      break;
    case "Tab":
      break;
    default:
      handled = false;
  }
  if (handled) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}

/** Mount once (App). Renders the open menu levels above everything else. */
export function MenuHost() {
  onMount(() => {
    window.addEventListener("keydown", onKey, true);
    const close = () => closeMenu(false);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    onCleanup(() => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    });
  });

  const pos = (e: PointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(".mn-it");
    if (!el) return null;
    const lv = Number(el.closest<HTMLElement>(".mn")!.dataset.level);
    return { lv, i: Number(el.dataset.i) };
  };
  const onMove = (e: PointerEvent) => {
    const p = pos(e);
    if (!p) return;
    const { lv, i } = p;
    const it = levels()[lv]?.items[i];
    if (!enabled(it) || (active()[lv] ?? -1) === i) return; // nothing new: keeps a pending submenu timer alone
    clearTimeout(hoverT);
    setActive((a) => [...a.slice(0, lv), i]);
    if (it.children) hoverT = window.setTimeout(() => openSub(lv, i, false), 200); // submenu after 200 ms
    else if (levels().length > lv + 1) hoverT = window.setTimeout(() => trimTo(lv), 200);
  };

  return (
    <Show when={levels().length}>
      <div
        class="mn-layer"
        data-testid="menu-layer"
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) {
            e.preventDefault();
            closeMenu();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (e.target === e.currentTarget) closeMenu();
        }}
        onPointerMove={onMove}
        onClick={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>(".mn-it");
          if (!el) return;
          runItem(Number(el.closest<HTMLElement>(".mn")!.dataset.level), Number(el.dataset.i));
        }}
      >
        <Index each={levels()}>
          {(lv, li) => (
            <div class="mn" classList={{ flip: !!lv().flipX }} role="menu" data-level={li} data-testid="menu" style={{ left: lv().left + "px", top: lv().top + "px" }} data-flip={lv().flipX ? "left" : "right"}>
              <For each={lv().items}>
                {(it, i) => (
                  <Show when={!isSep(it)} fallback={<div class="mn-sep" role="separator" />}>
                    {(() => {
                      const a = it as MenuAction;
                      return (
                        <button
                          type="button"
                          class="mn-it"
                          classList={{ on: active()[li] === i(), dis: !!a.disabled, danger: !!a.danger }}
                          role="menuitem"
                          aria-disabled={a.disabled ? "true" : undefined}
                          aria-haspopup={a.children ? "menu" : undefined}
                          aria-checked={a.checked === undefined ? undefined : a.checked}
                          tabindex="-1"
                          data-i={i()}
                          data-id={a.id}
                          data-testid="menu-item"
                        >
                          <span class="mn-ic">{a.icon ? <Icon n={a.icon} s={20} /> : null}</span>
                          <span class="mn-l ell">{a.label}</span>
                          <Show when={a.badge}>
                            <span class="b q">{a.badge}</span>
                          </Show>
                          <Show when={a.checked}>
                            <Icon n="check" s={20} />
                          </Show>
                          <Show when={a.hint}>
                            <span class="mn-k">{a.hint}</span>
                          </Show>
                          <Show when={a.children}>
                            <Icon n="chevron_right" s={16} class="mn-more" />
                          </Show>
                        </button>
                      );
                    })()}
                  </Show>
                )}
              </For>
            </div>
          )}
        </Index>
      </div>
    </Show>
  );
}
