// ---------------------------------------------------------------------------
// MotionForge — keyframe graph editor (bezier curve editing)
// ---------------------------------------------------------------------------

import {
  store,
  clamp,
  getValue,
  getKeyframes,
  animatedPaths,
  setKeyframe,
  easePreset,
  EASE_PRESETS,
  EFFECT_DEFS,
  TRANSFORM_PROPS,
  fmtTime,
} from './core.js';
import { el, $, contextMenu, toast, PATHS_COLORS } from './ui.js';

const M = { left: 54, right: 20, top: 18, bottom: 24 };

let canvas;
let ctx;
let wrap;
let W = 800;
let H = 260;
let selectedPath = null;
let selectedKf = null;
let drag = null;
let domain = { min: 0, max: 1 };
let plot = { x: 0, y: 0, w: 0, h: 0 };
let latest = { time: 0, value: 0, inside: false };

export function initGraph() {
  canvas = $('#graphCanvas');
  ctx = canvas.getContext('2d');
  wrap = $('#graphCanvasWrap');

  new ResizeObserver(() => {
    resize();
    draw();
  }).observe(wrap);

  store.on('project', () => {
    ensureSelected();
    buildChips();
    draw();
  });
  store.on('selection', () => {
    ensureSelected();
    buildChips();
    draw();
  });
  store.on('time', draw);
  store.on('transform', draw);
  store.on('history', buildChips);

  window.addEventListener('mf:graph-refresh', () => {
    ensureSelected();
    buildChips();
    draw();
  });
  window.addEventListener('mf:graph-mode', (e) => {
    if (e.detail) {
      resize();
      buildChips();
      draw();
    }
  });

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', () => {
    latest.inside = false;
    draw();
  });
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('contextmenu', onContextMenu);

  buildChips();
  resize();
  draw();
}

// ---------------------------------------------------------------------------

