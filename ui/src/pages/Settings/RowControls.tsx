import { For, Show, createSignal } from "solid-js";
import type { SettingEntry } from "@minmusic/protocol";
import { Seg } from "../../components/Seg";
import { t } from "../../i18n";
import { enumLabels, type RowDef } from "./layout";

type CtlProps = { entry: SettingEntry; value: unknown; label: string; disabled?: boolean; onChange: (v: unknown) => void };

/** Enum value label: the translated one, else the value humanised ("P1080" -> "1080p", "BLURRED_ARTWORK" -> "Blurred artwork"). */
export function enumLabel(key: string, value: string): string {
  const f = enumLabels[`${key}.${value}`];
  if (f) return f();
  const p = /^P(\d+)$/.exec(value);
  if (p) return `${p[1]}p`;
  const s = value.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const enumOptions = (e: SettingEntry, order?: string[]) => (order ?? e.enumValues ?? []).filter((v) => e.enumValues?.includes(v));

const decimals = (step: number) => (Number.isInteger(step) ? 0 : String(step).split(".")[1]?.length ?? 2);
const clamp = (v: number, e: SettingEntry) => Math.min(e.max ?? Infinity, Math.max(e.min ?? -Infinity, v));
/** Value rounded to the step grid (no float drift). */
export const snap = (v: number, e: SettingEntry) => {
  const step = e.step ?? 1;
  const d = decimals(step);
  return Number(clamp(Math.round((v - (e.min ?? 0)) / step) * step + (e.min ?? 0), e).toFixed(d));
};

export function SwitchCtl(props: CtlProps) {
  return (
    <button type="button" role="switch" class="sr-sw" classList={{ on: props.value === true }} aria-checked={props.value === true} aria-label={props.label} disabled={props.disabled} onClick={() => props.onChange(props.value !== true)}>
      <span class="sr-knob" />
    </button>
  );
}

export function SegCtl(props: CtlProps & { order?: string[] }) {
  return (
    <Seg
      class="sr-seg"
      label={props.label}
      value={String(props.value)}
      onChange={(v) => !props.disabled && props.onChange(v)}
      items={enumOptions(props.entry, props.order).map((v) => ({ key: v, label: enumLabel(props.entry.key, v) }))}
    />
  );
}

export function SelectCtl(props: CtlProps & { order?: string[] }) {
  return (
    <select class="sr-sel" aria-label={props.label} disabled={props.disabled} value={String(props.value)} onChange={(e) => props.onChange(e.currentTarget.value)}>
      <For each={enumOptions(props.entry, props.order)}>{(v) => <option value={v} selected={String(props.value) === v}>{enumLabel(props.entry.key, v)}</option>}</For>
    </select>
  );
}

export function SliderCtl(props: CtlProps) {
  const step = () => props.entry.step ?? 1;
  const [drag, setDrag] = createSignal<number | undefined>(undefined);
  const shown = () => drag() ?? (props.value as number);
  return (
    <div class="sr-slider">
      <input
        type="range"
        min={props.entry.min ?? 0}
        max={props.entry.max ?? 100}
        step={step()}
        value={shown()}
        aria-label={props.label}
        disabled={props.disabled}
        onInput={(e) => setDrag(Number(e.currentTarget.value))}
        onChange={(e) => {
          setDrag(undefined);
          props.onChange(snap(Number(e.currentTarget.value), props.entry));
        }}
      />
      <span class="sr-val num t12 i2">{Number(shown()).toFixed(decimals(step()))}</span>
    </div>
  );
}

export function StepperCtl(props: CtlProps) {
  const step = () => props.entry.step ?? 1;
  const bump = (d: number) => props.onChange(snap((props.value as number) + d * step(), props.entry));
  const atMin = () => props.entry.min !== undefined && (props.value as number) <= props.entry.min;
  const atMax = () => props.entry.max !== undefined && (props.value as number) >= props.entry.max;
  return (
    <div class="sr-step" role="group" aria-label={props.label}>
      <button type="button" class="ib" aria-label={t("w2_set_decrease")} disabled={props.disabled || atMin()} onClick={() => bump(-1)}>
        <span aria-hidden="true">−</span>
      </button>
      <span class="sr-val num" aria-live="polite">{Number(props.value).toFixed(decimals(step()))}</span>
      <button type="button" class="ib" aria-label={t("w2_set_increase")} disabled={props.disabled || atMax()} onClick={() => bump(1)}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

export function TextCtl(props: CtlProps) {
  return (
    <input
      type="text"
      class="sr-text"
      aria-label={props.label}
      disabled={props.disabled}
      value={String(props.value ?? "")}
      spellcheck={false}
      onChange={(e) => props.onChange(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          e.currentTarget.value = String(props.value ?? "");
          e.currentTarget.blur();
          e.preventDefault();
        }
      }}
    />
  );
}

/** Secret: shows set / not set; the key itself is only ever typed in and sent through `onSave`, never read back. */
export function SecretCtl(props: { label: string; value: unknown; disabled?: boolean; onSave: (secret: string) => void }) {
  const [editing, setEditing] = createSignal(false);
  let input: HTMLInputElement | undefined;
  const isSet = () => (props.value as { set?: boolean } | undefined)?.set === true;
  const save = () => {
    props.onSave(input?.value ?? "");
    setEditing(false);
  };
  return (
    <div class="sr-secret">
      <Show
        when={editing()}
        fallback={
          <>
            <span class="sr-state t12" classList={{ set: isSet() }} data-testid="secret-state">{isSet() ? t("w2_set_secret_set") : t("w2_set_secret_unset")}</span>
            <button type="button" class="sr-btn" disabled={props.disabled} onClick={() => { setEditing(true); queueMicrotask(() => input?.focus()); }}>{t("w2_set_secret_change")}</button>
            <Show when={isSet()}>
              <button type="button" class="sr-btn" disabled={props.disabled} onClick={() => props.onSave("")}>{t("w2_set_secret_clear")}</button>
            </Show>
          </>
        }
      >
        <input
          ref={input}
          type="password"
          class="sr-text"
          aria-label={props.label}
          autocomplete="off"
          spellcheck={false}
          placeholder={t("w2_set_secret_ph")}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            else if (e.key === "Escape") { setEditing(false); e.preventDefault(); }
          }}
        />
        <button type="button" class="sr-btn acc-btn" onClick={save}>{t("w2_set_secret_save")}</button>
        <button type="button" class="sr-btn" onClick={() => setEditing(false)}>{t("w2_set_cancel")}</button>
      </Show>
    </div>
  );
}

/** Default control for an entry; the layout may force a kind. */
export function kindOf(entry: SettingEntry, row: RowDef): NonNullable<RowDef["kind"]> {
  if (row.kind) return row.kind;
  switch (entry.type) {
    case "bool": return "switch";
    case "enum": return (entry.enumValues?.length ?? 0) <= 4 ? "seg" : "select";
    case "int": return "stepper";
    case "float": return entry.min !== undefined && entry.max !== undefined ? "slider" : "stepper";
    case "secret": return "secret";
    default: return "text";
  }
}
