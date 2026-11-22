// Full-player tint: art.dominant clamped to L* <= 20 (frontend-spec 5) so ink text always has contrast.

/** sRGB hex "#rrggbb" -> linear-light channels. */
function lin(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function enc(l: number): number {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
}
export function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** CIE L* (0..100) of a colour. */
export function lstar(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const y = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}
const Y20 = ((20 + 16) / 116) ** 3; // relative luminance of L* = 20

/** Scales the linear-light channels uniformly so L* <= max (hue and saturation of the source are kept). */
export function clampTint(hex: string | undefined, max = 20): string {
  const rgb = parseHex(hex ?? "");
  if (!rgb) return "#2A1622";
  const y = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const ymax = max === 20 ? Y20 : ((max + 16) / 116) ** 3;
  if (y <= ymax) return "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join("");
  const f = ymax / y;
  return "#" + rgb.map((c) => enc(lin(c) * f).toString(16).padStart(2, "0")).join("");
}

const FALLBACK = ["#2A1622", "#142A33", "#25203F", "#1F2D1B", "#33211A", "#16283B"];
/** Tint for a track: its dominant colour, else a stable muted colour from the id so the cross-fade still shows. */
export function tintFor(dominant: string | undefined, trackId: string | undefined): string {
  if (dominant && parseHex(dominant)) return clampTint(dominant);
  let h = 0;
  for (const ch of trackId ?? "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length]!;
}
