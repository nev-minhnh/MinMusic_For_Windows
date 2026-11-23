import type { RouteName } from "../../router/routes";
import { onMount, type Accessor } from "solid-js";
import { SongList } from "../Library/SongList";
import { DownloadsBox } from "../Library/DownloadsBox";
import { keepScroll } from "../Library/util";
import { t } from "../../i18n";
import "../Library/library.css";

/** Downloaded songs: the summary box (hidden until the core answers `download.summary`) and the shared song list over `library.window downloaded`. */
export function Downloads(props: { params: Record<string, string>; active: Accessor<boolean> }) {
  let root!: HTMLDivElement;
  onMount(() => keepScroll(root, props.active));
  return (
    <div ref={root} class="sc library" data-testid="downloads">
      <DownloadsBox />
      <SongList list="downloaded" label={t("w2_downloaded")} testid="downloads-table" title={t("w2_downloaded")} emptyKey="w2_lib_empty_downloads" active={props.active} />
    </div>
  );
}

export const routes: RouteName[] = ["downloads"];
export default Downloads;
