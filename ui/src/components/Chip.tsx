import type { JSX } from "solid-js";
export function Chip(props: { on?: boolean; dot?: string; children: JSX.Element; onClick?: () => void; class?: string }) {
  return (
    <button type="button" class={`chip ${props.on ? "on" : ""} ${props.class ?? ""}`} aria-pressed={props.on ? "true" : "false"} onClick={() => props.onClick?.()}>
      {props.dot && <span class="dot" style={{ background: props.dot }} />}
      {props.children}
    </button>
  );
}
