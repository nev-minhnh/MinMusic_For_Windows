// Generates src-tauri/icons/thumb/{prev,play,pause,next}.ico (16/20/24/32 px, 32-bit DIB entries)
// from simple vector glyphs on a 24x24 grid (Material "skip_previous", "play_arrow", "pause", "skip_next").
// No dependencies: 4x4 supersampled polygon rasteriser. Usage: node scripts/gen-thumb-icons.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "icons", "thumb");
const SIZES = [16, 20, 24, 32];
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const GLYPHS = {
  prev: [rect(6, 6, 8.2, 18), [[18, 6], [18, 18], [9.2, 12]]],
  next: [rect(15.8, 6, 18, 18), [[6, 6], [6, 18], [14.8, 12]]],
  play: [[[8, 5], [8, 19], [19, 12]]],
  pause: [rect(6.5, 5, 10, 19), rect(14, 5, 17.5, 19)],
};

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** alpha coverage 0..255 per pixel, top-down */
function raster(polys, n) {
  const SS = 4, a = new Uint8Array(n * n), k = 24 / n;
  for (let py = 0; py < n; py++)
    for (let px = 0; px < n; px++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * k, y = (py + (sy + 0.5) / SS) * k;
          if (polys.some((p) => inside(p, x, y))) hit++;
        }
      a[py * n + px] = Math.round((hit / (SS * SS)) * 255);
    }
  return a;
}

/** one ICO image: BITMAPINFOHEADER (height doubled) + BGRA bottom-up + 1bpp AND mask (all zero, alpha rules) */
function dib(alpha, n) {
  const mask = Math.ceil(n / 32) * 4;
  const buf = Buffer.alloc(40 + n * n * 4 + mask * n);
  buf.writeUInt32LE(40, 0); buf.writeInt32LE(n, 4); buf.writeInt32LE(n * 2, 8);
  buf.writeUInt16LE(1, 12); buf.writeUInt16LE(32, 14); buf.writeUInt32LE(n * n * 4 + mask * n, 20);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const o = 40 + ((n - 1 - y) * n + x) * 4, al = alpha[y * n + x];
      buf[o] = buf[o + 1] = buf[o + 2] = 255; // white glyph, premultiplied-safe
      buf[o + 3] = al;
    }
  return buf;
}

function ico(polys) {
  const imgs = SIZES.map((n) => dib(raster(polys, n), n));
  const head = Buffer.alloc(6 + 16 * SIZES.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(SIZES.length, 4);
  let off = head.length;
  SIZES.forEach((n, i) => {
    const e = 6 + i * 16;
    head[e] = n; head[e + 1] = n; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(off, e + 12);
    off += imgs[i].length;
  });
  return Buffer.concat([head, ...imgs]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, polys] of Object.entries(GLYPHS)) {
  fs.writeFileSync(path.join(OUT, `${name}.ico`), ico(polys));
  console.log("wrote", name + ".ico");
}