function resize() {
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  W = Math.max(80, Math.floor(rect.width));
  H = Math.max(80, Math.floor(rect.height));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function plotRect() {
  return { x: M.left, y: M.top, w: Math.max(10, W - M.left - M.right), h: Math.max(10, H - M.top - M.bottom) };
}

const timeToX = (t) => plot.x + (t / Math.max(0.001, store.project.duration)) * plot.w;
const xToTime = (x) => clamp(((x - plot.x) / plot.w) * store.project.duration, 0, store.project.duration);
const valueToY = (v) => plot.y + plot.h - ((v - domain.min) / Math.max(1e-9, domain.max - domain.min)) * plot.h;
const yToValue = (y) => domain.min + ((plot.y + plot.h - y) / plot.h) * (domain.max - domain.min);

function propLabel(path) {
  const layer = store.selectedLayer;
  if (!layer) return path;
  if (path.startsWith('effect.')) {
    const [, id, key] = path.split('.');
    const ef = (layer.effects || []).find((e) => e.id === id);
    if (!ef) return 'Effect';
    const def = EFFECT_DEFS[ef.type];
    const prm = def?.params?.find((p) => p.key === key);
    return `${def?.label || ef.type} · ${prm?.label || key}`;
  }
  const found = TRANSFORM_PROPS.find((p) => `transform.${p.key}` === path);
  return found ? found.label : path.replace('transform.', '');
}

function pathColor(path, layer) {
  const paths = animatedPaths(layer);
  const i = paths.indexOf(path);
  return PATHS_COLORS[(i < 0 ? 0 : i) % PATHS_COLORS.length];
}

function ensureSelected() {
  const layer = store.selectedLayer;
  if (!layer) {
    selectedPath = null;
    selectedKf = null;
    return;
  }
  const paths = animatedPaths(layer);
  if (!selectedPath || !paths.includes(selectedPath)) {
    selectedPath = paths[0] || null;
    selectedKf = null;
  }
  if (selectedKf && selectedPath) {
    const kfs = getKeyframes(layer, selectedPath) || [];
    if (!kfs.includes(selectedKf)) selectedKf = null;
  }
}

// ---------------------------------------------------------------------------

function buildChips() {
  const host = $('#graphProps');
  if (!host) return;
  host.innerHTML = '';
  const layer = store.selectedLayer;
  const paths = layer ? animatedPaths(layer) : [];

  if (!paths.length) {
    $('#graphEmpty').hidden = false;
    return;
  }
  $('#graphEmpty').hidden = true;

  for (const path of paths) {
    const active = path === selectedPath;
    const chip = el(
      'button',
      {
        class: `prop-chip ${active ? 'active' : ''}`,
        style: { color: pathColor(path, layer) },
        onclick: () => {
          selectedPath = path;
          selectedKf = null;
          buildChips();
          draw();
        },
      },
      el('span', { class: 'swatch' }),
      el('span', { text: propLabel(path) })
    );
    host.append(chip);
  }

  buildEaseButtons();
}

function buildEaseButtons() {
  const host = $('#graphEase');
  if (!host) return;
  host.innerHTML = '';
  for (const preset of EASE_PRESETS) {
    host.append(
      el('button', {
        text: preset.label,
        title: `Apply ${preset.label} to the selected keyframe`,
        onclick: () => applyEase(preset.id),
      })
    );
  }
  host.append(el('button', { text: 'Hold', title: 'Hold value until next keyframe', onclick: () => applyEase('hold') }));
}

function applyEase(id) {
  const layer = store.selectedLayer;
  if (!layer || !selectedPath || !selectedKf) {
    toast('Select a keyframe first', '', 1800);
    return;
  }
  const ease = id === 'hold' ? { type: 'hold', p: [0, 0, 1, 1] } : easePreset(id);
  store.act(() => {
    selectedKf.ease = ease;
  });
  store.emit('project');
}

// ---------------------------------------------------------------------------

function computeDomain(layer, path) {
  const kfs = getKeyframes(layer, path);
  if (!kfs || !kfs.length) return { min: 0, max: 1 };
  const t0 = kfs[0].t;
  const t1 = kfs[kfs.length - 1].t;
  let min = Infinity;
  let max = -Infinity;
  const N = 260;
  for (let i = 0; i <= N; i++) {
    const t = t0 + ((t1 - t0) * i) / N;
    const v = getValue(layer, path, t);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (max - min < 1e-6) {
    const pad = Math.max(1, Math.abs(max) * 0.15);
    return { min: min - pad, max: max + pad };
  }
  const pad = (max - min) * 0.18;
  return { min: min - pad, max: max + pad };
}

function fmtValue(v) {
  const a = Math.abs(v);
  if (a >= 10000) return `${(v / 1000).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function draw() {
  if (!ctx) return;
  const layer = store.selectedLayer;
  const path = selectedPath;
  ctx.clearRect(0, 0, W, H);

  // background
  ctx.fillStyle = '#0b0e15';
  ctx.fillRect(0, 0, W, H);

  if (!layer || !path) {
    drawGridOnly();
    return;
  }
  const kfs = getKeyframes(layer, path) || [];
  if (!kfs.length) {
    drawGridOnly();
    return;
  }

  plot = plotRect();
  domain = computeDomain(layer, path);

  const color = pathColor(path, layer);

  // ---- grid --------------------------------------------------------------
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.055)';
  ctx.lineWidth = 1;
  ctx.font = '9px "Segoe UI", sans-serif';
  ctx.fillStyle = '#5b6178';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= 4; i++) {
    const y = plot.y + (plot.h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(plot.x, y + 0.5);
    ctx.lineTo(plot.x + plot.w, y + 0.5);
    ctx.stroke();
    const v = yToValue(y);
    ctx.fillText(fmtValue(v), plot.x - 8, y);
  }

  const dur = store.project.duration;
  let step = 1;
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]) {
    if (s * (plot.w / dur) >= 70) {
      step = s;
      break;
    }
    step = s;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let t = 0; t <= dur + 1e-6; t += step) {
    const x = timeToX(t);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, plot.y);
    ctx.lineTo(x + 0.5, plot.y + plot.h);
    ctx.stroke();
    ctx.fillText(`${step >= 1 ? Math.round(t) + 's' : t.toFixed(2) + 's'}`, x, plot.y + plot.h + 6);
  }

  // ---- curve -------------------------------------------------------------
  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.x, plot.y - 4, plot.w, plot.h + 8);
  ctx.clip();

  ctx.beginPath();
  const steps = Math.max(80, Math.floor(plot.w));
  for (let i = 0; i <= steps; i++) {
    const t = (dur * i) / steps;
    const v = getValue(layer, path, t);
    const x = timeToX(t);
    const y = valueToY(v);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.restore();

  // ---- keyframes ---------------------------------------------------------
  for (const kf of kfs) {
    const x = timeToX(kf.t);
    const y = valueToY(kf.v);
    const isSel = kf === selectedKf;
    ctx.beginPath();
    ctx.arc(x, y, isSel ? 5.5 : 4, 0, Math.PI * 2);
    ctx.fillStyle = isSel ? '#ffffff' : '#111420';
    ctx.strokeStyle = isSel ? color : color;
    ctx.lineWidth = isSel ? 2.5 : 1.8;
    ctx.fill();
    ctx.stroke();
  }

  // ---- bezier handles for the selected keyframe --------------------------
  if (selectedKf) {
    const i = kfs.indexOf(selectedKf);
    const { out, inp } = handlePoints(kfs, i);
    ctx.lineWidth = 1.2;

    for (const [pt, role] of [
      [out, 'out'],
      [inp, 'in'],
    ]) {
      if (!pt) continue;
      ctx.beginPath();
      ctx.moveTo(timeToX(selectedKf.t), valueToY(selectedKf.v));
      ctx.lineTo(pt.x, pt.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#1b2030';
      ctx.strokeStyle = role === 'out' ? '#ffd166' : '#59e2b4';
      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();
    }
  }

  // ---- playhead ----------------------------------------------------------
  const px = timeToX(store.time);
  ctx.beginPath();
  ctx.moveTo(px + 0.5, plot.y - 8);
  ctx.lineTo(px + 0.5, plot.y + plot.h);
  ctx.strokeStyle = 'rgba(255,77,141,0.85)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const cv = getValue(layer, path, store.time);
  const cy = valueToY(cv);
  ctx.beginPath();
  ctx.arc(px, cy, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ff4d8d';
  ctx.fill();

  // ---- readouts ----------------------------------------------------------
  const info = $('#graphValue');
  if (info) {
    info.textContent = `${propLabel(path)}  ·  t=${fmtTime(store.time)}  ·  ${fmtValue(cv)}`;
  }

  if (latest.inside) {
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.beginPath();
    ctx.moveTo(latest.x, plot.y);
    ctx.lineTo(latest.x, plot.y + plot.h);
    ctx.stroke();
  }
}

function drawGridOnly() {
  plot = plotRect();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = plot.y + (plot.h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(plot.x, y + 0.5);
    ctx.lineTo(plot.x + plot.w, y + 0.5);
    ctx.stroke();
  }
  const px = timeToX(store.time);
  ctx.beginPath();
  ctx.moveTo(px + 0.5, plot.y);
  ctx.lineTo(px + 0.5, plot.y + plot.h);
  ctx.strokeStyle = 'rgba(255,77,141,0.5)';
  ctx.stroke();
}

function handlePoints(kfs, i) {
  if (i < 0) return {};
  const kf = kfs[i];
  let out = null;
  let inp = null;

  if (i < kfs.length - 1) {
    const b = kfs[i + 1];
    const p = kf.ease?.p || [0, 0, 1, 1];
    if (kf.ease?.type !== 'hold') {
      out = {
        x: timeToX(kf.t + p[0] * (b.t - kf.t)),
        y: valueToY(kf.v + p[1] * (b.v - kf.v)),
        seg: { a: kf, b, which: 'out' },
      };
    }
  }
  if (i > 0) {
    const a = kfs[i - 1];
    const p = a.ease?.p || [0, 0, 1, 1];
    if (a.ease?.type !== 'hold') {
      inp = {
        x: timeToX(a.t + p[2] * (kf.t - a.t)),
        y: valueToY(a.v + p[3] * (kf.v - a.v)),
        seg: { a, b: kf, which: 'in' },
      };
    }
  }
  return { out, inp };
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function hitTest(x, y) {
  const layer = store.selectedLayer;
  if (!layer || !selectedPath) return null;
  const kfs = getKeyframes(layer, selectedPath) || [];
  if (!kfs.length) return null;

  if (selectedKf) {
    const i = kfs.indexOf(selectedKf);
    const { out, inp } = handlePoints(kfs, i);
    for (const pt of [out, inp]) {
      if (pt && Math.hypot(pt.x - x, pt.y - y) < 9) {
        return { kind: 'handle', seg: pt.seg };
      }
    }
  }

  let best = null;
  let bestD = 12;
  for (const kf of kfs) {
    const d = Math.hypot(timeToX(kf.t) - x, valueToY(kf.v) - y);
    if (d < bestD) {
      bestD = d;
      best = kf;
    }
  }
  if (best) return { kind: 'kf', kf: best };

  return null;
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  const { x, y } = canvasPos(e);
  const hit = hitTest(x, y);

  if (hit) {
    e.preventDefault();
    const layer = store.selectedLayer;
    const kfs = getKeyframes(layer, selectedPath);

    if (hit.kind === 'kf') {
      selectedKf = hit.kf;
      const t0 = hit.kf.t;
      const v0 = hit.kf.v;
      const x0 = x;
      const y0 = y;
      let moved = false;
      store.begin();

      const move = (ev) => {
        const p = canvasPos(ev);
        const dt = (p.x - x0) / plot.w * store.project.duration;
        const dv = yToValue(p.y) - yToValue(y0);
        hit.kf.t = clamp(Math.round((t0 + dt) * 1000) / 1000, 0, store.project.duration);
        hit.kf.v = Math.round((v0 + dv) * 1000) / 1000;
        kfs.sort((a, b) => a.t - b.t);
        moved = true;
        store.emit('transform');
        draw();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) store.end();
        else store.cancel();
        store.emit('project');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      draw();
      return;
    }

    if (hit.kind === 'handle') {
      const { a, b, which } = hit.seg;
      const ease = a.ease && a.ease.type !== 'hold' ? a.ease : { type: 'bezier', p: [0.33, 0, 0.67, 1] };
      a.ease = ease;
      const x0 = x;
      const y0 = y;
      const p0 = ease.p.slice();
      let moved = false;
      store.begin();

      const move = (ev) => {
        const p = canvasPos(ev);
        const dt = ((p.x - x0) / plot.w) * store.project.duration;
        const dv = yToValue(p.y) - yToValue(y0);
        const spanT = b.t - a.t;
        const spanV = b.v - a.v;
        if (which === 'out') {
          const nx = ((xToTime(x0) + dt) - a.t) / Math.max(1e-6, spanT);
          const ny = ((yToValue(y0) + dv) - a.v) / (Math.abs(spanV) < 1e-6 ? 1 : spanV);
          ease.p[0] = clamp(nx, 0, 1);
          ease.p[1] = clamp(ny, -3, 4);
        } else {
          const nx = ((xToTime(x0) + dt) - a.t) / Math.max(1e-6, spanT);
          const ny = ((yToValue(y0) + dv) - a.v) / (Math.abs(spanV) < 1e-6 ? 1 : spanV);
          ease.p[2] = clamp(nx, 0, 1);
          ease.p[3] = clamp(ny, -3, 4);
        }
        moved = true;
        store.emit('transform');
        draw();
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) store.end();
        else store.cancel();
        store.emit('project');
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }
  }

  selectedKf = null;
  const t = xToTime(x);
  store.setTime(t);
  draw();
}

function onPointerMove(e) {
  const { x, y } = canvasPos(e);
  latest = { x, y, inside: true };
  const hit = hitTest(x, y);
  canvas.style.cursor = hit ? (hit.kind === 'handle' ? 'grabbing' : 'grab') : 'crosshair';
  draw();
}

function onDoubleClick(e) {
  const layer = store.selectedLayer;
  if (!layer || !selectedPath) return;
  const { x } = canvasPos(e);
  const t = Math.round(xToTime(x) * 1000) / 1000;
  const v = getValue(layer, selectedPath, t);
  store.act(() => {
    setKeyframe(layer, selectedPath, t, v);
  });
  store.emit('project');
  toast(`Keyframe added at ${fmtTime(t)}`, 'ok', 1600);
}

function onContextMenu(e) {
  const layer = store.selectedLayer;
  if (!layer || !selectedPath) return;
  e.preventDefault();
  const { x, y } = canvasPos(e);
  const kfs = getKeyframes(layer, selectedPath) || [];
  let best = null;
  let bestD = 14;
  for (const kf of kfs) {
    const d = Math.hypot(timeToX(kf.t) - x, valueToY(kf.v) - y);
    if (d < bestD) {
      bestD = d;
      best = kf;
    }
  }

  const items = [];
  if (best) {
    items.push({
      label: 'Delete keyframe',
      danger: true,
      action: () => {
        store.act(() => {
          const arr = getKeyframes(layer, selectedPath);
          const idx = arr.indexOf(best);
          if (idx >= 0) arr.splice(idx, 1);
          if (!arr.length) delete layer.keyframes[selectedPath];
        });
        selectedKf = null;
        store.emit('project');
      },
    });
    items.push({ sep: true });
    items.push({
      label: 'Linear easing',
      action: () => {
        selectedKf = best;
        applyEase('linear');
      },
    });
    items.push({
      label: 'Smooth easing',
      action: () => {
        selectedKf = best;
        applyEase('smooth');
      },
    });
  } else {
    const t = Math.round(xToTime(x) * 1000) / 1000;
    items.push({
      label: 'Add keyframe here',
      action: () => {
        store.act(() => setKeyframe(layer, selectedPath, t, getValue(layer, selectedPath, t)));
        store.emit('project');
      },
    });
  }
  if (items.length) contextMenu(e.clientX, e.clientY, items);
}

export function resetGraphSelection() {
  selectedKf = null;
  ensureSelected();
  buildChips();
  draw();
}

// Debug / automation bridge for the graph editor.
window.__mfGraph = {
  state() {
    const layer = store.selectedLayer;
    const kfs = layer && selectedPath ? getKeyframes(layer, selectedPath) || [] : [];
    const i = selectedKf ? kfs.indexOf(selectedKf) : -1;
    const hp = i >= 0 ? handlePoints(kfs, i) : {};
    return {
      plot,
      domain,
      W,
      H,
      selectedPath,
      selected: selectedKf ? { t: selectedKf.t, v: selectedKf.v } : null,
      points: kfs.map((k) => ({ t: k.t, v: k.v, x: timeToX(k.t), y: valueToY(k.v) })),
      handles: {
        out: hp.out ? { x: hp.out.x, y: hp.out.y } : null,
        in: hp.inp ? { x: hp.inp.x, y: hp.inp.y } : null,
      },
      ease: selectedKf && selectedKf.ease ? JSON.parse(JSON.stringify(selectedKf.ease)) : null,
    };
  },
  xFor(t) {
    return timeToX(t);
  },
  yFor(v) {
    return valueToY(v);
  },
};
