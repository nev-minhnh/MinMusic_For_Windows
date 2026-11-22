import { focusSearchBox } from "../../shell/search/box";
import type { Command } from "../ctx";

/** Ctrl K, Ctrl F and the slash key (bound in input/keys.ts) focus and select the title-bar search field. Registered after m1.ts, so it wins. */
export const commands: Command[] = [{ id: "search.focus", run: () => focusSearchBox() }];
