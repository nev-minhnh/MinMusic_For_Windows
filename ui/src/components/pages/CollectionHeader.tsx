import { Show, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { Art } from "../Art";
import { Icon } from "../Icon";
import { IconButton } from "../IconButton";
import { hClass } from "../../lib/layout";
import { caps } from "../../lib/caps";
import { t } from "../../i18n";
import { observeSentinel } from "./stickyBar";
import type { Art as ArtT } from "../../lib/types";
import "./pages.css";

/**
 * Header shared by Album, Playlist and Podcast (MK 5): art 168 (short windows) / 232, kicker, title 28, meta, actions, and the
 * sticky 56 bar (art 40 + title + Phát) that replaces it once it has scrolled away. The bar is shown by an IntersectionObserver
 * sentinel, never by a scroll handler. Put it as the first child of the page's `.sc` container.
 */
export function CollectionHeader(props: {
  loading?: boolean;
  art?: ArtT;
  kicker: string;
  title?: string;
  /** meta lines under the title */
  meta?: JSX.Element;
  badges?: JSX.Element;
  onPlay: () => void;
  onShuffle?: () => void;
  /** heart toggle (album.save / playlist.save); omit onSave to hide */
  saved?: boolean;
  onSave?: () => void;
  onMore?: (at: { x: number; y: number }) => void;
  /** extra buttons after the heart */
  actions?: JSX.Element;
  testid?: string;
}) {
  const [stuck, setStuck] = createSignal(false);
  let sentinel!: HTMLDivElement;
  onMount(() => onCleanup(observeSentinel(sentinel, setStuck)));
  const size = () => (hClass() === "short" ? 168 : 232);
  const more = (e: MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    props.onMore?.({ x: r.left, y: r.bottom + 4 });
  };
  return (
    <div data-testid={props.testid ?? "coll-header"}>
      <div class="al-sentinel" ref={sentinel} data-testid="coll-sentinel" />
      <div class="al-sticky" aria-hidden={!stuck()}>
        <div class="al-bar" classList={{ on: stuck() }} data-testid="coll-sticky" data-on={stuck() ? "1" : "0"}>
          <Show when={!props.loading}>
            <Art art={props.art} size={40} />
            <div class="w6 f1 ell">{props.title}</div>
            <button type="button" class="btn pri sm" tabindex={stuck() ? 0 : -1} data-testid="coll-sticky-play" onClick={() => props.onPlay()}>
              <Icon n="play" s={16} />
              {t("w2_play")}
            </button>
          </Show>
        </div>
      </div>
      <div class="al-head">
        <Show when={!props.loading} fallback={<div class="art skel-art al-art" style={{ width: size() + "px", height: size() + "px" }} />}>
          <Art art={props.art} size={size()} class="al-art" />
        </Show>
        <div class="f1" style={{ "min-width": "0" }}>
          <Show
            when={!props.loading}
            fallback={
              <>
                <div class="skel" style={{ width: "30%" }} />
                <div class="skel" style={{ width: "50%", "margin-top": "12px" }} />
              </>
            }
          >
            <div class="ovl">{props.kicker}</div>
            <h1 class="t28 w6 ch-title" data-testid="coll-title">
              {props.title}
            </h1>
            <div class="i2 ch-meta">{props.meta}</div>
            <Show when={props.badges}>
              <div class="row ch-badges">{props.badges}</div>
            </Show>
            <div class="row gap8 ch-actions">
              <button type="button" class="btn pri" data-testid="coll-play" onClick={() => props.onPlay()}>
                <Icon n="play" s={20} />
                {t("w2_play")}
              </button>
              <Show when={props.onShuffle}>
                <button type="button" class="btn ton" data-testid="coll-shuffle" onClick={() => props.onShuffle!()}>
                  <Icon n="shuffle" s={20} />
                  {t("w2_shuffle")}
                </button>
              </Show>
              <Show when={props.onSave}>
                <IconButton icon={props.saved ? "heartf" : "heart"} label={t(props.saved ? "w2_pg_unsave" : "w2_pg_save")} tonal active={!!props.saved} size={40} testid="coll-save" onClick={() => props.onSave!()} />
              </Show>
              <Show when={caps.downloads !== "unsupported"}>
                <IconButton icon="dl" label={t("w2_download")} tonal size={40} disabled testid="coll-download" />
              </Show>
              {props.actions}
              <Show when={props.onMore}>
                <IconButton icon="more" label={t("w2_more")} tonal size={40} testid="coll-more" onClick={more} />
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
