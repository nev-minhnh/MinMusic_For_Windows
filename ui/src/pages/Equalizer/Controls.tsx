import { createSignal, type JSX } from "solid-js";

export function Switch(props: { on: boolean; label: string; onChange: (on: boolean) => void; testid?: string }) {
  return (
    <button type="button" role="switch" aria-checked={props.on} aria-label={props.label} class="eqp-sw" classList={{ on: props.on }} data-testid={props.testid} onClick={() => props.onChange(!props.on)}>
      <span class="eqp-knob" />
    </button>
  );
}

/** `[-] value [+]` with a text field: steps per click (Shift = fine), Enter or blur commits a typed value. */
export function Stepper(props: {
  label: string; value: number | undefined; fmt: (v: number) => string; parse?: (s: string) => number;
  onSet: (v: number) => void; step: (dir: 1 | -1, fine: boolean) => number; min: number; max: number; testid: string; disabled?: boolean;
}) {
  const [edit, setEdit] = createSignal<string | null>(null);
  const shown = () => edit() ?? (props.value === undefined ? "—" : props.fmt(props.value));
  const set = (v: number) => { if (Number.isFinite(v)) props.onSet(Math.min(props.max, Math.max(props.min, v))); };
  const commit = (s: string) => {
    setEdit(null);
    const v = props.parse ? props.parse(s) : parseFloat(s.replace(",", "."));
    if (Number.isFinite(v)) set(v);
  };
  const off = () => props.disabled || props.value === undefined;
  return (
    <div class="eqp-step" classList={{ dis: off() }}>
      <span class="eqp-lbl">{props.label}</span>
      <div class="eqp-stepbox">
        <button type="button" class="eqp-sb" aria-label={`${props.label} −`} disabled={off()} data-testid={`${props.testid}-dec`} onClick={(e) => set(props.step(-1, e.shiftKey))}>−</button>
        <input
          class="eqp-in num" inputmode="decimal" aria-label={props.label} data-testid={props.testid} disabled={off()} value={shown()}
          onFocus={(e) => { setEdit(e.currentTarget.value); e.currentTarget.select(); }}
          onInput={(e) => setEdit(e.currentTarget.value)}
          onBlur={(e) => edit() !== null && commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { commit(e.currentTarget.value); e.currentTarget.blur(); }
            else if (e.key === "Escape") { setEdit(null); e.currentTarget.blur(); e.stopPropagation(); }
            else if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); setEdit(null); set(props.step(e.key === "ArrowUp" ? 1 : -1, e.shiftKey)); }
            e.stopPropagation();
          }}
        />
        <button type="button" class="eqp-sb" aria-label={`${props.label} +`} disabled={off()} data-testid={`${props.testid}-inc`} onClick={(e) => set(props.step(1, e.shiftKey))}>+</button>
      </div>
    </div>
  );
}

export function Slider(props: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onInput: (v: number) => void; testid: string; reset?: number }) {
  return (
    <label class="eqp-sl">
      <span class="eqp-sl-top"><span>{props.label}</span><span class="num i2" data-testid={`${props.testid}-val`}>{props.fmt(props.value)}</span></span>
      <input type="range" class="eqp-range" min={props.min} max={props.max} step={props.step} value={props.value} data-testid={props.testid}
        onInput={(e) => props.onInput(Number(e.currentTarget.value))}
        onDblClick={() => props.reset !== undefined && props.onInput(props.reset)} />
    </label>
  );
}

export const Card = (props: { title?: string; children: JSX.Element; class?: string; testid?: string; right?: JSX.Element }) => (
  <section class={`eqp-card ${props.class ?? ""}`} data-testid={props.testid}>
    {props.title && <div class="eqp-card-h"><span class="ovl">{props.title}</span>{props.right}</div>}
    {props.children}
  </section>
);
