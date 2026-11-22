import { Show, onMount } from "solid-js";
import { TitleBar } from "./TitleBar";
import { Sidebar, Rail } from "./Sidebar";
import { PlayerBar } from "./PlayerBar";
import { FullPlayer } from "./FullPlayer";
import { RouterView } from "../router/View";
import { wClass, hClass, initLayout } from "../lib/layout";
import { initPlayer } from "../state/player";
import { initKeys } from "../input/keys";
import { setAppLanguage } from "../i18n";

/** App frame: the grid matches MK .win (columns sb / 1fr / auto, rows tb / 1fr / pb). */
export function App() {
  let search: HTMLInputElement | undefined;
  onMount(() => {
    const q = new URLSearchParams(location.search);
    const theme = q.get("theme");
    if (theme) document.documentElement.dataset.theme = theme;
    setAppLanguage(q.get("lang") ?? "SYSTEM");
    initLayout();
    initPlayer();
    initKeys(() => search?.focus());
  });
  return (
    <div class="win" data-w={wClass()} data-h={hClass()} data-testid="app">
      <Show when={wClass() === "expanded"} fallback={<Rail compact={wClass() === "compact"} />}>
        <Sidebar />
      </Show>
      <TitleBar searchRef={(el) => (search = el)} />
      <main class="main">
        <RouterView />
      </main>
      <PlayerBar />
      <FullPlayer />
    </div>
  );
}
