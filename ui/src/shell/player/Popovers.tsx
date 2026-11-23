import { For, Match, Show, Switch, createEffect, onCleanup, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Icon } from "../../components/Icon";
import { IconButton } from "../../components/IconButton";
import { VolumeSlider } from "./VolumeSlider";
import { Switch as Toggle } from "./Switch";
import { playerState, player } from "../../state/player";
import { lyrics, lyricsApi } from "../../state/lyrics";
import {
  SPEEDS, barVariant, closePop, floatingBar, loadOutputs, outputs, pop, setFloatingBar, setOutput, setProgressVariant, setSleepTimer, setSpeed, sleep, sleepLeft,
  togglePop, type ProgressVariant,
} from "../../state/playerExtra";
import { pushEsc } from "../../lib/esc";
import { fmtTime } from "../../lib/format";
import { wClass } from "../../lib/layout";
import { t } from "../../i18n";

const Item = (p: { on?: boolean; onClick: () => void; children: JSX.Element; testid?: string; role?: string }) => (
  <button type="button" class="pop-it" classList={{ on: p.on }} role={(p.role ?? "menuitemradio") as "menuitemradio"} aria-checked={p.on === undefined ? undefined : p.on} data-testid={p.testid} onClick={p.onClick}>
    <span class="pop-ck">{p.on && <Icon n="check" s={16} />}</span>
    <span class="f1 ell">{p.children}</span>
  </button>
);

export function sleepLabel(): string | null {
  const s = sleep();
  if (!s) return null;
  if (s.endOfTrack) return t("w2_m22_sleep_eot");
  const left = sleepLeft();
  return left === null ? null : fmtTime(left);
}

function SleepList() {
  const s = () => sleep();
  const mins = [15, 30, 45, 60];
  return (
    <>
      <For each={mins}>
        {(m) => (
          <Item on={!!s()?.deadline && !s()?.endOfTrack && Math.abs((s()!.deadline! - Date.now()) / 60000 - m) < 1} onClick={() => { setSleepTimer({ minutes: m }); closePop(); }} testid={`sleep-${m}`}>
            {t("w2_m22_sleep_min", m)}
          </Item>
        )}
      </For>
      <Item on={!!s()?.endOfTrack} onClick={() => { setSleepTimer({ endOfTrack: true }); closePop(); }} testid="sleep-eot">{t("w2_m22_sleep_eot_full")}</Item>
      <Show when={s()}>
        <div class="pop-sep" />
        <button type="button" class="pop-it" role="menuitem" data-testid="sleep-cancel" onClick={() => { setSleepTimer({ cancel: true }); closePop(); }}>
          <span class="pop-ck" />
          <span class="f1 ell">{t("w2_m22_sleep_cancel")}</span>
        </button>
      </Show>
    </>
  );
}
function OutputList() {
  return (
    <For each={outputs().devices} fallback={<div class="pop-note">{t("w2_m22_out_none")}</div>}>
      {(d) => (
        <Item on={outputs().current === d.id} onClick={() => { setOutput(d.id); closePop(); }} testid="output-item">
          {d.name}
        </Item>
      )}
    </For>
  );
}

