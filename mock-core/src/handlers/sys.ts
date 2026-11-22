import type { HandlerModule } from "../state.ts";
import { bad, reqStr } from "../util.ts";

const MOCK_VERSION = "0.1.0-mock";

export const handlers: HandlerModule["handlers"] = {
  "sys.ping": () => ({ t: Date.now() }),
  "app.info": () => ({
    version: MOCK_VERSION, core: "mock-core", protocol: 1, buildTime: "2026-11-22T00:00:00Z",
    dataDirs: { data: "mock", config: "mock", state: "mock", cache: "mock", logs: "mock" }, portable: false,
  }),
  "app.log": (p) => { reqStr(p, "msg"); if (!["error", "warn", "info"].includes(p.level)) throw bad("level"); return {}; },
};

export const topics: HandlerModule["topics"] = {
  app: () => ({ toasts: [] }),
};
