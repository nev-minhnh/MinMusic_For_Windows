import { For, Index, Show, createEffect, createResource } from "solid-js";
import type { Accessor } from "solid-js";
import { client } from "../../lib/core";
import { t } from "../../i18n";
import { eqApi, eqSelected, eqState, setEffects, updateBand } from "../../state/eq";
import { Seg } from "../../components/Seg";
import { Icon } from "../../components/Icon";
import { Card, Slider, Stepper, Switch } from "./Controls";
import { hasGain, type BandType } from "./biquad";

const TYPES: BandType[] = ["PK", "LSC", "HSC", "LPQ", "HPQ", "BP", "NO"];
const OCT12 = Math.pow(2, 1 / 12);
const typeLabel = (ty: BandType) => ({ PK: t("w2_eq_type_PK"), LSC: t("w2_eq_type_LSC"), HSC: t("w2_eq_type_HSC"), LPQ: t("w2_eq_type_LPQ"), HPQ: t("w2_eq_type_HPQ"), BP: t("w2_eq_type_BP"), NO: t("w2_eq_type_NO") })[ty];
const cfLabel = (k: string) => ({ off: t("w2_eq_cf_off"), default: t("w2_eq_cf_default"), chuMoy: t("w2_eq_cf_chuMoy"), janMeier: t("w2_eq_cf_janMeier") } as Record<string, string>)[k];
const r = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Type select + Tần số / Gain / Q steppers + "Đặt lại band" for the selected band. */
export function Inspector() {
  const band = () => eqState()?.bands[eqSelected()];
  const i = () => eqSelected();
  return (
    <div class="eqp-insp" data-testid="eq-inspector">
      <div class="eqp-step">
        <span class="eqp-lbl">{t("w2_eq_type")}</span>
        <select class="eqp-select" aria-label={t("w2_eq_type")} data-testid="eq-type" disabled={!band()} value={band()?.type ?? "PK"}
          onChange={(e) => updateBand(i(), { type: e.currentTarget.value as BandType })}>
          <For each={TYPES}>{(ty) => <option value={ty} selected={band()?.type === ty}>{typeLabel(ty)}</option>}</For>
        </select>
      </div>
      <Stepper label={t("w2_eq_freq")} testid="eq-freq" value={band()?.freq} min={20} max={20000}
        fmt={(v) => `${r(v, 1)} Hz`} parse={(s) => { const n = parseFloat(s.replace(",", ".")); return /k/i.test(s) ? n * 1000 : n; }}
        step={(d, fine) => r((band()?.freq ?? 1000) * Math.pow(OCT12, d * (fine ? 0.2 : 1)), 1)} onSet={(v) => updateBand(i(), { freq: v })} />
      <Stepper label={t("w2_eq_gain")} testid="eq-gain" value={band()?.gain} min={-24} max={24} disabled={!!band() && !hasGain(band()!.type)}
        fmt={(v) => `${v > 0 ? "+" : ""}${r(v, 1)} dB`} step={(d, fine) => r((band()?.gain ?? 0) + d * (fine ? 0.1 : 0.5), 1)} onSet={(v) => updateBand(i(), { gain: r(v, 1) })} />
      <Stepper label="Q" testid="eq-q" value={band()?.q} min={0.1} max={20}
        fmt={(v) => r(v, 2).toFixed(2)} step={(d, fine) => r((band()?.q ?? 1) + d * (fine ? 0.01 : 0.1), 2)} onSet={(v) => updateBand(i(), { q: r(v, 2) })} />
      <div class="eqp-insp-act">
        <button type="button" class="btn ton sm" disabled={!band()} data-testid="eq-reset-band" onClick={() => void eqApi.resetBand(i()).catch(() => {})}>{t("w2_eq_reset_band")}</button>
        <button type="button" class="btn txt sm" data-testid="eq-add-band" disabled={(eqState()?.bands.length ?? 0) >= 32} onClick={() => void eqApi.addBand(1000).catch(() => {})}>
          <Icon n="plus" s={16} />{t("w2_eq_add_band")}
        </button>
        <button type="button" class="btn txt sm" disabled={!band()} data-testid="eq-remove-band" onClick={() => void eqApi.removeBand(i()).catch(() => {})}>
          <Icon n="delete" s={16} />{t("w2_eq_remove_band")}
        </button>
      </div>
    </div>
  );
}

const CROSS = ["off", "default", "chuMoy", "janMeier"] as const;

