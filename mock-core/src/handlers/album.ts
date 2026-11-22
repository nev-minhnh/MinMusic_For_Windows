// M1-5 stage 1 placeholder: album.get as in M0. Replaced by handlers/pages.ts in stage 2.
import type { HandlerModule } from "../state.ts";
import { albumPage } from "../content.ts";
import { reqStr } from "../util.ts";

export const handlers: HandlerModule["handlers"] = {
  "album.get": (p, { st }) => albumPage(st, reqStr(p, "id")),
};
