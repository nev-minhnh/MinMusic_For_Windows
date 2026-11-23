import { Index, Show } from "solid-js";
import { t } from "../../i18n";
import { eqApi, eqSelected, eqState, selectBand, setPreamp, updateBand } from "../../state/eq";
import { Card, Switch } from "./Controls";

const MIN = -12, MAX = 12;
export const fLabel = (f: number) => (f >= 1000 ? `${Math.round(f / 100) / 10}k` : String(Math.round(f)));
const sgn = (v: number) => (v > 0 ? "+" : "") + v.toFixed(1);

/** Preamp + one fader per band (11 columns for the 10-band profiles). Vertical native range inputs, horizontal rows when narrow (< 720). */
export function Faders(props: { narrow: boolean }) {
  const s = () => eqState();
  return (
    <Card
      title={t("w2_eq_faders")}
      testid="eq-faders"
      right={
        <label class="eqp-auto row gap8 t12 i2">
          {t("w2_eq_auto_preamp")}
          <Switch on={!!s()?.autoPreamp} label={t("w2_eq_auto_preamp")} onChange={(on) => void eqApi.setAutoPreamp(on).catch(() => {})} testid="eq-auto-preamp" />
        </label>
      }
    >
      <div class="eqp-faders" classList={{ rows: props.narrow }} data-testid="eq-fader-list">
        <Show when={s()}>
          {(st) => (
            <>
              <div class="eqp-col pre" data-testid="eq-fader-pre">
                <span class="num t12 w6">{sgn(st().preampDb)}</span>
                <input type="range" class="eqp-fader" min={-24} max={12} step={0.1} value={st().preampDb} aria-label={t("w2_eq_preamp")} data-testid="eq-preamp"
                  onInput={(e) => setPreamp(Number(e.currentTarget.value))} onDblClick={() => setPreamp(0)} />
                <span class="t12 i3 eqp-fl">{t("w2_eq_preamp")}</span>
              </div>
              <Index each={st().bands}>
                {(b, i) => (
                  <div class="eqp-col" classList={{ sel: eqSelected() === i }} data-testid={`eq-fader-col-${i}`}>
                    <span class="num t12 w6">{sgn(b().gain)}</span>
                    <input type="range" class="eqp-fader" min={MIN} max={MAX} step={0.1} value={Math.min(MAX, Math.max(MIN, b().gain))}
                      aria-label={t("w2_eq_band_n", i + 1, fLabel(b().freq))} data-testid={`eq-fader-${i}`}
                      onFocus={() => selectBand(i)} onPointerDown={() => selectBand(i)}
                      onInput={(e) => updateBand(i, { gain: Number(e.currentTarget.value) })} onDblClick={() => updateBand(i, { gain: 0 })} />
                    <span class="eqp-fl t12"><span class="eqp-bn">{i + 1}</span> <span class="i3">{fLabel(b().freq)}</span></span>
                  </div>
                )}
              </Index>
            </>
          )}
        </Show>
      </div>
    </Card>
  );
}
