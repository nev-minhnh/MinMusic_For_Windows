import { Show, createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { artUrl } from "../lib/core";
import { Art } from "../components/Art";
import { Icon } from "../components/Icon";
import { IconButton } from "../components/IconButton";
import { runCommand } from "../input/keys";
import { Seg } from "../components/Seg";
import { QualityBadge, SourceBadge, AltBadge } from "../components/Badge";
import { Caption } from "./Caption";
import { player, playerState, elapsed } from "../state/player";
import { fullOpen, closeFull } from "../state/ui";
import { fpLayer, fpTab, outputs, pop, setFpLayer, setFpTab, sleep, toggleLyricsFs, togglePop, type FpTab } from "../state/playerExtra";
import { lyrics } from "../state/lyrics";
import { navigate } from "../router/router";
import { pushEsc } from "../lib/esc";
import { size } from "../lib/layout";
import { reducedMotion, E_CONTAINER, D_CONTAINER } from "../lib/motion";
import { fmtRemaining, fmtTime, artistsText } from "../lib/format";
import { t } from "../i18n";
import { LyricsView } from "../pages/Lyrics/LyricsView";
import { LyricsTools } from "../pages/Lyrics/LyricsTools";
import { LyricsSearchDialog } from "../pages/Lyrics/SearchDialog";
import { QueuePanel } from "./player/QueuePanel";
import { RelatedPanel } from "./player/RelatedPanel";
import { ProgressControl } from "./player/ProgressControl";
import { VolumeSlider } from "./player/VolumeSlider";
import { sleepLabel } from "./player/Popovers";
import { tintFor } from "./player/tint";
import "./player/player.css";

type Phase = "closed" | "opening" | "open" | "closing";

/**
 * Full player: a fixed layer, mounted after first use, `visibility:hidden` while closed (frontend-spec 6.3).
 * Container transform with WAAPI: the art travels from the bar art rect (translate + scale), the layer slides up with a
 * pure translateY (no clip-path), the layer background fades, the bar content fades 0-25 %, controls fade + translateY 35-100 %.
 * Two panes when W >= 960 and H >= 600, otherwise one pane plus a "Lời / Tiếp theo" layer.
 */
export function FullPlayer() {
  const [used, setUsed] = createSignal(false);
  const [find, setFind] = createSignal(false);
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
    endWarm();
    layer.style.visibility = "visible";
    layer.classList.add("anim");
    const pb = document.querySelector<HTMLElement>(".pbar")?.getBoundingClientRect().height ?? 88;
    const A = barArt()?.getBoundingClientRect();
    const B = artWrap.getBoundingClientRect();
    const kf = (keyframes: Keyframe[], el: Element, opts: KeyframeAnimationOptions = {}) =>
      el.animate(keyframes, { duration: dur, easing: ease, fill: "both", direction: open ? "normal" : "reverse", ...opts });
    anims = [];
    if (!rm && A) {
      // Transform-only reveal (frontend-spec 6.3): the layer slides up from the bar top instead of animating clip-path.
      // The art keyframe subtracts the layer offset D; both share the easing, so the art still travels in a straight
      // line from the bar art.
      const D = window.innerHeight - pb;
      anims.push(kf([{ transform: `translate(${A.left - B.left}px,${A.top - B.top - D}px) scale(${A.width / B.width})` }, { transform: "none" }], artWrap));
      anims.push(kf([{ transform: `translateY(${D}px)` }, { transform: "none" }], layer));
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

  // First-open cost (M0 trace: a 118-146 ms GPU task on the first open, mostly the first raster and
  // pipeline setup of the full-screen layer at DPR 2.5). When the app is idle: mount the layer hidden,
  // then draw it once at opacity 0.002 (invisible, but rastered) for a few frames and hide it again.
  let warming = false;
  function endWarm() {
    if (!warming || !layer) return;
    warming = false;
    layer.style.opacity = "";
    layer.style.pointerEvents = "";
    if (phase === "closed") layer.style.visibility = "hidden";
  }
  function warm() {
    if (!layer || phase !== "closed" || fullOpen()) return;
    warming = true;
    layer.style.opacity = "0.002";
    layer.style.pointerEvents = "none";
    layer.style.visibility = "visible";
    let n = 0;
    const step = () => (++n < 6 && warming ? requestAnimationFrame(step) : endWarm());
    requestAnimationFrame(step);
  }
  onMount(() => {
    const idle = (cb: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1500));
    idle(() => {
      if (!used()) setUsed(true);
      requestAnimationFrame(() => idle(warm));
    });
  });
  // pre-decode the full-size artwork whenever the track changes, so neither the open nor the art
  // transform waits for a decode (6.3: bar and full player share the artUrl(…, 520) URL)
  createEffect(
    on(
      () => artUrl(playerState()?.track?.art, 520),
      (src) => {
        if (!src || src.startsWith("grad:")) return;
        const im = new Image();
        im.src = src;
        im.decode().catch(() => {});
      }
    )
  );

  const s = () => playerState();
  const tr = () => s()?.track;
  const tabs = () => [
    { key: "lyrics", label: t("w2_tab_lyrics") },
    { key: "queue", label: t("w2_tab_next") },
    { key: "related", label: t("w2_tab_related") },
  ];

  // two panes when W >= 960 and H >= 600, else one pane + the "Lời / Tiếp theo" layer
  const two = () => size().w >= 960 && size().h >= 600;
  createEffect(
    on(
      () => fpLayer() && !two() && fullOpen(),
      (o) => {
        if (!o) return;
        const un = pushEsc(() => setFpLayer(false));
        onCleanup(un);
      }
    )
  );
  createEffect(on(fullOpen, (o) => { if (!o) setFpLayer(false); }, { defer: true }));

  // tint: art.dominant clamped to L* <= 20, two stacked layers cross-fading over 300 ms (opacity only)
  const tint = createMemo(() => tintFor(tr()?.art?.dominant, tr()?.id));
  const [tl, setTl] = createSignal<[string, string]>([tint(), tint()]);
  const [on2, setOn2] = createSignal<[boolean, boolean]>([true, false]);
  const [z, setZ] = createSignal<[number, number]>([1, 0]);
  let front = 0;
  let zc = 1;
  let offT = 0;
  createEffect(
    on(
      tint,
      (c) => {
        if (c === tl()[front]) return;
        const back = 1 - front;
        setTl((l) => (back ? [l[0], c] : [c, l[1]]));
        setZ((l) => (back ? [l[0], ++zc] : [++zc, l[1]]));
        const old = front;
        front = back;
        requestAnimationFrame(() => setOn2((o) => (back ? [o[0], true] : [true, o[1]])));
        clearTimeout(offT);
        offT = window.setTimeout(() => setOn2((o) => (old ? [o[0], false] : [false, o[1]])), 340);
      },
      { defer: true }
    )
  );
  onCleanup(() => clearTimeout(offT));

  const lyricsActive = () => fullOpen() && fpTab() === "lyrics" && (two() || fpLayer());
  const srcLabel = () => {
    const l = lyrics();
    return l ? t("w2_m22_ly_src", l.provider, l.synced === "word" ? t("w2_m22_ly_word") : l.synced === "line" ? t("w2_m22_ly_line") : t("w2_m22_ly_plain")) : "";
  };
  const goEq = () => {
    closeFull();
    navigate("equalizer");
  };

  return (
    <Show when={used()}>
      <div
        ref={layer}
        class="fp"
        classList={{ two: two(), one: !two(), layer: fpLayer() }}
        style={{ visibility: "hidden", "--tint": tint() }}
        data-testid="full-player"
        role="dialog"
        aria-label={t("w2_player")}
        aria-modal="true"
      >
        <div class="fp-bg" ref={bg}>
          <div class="fp-tl" classList={{ on: on2()[0] }} style={{ "--tint": tl()[0], "z-index": z()[0] }} data-testid="tint-a" />
          <div class="fp-tl" classList={{ on: on2()[1] }} style={{ "--tint": tl()[1], "z-index": z()[1] }} data-testid="tint-b" />
        </div>
        <div class="fp-top tbar" ref={top} data-tauri-drag-region>
          <IconButton icon="down" label={t("w2_collapse")} class="h" onClick={closeFull} testid="collapse-player" />
          <span class="t12 i3" style={{ "margin-left": "4px" }}>{t("w2_collapse")}</span>
          <div class="fp-ctx">
            <div class="ovl">{t("w2_m22_playing_from")}</div>
            <div class="w6">{s()?.context?.title}</div>
          </div>
          <div class="row gap8 mla">
            <IconButton icon="pip" label={t("w2_mini")} onClick={() => runCommand("mini.open")} testid="fp-mini" />
            <IconButton icon="full" label={t("w2_fullscreen")} />
            <IconButton icon="more" label={t("w2_more")} />
          </div>
          <Caption />
        </div>
        <div class="fp-body">
          <div class="fp-left">
            <div class="fp-art" ref={artWrap} data-testid="player-art">
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
                <ProgressControl where="fp" testid="fp-progress" />
                <div class="row t12 i3 num" style={{ "justify-content": "space-between", "margin-top": "6px" }}>
                  <span>{fmtTime(elapsed())}</span>
                  <span>{fmtRemaining((s()?.durMs ?? 0) - elapsed())}</span>
                </div>
              </div>
              <div class="fp-btns">
                <IconButton icon="shuffle" label={t("shuffle")} size={48} iconSize={24} active={s()?.shuffle} onClick={() => player.setShuffle(!s()?.shuffle)} />
                <IconButton icon="prev" label={t("w2_prev")} size={48} iconSize={32} style={{ color: "var(--ink)" }} onClick={() => player.prev()} />
                <button type="button" class="play72 pressable" aria-label={s()?.playing ? t("w2_pause") : t("w2_play")} onClick={() => player.toggle()} data-testid="fp-play">
                  <Icon n={s()?.playing ? "pause" : "play"} s={32} />
                </button>
                <IconButton icon="next" label={t("w2_next")} size={48} iconSize={32} style={{ color: "var(--ink)" }} onClick={() => player.next()} />
                <IconButton icon="repeat" label={t("w2_repeat")} size={48} iconSize={24} active={s()?.repeat !== "off"} onClick={() => player.cycleRepeat()} />
              </div>
              <div class="row gap8 fp-chips">
                <button type="button" class="chipbtn btn" data-testid="fp-output" aria-haspopup="menu" aria-expanded={pop()?.kind === "output"} onClick={(e) => togglePop("output", e.currentTarget as HTMLElement)}>
                  <Icon n="phones" s={16} />
                  {s()?.output?.name ?? outputs().devices.find((d) => d.id === outputs().current)?.name ?? t("w2_output")}
                </button>
                <button type="button" class="chipbtn btn" data-testid="fp-eq" onClick={goEq}>
                  <span class="dot" />
                  {t("w2_eq_chip", s()?.eq.profileName ?? "")}
                </button>
                <IconButton icon="moon" label={t("w2_sleep")} size={32} active={!!sleep()} onClick={(e) => togglePop("sleep", e.currentTarget as HTMLElement)} testid="fp-sleep" />
                <Show when={sleepLabel()}>
                  <span class="t12 i2 num">{sleepLabel()}</span>
                </Show>
                <div class="row gap8 mla fp-vol">
                  <Icon n={s()?.muted ? "vol_off" : "vol"} s={20} />
                  <VolumeSlider testid="fp-volume" />
                </div>
              </div>
              <button type="button" class="chipbtn btn fp-layer-btn" data-testid="fp-layer-btn" aria-expanded={fpLayer()} onClick={() => setFpLayer(!fpLayer())}>
                <Icon n="lyrics" s={16} />
                {t("w2_m22_layer")}
              </button>
            </div>
          </div>
          <div class="fp-right" ref={right} data-testid="fp-right">
            <div class="fp-right-h">
              <Seg items={tabs()} value={fpTab()} onChange={(k) => setFpTab(k as FpTab)} label={t("w2_player")} class="dark" />
              <Show when={fpTab() === "lyrics"}>
                <div class="mla row gap8">
                  <LyricsTools onSearch={() => setFind(true)} />
                  <IconButton icon="full" label={t("w2_fullscreen")} testid="lyrics-fs" onClick={toggleLyricsFs} />
                </div>
              </Show>
              <Show when={!two()}>
                <IconButton icon="down" label={t("w2_close")} class={fpTab() === "lyrics" ? "" : "mla"} onClick={() => setFpLayer(false)} testid="fp-layer-close" />
              </Show>
            </div>
            <Show when={fpTab() === "lyrics"}>
              <LyricsView variant="fp" active={lyricsActive} onSearch={() => setFind(true)} />
              <div class="row gap8 t12 i3" data-testid="lyrics-source">
                <span>{srcLabel()}</span>
              </div>
            </Show>
            <Show when={fpTab() === "queue"}>
              <QueuePanel variant="fp" />
            </Show>
            <Show when={fpTab() === "related"}>
              <RelatedPanel active={() => fullOpen() && fpTab() === "related"} />
            </Show>
          </div>
        </div>
        <Show when={find()}>
          <LyricsSearchDialog onClose={() => setFind(false)} />
        </Show>
      </div>
    </Show>
  );
}
