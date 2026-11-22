import { Show } from "solid-js";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { IconButton } from "../components/IconButton";
import { Meta } from "../components/Meta";
import { ProgressBar } from "../components/Progress";
import { player, playerState, elapsed } from "../state/player";
import { openFull } from "../state/ui";
import { wClass, hClass } from "../lib/layout";
import { fmtTime } from "../lib/format";
import { t } from "../i18n";

/** Player bar: 3 zones 1fr / <=640 / 1fr (expanded), 1fr / <=440 / auto (medium), 1fr / auto / auto + 2 px top line (compact). */
export function PlayerBar() {
  const s = () => playerState();
  const playing = () => s()?.playing ?? false;
  const compact = () => wClass() === "compact";
  const medium = () => wClass() === "medium";
  const artSize = () => (compact() ? 40 : medium() || hClass() === "short" ? 48 : 56);
  return (
    <div class="pbar" classList={{ cmp: compact() }} data-testid="player-bar" role="region" aria-label={t("w2_player")}>
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
              <ProgressBar label={t("w2_seek")} testid="progress" />
              <span class="tl">{fmtTime(s()?.durMs ?? 0)}</span>
            </div>
          </Show>
        </div>
        <div class="pr">
          <Show when={!compact()}>
            <Show when={medium()} fallback={<span class="chipbtn"><span class="dot" />{t("w2_eq_chip", s()?.eq.profileName ?? "")}</span>}>
              <IconButton icon="tune" label={t("w2_equalizer")} />
            </Show>
            <IconButton icon="lyrics" label={t("lyrics")} />
          </Show>
          <IconButton icon="queue" label={t("queue")} />
          <Show when={!compact()}>
            <Show when={!medium()}>
              <IconButton icon="phones" label={t("w2_output")} />
            </Show>
            <IconButton icon="vol" label={t("w2_volume")} />
            <Show when={!medium()}>
              <div class="bar vol">
                <div class="bar-fill" style={{ transform: `scaleX(${s()?.volume ?? 0})`, background: "var(--ink2)" }} />
              </div>
            </Show>
          </Show>
          <IconButton icon="full" label={t("w2_expand")} onClick={openFull} testid="expand-player" />
        </div>
      </div>
    </div>
  );
}
