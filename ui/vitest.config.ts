// Separate from vite.config.ts so the production build typechecks against the ui/ vite only.
import { defineConfig, mergeConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig as never,
  defineConfig({
    // vite-plugin-solid adds the "browser" resolve condition under vitest, which makes "ws" resolve to its browser stub
    // (no WebSocketServer). The core tests run real ws servers, so alias it to the node ESM wrapper.
    test: { alias: { ws: fileURLToPath(new URL("../node_modules/ws/wrapper.mjs", import.meta.url)) } },
  }),
);
