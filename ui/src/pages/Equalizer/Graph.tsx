import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";
import { client } from "../../lib/core";
import { t } from "../../i18n";
import { eqCurve, eqDragging, eqRev, eqSelected, eqState, endDrag, nudgeFreq, nudgeGain, selectBand, startDrag, updateBand } from "../../state/eq";
import { clamp, curveDb, dbOfY, F_MAX, F_MIN, hasGain, hzOfX, logGrid, round1, xOfHz, yOfDb, type Band } from "./biquad";

// One <canvas> (frontend-spec 5), sized by DPR and redrawn only on change: state, selection, curve, size, theme, spectrum frame.
// There is no animation loop. While a node is dragged the curve is the local biquad approximation (biquad.ts); otherwise the
// curve that eq.response returned for the current revision.
const HIT = 24; // node hit radius, CSS px
const RANGE = 18; // dB shown above and below 0
const INSET = { l: 40, r: 20, t: 12, b: 26 };
const GRID_HZ = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const SPEC_EDGES = logGrid(33);
const hzLabel = (f: number) => (f >= 1000 ? `${f / 1000}k` : String(f));

type Colors = { ink3: string; line: string; acc: string; accT: string; s2: string; bg: string; ink: string };
function readColors(el: Element): Colors {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return { ink3: v("--ink3"), line: v("--line"), acc: v("--acc"), accT: v("--acc-t"), s2: v("--s2"), bg: v("--bg"), ink: v("--ink") };
}