/** One popover at a time (volume, sleep timer, output, more, lyrics tools), portalled so the full-player layer never covers it. */
export function PlayerPopovers() {
  let box: HTMLDivElement | undefined;
  createEffect(() => {
    const p = pop();
    if (!p) return;
    if (p.kind === "output" || p.kind === "more") loadOutputs();
    const un = pushEsc(closePop);
    const down = (e: PointerEvent) => {
      const n = e.target as Node;
      if (box?.contains(n) || p.anchor.contains(n)) return;
      closePop();
    };
    const resize = () => closePop();
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("resize", resize);
    onCleanup(() => { un(); window.removeEventListener("pointerdown", down, true); window.removeEventListener("resize", resize); });
  });
  const place = () => {
    const p = pop();
    if (!p) return {};
    const r = p.anchor.getBoundingClientRect();
    const up = r.top > window.innerHeight / 2;
    const right = Math.max(8, window.innerWidth - r.right - (p.kind === "vol" ? 0 : 0));
    return up ? { right: right + "px", bottom: window.innerHeight - r.top + 8 + "px" } : { right: right + "px", top: r.bottom + 8 + "px" };
  };
  const s = () => playerState();
  return (
    <Show when={pop()}>
      {(p) => (
        <Portal>
          <div ref={box} class={`pop pop-${p().kind}`} style={place()} role="menu" data-testid={`pop-${p().kind}`}>
            <Switch>
              <Match when={p().kind === "vol"}>
                <div class="pop-vrow">
                  <IconButton icon={s()?.muted ? "vol_off" : "vol"} label={t("w2_m22_mute")} active={s()?.muted} onClick={() => player.mute(!s()?.muted)} testid="mute-btn" />
                  <VolumeSlider />
                  <span class="t12 i3 num pop-pct">{Math.round((s()?.muted ? 0 : s()?.volume ?? 0) * 100)}%</span>
                </div>
              </Match>
              <Match when={p().kind === "sleep"}>
                <div class="pop-h">{t("w2_sleep")}</div>
                <Show when={sleepLabel()}>
                  <div class="pop-note" data-testid="sleep-remaining">{t("w2_m22_sleep_left", sleepLabel()!)}</div>
                </Show>
                <SleepList />
              </Match>
              <Match when={p().kind === "output"}>
                <div class="pop-h">{t("w2_output")}</div>
                <OutputList />
              </Match>
              <Match when={p().kind === "more"}>
                <div class="pop-h">{t("w2_m22_speed")}</div>
                <For each={SPEEDS}>
                  {(sp) => (
                    <Item on={(s()?.speed ?? 1) === sp} onClick={() => setSpeed(sp)} testid={`speed-${sp}`}>
                      {sp === 1 ? t("w2_m22_speed_normal") : `${sp}×`}
                    </Item>
                  )}
                </For>
                <Show when={wClass() !== "expanded"}>
                  <div class="pop-sep" />
                  <div class="pop-h">{t("w2_output")}</div>
                  <OutputList />
                  <div class="pop-sep" />
                  <div class="pop-h">{t("w2_sleep")}</div>
                  <SleepList />
                </Show>
                <div class="pop-sep" />
                <div class="pop-h">{t("w2_m22_progress_style")}</div>
                <For each={["line", "wavy", "thick"] as ProgressVariant[]}>
                  {(v) => (
                    <Item on={barVariant() === v} onClick={() => setProgressVariant(v)} testid={`prog-${v}`}>
                      {v === "line" ? t("w2_m22_prog_line") : v === "wavy" ? t("w2_m22_prog_wavy") : t("w2_m22_prog_thick")}
                    </Item>
                  )}
                </For>
                <div class="pop-sep" />
                <div class="pop-row">
                  <span class="f1">{t("w2_m22_floating_bar")}</span>
                  <Toggle on={floatingBar()} onChange={setFloatingBar} label={t("w2_m22_floating_bar")} testid="floating-switch" />
                </div>
              </Match>
              <Match when={p().kind === "lytools"}>
                <div class="pop-h">{t("lyrics")}</div>
                <div class="pop-row">
                  <span class="f1">{t("w2_m22_ly_offset")}</span>
                  <IconButton icon="minus" label={t("w2_m22_ly_earlier")} size={32} testid="offset-minus" onClick={() => lyricsApi.setOffset((lyrics()?.offsetMs ?? 0) - 100)} />
                  <span class="num t14 pop-off" data-testid="offset-value">{`${(lyrics()?.offsetMs ?? 0) > 0 ? "+" : ""}${(lyrics()?.offsetMs ?? 0) / 1000} s`}</span>
                  <IconButton icon="plus" label={t("w2_m22_ly_later")} size={32} testid="offset-plus" onClick={() => lyricsApi.setOffset((lyrics()?.offsetMs ?? 0) + 100)} />
                </div>
                <div class="pop-row">
                  <span class="f1">{t("w2_m22_ly_romanize")}</span>
                  <Toggle on={!!lyrics()?.lines.some((l) => !!l.ro)} onChange={(on) => lyricsApi.romanize(on)} label={t("w2_m22_ly_romanize")} testid="romanize-switch" />
                </div>
                <div class="pop-sep" />
                <button type="button" class="pop-it" role="menuitem" data-testid="lyrics-find" onClick={() => { const f = p().onSearch; closePop(); f?.(); }}>
                  <span class="pop-ck"><Icon n="search" s={16} /></span>
                  <span class="f1 ell">{t("w2_m22_ly_find")}</span>
                </button>
              </Match>
            </Switch>
          </div>
        </Portal>
      )}
    </Show>
  );
}

export { togglePop };
