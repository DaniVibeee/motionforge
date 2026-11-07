// ---------------------------------------------------------------------------
// MotionForge — compositor / render engine
// ---------------------------------------------------------------------------

import {
  store,
  getValue,
  getBaseValue,
  clamp,
  hexToRgb,
  rgba,
  EFFECT_DEFS,
} from './core.js';

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export const mediaCache = {
  images: new Map(),
  videos: new Map(),
};

export function mediaUrl(p) {
  if (!p) return '';
  if (/^(https?:|data:|blob:|media:|file:)/i.test(p)) return p;
  const norm = p.replace(/\\/g, '/');
  return 'media://local/' + norm.split('/').map(encodeURIComponent).join('/');
}

export function getImage(path) {
  if (!path) return null;
  if (mediaCache.images.has(path)) return mediaCache.images.get(path);
  const entry = { img: new Image(), ready: false, error: false, w: 0, h: 0 };
  entry.img.onload = () => {
    entry.ready = true;
    entry.w = entry.img.naturalWidth;
    entry.h = entry.img.naturalHeight;
    window.dispatchEvent(new CustomEvent('mf:media'));
  };
  entry.img.onerror = () => {
    entry.error = true;
    window.dispatchEvent(new CustomEvent('mf:media'));
  };
  entry.img.src = mediaUrl(path);
  mediaCache.images.set(path, entry);
  return entry;
}

export function getVideo(path) {
  if (!path) return null;
  if (mediaCache.videos.has(path)) return mediaCache.videos.get(path);
  const el = document.createElement('video');
  el.src = mediaUrl(path);
  el.preload = 'auto';
  el.playsInline = true;
  el.loop = false;
  el.muted = false;
  el.volume = 1;
  el.crossOrigin = 'anonymous';
  const entry = { el, ready: false, error: false, w: 0, h: 0, duration: 0 };
  el.addEventListener('loadedmetadata', () => {
    entry.ready = true;
    entry.w = el.videoWidth;
    entry.h = el.videoHeight;
    entry.duration = el.duration || 0;
    window.dispatchEvent(new CustomEvent('mf:media'));
  });
  el.addEventListener('error', () => {
    entry.error = true;
    window.dispatchEvent(new CustomEvent('mf:media'));
  });
  mediaCache.videos.set(path, entry);
  return entry;
}

export function seekVideo(entry, time) {
  return new Promise((resolve) => {
    if (!entry) return resolve();
    const el = entry.el;
    if (!entry.ready) {
      const done = () => resolve();
      el.addEventListener('loadedmetadata', done, { once: true });
      setTimeout(done, 5000);
      return;
    }
    const dur = entry.duration || el.duration || 0;
    const target = clamp(time, 0, Math.max(0, dur - 0.001));
    if (Math.abs(el.currentTime - target) < 0.0008) return resolve();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      el.removeEventListener('seeked', finish);
      resolve();
    };
    el.addEventListener('seeked', finish);
    try {
      el.currentTime = target;
    } catch {
      finish();
    }
    setTimeout(finish, 4000);
  });
}

