// Ctrl , -> Settings, Ctrl ` / Ctrl / -> shortcuts sheet (these replace the m1 no-ops). Also starts the settings store,
// so theme and language follow the `settings` topic from the first frame the core answers.
import { navigate } from "../../router/router";
import { openShortcuts } from "../../pages/Settings/Shortcuts/Dialog";
import { initSettings } from "../../state/settings";
import type { Command } from "../ctx";

export const commands: Command[] = [
  { id: "settings.open", run: () => navigate("settings") },
  { id: "shortcuts.sheet", run: openShortcuts },
];

queueMicrotask(() => {
  try { initSettings(); } catch { /* no core: defaults */ }
});
