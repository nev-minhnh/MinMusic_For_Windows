import { invoke } from "../../lib/tauri";
import type { Command } from "../ctx";

/** Ctrl M (frontend-spec 7): open the mini player window, or close it again. */
export const commands: Command[] = [{ id: "mini.open", run: () => void invoke("mini_toggle") }];