export function videoLocalTime(layer, t) {
  return (layer.sourceStart || 0) + Math.max(0, t - layer.start) * (layer.speed || 1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function buildFilterString(layer, t) {
  const parts = [];
  for (const ef of layer.effects || []) {
    if (!ef.enabled) continue;
    const v = (k) => getValue(layer, `effect.${ef.id}.${k}`, t);
    switch (ef.type) {
      case 'blur': {
        const r = v('radius');
        if (r > 0.05) parts.push(`blur(${r.toFixed(2)}px)`);
        break;
      }
      case 'brightness':
        parts.push(`brightness(${clamp(1 + v('amount') / 100, 0, 4).toFixed(3)})`);
        break;
      case 'contrast':
        parts.push(`contrast(${clamp(1 + v('amount') / 100, 0, 4).toFixed(3)})`);
        break;
      case 'saturation':
        parts.push(`saturate(${clamp(1 + v('amount') / 100, 0, 4).toFixed(3)})`);
        break;
      case 'hue':
        parts.push(`hue-rotate(${v('amount').toFixed(2)}deg)`);
        break;
      case 'grayscale': {
        const a = v('amount') / 100;
        if (a > 0.002) parts.push(`grayscale(${clamp(a, 0, 1).toFixed(3)})`);
        break;
      }
      case 'invert': {
        const a = v('amount') / 100;
        if (a > 0.002) parts.push(`invert(${clamp(a, 0, 1).toFixed(3)})`);
        break;
      }
      case 'shadow': {
        const o = v('opacity') / 100;
        if (o > 0.002) {
          parts.push(
            `drop-shadow(${v('x').toFixed(1)}px ${v('y').toFixed(1)}px ${v('blur').toFixed(1)}px ${rgba(
              ef.params.color,
              o
            )})`
          );
        }
        break;
      }
      default:
        break;
    }
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Compositor
// ---------------------------------------------------------------------------

export class Compositor {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.measureCanvas = makeCanvas(8, 8);
    this.measureCtx = this.measureCanvas.getContext('2d');
    this.cache = new Map();
    this.renderScale = opts.scale || 1;
    this.renderScaleY = this.renderScale;
  }

  setScale(scale, scaleY = scale) {
    this.renderScale = scale;
    this.renderScaleY = scaleY;
  }

  resizeToProject() {
    const p = store.project;
    const w = Math.max(1, Math.round(p.width * this.renderScale));
    const h = Math.max(1, Math.round(p.height * this.renderScale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  canvasFor(key, w, h) {
    let entry = this.cache.get(key);
    w = Math.max(1, Math.ceil(w));
    h = Math.max(1, Math.ceil(h));
    if (!entry) {
      const canvas = makeCanvas(w, h);
      entry = { canvas, ctx: canvas.getContext('2d'), w, h };
      this.cache.set(key, entry);
    } else if (entry.w !== w || entry.h !== h) {
      entry.canvas.width = w;
      entry.canvas.height = h;
      entry.w = w;
      entry.h = h;
    } else {
      entry.ctx.setTransform(1, 0, 0, 1, 0, 0);
      entry.ctx.clearRect(0, 0, w, h);
    }
    return entry;
  }

  // -------------------------------------------------------------------------
  render(t) {
    const p = store.project;
    const ctx = this.ctx;
    const scale = this.renderScale;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(scale, 0, 0, this.renderScaleY, 0, 0);
    ctx.fillStyle = p.background || '#000000';
    ctx.fillRect(0, 0, p.width, p.height);

    for (let i = p.layers.length - 1; i >= 0; i--) {
      const layer = p.layers[i];
      if (!layer.visible) continue;
      if (t < layer.start - 1e-6 || t > layer.end + 1e-6) continue;
      this.drawLayer(ctx, layer, t);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawLayer(ctx, layer, t) {
    const opacity = clamp(getValue(layer, 'transform.opacity', t) / 100, 0, 1);
    if (opacity <= 0.001) return;

    const content = this.buildContent(layer, t);
    if (!content) return;

    this.applyPixelEffects(content, layer, t);

    const x = getValue(layer, 'transform.x', t);
    const y = getValue(layer, 'transform.y', t);
    const scale = getValue(layer, 'transform.scale', t);
    const rot = (getValue(layer, 'transform.rotation', t) * Math.PI) / 180;

    const filter = buildFilterString(layer, t);
    const blend = layer.blend || 'source-over';
    const glow = (layer.effects || []).find((e) => e.enabled && e.type === 'glow');

    const draw = (alpha, op, filt) => {
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.globalCompositeOperation = op;
      ctx.filter = filt || 'none';
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.scale(scale, scale);
      ctx.drawImage(content.canvas, -content.w / 2, -content.h / 2, content.w, content.h);
      ctx.restore();
    };

    if (glow) {
      const r = Math.max(0, getValue(layer, `effect.${glow.id}.radius`, t));
      const intensity = clamp(getValue(layer, `effect.${glow.id}.intensity`, t) / 100, 0, 1);
      if (r > 0.05 && intensity > 0.002) {
        // draw the blurred halo first so the crisp layer sits on top
        draw(opacity * intensity * 1.4, 'lighter', `blur(${r.toFixed(2)}px)`);
      }
    }

    draw(opacity, blend, filter);
  }

  // -------------------------------------------------------------------------

  buildContent(layer, t) {
    if (layer.type === 'text') return this.buildText(layer);
    if (layer.type === 'shape' || layer.type === 'solid') return this.buildShape(layer);

    if (layer.type === 'image') {
      const entry = getImage(layer.src);
      if (!entry || !entry.ready) return null;
      const w = layer.width || entry.w;
      const h = layer.height || entry.h;
      const c = this.canvasFor(`img:${layer.id}:${w}x${h}`, w, h);
      c.ctx.drawImage(entry.img, 0, 0, c.w, c.h);
      return c;
    }

    if (layer.type === 'video') {
      const entry = getVideo(layer.src);
      if (!entry || !entry.ready || !entry.el.videoWidth) return null;
      const w = layer.width || entry.w;
      const h = layer.height || entry.h;
      const c = this.canvasFor(`vid:${layer.id}:${w}x${h}`, w, h);
      try {
        c.ctx.drawImage(entry.el, 0, 0, c.w, c.h);
      } catch {
        return null;
      }
      return c;
    }

    return null;
  }

  buildShape(layer) {
    const S = layer.shape || {};
    const sw = Math.max(0, S.strokeWidth || 0);
    const pad = Math.ceil(sw + 4);
    const W = Math.max(1, S.width || 100);
    const H = Math.max(1, S.height || 100);
    const c = this.canvasFor(`shape:${layer.id}`, W + pad * 2, H + pad * 2);
    const ctx = c.ctx;

    ctx.save();
    ctx.translate(c.w / 2, c.h / 2);
    ctx.beginPath();

    const halfW = W / 2;
    const halfH = H / 2;
    const kind = S.kind || 'rect';

    if (kind === 'ellipse') {
      ctx.ellipse(0, 0, halfW, halfH, 0, 0, Math.PI * 2);
    } else if (kind === 'polygon' || kind === 'triangle') {
      const sides = kind === 'triangle' ? 3 : Math.max(3, Math.round(S.sides || 5));
      for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / sides;
        const px = Math.cos(a) * halfW;
        const py = Math.sin(a) * halfH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else {
      const r = clamp(S.radius || 0, 0, Math.min(halfW, halfH));
      if (r > 0.5 && ctx.roundRect) {
        ctx.roundRect(-halfW, -halfH, W, H, r);
      } else if (r > 0.5) {
        const rr = Math.min(r, halfW, halfH);
        ctx.moveTo(-halfW + rr, -halfH);
        ctx.arcTo(halfW, -halfH, halfW, halfH, rr);
        ctx.arcTo(halfW, halfH, -halfW, halfH, rr);
        ctx.arcTo(-halfW, halfH, -halfW, -halfH, rr);
        ctx.arcTo(-halfW, -halfH, halfW, -halfH, rr);
        ctx.closePath();
      } else {
        ctx.rect(-halfW, -halfH, W, H);
      }
    }

    if (S.fill && S.fill !== 'none') {
      ctx.fillStyle = S.fill;
      ctx.fill();
    }
    if (sw > 0.01) {
      ctx.lineWidth = sw;
      ctx.strokeStyle = S.stroke || '#ffffff';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.restore();

    return c;
  }

  buildText(layer) {
    const T = layer.text || {};
    const m = this.measureCtx;
    const weight = T.fontWeight || 400;
    const fontSize = Math.max(1, T.fontSize || 64);
    const font = `${T.italic ? 'italic ' : ''}${weight} ${fontSize}px "${T.fontFamily || 'Segoe UI'}"`;

    m.font = font;
    if ('letterSpacing' in m) m.letterSpacing = `${T.letterSpacing || 0}px`;

    const maxW = Math.max(20, T.maxWidth || store.project.width * 0.85);
    const lines = wrapText(m, T.content || '', maxW);
    const lineH = fontSize * (T.lineHeight || 1.2);
    let textW = 0;
    for (const line of lines) textW = Math.max(textW, m.measureText(line).width);

    const strokeW = Math.max(0, T.strokeWidth || 0);
    const pad = Math.ceil(Math.max(strokeW, T.shadow ? (T.shadowBlur || 0) + Math.abs(T.shadowY || 0) : 0) + fontSize * 0.12);

    const W = Math.ceil(textW + pad * 2 + strokeW * 2);
    const H = Math.ceil(lines.length * lineH + pad * 2);

    const c = this.canvasFor(`text:${layer.id}`, W, H);
    const ctx = c.ctx;

    ctx.font = font;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${T.letterSpacing || 0}px`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = T.align === 'left' ? 'left' : T.align === 'right' ? 'right' : 'center';

    const x = T.align === 'left' ? pad : T.align === 'right' ? c.w - pad : c.w / 2;

    for (let i = 0; i < lines.length; i++) {
      const y = pad + lineH * (i + 0.5);
      if (strokeW > 0.01) {
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = strokeW;
        ctx.strokeStyle = T.strokeColor || '#000000';
        ctx.lineJoin = 'round';
        ctx.strokeText(lines[i], x, y);
      }
      ctx.fillStyle = T.color || '#ffffff';
      if (T.shadow) {
        ctx.shadowColor = T.shadowColor || '#000000';
        ctx.shadowBlur = T.shadowBlur || 0;
        ctx.shadowOffsetX = T.shadowX || 0;
        ctx.shadowOffsetY = T.shadowY || 0;
      } else {
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }
      ctx.fillText(lines[i], x, y);
    }
    ctx.shadowColor = 'transparent';

    return c;
  }

  // -------------------------------------------------------------------------
  applyPixelEffects(content, layer, t) {
    for (const ef of layer.effects || []) {
      if (!ef.enabled) continue;
      if (ef.type === 'chroma') this.applyChroma(content, layer, ef, t);
      else if (ef.type === 'tint') this.applyTint(content, layer, ef, t);
    }
  }

  applyChroma(content, layer, ef, t) {
    const { canvas, ctx } = content;
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;
    const v = (k) => getValue(layer, `effect.${ef.id}.${k}`, t);

    const key = hexToRgb(ef.params.color);
    const tol = clamp(v('tolerance') / 100, 0, 1) * 0.9;
    const soft = Math.max(0.005, (v('softness') / 100) * 0.9);
    const spill = clamp(v('spill') / 100, 0, 1);

    let img;
    try {
      img = ctx.getImageData(0, 0, w, h);
    } catch {
      return;
    }
    const d = img.data;
    const inv = 1 / Math.sqrt(3);

    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const dr = (d[i] - key.r) / 255;
      const dg = (d[i + 1] - key.g) / 255;
      const db = (d[i + 2] - key.b) / 255;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db) * inv;
      const m = smoothstep(tol, tol + soft, dist);
      d[i + 3] = d[i + 3] * m;
      if (spill > 0 && m < 0.999 && d[i + 3] > 0) {
        const luma = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const k = spill * (1 - m);
        d[i] = d[i] + (luma - d[i]) * k;
        d[i + 1] = d[i + 1] + (luma - d[i + 1]) * k;
        d[i + 2] = d[i + 2] + (luma - d[i + 2]) * k;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  applyTint(content, layer, ef, t) {
    const { canvas, ctx } = content;
    const w = canvas.width;
    const h = canvas.height;
    if (!w || !h) return;
    const amt = clamp(getValue(layer, `effect.${ef.id}.amount`, t) / 100, 0, 1);
    if (amt <= 0.002) return;
    const tint = hexToRgb(ef.params.color);
    let img;
    try {
      img = ctx.getImageData(0, 0, w, h);
    } catch {
      return;
    }
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      d[i] = d[i] + (tint.r - d[i]) * amt;
      d[i + 1] = d[i + 1] + (tint.g - d[i + 1]) * amt;
      d[i + 2] = d[i + 2] + (tint.b - d[i + 2]) * amt;
    }
    ctx.putImageData(img, 0, 0);
  }

  // -------------------------------------------------------------------------
  async prepare(t) {
    const tasks = [];
    for (const layer of store.project.layers) {
      if (layer.type !== 'video' || !layer.visible) continue;
      if (t < layer.start - 1e-6 || t > layer.end + 1e-6) continue;
      const entry = getVideo(layer.src);
      if (!entry) continue;
      tasks.push(seekVideo(entry, videoLocalTime(layer, t)));
    }
    await Promise.all(tasks);
  }
}

// ---------------------------------------------------------------------------
// Text wrap
// ---------------------------------------------------------------------------

function wrapText(ctx, text, maxWidth) {
  const paragraphs = String(text).split('\n');
  const out = [];

  for (const para of paragraphs) {
    if (para === '') {
      out.push('');
      continue;
    }
    if (ctx.measureText(para).width <= maxWidth) {
      out.push(para);
      continue;
    }

    const words = para.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      const test = line + word;
      if (ctx.measureText(test).width > maxWidth && line !== '') {
        out.push(line.trimEnd());
        line = word.trimStart();
        // hard-break words that are still too long
        while (line && ctx.measureText(line).width > maxWidth) {
          let cut = line.length;
          while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
          out.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        line = test;
      }
    }
    if (line) out.push(line.trimEnd());
  }

  return out.length ? out : [''];
}

// ---------------------------------------------------------------------------
// Playback helpers
// ---------------------------------------------------------------------------

export function syncVideos(t, playing) {
  for (const layer of store.project.layers) {
    if (layer.type !== 'video' || !layer.visible) continue;
    const entry = getVideo(layer.src);
    if (!entry || !entry.ready) continue;

    const active = t >= layer.start && t <= layer.end;
    const local = videoLocalTime(layer, t);
    const el = entry.el;

    if (active && playing) {
      el.volume = clamp(layer.volume == null ? 1 : layer.volume, 0, 1);
      if (el.paused) el.play().catch(() => {});
      if (Math.abs(el.currentTime - local) > 0.3) {
        try {
          el.currentTime = clamp(local, 0, Math.max(0, (entry.duration || 0) - 0.01));
        } catch {}
      }
    } else if (!el.paused) {
      el.pause();
    }
  }
}

export function pauseAllVideos() {
  for (const entry of mediaCache.videos.values()) {
    try {
      entry.el.pause();
    } catch {}
  }
}
