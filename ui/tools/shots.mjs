// Screenshots of the UI in Microsoft Edge (same engine as WebView2) against the Vite dev server.
// usage: node tools/shots.mjs <outDir> [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2] ?? "shots";
const base = process.argv[3] ?? "http://127.0.0.1:5173/";
mkdirSync(out, { recursive: true });

const sizes = [
  { name: "1536x960", width: 1536, height: 960, dpr: 2.5 },
  { name: "1920x1200", width: 1920, height: 1200, dpr: 1 },
];
const only = process.env.SIZES?.split(",");

const browser = await chromium.launch({ channel: "msedge", headless: true });
for (const s of sizes) {
  if (only && !only.includes(s.name)) continue;
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr, colorScheme: "dark", locale: "vi-VN" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
  await page.goto(base);
  await page.waitForSelector('[data-testid="home"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${s.name}-home.png`) });
  // library
  await page.click('[data-testid="nav-library"]');
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(out, `${s.name}-library-top.png`) });
  await page.evaluate(() => document.querySelector('.pg[data-route="library"]').scrollTo(0, 900));
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, `${s.name}-library-list.png`) });
  // album
  await page.click('[data-testid="nav-home"]');
  await page.waitForTimeout(500);
  await page.locator('.pg:not(.hid) [data-testid="card"]').first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `${s.name}-album.png`) });
  // full player
  await page.click('[data-testid="player-art"]');
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, `${s.name}-fullplayer.png`) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `${s.name}-after-close.png`) });
  await ctx.close();
}
await browser.close();
console.log("done");
