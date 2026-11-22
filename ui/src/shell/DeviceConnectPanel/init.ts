// Starts the dc / lt subscriptions once the core advertises the capabilities (the UI hides everything without them) and wires `mm-open-dc`.
import { createEffect, createRoot } from "solid-js";
import { capability } from "./cap";
import { startDc, stopDc, openDc } from "./store";
import { startLt, stopLt } from "../../pages/ListenTogether/store";

export const hasDeviceConnect = capability("deviceConnect");
export const hasListenTogether = capability("listenTogether");

let started = false;
export function initDcLt() {
  if (started) return;
  started = true;
  createRoot(() => {
    createEffect(() => (hasDeviceConnect() ? startDc() : stopDc()));
    createEffect(() => (hasListenTogether() ? startLt() : stopLt()));
  });
  // the player-bar device chip (M2-2) dispatches this event
  window.addEventListener("mm-open-dc", () => hasDeviceConnect() && openDc());
}
