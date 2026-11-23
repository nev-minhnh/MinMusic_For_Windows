import { For, createEffect, on, onMount } from "solid-js";
import { Dynamic } from "solid-js/web";
import { current, mounted, direction, savedScroll, type Route } from "./router";
import { reducedMotion } from "../lib/motion";
import { buildPages, pageFor, type PageModule, type PageProps } from "./registry";
import Missing from "../pages/_Missing";

export type { PageProps };
// Every pages/<Name>/index.tsx registers itself: `export const routes` + default component. Page WPs never edit the router.
const PAGES = buildPages(import.meta.glob<PageModule>("../pages/*/index.tsx", { eager: true }));

const NAV_EASE = "cubic-bezier(0.05,0.7,0.1,1)";

function Page(props: { route: Route }) {
  const active = () => current().key === props.route.key;
  let el!: HTMLDivElement;
  // A hidden page (content-visibility:hidden) loses its scroll extent, so Chromium clamps scrollTop to 0 and fires scroll
  // events; and when it shows again it restores the wrong offset. Record only while the page is active and settled, and put
  // the remembered offset back when it becomes active again (keep-alive scroll restore).
  let settling = true;
  const restore = () => {
    settling = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const saved = savedScroll.get(props.route.key) ?? 0;
        if (el.scrollTop !== saved) el.scrollTop = saved;
        setTimeout(() => (settling = false), 50);
      })
    );
  };
  onMount(() => {
    // passive bookkeeping only: remembers the scroll offset, writes no styles
    el.addEventListener("scroll", () => active() && !settling && savedScroll.set(props.route.key, el.scrollTop), { passive: true });
  });
  createEffect(
    on(active, (a) => {
      if (!a) return;
      el.focus({ preventScroll: true });
      restore();
    })
  );
  return (
    <div ref={el} class="pg" classList={{ hid: !active() }} data-key={props.route.key} data-route={props.route.name} tabindex="-1">
      <Dynamic component={pageFor(PAGES, props.route.name, Missing)} params={props.route.params} active={active} />
    </div>
  );
}

/** Stack view with keep-alive and the page transition (frontend-spec 6.2): WAAPI on the wrappers, transform + opacity only. */
export function RouterView() {
  let host!: HTMLDivElement;
  const find = (key: string) => host.querySelector<HTMLElement>(`[data-key="${key}"]`);
  createEffect(
    on(
      () => current().key,
      (key, prevKey) => {
        if (prevKey === undefined) return;
        const dir = direction();
        const incoming = find(key);
        const outgoing = find(prevKey);
        if (!incoming) return;
        const rm = reducedMotion();
        // hold the first frame (the effect runs before paint): incoming invisible, outgoing still shown
        incoming.style.opacity = "0";
        outgoing?.classList.add("vis");
        // render first, animate after one frame so the first frame is not spent on layout
        requestAnimationFrame(() => {
          const dx = dir === "pop" ? -30 : 30;
          incoming.classList.add("anim");
          const a = incoming.animate(
            rm
              ? [{ opacity: 0 }, { opacity: 1 }]
              : [
                  { transform: `translateX(${dx}px)`, opacity: 0 },
                  { transform: "none", opacity: 1 },
                ],
            { duration: rm ? 120 : 300, easing: NAV_EASE, fill: "backwards" }
          );
          incoming.style.opacity = "";
          a.finished.then(() => incoming.classList.remove("anim")).catch(() => {});
          if (outgoing) {
            outgoing.classList.add("anim");
            const o = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 100, easing: "linear", fill: "forwards" });
            o.finished
              .then(() => {
                outgoing.classList.remove("anim", "vis");
                o.cancel();
              })
              .catch(() => {});
          }
        });
      }
    )
  );
  return (
    <div class="stack" ref={host}>
      <For each={mounted()}>{(r) => <Page route={r} />}</For>
    </div>
  );
}
