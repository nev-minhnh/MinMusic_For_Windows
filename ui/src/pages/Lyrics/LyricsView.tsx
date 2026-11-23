import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { lyrics, lyState, karaoke, trOn, roOn } from "../../state/lyrics";
import { playerState, positionNow, prog } from "../../state/player";
import { seekTo } from "../../state/playerExtra";
import { reducedMotion } from "../../lib/motion";
import { t } from "../../i18n";
import { createFollowGate, createLyricsScheduler, wordAt } from "./sched";
import "./lyrics.css";

type Wipe = { a: Animation; b: Animation; t: number; dur: number };

/**
 * Synced lyrics (frontend-spec 5). Timing is a setTimeout chain over line / word boundaries (sched.ts), re-armed on every
 * position event; there is no rAF loop. The word wipe is a hard-edge reveal made of two transform animations (a clip
 * window moving right, its text moving left in lock step), so it runs on the compositor and costs no per-frame JS.
 */
export function LyricsView(props: { variant: "pane" | "fp" | "fs"; active?: () => boolean; onSearch?: () => void }) {
  let scroller!: HTMLDivElement;
  const active = () => props.active?.() ?? true;
  const [cur, setCur] = createSignal(-1);
  const [word, setWord] = createSignal(-1);
  const wordMode = () => karaoke() && lyrics()?.synced === "word";
  const gate = createFollowGate(4000);
  let firstScroll = true;
  let wipes: Wipe[] = [];

  function scrollToLine(i: number, instant = false) {
    const el = scroller?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (!el || !scroller.clientHeight) return;
    const top = el.offsetTop - (scroller.clientHeight - el.offsetHeight) * 0.38;
    scroller.scrollTo({ top: Math.max(0, top), behavior: instant || reducedMotion() ? "auto" : "smooth" });
  }
  const follow = (i: number) => {
    if (!gate.shouldScroll(i)) return;
    scrollToLine(i, firstScroll);
    firstScroll = false;
  };

  function clearWipes() {
    for (const w of wipes) { w.a.cancel(); w.b.cancel(); }
    wipes = [];
  }
  /** the current line just changed: create the two animations per word, then place them on the clock */
  function buildWipes() {
    clearWipes();
    if (!active() || !wordMode()) return;
    const i = cur();
    const line = lyrics()?.lines[i];
    if (!line?.words) return;
    const ws = scroller?.querySelectorAll<HTMLElement>(`[data-i="${i}"] .w`);
    ws?.forEach((el, k) => {
      const wd = line.words![k];
      const wf = el.querySelector<HTMLElement>(".wf");
      const wt = el.querySelector<HTMLElement>(".wt");
      if (!wd || !wf || !wt) return;
      const dur = Math.max(1, wd.end - wd.t);
      const o: KeyframeAnimationOptions = { duration: dur, fill: "both", easing: "linear" };
      const a = wf.animate([{ transform: "translateX(-100%)" }, { transform: "translateX(0)" }], o);
      const b = wt.animate([{ transform: "translateX(100%)" }, { transform: "translateX(0)" }], o);
      a.pause(); b.pause();
      wipes.push({ a, b, t: wd.t, dur });
    });
    syncWipes(true);
  }
  /** place the animations on the interpolated clock; re-done only on a state change or a drift over 80 ms */
  function syncWipes(force = false) {
    if (!wipes.length) return;
    const s = playerState();
    const playing = s?.playing ?? false;
    const rate = s?.speed || 1;
    const off = lyrics()?.offsetMs ?? 0;
    const p = positionNow() - off;
    if (!force) {
      const line = lyrics()?.lines[cur()];
      const k = Math.max(0, wordAt(line, p + off, off));
      const w = wipes[k];
      if (w) {
        const exp = Math.min(p - w.t, w.dur);
        const have = Number(w.a.currentTime ?? 0);
        if (Math.abs(exp - have) < 80 && (w.a.playState === "running") === (playing && exp < w.dur)) return;
      }
    }
    for (const w of wipes) {
      const ct = p - w.t;
      w.a.playbackRate = rate;
      w.b.playbackRate = rate;
      if (ct >= w.dur) {
        w.a.pause(); w.b.pause();
        w.a.currentTime = w.dur; w.b.currentTime = w.dur;
      } else if (ct < 0) {
        // not sung yet: hold at the hidden first frame (play() would auto-rewind a negative time and start it now);
        // the scheduler's word boundary re-syncs and starts it
        w.a.pause(); w.b.pause();
        w.a.currentTime = 0; w.b.currentTime = 0;
      } else {
        w.a.currentTime = ct; w.b.currentTime = ct;
        if (playing) { w.a.play(); w.b.play(); } else { w.a.pause(); w.b.pause(); }
      }
    }
  }

  const sched = createLyricsScheduler({
    pos: positionNow,
    rate: () => playerState()?.speed || 1,
    playing: () => playerState()?.playing ?? false,
    lyrics: () => (active() ? lyrics() : null),
    wordSync: wordMode,
    onLine: (i) => {
      setCur(i);
      follow(i);
      buildWipes();
    },
    onWord: (_l, w) => {
      setWord(w);
      if (w >= 0) syncWipes(true);
    },
  });

  // manual scroll: wheel / touch / pointer / key pause auto-follow for 4 s (passive listeners, no scroll handler)
  const userScroll = () => gate.user(() => scrollToLine(cur()));
  onMount(() => {
    for (const ev of ["wheel", "touchstart", "pointerdown", "keydown"]) scroller.addEventListener(ev, userScroll, { passive: true });
    onCleanup(() => { for (const ev of ["wheel", "touchstart", "pointerdown", "keydown"]) scroller.removeEventListener(ev, userScroll); });
  });
  createEffect(on([lyrics, wordMode, active], () => { gate.forget(); firstScroll = true; clearWipes(); sched.reset(); }));
  createEffect(on(prog, () => { sched.rearm(); syncWipes(); }, { defer: true }));
  onCleanup(() => { sched.stop(); gate.dispose(); clearWipes(); });

  const onLineClick = (ms: number) => {
    gate.release();
    seekTo(ms + (lyrics()?.offsetMs ?? 0));
  };

  return (
    <div class="lyv" classList={{ "v-pane": props.variant === "pane", "v-fp": props.variant === "fp", "v-fs": props.variant === "fs" }} data-testid="lyrics-view" data-state={lyState()} data-synced={lyrics()?.synced ?? ""}>
      <div class="lyv-scroll" ref={scroller} data-testid="lyrics-scroll" tabindex="-1">
        <Show when={lyrics() && lyState() === "ready"} fallback={<LyEmpty state={lyState()} onSearch={props.onSearch} />}>
          <div class="lyv-pad" />
          <For each={lyrics()!.lines}>
            {(line, i) => (
              <p
                class="ll"
                classList={{ cur: cur() === i(), past: i() < cur(), kar: wordMode() && !!line.words, bg: line.agent === "bg", v2: line.agent === "v2", plain: lyrics()!.synced === "none" }}
                data-i={i()}
                data-testid="lyric-line"
                onClick={() => lyrics()!.synced !== "none" && onLineClick(line.t)}
              >
                <Show when={wordMode() && line.words} fallback={<span class="lt">{line.text}</span>}>
                  <span class="lt">
                    <For each={line.words}>
                      {(w, k) => (
                        <span class="w" classList={{ cw: cur() === i() && word() === k() }} data-k={k()}>
                          {w.text}
                          <Show when={cur() === i()}>
                            <span class="wf" aria-hidden="true">
                              <span class="wt">{w.text}</span>
                            </span>
                          </Show>
                        </span>
                      )}
                    </For>
                  </span>
                </Show>
                <Show when={roOn() && line.ro}>
                  <span class="lro">{line.ro}</span>
                </Show>
                <Show when={trOn() && line.tr}>
                  <span class="ltr">{line.tr}</span>
                </Show>
              </p>
            )}
          </For>
          <div class="lyv-pad" />
        </Show>
      </div>
    </div>
  );
}

function LyEmpty(props: { state: string; onSearch?: () => void }) {
  return (
    <div class="lyv-empty" data-testid="lyrics-empty">
      <Show when={props.state === "loading"} fallback={<span>{t("w2_m22_ly_none")}</span>}>
        <span>{t("w2_m22_ly_loading")}</span>
      </Show>
      <Show when={props.state === "none" && props.onSearch}>
        <button type="button" class="chip" onClick={() => props.onSearch?.()}>
          {t("w2_m22_ly_find")}
        </button>
      </Show>
    </div>
  );
}
