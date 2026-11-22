import { Show, onMount } from "solid-js";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { IconButton } from "../components/IconButton";
import { Meta } from "../components/Meta";
import { ProgressBar } from "../components/Progress";
import { player, playerState, elapsed, positionNow } from "../state/player";
import { openFull } from "../state/ui";
import { floatingBar, paneOpen, paneTab, pop, togglePane, togglePop } from "../state/playerExtra";
import { initQueue } from "../state/queue";
import { navigate } from "../router/router";
import { devBuild } from "../lib/core";
import { wClass, hClass } from "../lib/layout";
import { fmtTime } from "../lib/format";
import { t } from "../i18n";
import { SupportPane } from "./SupportPane";
import { LyricsFullscreen } from "../pages/Lyrics/Fullscreen";
import { PlayerPopovers, sleepLabel } from "./player/Popovers";
import { ProgressControl } from "./player/ProgressControl";
import { VolumeSlider } from "./player/VolumeSlider";
import "./player/player.css";

/**
 * Player bar: 3 zones 1fr / <=640 / 1fr (expanded), 1fr / <=440 / auto (medium), 1fr / auto / auto + 2 px top line (compact).
 * Also mounts the app-level player overlays that live outside the full-player layer: support pane (grid column 3),
 * lyrics fullscreen and the popovers.
 */
export function PlayerBar() {
  const s = () => playerState();
  const playing = () => s()?.playing ?? false;
  const compact = () => wClass() === "compact";
  const medium = () => wClass() === "medium";
  const artSize = () => (compact() ? 40 : medium() || hClass() === "short" ? 48 : 56);
  const paneIs = (tab: "queue" | "lyrics") => paneOpen() && paneTab() === tab;
  onMount(() => {
    initQueue();
    if (devBuild) (window as any).__mmPos = positionNow; // test seam: the interpolated clock
  });
  const muted = () => s()?.muted || (s()?.volume ?? 1) === 0;
  const speedOn = () => (s()?.speed ?? 1) !== 1;
  return (
    <>
      <div class="pbar" classList={{ cmp: compact(), float: floatingBar() }} data-testid="player-bar" role="region" aria-label={t("w2_player")}>
        <div class="pbar-in">
          <Show when={compact()}>
            <div class="topline">
              <ProgressBar line label={t("w2_seek")} />
            </div>
          </Show>
          <div class="pl">
            <button type="button" class="art-btn" aria-label={t("w2_expand")} onClick={openFull} data-testid="player-art" style={{ width: artSize() + "px", height: artSize() + "px" }}>
              <Art art={s()?.track?.art} size={artSize()} reqPx={520} class="pressable" />
            </button>
            <div class="f1">
              <div class="w6 ell">{s()?.track?.title}</div>
              <Show when={s()?.track}>{(tr) => <Meta t={tr()} />}</Show>
            </div>
            <Show when={!compact()}>
              <IconButton icon={s()?.track?.liked ? "heartf" : "heart"} label={t("w2_like")} class="liked-btn" onClick={() => s()?.track && player.like(s()!.track!.id, !s()!.track!.liked)} />
            </Show>
          </div>
          <div class="pc">
            <div class="ctl">
              <Show when={!compact()}>
                <IconButton icon="shuffle" label={t("shuffle")} active={s()?.shuffle} onClick={() => player.setShuffle(!s()?.shuffle)} />
              </Show>
              <IconButton icon="prev" label={t("w2_prev")} onClick={() => player.prev()} />
              <button type="button" class="pp pressable" aria-label={playing() ? t("w2_pause") : t("w2_play")} onClick={() => player.toggle()} data-testid="play-pause">
                <Icon n={playing() ? "pause" : "play"} s={24} />
              </button>
              <IconButton icon="next" label={t("w2_next")} onClick={() => player.next()} />
              <Show when={!compact()}>
                <IconButton icon="repeat" label={t("w2_repeat")} active={s()?.repeat !== "off"} onClick={() => player.cycleRepeat()} />
              </Show>
            </div>
            <Show when={!compact()}>
              <div class="prow">
                <span class="tl">{fmtTime(elapsed())}</span>
                <ProgressControl where="bar" testid="progress" />
                <span class="tl">{fmtTime(s()?.durMs ?? 0)}</span>
              </div>
            </Show>
          </div>
          <div class="pr">
            <Show when={!compact()}>
              <Show when={medium()} fallback={<button type="button" class="chipbtn btn" data-testid="eq-chip" onClick={() => navigate("equalizer")}><span class="dot" />{t("w2_eq_chip", s()?.eq.profileName ?? "")}</button>}>
                <IconButton icon="tune" label={t("w2_equalizer")} onClick={() => navigate("equalizer")} />
              </Show>
              <IconButton icon="lyrics" label={t("lyrics")} active={paneIs("lyrics")} onClick={() => togglePane("lyrics")} testid="lyrics-btn" />
            </Show>
            <IconButton icon="queue" label={t("queue")} active={paneIs("queue")} onClick={() => togglePane("queue")} testid="queue-btn" />
            <Show when={!compact()}>
              <Show when={!medium()}>
                <IconButton icon="phones" label={t("w2_output")} active={pop()?.kind === "output"} onClick={(e) => togglePop("output", e.currentTarget as HTMLElement)} testid="output-btn" />
                <IconButton icon="moon" label={t("w2_sleep")} active={!!sleepLabel()} onClick={(e) => togglePop("sleep", e.currentTarget as HTMLElement)} testid="sleep-btn" />
                <Show when={sleepLabel()}>
                  <span class="chipbtn sleep-on num" data-testid="sleep-chip">{sleepLabel()}</span>
                </Show>
                <Show when={speedOn()}>
                  <button type="button" class="chipbtn btn spd num" data-testid="speed-chip" onClick={(e) => togglePop("more", e.currentTarget as HTMLElement)}>{`${s()?.speed}×`}</button>
                </Show>
              </Show>
              <Show
                when={medium()}
                fallback={<IconButton icon={muted() ? "vol_off" : "vol"} label={t("w2_m22_mute")} active={s()?.muted} onClick={() => player.mute(!s()?.muted)} testid="vol-btn" />}
              >
                <IconButton icon={muted() ? "vol_off" : "vol"} label={t("w2_volume")} onClick={(e) => togglePop("vol", e.currentTarget as HTMLElement)} testid="vol-btn" />
              </Show>
              <Show when={!medium()}>
                <VolumeSlider class="bar-vol" />
              </Show>
              <IconButton icon="more" label={t("w2_more")} active={pop()?.kind === "more"} onClick={(e) => togglePop("more", e.currentTarget as HTMLElement)} testid="more-btn" />
            </Show>
            <IconButton icon="full" label={t("w2_expand")} onClick={openFull} testid="expand-player" />
          </div>
        </div>
      </div>
      <SupportPane />
      <LyricsFullscreen />
      <PlayerPopovers />
    </>
  );
}
