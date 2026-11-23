import { render } from "solid-js/web";
import { DeviceConnectPanel } from "./index";

let mounted = false;
/** The panel is an overlay, not a route: it mounts itself once on <body> (App.tsx stays untouched). */
export function mountDcHost() {
  if (mounted || typeof document === "undefined") return;
  mounted = true;
  const go = () => {
    const el = document.createElement("div");
    el.dataset.testid = "dc-host";
    document.body.appendChild(el);
    render(() => <DeviceConnectPanel />, el);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go, { once: true });
  else go();
}
