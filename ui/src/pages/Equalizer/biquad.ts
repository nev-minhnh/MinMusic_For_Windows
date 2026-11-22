// RBJ cookbook biquads at 48 kHz, closed-form magnitude (no complex numbers, no allocation per point).
// The UI draws this while a node is dragged; the final curve comes from eq.response. biquad.test.ts holds this module to
// the mock core's independent evaluation within 0.1 dB (api.md: "the drawing equals the sound").
export type BandType = "PK" | "LSC" | "HSC" | "LPQ" | "HPQ" | "BP" | "NO";
export type Band = { type: BandType; freq: number; gain: number; q: number };
export const FS = 48000;
export const F_MIN = 20;
export const F_MAX = 20000;
export const GAIN_TYPES: readonly BandType[] = ["PK", "LSC", "HSC"];
export const hasGain = (t: BandType) => GAIN_TYPES.includes(t);

/** [b0,b1,b2,a0,a1,a2] (not normalised) */
export function coeffs(b: Band, fs = FS): [number, number, number, number, number, number] {
  const w0 = (2 * Math.PI * b.freq) / fs, c = Math.cos(w0), s = Math.sin(w0);
  const A = Math.pow(10, (hasGain(b.type) ? b.gain : 0) / 40), alpha = s / (2 * b.q), sA = 2 * Math.sqrt(A) * alpha;
  switch (b.type) {
    case "LSC": return [A * (A + 1 - (A - 1) * c + sA), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - sA), A + 1 + (A - 1) * c + sA, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - sA];
    case "HSC": return [A * (A + 1 + (A - 1) * c + sA), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - sA), A + 1 - (A - 1) * c + sA, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - sA];
    case "LPQ": return [(1 - c) / 2, 1 - c, (1 - c) / 2, 1 + alpha, -2 * c, 1 - alpha];
    case "HPQ": return [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + alpha, -2 * c, 1 - alpha];
    case "BP": return [alpha, 0, -alpha, 1 + alpha, -2 * c, 1 - alpha];
    case "NO": return [1, -2 * c, 1, 1 + alpha, -2 * c, 1 - alpha];
    default: return [1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A];
  }
}

/** |H(e^jw)|^2 = ((b0+b1+b2)^2 - 4(b0b1 + 4b0b2 + b1b2)p + 16 b0 b2 p^2) / (same for a), p = sin^2(w/2) */
function mag2(x0: number, x1: number, x2: number, p: number) {
  const s = x0 + x1 + x2;
  return s * s - 4 * (x0 * x1 + 4 * x0 * x2 + x1 * x2) * p + 16 * x0 * x2 * p * p;
}
export function bandDb(co: ReturnType<typeof coeffs>, hz: number, fs = FS): number {
  const sw = Math.sin((Math.PI * hz) / fs), p = sw * sw;
  return 10 * Math.log10(Math.max(1e-30, mag2(co[0], co[1], co[2], p)) / Math.max(1e-30, mag2(co[3], co[4], co[5], p)));
}

export const logGrid = (n: number, lo = F_MIN, hi = F_MAX): Float64Array => {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = lo * Math.pow(hi / lo, i / (n - 1));
  return out;
};
const GRID = new Map<number, Float64Array>();
const grid = (n: number) => { let g = GRID.get(n); if (!g) GRID.set(n, (g = logGrid(n))); return g; };

/** Summed response of all bands on the log grid (the same 20 Hz to 20 kHz grid as eq.response). */
export function curveDb(bands: readonly Band[], points = 256): { hz: Float64Array; db: Float64Array } {
  const hz = grid(points), db = new Float64Array(points);
  for (const b of bands) {
    const co = coeffs(b);
    for (let i = 0; i < points; i++) db[i] += bandDb(co, hz[i]!);
  }
  return { hz, db };
}

// ---- plot mapping (shared by the graph and its tests)
export const xOfHz = (hz: number, x0: number, w: number) => x0 + (Math.log(hz / F_MIN) / Math.log(F_MAX / F_MIN)) * w;
export const hzOfX = (x: number, x0: number, w: number) => F_MIN * Math.pow(F_MAX / F_MIN, Math.min(1, Math.max(0, (x - x0) / w)));
export const yOfDb = (db: number, y0: number, h: number, range: number) => y0 + (0.5 - db / (2 * range)) * h;
export const dbOfY = (y: number, y0: number, h: number, range: number) => (0.5 - (y - y0) / h) * 2 * range;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const round1 = (v: number) => Math.round(v * 10) / 10;
