import { render } from "solid-js/web";
import type { JSX } from "solid-js";

const mounted = new Set<string>();

/** Mounts a self-contained dialog host once, on first use (the app shell does not know these dialogs). */
export function mountOnce(name: string, view: () => JSX.Element): void {
  if (mounted.has(name) || typeof document === "undefined") return;
  mounted.add(name);
  const host = document.createElement("div");
  host.dataset.host = name;
  document.body.appendChild(host);
  render(view, host);
}
