import { createSignal } from "solid-js";

// Reduced motion: OS setting or the in-app setting (frontend-spec 6.1).
const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
const [app, setApp] = createSignal(false);
const [os, setOs] = createSignal(mq.matches);
mq.addEventListener("change", () => setOs(mq.matches));
export const reducedMotion = () => app() || os();
export function setReducedMotionSetting(on: boolean) {
  setApp(on);
  document.documentElement.classList.toggle("reduce-motion", on);
}

export const E_CONTAINER = "cubic-bezier(0.2,0.9,0.1,1)";
export const D_CONTAINER = 380;
