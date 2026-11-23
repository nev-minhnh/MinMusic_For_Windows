// Ctrl Shift L -> log viewer. The viewer module is loaded on first use (it is not needed to paint).
// Also kicks off the M4-3b startup hooks after the first paint until App runs `startup/*.ts` itself (the hooks are idempotent).
import type { Command } from "../ctx";

export const commands: Command[] = [
  {
    id: "logs.open",
    run: () => void import("../../dialogs/LogViewer").then((m) => m.openLogViewer()),
  },
];

if (typeof window !== "undefined" && import.meta.env.MODE !== "test") {
  requestAnimationFrame(() => requestAnimationFrame(() => void import("../../startup/m4-3b").then((m) => m.run()).catch(() => {})));
}
