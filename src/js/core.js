// ---------------------------------------------------------------------------
// Nameless Editing — core model, animation engine, easing and effect definitions
// ---------------------------------------------------------------------------

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, u) => a + (b - a) * u;
export const EPS = 1e-4;

let uidCounter = 0;
export function uid(prefix = 'id') {
  uidCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

export function fmtTime(t, withMs = true) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  const base = `${m}:${String(s).padStart(2, '0')}`;
  return withMs ? `${base}.${String(cs).padStart(2, '0')}` : base;
}

export function hexToRgb(hex) {
  if (!hex) return { r: 0, g: 0, b: 0 };
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgba(hex, a = 1) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(a, 0, 1)})`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TYPE_NAMES = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
  shape: 'Shape',
  solid: 'Solid',
};

export const BLEND_MODES = [
  ['source-over', 'Normal'],
  ['multiply', 'Multiply'],
  ['screen', 'Screen'],
  ['overlay', 'Overlay'],
  ['darken', 'Darken'],
  ['lighten', 'Lighten'],
  ['color-dodge', 'Color Dodge'],
  ['color-burn', 'Color Burn'],
  ['hard-light', 'Hard Light'],
  ['soft-light', 'Soft Light'],
  ['difference', 'Difference'],
  ['exclusion', 'Exclusion'],
  ['hue', 'Hue'],
  ['saturation', 'Saturation'],
  ['color', 'Color'],
  ['luminosity', 'Luminosity'],
  ['lighter', 'Add'],
];

export const SIZE_PRESETS = [
  { label: 'Vertical 1080 × 1920', w: 1080, h: 1920 },
  { label: 'Square 1080 × 1080', w: 1080, h: 1080 },
  { label: 'Portrait 1080 × 1350', w: 1080, h: 1350 },
  { label: 'Landscape 1920 × 1080', w: 1920, h: 1080 },
  { label: 'Landscape 1280 × 720', w: 1280, h: 720 },
  { label: 'Vertical 720 × 1280', w: 720, h: 1280 },
  { label: 'Custom', w: 0, h: 0 },
];

export const FONT_FAMILIES = [
  'Segoe UI',
  'Arial',
  'Verdana',
  'Tahoma',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Consolas',
  'Impact',
  'Comic Sans MS',
];

export const TRANSFORM_PROPS = [
  { key: 'x', label: 'Position X', min: -10000, max: 10000, step: 1, unit: 'px' },
  { key: 'y', label: 'Position Y', min: -10000, max: 10000, step: 1, unit: 'px' },
  { key: 'scale', label: 'Scale', min: 0, max: 10, step: 0.01, unit: '×' },
  { key: 'rotation', label: 'Rotation', min: -3600, max: 3600, step: 0.1, unit: '°' },
  { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 0.1, unit: '%' },
];

// ---------------------------------------------------------------------------
// Project / layer factories
// ---------------------------------------------------------------------------

export function createProject() {
  return {
    version: 1,
    name: 'Untitled',
    width: 1080,
    height: 1920,
    fps: 30,
    duration: 8,
    background: '#0b0b10',
    layers: [],
  };
}

export function createLayer(type, project, extra = {}) {
  const cx = Math.round(project.width / 2);
  const cy = Math.round(project.height / 2);

  const base = {
    id: uid('layer'),
    type,
    name: TYPE_NAMES[type] || 'Layer',
    visible: true,
    locked: false,
    blend: 'source-over',
    start: 0,
    end: project.duration,
    transform: { x: cx, y: cy, scale: 1, rotation: 0, opacity: 100 },
    keyframes: {},
    effects: [],
  };

  if (type === 'text') {
    base.text = {
      content: 'Your text',
      fontFamily: 'Segoe UI',
      fontSize: Math.round(project.width / 9),
      fontWeight: 700,
      italic: false,
      color: '#ffffff',
      align: 'center',
      lineHeight: 1.18,
      maxWidth: Math.round(project.width * 0.82),
      letterSpacing: 0,
      strokeWidth: 0,
      strokeColor: '#000000',
      shadow: false,
      shadowColor: '#000000',
      shadowBlur: 24,
      shadowX: 0,
      shadowY: 8,
    };
  }

  if (type === 'shape' || type === 'solid') {
    base.shape = {
      kind: type === 'solid' ? 'rect' : 'rect',
      width: type === 'solid' ? project.width : Math.round(project.width * 0.5),
      height: type === 'solid' ? project.height : Math.round(project.width * 0.5),
      radius: type === 'solid' ? 0 : 24,
      sides: 5,
      fill: type === 'solid' ? '#7c5cff' : '#7c5cff',
      stroke: '#ffffff',
      strokeWidth: 0,
    };
  }

  if (type === 'image' || type === 'video') {
    base.src = extra.src || '';
    base.mediaName = extra.mediaName || '';
    base.mediaW = extra.mediaW || 0;
    base.mediaH = extra.mediaH || 0;
    base.width = extra.width || 0;
    base.height = extra.height || 0;
    base.fit = 'contain';
    base.speed = 1;
    base.volume = 1;
    base.sourceStart = 0;
  }

  if (type === 'video' || extra.src) {
    base.sourceStart = 0;
  }

  return Object.assign(base, extra.override || {});
}

export function fitSizeToComp(w, h, comp) {
  if (!w || !h) return { w: comp.width * 0.6, h: comp.width * 0.6 };
  const maxW = comp.width * 0.9;
  const maxH = comp.height * 0.9;
  const s = Math.min(1, maxW / w, maxH / h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

// ---------------------------------------------------------------------------
// Easing (cubic bezier defined in normalized 0..1 space)
// ---------------------------------------------------------------------------

export const EASE_PRESETS = [
  { id: 'linear', label: 'Linear', p: [0, 0, 1, 1] },
  { id: 'ease-in', label: 'Ease In', p: [0.42, 0, 1, 1] },
  { id: 'ease-out', label: 'Ease Out', p: [0, 0, 0.58, 1] },
  { id: 'ease-in-out', label: 'Ease In Out', p: [0.42, 0, 0.58, 1] },
  { id: 'smooth', label: 'Smooth', p: [0.45, 0, 0.25, 1] },
  { id: 'snappy', label: 'Snappy', p: [0.2, 0, 0, 1] },
  { id: 'back', label: 'Overshoot', p: [0.34, 1.56, 0.64, 1] },
  { id: 'anticipate', label: 'Anticipate', p: [0.36, 0, 0.66, -0.56] },
];

export function defaultEase() {
  return { type: 'bezier', p: [0.42, 0, 0.58, 1] };
}

export function easePreset(id) {
  const preset = EASE_PRESETS.find((e) => e.id === id);
  if (!preset) return defaultEase();
  if (id === 'linear') return { type: 'linear', p: [0, 0, 1, 1] };
  return { type: 'bezier', p: preset.p.slice() };
}

const bezierX = (t, x1, x2) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
const bezierY = (t, y1, y2) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;

function solveBezierT(x, x1, x2) {
  let t = x;
  for (let i = 0; i < 8; i++) {
    const err = bezierX(t, x1, x2) - x;
    if (Math.abs(err) < 1e-6) return clamp(t, 0, 1);
    const d = 3 * (1 - t) * (1 - t) * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t * t * (1 - x2);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (bezierX(mid, x1, x2) < x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function easeValue(ease, u) {
  if (!ease) return u;
  if (ease.type === 'hold') return 0;
  const p = ease.p || [0, 0, 1, 1];
  if (p[0] === 0 && p[1] === 0 && p[2] === 1 && p[3] === 1) return u;
  const t = solveBezierT(clamp(u, 0, 1), p[0], p[2]);
  return bezierY(t, p[1], p[3]);
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------

export function getKeyframes(layer, path) {
  return layer.keyframes?.[path] || null;
}

export function isAnimated(layer, path) {
  const kfs = layer.keyframes?.[path];
  return !!(kfs && kfs.length > 0);
}

export function keyframeAt(layer, path, t, tol = 1e-3) {
  const kfs = layer.keyframes?.[path];
  if (!kfs) return null;
  return kfs.find((k) => Math.abs(k.t - t) <= tol) || null;
}

export function setKeyframe(layer, path, t, v) {
  if (!layer.keyframes) layer.keyframes = {};
  if (!layer.keyframes[path]) layer.keyframes[path] = [];
  const kfs = layer.keyframes[path];
  const tt = Math.round(t * 1000) / 1000;
  const existing = kfs.find((k) => Math.abs(k.t - tt) <= 1e-3);
  if (existing) {
    existing.v = v;
    return existing;
  }
  const kf = { t: tt, v, ease: defaultEase() };
  kfs.push(kf);
  kfs.sort((a, b) => a.t - b.t);
  return kf;
}

export function removeKeyframe(layer, path, t, tol = 1e-3) {
  const kfs = layer.keyframes?.[path];
  if (!kfs) return false;
  const i = kfs.findIndex((k) => Math.abs(k.t - t) <= tol);
  if (i < 0) return false;
  kfs.splice(i, 1);
  if (!kfs.length) delete layer.keyframes[path];
  return true;
}

export function toggleKeyframe(layer, path, t) {
  if (isAnimated(layer, path) && keyframeAt(layer, path, t)) {
    removeKeyframe(layer, path, t);
    return false;
  }
  setKeyframe(layer, path, t, getValue(layer, path, t));
  return true;
}

export function keyframeTimes(layer) {
  const set = new Map();
  for (const kfs of Object.values(layer.keyframes || {})) {
    for (const k of kfs) {
      const key = Math.round(k.t * 1000);
      if (!set.has(key)) set.set(key, k.t);
    }
  }
  return [...set.values()].sort((a, b) => a - b);
}

export function animatedPaths(layer) {
  return Object.keys(layer.keyframes || {}).filter((p) => layer.keyframes[p] && layer.keyframes[p].length);
}

export function keyframesInRange(layer, path, t0, t1) {
  const kfs = layer.keyframes?.[path] || [];
  return kfs.filter((k) => k.t >= t0 - 1e-6 && k.t <= t1 + 1e-6);
}

// ---------------------------------------------------------------------------
// Value access
// ---------------------------------------------------------------------------

export function getBaseValue(layer, path) {
  const parts = path.split('.');
  if (parts[0] === 'effect') {
    const ef = (layer.effects || []).find((e) => e.id === parts[1]);
    if (!ef || !ef.params) return 0;
    const v = ef.params[parts[2]];
    return typeof v === 'number' ? v : 0;
  }
  let o = layer;
  for (const p of parts) {
    if (o == null) return 0;
    o = o[p];
  }
  return typeof o === 'number' ? o : 0;
}

export function setBaseValue(layer, path, value) {
  const parts = path.split('.');
  if (parts[0] === 'effect') {
    const ef = (layer.effects || []).find((e) => e.id === parts[1]);
    if (ef && ef.params) ef.params[parts[2]] = value;
    return;
  }
  let o = layer;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null) o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}

/** Resolve an animatable value at time t. */
export function getValue(layer, path, t) {
  const kfs = layer.keyframes?.[path];
  if (!kfs || kfs.length === 0) return getBaseValue(layer, path);
  if (kfs.length === 1) return kfs[0].v;

  const first = kfs[0];
  if (t <= first.t) return first.v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;

  let lo = 0;
  let hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = kfs[lo];
  const b = kfs[hi];
  if (a.ease && a.ease.type === 'hold') return a.v;
  const span = b.t - a.t;
  const u = span > 1e-9 ? (t - a.t) / span : 1;
  return a.v + (b.v - a.v) * easeValue(a.ease, u);
}

/** Returns {a, b, u} describing the active segment for a path at time t. */
export function getSegment(layer, path, t) {
  const kfs = layer.keyframes?.[path];
  if (!kfs || kfs.length < 2) return null;
  if (t <= kfs[0].t || t >= kfs[kfs.length - 1].t) return null;
  let lo = 0;
  let hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = kfs[lo];
  const b = kfs[hi];
  const span = b.t - a.t;
  return { a, b, u: span > 1e-9 ? (t - a.t) / span : 1 };
}

export function setAnimatable(layer, path, value, t, autoKey = true) {
  if (autoKey && isAnimated(layer, path)) {
    setKeyframe(layer, path, t, value);
  } else {
    setBaseValue(layer, path, value);
  }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export const EFFECT_DEFS = {
  blur: {
    label: 'Blur',
    group: 'Stylize',
    params: [{ key: 'radius', label: 'Radius', min: 0, max: 150, step: 0.5, def: 12, unit: 'px' }],
  },
  glow: {
    label: 'Glow',
    group: 'Stylize',
    params: [
      { key: 'radius', label: 'Radius', min: 0, max: 150, step: 0.5, def: 28, unit: 'px' },
      { key: 'intensity', label: 'Intensity', min: 0, max: 100, step: 1, def: 65, unit: '%' },
    ],
  },
  shadow: {
    label: 'Drop Shadow',
    group: 'Stylize',
    params: [
      { key: 'x', label: 'Offset X', min: -200, max: 200, step: 1, def: 0, unit: 'px' },
      { key: 'y', label: 'Offset Y', min: -200, max: 200, step: 1, def: 14, unit: 'px' },
      { key: 'blur', label: 'Softness', min: 0, max: 150, step: 0.5, def: 30, unit: 'px' },
      { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, def: 55, unit: '%' },
      { key: 'color', label: 'Color', type: 'color', def: '#000000' },
    ],
  },
  brightness: {
    label: 'Brightness',
    group: 'Color',
    params: [{ key: 'amount', label: 'Amount', min: -100, max: 100, step: 1, def: 0, unit: '%' }],
  },
  contrast: {
    label: 'Contrast',
    group: 'Color',
    params: [{ key: 'amount', label: 'Amount', min: -100, max: 100, step: 1, def: 0, unit: '%' }],
  },
  saturation: {
    label: 'Saturation',
    group: 'Color',
    params: [{ key: 'amount', label: 'Amount', min: -100, max: 200, step: 1, def: 0, unit: '%' }],
  },
  hue: {
    label: 'Hue Shift',
    group: 'Color',
    params: [{ key: 'amount', label: 'Rotate', min: -180, max: 180, step: 1, def: 0, unit: '°' }],
  },
  grayscale: {
    label: 'Grayscale',
    group: 'Color',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, def: 100, unit: '%' }],
  },
  invert: {
    label: 'Invert',
    group: 'Color',
    params: [{ key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, def: 100, unit: '%' }],
  },
  tint: {
    label: 'Color Tint',
    group: 'Color',
    params: [
      { key: 'color', label: 'Color', type: 'color', def: '#ff2d55' },
      { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, def: 35, unit: '%' },
    ],
  },
  chroma: {
    label: 'Chroma Key',
    group: 'Keying',
    params: [
      { key: 'color', label: 'Key Color', type: 'color', def: '#00ff00' },
      { key: 'tolerance', label: 'Tolerance', min: 0, max: 100, step: 1, def: 38, unit: '%' },
      { key: 'softness', label: 'Softness', min: 0, max: 100, step: 1, def: 12, unit: '%' },
      { key: 'spill', label: 'Spill', min: 0, max: 100, step: 1, def: 30, unit: '%' },
    ],
  },
};

export function createEffect(type) {
  const def = EFFECT_DEFS[type];
  if (!def) return null;
  const params = {};
  for (const p of def.params) params[p.key] = p.def;
  return { id: uid('fx'), type, enabled: true, params };
}

export const EFFECT_GROUPS = ['Stylize', 'Color', 'Keying'];

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class Store {
  constructor() {
    this.project = createProject();
    this.time = 0;
    this.selection = [];
    this.playing = false;
    this.dirty = false;
    this.filePath = null;
    this.undoStack = [];
    this.redoStack = [];
    this._dragSnap = null;
    this._bus = new EventTarget();
    this._renderScale = 1;
  }

  on(event, fn) {
    const handler = (e) => fn(e.detail);
    this._bus.addEventListener(event, handler);
    return () => this._bus.removeEventListener(event, handler);
  }

  emit(event, detail = null) {
    this._bus.dispatchEvent(new CustomEvent(event, { detail }));
  }

  get selectedLayer() {
    if (!this.selection.length) return null;
    return this.project.layers.find((l) => l.id === this.selection[0]) || null;
  }

  setProject(project) {
    this.project = project;
    this.selection = [];
    this.time = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    this.emit('project');
    this.emit('time');
    this.emit('history');
  }

  snapshot() {
    return JSON.stringify(this.project);
  }

  act(fn) {
    const snap = this.snapshot();
    fn();
    if (this.snapshot() === snap) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack.length = 0;
    this.dirty = true;
    this.emit('history');
  }

  begin() {
    if (this._dragSnap === null) this._dragSnap = this.snapshot();
  }

  cancel() {
    this._dragSnap = null;
  }

  end() {
    if (this._dragSnap === null) return;
    const snap = this._dragSnap;
    this._dragSnap = null;
    if (snap === this.snapshot()) return;
    this.undoStack.push(snap);
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack.length = 0;
    this.dirty = true;
    this.emit('history');
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snapshot());
    this.project = JSON.parse(this.undoStack.pop());
    this._fixSelection();
    this.dirty = true;
    this.emit('project');
    this.emit('time');
    this.emit('history');
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snapshot());
    this.project = JSON.parse(this.redoStack.pop());
    this._fixSelection();
    this.dirty = true;
    this.emit('project');
    this.emit('time');
    this.emit('history');
  }

  _fixSelection() {
    this.selection = this.selection.filter((id) => this.project.layers.some((l) => l.id === id));
    this.time = clamp(this.time, 0, this.project.duration);
  }

  select(id) {
    this.selection = id ? [id] : [];
    this.emit('selection');
  }

  addLayer(layer, select = true) {
    this.act(() => {
      this.project.layers.unshift(layer);
    });
    if (select) this.selection = [layer.id];
    this.emit('project');
    this.emit('selection');
  }

  removeLayer(id) {
    this.act(() => {
      this.project.layers = this.project.layers.filter((l) => l.id !== id);
    });
    this.selection = this.selection.filter((s) => s !== id);
    this.emit('project');
    this.emit('selection');
  }

  duplicateLayer(id) {
    const src = this.project.layers.find((l) => l.id === id);
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid('layer');
    copy.name = `${src.name} copy`;

    const idMap = new Map();
    copy.effects = (copy.effects || []).map((e) => {
      const nid = uid('fx');
      idMap.set(e.id, nid);
      return { ...e, id: nid };
    });

    const newKfs = {};
    for (const [path, kfs] of Object.entries(copy.keyframes || {})) {
      const parts = path.split('.');
      if (parts[0] === 'effect' && idMap.has(parts[1])) {
        newKfs[`effect.${idMap.get(parts[1])}.${parts[2]}`] = kfs;
      } else {
        newKfs[path] = kfs;
      }
    }
    copy.keyframes = newKfs;

    this.act(() => {
      const idx = this.project.layers.findIndex((l) => l.id === id);
      this.project.layers.splice(Math.max(0, idx), 0, copy);
    });
    this.selection = [copy.id];
    this.emit('project');
    this.emit('selection');
  }

  moveLayer(id, toIndex) {
    const from = this.project.layers.findIndex((l) => l.id === id);
    if (from < 0) return;
    const clamped = clamp(toIndex, 0, this.project.layers.length - 1);
    if (from === clamped) return;
    this.act(() => {
      const [l] = this.project.layers.splice(from, 1);
      this.project.layers.splice(clamped, 0, l);
    });
    this.emit('project');
  }

  setTime(t, emit = true) {
    this.time = clamp(t, 0, this.project.duration);
    if (emit) this.emit('time');
  }

  setPlaying(v) {
    this.playing = v;
    this.emit('play');
  }
}

export const store = new Store();

// ---------------------------------------------------------------------------

export function clampLayerToProject(layer, project) {
  layer.start = clamp(layer.start, 0, project.duration);
  layer.end = clamp(layer.end, layer.start + 0.05, project.duration);
}

export function projectDurationFromLayers(project) {
  let end = 0;
  for (const l of project.layers) end = Math.max(end, l.end || 0);
  return end;
}
