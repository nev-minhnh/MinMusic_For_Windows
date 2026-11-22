import { type JSX, splitProps } from "solid-js";
import { Icon } from "./Icon";

type P = {
  icon: string;
  label: string;
  size?: 28 | 32 | 36 | 40 | 48;
  active?: boolean;
  tonal?: boolean;
  disabled?: boolean;
  iconSize?: 16 | 20 | 24 | 32;
  onClick?: (e: MouseEvent) => void;
  testid?: string;
  class?: string;
  style?: JSX.CSSProperties;
};

export function IconButton(props: P) {
  const [p] = splitProps(props, ["icon", "label", "size", "active", "tonal", "disabled", "iconSize", "onClick", "testid", "class", "style"]);
  return (
    <button
      type="button"
      class={`ib ${p.active ? "on" : ""} ${p.tonal ? "ton" : ""} ${p.class ?? ""}`}
      classList={{ dis: p.disabled }}
      style={{ ...(p.size && p.size !== 36 ? { width: p.size + "px", height: p.size + "px", "border-radius": p.size / 2 + "px" } : {}), ...(p.style ?? {}) }}
      aria-label={p.label}
      title={p.label}
      aria-pressed={p.active === undefined ? undefined : p.active}
      aria-disabled={p.disabled ? "true" : undefined}
      data-testid={p.testid}
      onClick={(e) => !p.disabled && p.onClick?.(e)}
    >
      <Icon n={p.icon} s={p.iconSize ?? 20} />
    </button>
  );
}
