import { Show, createSignal, lazy, onCleanup, onMount, type Component } from "solid-js";
import { TitleBar } from "./TitleBar";
import { Sidebar } from "./Sidebar";
import { Rail } from "./Rail";
import { PlayerBar } from "./PlayerBar";
import { FullPlayer } from "./FullPlayer";
import { RouterView } from "../router/View";
import { MenuHost } from "../components/Menu";
import { Toasts } from "../toast/Toasts";
import { initToasts, toast } from "../toast";
import { ConfirmHost } from "../dialogs/Confirm";
import { PromptHost } from "../dialogs/Prompt";
import { wClass, hClass, initLayout } from "../lib/layout";
import { devBuild } from "../lib/core";
import { inTauri } from "../lib/tauri";
import { dropTarget, initFileDrop } from "../lib/dnd";
import { navTo } from "../lib/nav";
import { initPlayer, player } from "../state/player";
import { initLibrary } from "../state/library";
import { initUserAlbums } from "../state/userAlbums";
import { initPrefs } from "../state/prefs";
import { overlayOpen, setOverlay, sidebarDocked, sidebarWidth } from "../state/shell";
import { current } from "../router/router";
import { initKeys, isTyping } from "../input/keys";
import { plural } from "../i18n";
import type { NavTarget } from "../lib/types";

// `#/dev/settings/<key>` renders one Settings category alone (dev and e2e builds only)
const DevSettings: Component<{ k: string }> | null = devBuild ? lazy(() => import("../pages/Settings/_dev")) : null;
// `#/dev/table`: the shared Table + Card on the mock library (foundation tests)
const DevTable: Component | null = devBuild ? lazy(() => import("../dev/DevTable")) : null;
const devKey = () => /^#\/dev\/(settings\/[\w-]+|table)/.exec(location.hash)?.[1] ?? null;

/** App frame: the grid matches MK .win (columns sb / 1fr / auto, rows tb / 1fr / pb). */
export function App() {
  let search: HTMLInputElement | undefined;
  const [dev, setDev] = createSignal(devKey());
  onMount(() => {
    initPrefs();
    initLayout();
    initPlayer();
    initLibrary();
    initUserAlbums();
    initKeys(() => search?.focus());
    initFileDrop();
    const offToasts = initToasts();
    // startup/*.ts hooks (crash prompt, onboarding, first-run toast...) run once after the first paint
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        for (const load of Object.values(import.meta.glob<{ run?: () => unknown }>("../startup/*.ts"))) void load().then((m) => m.run?.()).catch(() => {});
      }),
    );

    const hash = () => setDev(devKey());
    window.addEventListener("hashchange", hash);
    // no native context menu on empty space (LS 5.3); text fields keep theirs
    const noMenu = (e: MouseEvent) => !isTyping(e.target) && e.preventDefault();
    window.addEventListener("contextmenu", noMenu);
    // deep links: the shell emits the Tauri event `mm-nav` {NavTarget}; a DOM CustomEvent of the same name serves the web project
    const domNav = (e: Event) => navTo((e as CustomEvent<NavTarget>).detail);
    window.addEventListener("mm-nav", domNav);
    let offTauri: (() => void) | undefined;
    if (inTauri) import("@tauri-apps/api/event").then(({ listen }) => listen("mm-nav", (ev: { payload: NavTarget }) => navTo(ev.payload))).then((un) => (offTauri = un)).catch(() => {});
    // dropping tracks on the player bar appends them to the queue
    const bar = document.querySelector<HTMLElement>('[data-testid="player-bar"]');
    const offBar = bar
      ? dropTarget(bar, (p) => {
          void player.addToQueue(p.ids);
          toast({ text: plural("w2_queued_n", p.ids.length) });
        })
      : () => {};
    onCleanup(() => {
      offToasts();
      offBar();
      offTauri?.();
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("contextmenu", noMenu);
      window.removeEventListener("mm-nav", domNav);
    });
  });
  const rail = () => wClass() !== "expanded" || !sidebarDocked();
  // the overlay sidebar closes when the route changes
  let lastKey = current().key;
  const overlayWatch = () => {
    const k = current().key;
    if (k !== lastKey) {
      lastKey = k;
      if (overlayOpen()) setOverlay(false);
    }
    return null;
  };
  return (
    <div
      class="win"
      data-w={wClass()}
      data-h={hClass()}
      data-side={rail() ? "rail" : "side"}
      style={wClass() === "expanded" ? { "--sb": sidebarDocked() ? sidebarWidth() + "px" : "80px" } : undefined}
      data-testid="app"
    >
      <Show when={!rail()} fallback={<Rail compact={wClass() === "compact"} />}>
        <Sidebar />
      </Show>
      <TitleBar searchRef={(el) => (search = el)} />
      <main class="main">
        <Show when={devBuild && dev()} fallback={<RouterView />}>
          {(() => {
            const S = DevSettings!;
            const T = DevTable!;
            return dev() === "table" ? <T /> : <S k={dev()!.slice("settings/".length)} />;
          })()}
        </Show>
      </main>
      <PlayerBar />
      <FullPlayer />
      <Show when={overlayOpen() && wClass() !== "expanded" || overlayOpen() && !sidebarDocked()}>
        <div class="ovl-scrim" data-testid="sidebar-scrim" onPointerDown={() => setOverlay(false)} />
        <Sidebar overlay />
      </Show>
      {overlayWatch()}
      <MenuHost />
      <ConfirmHost />
      <PromptHost />
      <Toasts />
    </div>
  );
}
