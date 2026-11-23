// Ctrl Shift L -> log viewer. The viewer module is loaded on first use (it is not needed to paint).
import type { Command } from "../ctx";

export const commands: Command[] = [
  {
    id: "logs.open",
    run: () => void import("../../dialogs/LogViewer").then((m) => m.openLogViewer()),
  },
];
