import type { Command } from "../ctx";
import { registerSongInfo } from "../../dialogs/SongInfo";

// Ctrl I -> `track.info` (input/commands/m1-ui.ts) opens the song info dialog through lib/songInfo.ts. This module is loaded with the
// command registry at start-up, so importing the dialog here registers its opener before any page needs it.
registerSongInfo();

/** No shortcut of its own: the Library keys (Del, F2, F5, Enter, Ctrl A) are DOM events and list handlers (frontend-spec 7). */
export const commands: Command[] = [];