export function Graph(props: { active: Accessor<boolean>; height: number; spectrum: Accessor<boolean> }) {
  let wrap!: HTMLDivElement;
  let cv!: HTMLCanvasElement;
  let raf = 0;
  let colors: Colors | null = null;
  let spec: Uint8Array | null = null;
  let visible = document.visibilityState === "visible";
  let hover = -1;
  let wheelOn = false;
  let drag: { i: number; dx: number; dy: number } | null = null;

  const geom = () => {
    const W = cv.clientWidth, H = cv.clientHeight;
    return { W, H, x0: INSET.l, y0: INSET.t, w: Math.max(10, W - INSET.l - INSET.r), h: Math.max(10, H - INSET.t - INSET.b) };
  };
  const bands = () => (eqState()?.bands ?? []) as Band[];

  function draw() {
    raf = 0;
    if (!props.active()) return;
    const dpr = window.devicePixelRatio || 1;
    const { W, H, x0, y0, w, h } = geom();
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const c = cv.getContext("2d");
    if (!c) return;
    colors ??= readColors(cv);
    const k = colors;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    c.font = "11px 'Be Vietnam Pro', system-ui, sans-serif";
    c.textBaseline = "middle";

    // grid
    c.lineWidth = 1;
    c.strokeStyle = k.line;
    c.fillStyle = k.ink3;
    c.beginPath();
    for (let db = -RANGE; db <= RANGE; db += 6) {
      const y = Math.round(yOfDb(db, y0, h, RANGE)) + 0.5;
      c.moveTo(x0, y); c.lineTo(x0 + w, y);
    }
    for (const f of GRID_HZ) {
      const x = Math.round(xOfHz(f, x0, w)) + 0.5;
      c.moveTo(x, y0); c.lineTo(x, y0 + h);
    }
    c.stroke();
    c.textAlign = "right";
    for (let db = -RANGE; db <= RANGE; db += 6) c.fillText(db > 0 ? `+${db}` : String(db), x0 - 8, yOfDb(db, y0, h, RANGE));
    c.textAlign = "center";
    for (const f of GRID_HZ) if (f !== 20 && f !== 20000) c.fillText(hzLabel(f), xOfHz(f, x0, w), y0 + h + 14);

    // spectrum, behind the curve
    if (spec && props.spectrum() && visible) {
      c.fillStyle = k.acc;
      c.globalAlpha = 0.2;
      for (let i = 0; i < 32; i++) {
        const xa = xOfHz(SPEC_EDGES[i]!, x0, w), xb = xOfHz(SPEC_EDGES[i + 1]!, x0, w);
        const bh = (spec[i]! / 255) * h * 0.9;
        c.fillRect(xa + 0.5, y0 + h - bh, Math.max(1, xb - xa - 1), bh);
      }
      c.globalAlpha = 1;
    }

    // curve
    const cur = eqCurve();
    const local = eqDragging() || !cur || cur.rev !== eqRev();
    const pts = local ? curveDb(bands(), 256) : cur;
    const n = pts.hz.length;
    const on = eqState()?.enabled !== false;
    const yz = yOfDb(0, y0, h, RANGE);
    c.save();
    c.beginPath();
    c.rect(x0, y0, w, h);
    c.clip();
    c.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xOfHz(pts.hz[i]!, x0, w), y = yOfDb(clamp(pts.db[i]!, -RANGE - 3, RANGE + 3), y0, h, RANGE);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.globalAlpha = on ? 1 : 0.4;
    c.lineWidth = 2.5;
    c.lineJoin = "round";
    c.strokeStyle = k.acc;
    c.stroke();
    c.lineTo(x0 + w, yz); c.lineTo(x0, yz); c.closePath();
    c.globalAlpha = on ? 0.14 : 0.06;
    c.fillStyle = k.acc;
    c.fill();
    c.restore();

    // nodes
    const sel = eqSelected();
    bands().forEach((b, i) => {
      const x = xOfHz(b.freq, x0, w), y = yOfDb(hasGain(b.type) ? clamp(b.gain, -RANGE, RANGE) : 0, y0, h, RANGE);
      c.beginPath();
      c.arc(x, y, i === sel ? 9 : 6.5, 0, Math.PI * 2);
      c.fillStyle = i === sel ? k.acc : k.bg;
      c.fill();
      c.lineWidth = i === sel ? 3 : 2;
      c.strokeStyle = i === sel ? k.ink : k.acc;
      c.stroke();
      if (i === sel) { c.beginPath(); c.arc(x, y, 14, 0, Math.PI * 2); c.lineWidth = 1.5; c.strokeStyle = k.acc; c.globalAlpha = 0.45; c.stroke(); c.globalAlpha = 1; }
    });
  }
  const requestDraw = () => { if (!raf && props.active()) raf = requestAnimationFrame(draw); };

  // ---- pointer
  const local = (e: { clientX: number; clientY: number }) => {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function hit(x: number, y: number): number {
    const { x0, y0, w, h } = geom();
    let best = -1, bd = HIT * HIT + 1;
    const sel = eqSelected();
    bands().forEach((b, i) => {
      const bx = xOfHz(b.freq, x0, w), by = yOfDb(hasGain(b.type) ? clamp(b.gain, -RANGE, RANGE) : 0, y0, h, RANGE);
      const d = (bx - x) ** 2 + (by - y) ** 2 - (i === sel ? 1 : 0);
      if (d <= HIT * HIT && d < bd) { bd = d; best = i; }
    });
    return best;
  }
  function setHover(i: number) {
    if (i === hover) return;
    hover = i;
    cv.style.cursor = i >= 0 ? "grab" : "";
    if (i >= 0 && !wheelOn) { cv.addEventListener("wheel", onWheel, { passive: false }); wheelOn = true; }
    else if (i < 0 && wheelOn) { cv.removeEventListener("wheel", onWheel); wheelOn = false; }
  }
  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const p = local(e);
    const i = hit(p.x, p.y);
    wrap.focus({ preventScroll: true });
    if (i < 0) { selectBand(-1); return; } // empty area: deselect, never creates a node
    const { x0, y0, w, h } = geom();
    const b = bands()[i]!;
    selectBand(i);
    drag = { i, dx: p.x - xOfHz(b.freq, x0, w), dy: p.y - yOfDb(hasGain(b.type) ? clamp(b.gain, -RANGE, RANGE) : 0, y0, h, RANGE) };
    startDrag();
    cv.setPointerCapture(e.pointerId);
    cv.style.cursor = "grabbing";
  }
  function onMove(e: PointerEvent) {
    const p = local(e);
    if (!drag) { setHover(hit(p.x, p.y)); return; }
    const { x0, y0, w, h } = geom();
    const b = bands()[drag.i];
    if (!b) return;
    const freq = Math.round(clamp(hzOfX(p.x - drag.dx, x0, w), F_MIN, F_MAX) * 10) / 10;
    if (hasGain(b.type)) updateBand(drag.i, { freq, gain: clamp(round1(dbOfY(p.y - drag.dy, y0, h, RANGE)), -RANGE, RANGE) });
    else updateBand(drag.i, { freq });
  }
  function onUp(e: PointerEvent) {
    if (!drag) return;
    drag = null;
    try { cv.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    cv.style.cursor = hover >= 0 ? "grab" : "";
    endDrag();
  }
  function onDbl(e: MouseEvent) {
    const p = local(e);
    const i = hit(p.x, p.y);
    if (i >= 0 && hasGain(bands()[i]!.type)) { selectBand(i); updateBand(i, { gain: 0 }); }
  }
  /** wheel = Q, Shift+wheel = fine gain; attached only while a node is under the pointer so empty-canvas wheel scrolling stays on the compositor */
  function onWheel(e: WheelEvent) {
    const i = hover;
    const b = bands()[i];
    if (!b) return;
    e.preventDefault();
    const dy = e.deltaY || e.deltaX;
    if (!dy) return;
    const steps = Math.max(1, Math.min(3, Math.round(Math.abs(dy) / 100)));
    selectBand(i);
    if (e.shiftKey) { if (hasGain(b.type)) updateBand(i, { gain: clamp(round1(b.gain + (dy < 0 ? 0.1 : -0.1) * steps), -24, 24) }); }
    else updateBand(i, { q: clamp(Math.round(b.q * Math.pow(1.1, dy < 0 ? steps : -steps) * 100) / 100, 0.1, 20) });
  }

  // ---- keyboard: Tab cycles bands; with a band selected, arrows move it (frontend-spec 5)
  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const sel = eqSelected(), n = bands().length;
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === "Tab") {
      const next = e.shiftKey ? (sel < 0 ? n - 1 : sel - 1) : sel + 1;
      if (next < 0 || next >= n) return; // leave the graph
      take(); selectBand(next);
      return;
    }
    if (!n) return;
    switch (e.key) {
      case "ArrowLeft": if (sel >= 0) { take(); nudgeFreq(-1, e.shiftKey); } break;
      case "ArrowRight": if (sel >= 0) { take(); nudgeFreq(1, e.shiftKey); } break;
      case "ArrowUp": take(); if (sel >= 0) nudgeGain(1, e.shiftKey); else selectBand(n - 1); break;
      case "ArrowDown": take(); if (sel >= 0) nudgeGain(-1, e.shiftKey); else selectBand(0); break;
      case "Escape": if (sel >= 0) { take(); selectBand(-1); } break;
      default: break;
    }
  }

  onMount(() => {
    const ro = new ResizeObserver(requestDraw);
    ro.observe(wrap);
    const mo = new MutationObserver(() => { colors = null; requestDraw(); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const onVis = () => { visible = document.visibilityState === "visible"; requestDraw(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("resize", requestDraw);
    onCleanup(() => {
      ro.disconnect(); mo.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", requestDraw);
      if (raf) cancelAnimationFrame(raf);
      if (wheelOn) cv.removeEventListener("wheel", onWheel);
    });
  });

  // redraw on change only
  createEffect(() => { eqState(); eqSelected(); eqCurve(); eqRev(); eqDragging(); props.height; props.spectrum(); props.active(); requestDraw(); });

  // the spectrum subscription lives only while the page is on screen, visible and the toggle is on
  createEffect(() => {
    if (!props.active() || !props.spectrum()) { spec = null; return; }
    const un = client.sub("eq", { spectrum: true }, (name, d) => {
      if (name !== "eq.spectrum" || !visible) return;
      const bin = atob(d.b64 as string);
      const a = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
      spec = a;
      requestDraw();
    });
    onCleanup(() => { un(); spec = null; requestDraw(); });
  });

  const label = () => {
    const b = bands()[eqSelected()];
    return b ? t("w2_eq_band_desc", eqSelected() + 1, Math.round(b.freq), b.gain.toFixed(1), b.q.toFixed(2)) : t("w2_eq_graph_hint");
  };

  return (
    <div class="eqp-graph" ref={wrap} tabindex="0" role="application" aria-label={t("w2_eq_graph")} aria-roledescription={t("w2_eq_graph")} data-testid="eq-graph" style={{ height: props.height + "px" }} onKeyDown={onKey}>
      <canvas ref={cv} data-testid="eq-canvas" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDblClick={onDbl} onPointerLeave={() => !drag && setHover(-1)} />
      <div class="eqp-sr" aria-live="polite" data-testid="eq-graph-desc">{label()}</div>
    </div>
  );
}
