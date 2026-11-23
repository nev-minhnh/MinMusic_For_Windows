import { eqApi, nudgeFreq, nudgeGain, stepSelection } from "../../state/eq";
import type { Command } from "../ctx";

// Equalizer commands. The band keys themselves are handled on the focused graph (pages/Equalizer/Graph.tsx) so they never
// fight the global seek/volume keys; these ids let other code (and tests) run the same actions: arg "1" | "-1", "fine" via "1f".
const dir = (a?: string): 1 | -1 => (Number(a?.replace("f", "")) < 0 ? -1 : 1);
const fine = (a?: string) => !!a?.endsWith("f");

export const commands: Command[] = [
  { id: "eq.band.select", run: (c) => stepSelection(dir(c.arg)) },
  { id: "eq.band.freq", run: (c) => nudgeFreq(dir(c.arg), fine(c.arg)) },
  { id: "eq.band.gain", run: (c) => nudgeGain(dir(c.arg), fine(c.arg)) },
  { id: "eq.undo", run: () => void eqApi.undo().catch(() => {}) },
  { id: "eq.redo", run: () => void eqApi.redo().catch(() => {}) },
  { id: "eq.reset", run: () => void eqApi.reset().catch(() => {}) },
];
