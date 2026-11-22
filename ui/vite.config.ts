import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: { port: 5173, strictPort: true, host: "127.0.0.1" },
  build: { outDir: "dist", target: "chrome120", cssCodeSplit: false, modulePreload: false, assetsInlineLimit: 0 },
});
