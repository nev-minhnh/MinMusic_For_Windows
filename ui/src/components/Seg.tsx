import { For } from "solid-js";
export type SegItem = { key: string; label: string; dot?: string };
export function Seg(props: { items: SegItem[]; value: string; onChange: (k: string) => void; label: string; class?: string; style?: Record<string, string> }) {
  return (
    <div class={`seg ${props.class ?? ""}`} role="tablist" aria-label={props.label} style={props.style}>
      <For each={props.items}>
        {(it) => (
          <button type="button" role="tab" aria-selected={props.value === it.key} classList={{ on: props.value === it.key }} onClick={() => props.onChange(it.key)}>
            {it.dot && <span class="dot" style={{ background: it.dot }} />}
            {it.label}
          </button>
        )}
      </For>
    </div>
  );
}
