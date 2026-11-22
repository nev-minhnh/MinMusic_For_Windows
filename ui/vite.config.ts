import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [solid()],
  resolve: { alias: { "@minmusic/protocol": fileURLToPath(new URL("../protocol/src/index.ts", import.meta.url)) } },
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
  build: { outDir: "dist", target: "chrome120", cssCodeSplit: false, modulePreload: false, assetsInlineLimit: 0 },
});
