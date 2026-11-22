// Composited layer census (CDP LayerTree) for the Library list and the open full player.
//   node tools/layers.mjs <url> [--dpr=2.5]
import { chromium } from "@playwright/test";
const url = process.argv[2] ?? "http://127.0.0.1:4173/";
const dpr = Number(process.argv.find((a) => a.startsWith("--dpr="))?.split("=")[1] ?? 2.5);
const browser = await chromium.launch({ channel: "msedge", headless: false, args: [`--force-device-scale-factor=${dpr}`] });
const ctx = await browser.newContext({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await page.goto(url);
await page.waitForSelector('[data-testid="home"]');
let layers = [];
cdp.on("LayerTree.layerTreeDidChange", (e) => { if (e.layers) layers = e.layers; });
await cdp.send("DOM.enable");
await cdp.send("LayerTree.enable");
const census = async (label) => {
  await page.waitForTimeout(600);
  const drawn = layers.filter((l) => l.drawsContent);
  const px = drawn.reduce((a, l) => a + l.width * l.height, 0) * dpr * dpr;
  const vp = 1536 * 960 * dpr * dpr;
  const reasons = {};
  for (const l of drawn.slice(0, 80)) {
    try {
      const r = await cdp.send("LayerTree.compositingReasons", { layerId: l.layerId });
      const k = (r.compositingReasonIds ?? r.compositingReasons ?? []).join("+") || "root/none";
      reasons[k] = (reasons[k] ?? 0) + 1;
    } catch {}
  }
  console.log(`${label}: layers=${layers.length} drawing=${drawn.length} drawn area=${(px / vp).toFixed(2)} viewports`);
  console.log("  reasons", JSON.stringify(reasons));
  const big = drawn.filter((l) => l.width * l.height > 0.25 * 1536 * 960).map((l) => `${l.width}x${l.height}`);
  console.log("  large layers", big.join(" "));
};
await census("home");
await page.click('[data-testid="nav-library"]');
await page.waitForSelector('[data-testid="songs-list"]');
await page.mouse.move(768, 600);
await census("library (hovering a row)");
await page.click('[data-testid="player-art"]');
await census("full player open");
await browser.close();
