import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { IconButton } from "../components/IconButton";
import { Chip } from "../components/Chip";
import { Seg } from "../components/Seg";
import { QualityBadge, SourceBadge, AltBadge } from "../components/Badge";
import { WaveProgress } from "../components/Progress";
import { Caption } from "./Caption";
import { player, playerState, elapsed } from "../state/player";
import { fullOpen, closeFull } from "../state/ui";
import { pushEsc } from "../lib/esc";
import { reducedMotion, E_CONTAINER, D_CONTAINER } from "../lib/motion";
import { fmtRemaining, fmtTime, artistsText } from "../lib/format";
import { SAMPLE_LYRICS, SAMPLE_TRANSLATION, CURRENT_LINE } from "../stub/lyrics";
import { t } from "../i18n";

type Phase = "closed" | "opening" | "open" | "closing";

/**
 * Full player: a fixed layer, mounted after first use, `visibility:hidden` while closed (frontend-spec 6.3).
 * Container transform with WAAPI: art translate+scale from the bar art rect, layer background opacity,
 * the single allowed clip-path animation, bar content fade 0-25 %, controls fade + translateY 35-100 %.
 */
export function FullPlayer() {
  const [used, setUsed] = createSignal(false);
  const [tab, setTab] = createSignal("lyrics");
  let layer: HTMLDivElement | undefined;
  let bg: HTMLDivElement | undefined;
  let artWrap: HTMLDivElement | undefined;
  let ctl: HTMLDivElement | undefined;
  let right: HTMLDivElement | undefined;
  let top: HTMLDivElement | undefined;
  let phase: Phase = "closed";
  let anims: Animation[] = [];
  let unEsc: (() => void) | undefined;

  const barArt = () => document.querySelector<HTMLElement>('[data-testid="player-art"]');
  const barIn = () => document.querySelector<HTMLElement>(".pbar-in");

  function stop() {
    anims.forEach((a) => a.cancel());
    anims = [];
  }

  function run(open: boolean) {
    if (!layer || !bg || !artWrap || !ctl || !right || !top) return;
    const rm = reducedMotion();
    const ease = rm ? "linear" : E_CONTAINER;
    const dur = rm ? 120 : D_CONTAINER;
    // interrupted mid-flight: reverse what is running
    if (anims.length && (phase === "opening" || phase === "closing")) {
      phase = open ? "opening" : "closing";
      anims.forEach((a) => a.reverse());
      return;
    }
    layer.style.visibility = "visible";
    layer.classList.add("anim");
    const pb = document.querySelector<HTMLElement>(".pbar")?.getBoundingClientRect().height ?? 88;
    const A = barArt()?.getBoundingClientRect();
    const B = artWrap.getBoundingClientRect();
    const kf = (keyframes: Keyframe[], el: Element, opts: KeyframeAnimationOptions = {}) =>
      el.animate(keyframes, { duration: dur, easing: ease, fill: "both", direction: open ? "normal" : "reverse", ...opts });
    anims = [];
    if (!rm && A) {
      anims.push(kf([{ transform: `translate(${A.left - B.left}px,${A.top - B.top}px) scale(${A.width / B.width})` }, { transform: "none" }], artWrap));
      anims.push(kf([{ clipPath: `inset(${window.innerHeight - pb}px 0 0 0)` }, { clipPath: "inset(0px 0 0 0)" }], layer));
    }
    anims.push(kf([{ opacity: 0 }, { opacity: 1 }], bg));
    const reveal: Keyframe[] = rm
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: "translateY(16px)", offset: 0 },
          { opacity: 0, transform: "translateY(16px)", offset: 0.35 },
          { opacity: 1, transform: "none", offset: 1 },
        ];
    anims.push(kf(reveal, ctl), kf(reveal, right), kf(reveal, top));
    const bi = barIn();
    if (bi) anims.push(kf([{ opacity: 1, offset: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 0, offset: 1 }], bi, { easing: "linear" }));
    phase = open ? "opening" : "closing";
    const mine = anims.slice();
    Promise.all(mine.map((a) => a.finished))
      .then(() => {
        if (anims[0] !== mine[0]) return;
        const nowOpen = phase === "opening";
        phase = nowOpen ? "open" : "closed";
        // end states equal the natural styles, except the bar content which stays hidden under the open layer
        const barOpacity = nowOpen ? "0" : "";
        const b = barIn();
        stop();
        if (b) b.style.opacity = barOpacity;
        layer!.classList.remove("anim");
        if (!nowOpen) layer!.style.visibility = "hidden";
        else ctl?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
      })
      .catch(() => {});
  }

  createEffect(
    on(
      fullOpen,
      (o) => {
        if (o) {
          unEsc?.();
          unEsc = pushEsc(closeFull);
          if (!used()) setUsed(true);
          // the layer is laid out (hidden) before measuring: wait for the Show to render
          queueMicrotask(() => requestAnimationFrame(() => run(true)));
        } else {
          unEsc?.();
          unEsc = undefined;
          if (used()) run(false);
        }
      },
      { defer: true }
    )
  );
  onCleanup(() => unEsc?.());

  const s = () => playerState();
  const tr = () => s()?.track;
  const tabs = () => [
    { key: "lyrics", label: t("w2_tab_lyrics") },
    { key: "queue", label: t("w2_tab_next") },
    { key: "related", label: t("w2_tab_related") },
  ];

  return (
    <Show when={used()}>
      <div ref={layer} class="fp" style={{ visibility: "hidden" }} data-testid="full-player" role="dialog" aria-label={t("w2_player")} aria-modal="true">
        <div class="fp-bg" ref={bg} style={{ "--tint": tr()?.art?.dominant ?? "#2A1622" }} />
        <div class="fp-top tbar" ref={top} data-tauri-drag-region>
          <IconButton icon="down" label={t("w2_collapse")} class="h" onClick={closeFull} testid="collapse-player" />
          <span class="t12 i3" style={{ "margin-left": "4px" }}>{t("w2_collapse")}</span>
          <div class="fp-ctx">
            <div class="ovl">{t("w2_playing_from_album")}</div>
            <div class="w6">{s()?.context?.title}</div>
          </div>
          <div class="row gap8 mla">
            <IconButton icon="pip" label={t("w2_mini")} />
            <IconButton icon="full" label={t("w2_fullscreen")} />
            <IconButton icon="more" label={t("w2_more")} />
          </div>
          <Caption />
        </div>
        <div class="fp-body">
          <div class="fp-left">
            <div class="fp-art" ref={artWrap}>
              <Art art={tr()?.art} size={440} reqPx={520} fill class="soft fp-art-img" />
            </div>
            <div class="fp-ctl" ref={ctl}>
              <div class="fp-title">
                <div class="f1" style={{ "min-width": "0" }}>
                  <div class="t28 w6 ell">{tr()?.title}</div>
                  <div class="i2 ell">{artistsText(tr()?.artists ?? [])}</div>
                  <Show when={tr()}>
                    {(x) => (
                      <div class="row" style={{ "margin-top": "8px", gap: "6px" }}>
                        <SourceBadge source={x().source} />
                        <QualityBadge q={x().quality} />
                        <AltBadge n={x().altSources} />
                        <span class="t12 i3">{t("w2_auto_pick")}</span>
                      </div>
                    )}
                  </Show>
                </div>
                <IconButton icon={tr()?.liked ? "heartf" : "heart"} label={t("w2_like")} size={40} iconSize={24} class="liked-btn" onClick={() => tr() && player.like(tr()!.id, !tr()!.liked)} />
                <IconButton icon="more" label={t("w2_more")} size={40} iconSize={24} />
              </div>
              <div class="fp-prog">
                <WaveProgress width={640} label={t("w2_seek")} />
                <div class="row t12 i3 num" style={{ "justify-content": "space-between", "margin-top": "6px" }}>
                  <span>{fmtTime(elapsed())}</span>
                  <span>{fmtRemaining((s()?.durMs ?? 0) - elapsed())}</span>
                </div>
              </div>
              <div class="fp-btns">
                <IconButton icon="shuffle" label={t("shuffle")} size={48} iconSize={24} active={s()?.shuffle} onClick={() => player.setShuffle(!s()?.shuffle)} />
                <IconButton icon="prev" label={t("w2_prev")} size={48} iconSize={32} style={{ color: "var(--ink)" }} onClick={() => player.prev()} />
                <button type="button" class="play72 pressable" aria-label={s()?.playing ? t("w2_pause") : t("w2_play")} onClick={() => player.toggle()}>
                  <Icon n={s()?.playing ? "pause" : "play"} s={32} />
                </button>
                <IconButton icon="next" label={t("w2_next")} size={48} iconSize={32} style={{ color: "var(--ink)" }} onClick={() => player.next()} />
                <IconButton icon="repeat" label={t("w2_repeat")} size={48} iconSize={24} active={s()?.repeat !== "off"} onClick={() => player.cycleRepeat()} />
              </div>
              <div class="row gap8 fp-chips">
                <span class="chipbtn">
                  <Icon n="phones" s={16} />
                  {t("w2_output_name")}
                </span>
                <span class="chipbtn">
                  <span class="dot" />
                  {t("w2_eq_chip", s()?.eq.profileName ?? "")}
                </span>
                <IconButton icon="moon" label={t("w2_sleep")} size={32} />
                <div class="row gap8 mla fp-vol">
                  <Icon n="vol" s={20} />
                  <div class="bar">
                    <div class="bar-fill" style={{ transform: `scaleX(${s()?.volume ?? 0})`, background: "var(--ink2)" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="fp-right" ref={right}>
            <div class="row gap8">
              <Seg items={tabs()} value={tab()} onChange={setTab} label={t("w2_player")} class="dark" />
              <Chip on class="mla">{t("w2_karaoke")}</Chip>
              <Chip>{t("w2_translate")}</Chip>
              <IconButton icon="full" label={t("w2_fullscreen")} />
            </div>
            <div class="ly">
              <For each={SAMPLE_LYRICS}>
                {(line, i) => (
                  <p classList={{ past: i() < CURRENT_LINE, cur: i() === CURRENT_LINE }}>
                    {line}
                    <Show when={i() === CURRENT_LINE}>
                      <span class="tr2">{SAMPLE_TRANSLATION}</span>
                    </Show>
                  </p>
                )}
              </For>
            </div>
            <div class="row gap8 t12 i3">
              <span>{t("w2_lyrics_source")}</span>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
