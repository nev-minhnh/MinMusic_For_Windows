import { createSignal } from "solid-js";

// Full player overlay state (an overlay in the Esc stack, not a route).
const [fullOpen, setFullOpen] = createSignal(false);
export { fullOpen };
export const openFull = () => setFullOpen(true);
export const closeFull = () => setFullOpen(false);
export const toggleFull = () => setFullOpen((o) => !o);
