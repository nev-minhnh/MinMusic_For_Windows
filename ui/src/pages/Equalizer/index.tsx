import { Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import type { RouteName } from "../../router/routes";
import type { PageProps } from "../../router/registry";
import { Icon } from "../../components/Icon";
import { IconButton } from "../../components/IconButton";
import { Seg } from "../../components/Seg";
import { hClass } from "../../lib/layout";
import { t } from "../../i18n";
import { playerState } from "../../state/player";
import { eqApi, eqSelected, eqState, eqStatus, initEq, refreshCurve, setEqStatus } from "../../state/eq";
import { Switch } from "./Controls";
import { Faders } from "./Faders";
import { Graph } from "./Graph";
import { DeviceCard, Effects, Inspector } from "./Panels";
import { AutoEqDialog, ProfileBar, exportApo, importApo } from "./Profiles";
import "./equalizer.css";

export const routes: RouteName[] = ["equalizer"];

const SPEC_KEY = "mm.eq.spectrum";
const readSpec = () => { try { return localStorage.getItem(SPEC_KEY) === "1"; } catch { return false; } };
const GRAPH_H = { short: 220, regular: 290, tall: 360 } as const;
const ignore = () => {};
const statusText = (st: { key: string; arg?: string }) => {
  const a = st.arg ?? "";
  switch (st.key) {
    case "w2_eq_saved": return t("w2_eq_saved", a);
    case "w2_eq_applied": return t("w2_eq_applied", a);
    case "w2_eq_imported": return t("w2_eq_imported", a);
    case "w2_eq_exported": return t("w2_eq_exported", a);
    default: return t("w2_eq_err", a);
  }
};

/** Equalizer (MK 8). Two columns 1fr / 400 when the page is >= 1000 wide, otherwise one column with tabs Dải tần / Hiệu ứng. */
export default function Equalizer(props: PageProps) {
  let root!: HTMLDivElement;
  const [cw, setCw] = createSignal(1100);
  const [tab, setTab] = createSignal<"bands" | "fx">("bands");
  const [spectrum, setSpectrum] = createSignal(readSpec());
  const [autoeq, setAutoeq] = createSignal(false);
  const wide = () => cw() >= 1000;
  const s = () => eqState();

  initEq();
  onMount(() => {
    const ro = new ResizeObserver(([e]) => setCw(Math.round(e!.contentRect.width)));
    ro.observe(root);
    // Del -> remove the selected band, F5 -> refresh (key commands dispatch these on the page wrapper, see input/commands/m1.ts)
    const host = root.closest("[data-key]");
    const del = () => { if (props.active() && eqSelected() >= 0 && (eqState()?.bands.length ?? 0) > 1) void eqApi.removeBand(eqSelected()).catch(ignore); };
    const refresh = () => refreshCurve();
    host?.addEventListener("mm-delete", del);
    host?.addEventListener("mm-refresh", refresh);
    onCleanup(() => { ro.disconnect(); host?.removeEventListener("mm-delete", del); host?.removeEventListener("mm-refresh", refresh); });
  });

  createEffect(() => { const sp = spectrum(); try { localStorage.setItem(SPEC_KEY, sp ? "1" : "0"); } catch { /* storage unavailable */ } });
  createEffect(() => {
    const st = eqStatus();
    if (!st) return;
    const id = window.setTimeout(() => setEqStatus(null), 4000);
    onCleanup(() => clearTimeout(id));
  });

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el.tagName === "INPUT" && (el as HTMLInputElement).type !== "range") return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); void eqApi.undo().catch(ignore); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); void eqApi.redo().catch(ignore); }
  }

  const bandsCol = () => (
    <>
      <div class="eqp-card eqp-gcard">
        <Graph active={props.active} height={GRAPH_H[hClass()]} spectrum={spectrum} />
        <Inspector />
      </div>
      <Faders narrow={cw() < 720} />
    </>
  );
  const fxCol = () => (
    <>
      <Effects />
      <DeviceCard active={props.active} />
    </>
  );

  return (
    <div class="sc eqp" ref={root} data-testid="equalizer" onKeyDown={onKey}>
      <div class="eqp-head">
        <div class="t28 w6 f1 ell">{t("w2_eq_title")}</div>
        <Show when={playerState()?.output}>
          {(o) => <span class="chipbtn" data-testid="eq-device-chip"><Icon n="phones" s={16} />{o().name}<span class="i3">{(s()?.deviceProfiles.length ?? 0) > 0 ? ` · ${t("w2_eq_auto_switch")}` : ""}</span></span>}
        </Show>
        <label class="row gap8 t14 i2">
          {t("w2_eq_enabled")}
          <Switch on={s()?.enabled !== false} label={t("w2_eq_enabled")} testid="eq-enabled" onChange={(on) => void eqApi.setEnabled(on).catch(ignore)} />
        </label>
      </div>
      <div class="eqp-tools">
        <IconButton icon="eq_undo" label={t("w2_eq_undo")} testid="eq-undo" disabled={!s()?.canUndo} onClick={() => void eqApi.undo().catch(ignore)} />
        <IconButton icon="eq_redo" label={t("w2_eq_redo")} testid="eq-redo" disabled={!s()?.canRedo} onClick={() => void eqApi.redo().catch(ignore)} />
        <IconButton icon="eq_reset" label={t("w2_eq_reset")} testid="eq-reset" onClick={() => void eqApi.reset().catch(ignore)} />
        <span class="eqp-sep" />
        <button type="button" class="btn ton sm" data-testid="eq-import" onClick={() => void importApo()}><Icon n="eq_import" s={16} />{t("w2_eq_import")}</button>
        <button type="button" class="btn ton sm" data-testid="eq-export" onClick={() => void exportApo()}><Icon n="eq_export" s={16} />{t("w2_eq_export")}</button>
        <button type="button" class="btn ton sm" data-testid="eq-autoeq" onClick={() => setAutoeq(true)}><Icon n="search" s={16} />{t("w2_eq_autoeq")}</button>
        <IconButton icon="eq_spectrum" label={t("w2_eq_spectrum")} testid="eq-spectrum" active={spectrum()} onClick={() => setSpectrum((v) => !v)} />
        <span class="eqp-status t12 i2" role="status" aria-live="polite" data-testid="eq-status" classList={{ err: eqStatus()?.kind === "err" }}>
          <Show when={eqStatus()}>{(st) => statusText(st())}</Show>
        </span>
      </div>
      <ProfileBar />
      <Show when={!wide()}>
        <Seg label={t("w2_eq_title")} class="s1" style={{ "margin": "12px 0" }} value={tab()} onChange={(k) => setTab(k as "bands" | "fx")}
          items={[{ key: "bands", label: t("w2_eq_tab_bands") }, { key: "fx", label: t("w2_eq_tab_fx") }]} />
      </Show>
      <Show when={wide()} fallback={<div class="eqp-one" data-testid="eq-one-col">{tab() === "bands" ? bandsCol() : fxCol()}</div>}>
        <div class="eqp-two" data-testid="eq-two-col">
          <div class="eqp-left">{bandsCol()}</div>
          <div class="eqp-right">{fxCol()}</div>
        </div>
      </Show>
      <Show when={autoeq()}><AutoEqDialog onClose={() => setAutoeq(false)} /></Show>
    </div>
  );
}
