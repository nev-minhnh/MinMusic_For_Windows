// M1-5 stage 1 placeholder: home.get as in M0. Replaced by handlers/browse.ts in stage 2.
import type { HandlerModule } from "../state.ts";

export const handlers: HandlerModule["handlers"] = {
  "home.get": (p, { st, emit }) => {
    const chip = typeof p?.chip === "string" ? p.chip : undefined;
    if (p?.refresh) setTimeout(() => emit("app", "home.updated", { shelves: st.home.shelves }), 600);
    return { ...st.home, chips: st.home.chips.map((c) => ({ ...c, selected: c.key === chip })), fromCache: true };
  },
};
