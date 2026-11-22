import { createSignal } from "solid-js";

// Full player overlay state (an overlay in the Esc stack, not a route).
const [fullOpen, setFullOpen] = createSignal(false);
export { fullOpen };
export const openFull = () => setFullOpen(true);
export const closeFull = () => setFullOpen(false);
export const toggleFull = () => setFullOpen((o) => !o);

// Open modal dialogs (plain keys are ignored while > 0, see input/keys.ts).
const [dialogDepth, setDialogDepth] = createSignal(0);
export const dialogsOpen = () => dialogDepth() > 0;
export const trackDialog = (open: boolean) => setDialogDepth((n) => Math.max(0, n + (open ? 1 : -1)));