/** Hiệu ứng: bass, treble, stereo width, crossfeed, limiter (+ reduction meter), output gain. */
export function Effects() {
  const e = () => eqState()?.effects;
  const db = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)} dB`;
  return (
    <Card title={t("w2_eq_effects")} testid="eq-effects">
      <Show when={e()}>
        {(fx) => (
          <div class="col gap16">
            <Slider label={t("w2_eq_bass")} value={fx().bassDb} min={-12} max={12} step={0.5} fmt={db} reset={0} testid="eq-bass" onInput={(v) => setEffects({ bassDb: v })} />
            <Slider label={t("w2_eq_treble")} value={fx().trebleDb} min={-12} max={12} step={0.5} fmt={db} reset={0} testid="eq-treble" onInput={(v) => setEffects({ trebleDb: v })} />
            <Slider label={t("w2_eq_width")} value={fx().widthPct} min={0} max={200} step={1} fmt={(v) => `${v} %`} reset={100} testid="eq-width" onInput={(v) => setEffects({ widthPct: v })} />
            <div class="col gap8">
              <span class="eqp-sl-top"><span>{t("w2_eq_crossfeed")}</span></span>
              <Seg label={t("w2_eq_crossfeed")} value={fx().crossfeed} class="s1 eqp-seg" items={CROSS.map((k) => ({ key: k, label: cfLabel(k)! }))} onChange={(k) => setEffects({ crossfeed: k as (typeof CROSS)[number] })} />
            </div>
            <div class="eqp-lim">
              <div class="row gap12">
                <span class="f1">{t("w2_eq_limiter")}</span>
                <Switch on={fx().limiter} label={t("w2_eq_limiter")} onChange={(on) => setEffects({ limiter: on })} testid="eq-limiter" />
              </div>
              <div class="eqp-meter" role="meter" aria-label={t("w2_eq_limiter_meter")} aria-valuemin={0} aria-valuemax={12} aria-valuenow={eqState()?.limiterReductionDb ?? 0} data-testid="eq-limiter-meter">
                <div class="eqp-meter-fill" style={{ transform: `scaleX(${Math.min(1, (eqState()?.limiterReductionDb ?? 0) / 12)})` }} />
              </div>
              <span class="t12 i3 num">{t("w2_eq_reduction", (eqState()?.limiterReductionDb ?? 0).toFixed(1))}</span>
            </div>
            <Slider label={t("w2_eq_output")} value={fx().outputDb} min={-24} max={12} step={0.5} fmt={db} reset={0} testid="eq-output" onInput={(v) => setEffects({ outputDb: v })} />
          </div>
        )}
      </Show>
    </Card>
  );
}

type Dev = { id: string; name: string; kind: string; default: boolean };
/** Hồ sơ theo thiết bị: one profile per output device (eq.device.bind). */
export function DeviceCard(props: { active: Accessor<boolean> }) {
  const [devs, { refetch }] = createResource(() => client.call<{ devices: Dev[]; current?: { id: string } }>("player.output.list"));
  createEffect((was: boolean | undefined) => { const a = props.active(); if (a && was === false) void refetch(); return a; });
  const bound = (id: string) => eqState()?.deviceProfiles.find((d) => d.deviceId === id)?.profileId ?? "";
  return (
    <Card title={t("w2_eq_per_device")} testid="eq-devices">
      <div class="i3 t12" style={{ "margin-bottom": "8px" }}>{t("w2_eq_per_device_hint")}</div>
      <Show when={devs()?.devices} fallback={<div class="i3 t12">…</div>}>
        {(list) => (
          <div class="col gap8">
            <For each={list()}>
              {(d) => (
                <div class="eqp-dev" data-testid="eq-device">
                  <Icon n="phones" s={20} />
                  <div class="f1" style={{ "min-width": "0" }}>
                    <div class="ell w6 t14">{d.name}</div>
                    <div class="ell t12 i3">{bound(d.id) ? t("w2_eq_auto_switch") : t("w2_eq_no_profile")}</div>
                  </div>
                  <select class="eqp-select sm" aria-label={`${t("w2_eq_per_device")}: ${d.name}`} data-testid="eq-device-select" value={bound(d.id)}
                    onChange={(e) => void eqApi.bindDevice(d.id, e.currentTarget.value || null).catch(() => {})}>
                    <option value="" selected={!bound(d.id)}>{t("w2_eq_no_profile")}</option>
                    <Index each={eqState()?.profiles ?? []}>{(p) => <option value={p().id} selected={bound(d.id) === p().id}>{p().name}</option>}</Index>
                  </select>
                </div>
              )}
            </For>
          </div>
        )}
      </Show>
    </Card>
  );
}
