// Ground truth for perf runs: dump edge://gpu feature status, the GL/ANGLE adapter and the browser command line
// for an Edge launched by Playwright with the same flags as perf-trace.mjs.
//   node tools/gpu-info.mjs [--dsf=2.5] [--plain]   (--plain: no extra flags at all)
import { chromium } from "@playwright/test";
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const plain = process.argv.includes("--plain");
const args = plain ? [] : [`--force-device-scale-factor=${arg("dsf", "2.5")}`];
const browser = await chromium.launch({ channel: "msedge", headless: false, args });
const page = await (await browser.newContext({ viewport: null })).newPage();
const deepText = () => {
  const walk = (n) => {
    let s = "";
    if (n.shadowRoot) s += walk(n.shadowRoot);
    for (const c of n.childNodes) s += c.nodeType === 3 ? c.textContent : c.nodeType === 1 ? (/^(DIV|TR|LI|H\d|P)$/.test(c.tagName) ? "\n" : " ") + walk(c) : "";
    return s;
  };
  return walk(document.body).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");
};
await page.goto("edge://gpu");
await page.waitForTimeout(2500);
const gpu = await page.evaluate(deepText);
const pick = (re) => gpu.split("\n").filter((l) => re.test(l)).map((l) => l.trim());
console.log("== Graphics Feature Status");
const fs = gpu.indexOf("Graphics Feature Status");
console.log(gpu.slice(fs, gpu.indexOf("Version Information", fs) > 0 ? gpu.indexOf("Version Information", fs) : fs + 1500).trim().split("\n").slice(1, 25).join("\n"));
console.log("== Adapter");
for (const l of pick(/GL_RENDERER|Active GPU|GPU0|GPU1|Direct Rendering Display Compositor|Overlays|Display type|ANGLE|SwiftShader|software|Driver vendor|Driver version|Desktop composition|Optimus|AMD switchable|Hardware supports|D3D11 feature/i).slice(0, 40)) console.log(l);
await page.goto("edge://version");
await page.waitForTimeout(500);
const ver = await page.evaluate(deepText);
console.log("== Version / command line");
console.log(pick(/Microsoft Edge|Command Line|Chromium/i).slice(0, 6).join("\n"));
console.log("== window", await page.evaluate(() => `${innerWidth}x${innerHeight} dpr=${devicePixelRatio}`));
await browser.close();
