import type { LocalList } from "@minmusic/protocol";
import type { HandlerModule } from "../state.ts";
import { bad, isObj, reqInt } from "../util.ts";

export const handlers: HandlerModule["handlers"] = {
  "library.counts": (_p, { st }) => st.counts(),
  "library.window": (p, { st }) => {
    if (!isObj(p)) throw bad("params required");
    const offset = reqInt(p, "offset", 0);
    const limit = reqInt(p, "limit", 1, 200);
    if (!p.sort || typeof p.sort.by !== "string") throw bad("sort required");
    if (typeof p.list !== "string") throw bad("list required");
    const items = st.listItems(p.list as LocalList, p.sort, p.filter);
    return { total: items.length, revision: st.lib.revision, offset, items: items.slice(offset, offset + limit) };
  },
  /** test hook (mock only) */
  "mock.libraryChanged": (p, { st }) => {
    st.bumpLibrary(Array.isArray(p?.lists) ? p.lists : ["songs"]);
    return { revision: st.lib.revision };
  },
};

export const topics: HandlerModule["topics"] = {
  library: ({ st }) => ({ counts: st.counts(), revision: st.lib.revision }),
};
