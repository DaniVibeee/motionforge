// ---------------------------------------------------------------------------
// Nameless Editing — multi-layer timeline
// ---------------------------------------------------------------------------

import {
  store,
  clamp,
  fmtTime,
  keyframeTimes,
  getValue,
} from './core.js';
import { el, $, contextMenu } from './ui.js';

const NAME_W = 200;
let pps = 90;
let mode = 'timeline';

export function initTimeline() {
  const zoom = $('#tlZoom');
  zoom.value = String(pps);
  zoom.addEventListener('input', () => {
    pps = Number(zoom.value);
    renderAll();
  });

  $('#modeTimeline').addEventListener('click', () => setMode('timeline'));
  $('#modeGraph').addEventListener('click', () => setMode('graph'));

  store.on('project', renderAll);
  store.on('time', updatePlayhead);
  store.on('selection', updateSelection);
  store.on('duration', renderAll);

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    if (mode !== 'timeline' || resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      renderAll();
    });
  });

  renderAll();
}

export function setMode(next) {
  mode = next;
  const isGraph = next === 'graph';
  $('#modeTimeline').classList.toggle('active', !isGraph);
  $('#modeGraph').classList.toggle('active', isGraph);
  $('#tlScroll').hidden = isGraph;
  $('#graphWrap').hidden = !isGraph;
  $('#tlHint').textContent = isGraph
    ? 'Drag keyframes to retime · drag handles to shape easing'
    : 'Drag clips to move · drag edges to trim · drag diamonds to retime';
  window.dispatchEvent(new CustomEvent('mf:graph-mode', { detail: isGraph }));
  if (isGraph) window.dispatchEvent(new CustomEvent('mf:graph-refresh'));
}

export function getPPS() {
  return pps;
}

function trackWidth() {
  const scroll = $('#tlScroll');
  const avail = scroll ? scroll.clientWidth - NAME_W : 0;
  return Math.max(400, Math.ceil(store.project.duration * pps) + 80, avail);
}

function renderAll() {
  renderRuler();
  renderRows();
  updatePlayhead();
  updateSelection();
  const content = $('#tlContent');
  if (content) content.style.width = `${NAME_W + trackWidth()}px`;
}

function renderRuler() {
  const ruler = $('#tlRuler');
  const dur = store.project.duration;
  const w = trackWidth();
  ruler.style.width = `${w}px`;
  ruler.innerHTML = '';

  let step = 1;
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
  for (const s of steps) {
    if (s * pps >= 58) {
      step = s;
      break;
    }
    step = s;
  }

  for (let t = 0; t <= dur + 1e-6; t += step) {
    const x = t * pps;
    ruler.append(el('div', { class: 'tick', style: { left: `${x}px` } }));
    ruler.append(
      el('div', { class: 'tick-label', style: { left: `${x}px` }, text: step >= 1 ? `${Math.round(t)}s` : `${t.toFixed(2)}s` })
    );
  }

  ruler.onpointerdown = (e) => {
    e.preventDefault();
    const scrub = (ev) => {
      const rect = ruler.getBoundingClientRect();
      const t = clamp((ev.clientX - rect.left) / pps, 0, store.project.duration);
      store.setTime(t);
    };
    scrub(e);
    const move = (ev) => scrub(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
}

function renderRows() {
  const host = $('#tlRows');
  host.innerHTML = '';
  const p = store.project;
  const w = trackWidth();

  for (const layer of p.layers) {
    const selected = store.selection.includes(layer.id);
    const row = el('div', { class: `tl-row ${selected ? 'selected' : ''}`, dataset: { id: layer.id } });

    const name = el(
      'div',
      { class: 'tl-name' },
      el('span', { class: 'dot', style: { background: layer.visible ? '' : '#3a3f52' } }),
      el('span', { class: 'txt', text: layer.name }),
      el('button', {
        class: 'eye',
        text: layer.visible ? '●' : '○',
        title: 'Toggle visibility',
        onclick: (e) => {
          e.stopPropagation();
          store.act(() => {
            layer.visible = !layer.visible;
          });
          store.emit('project');
        },
      })
    );
    name.addEventListener('pointerdown', () => selectLayer(layer.id));

    const track = el('div', { class: 'tl-track', style: { width: `${w}px` } });

    if (!layer.visible) row.style.opacity = '0.55';

    const clip = el('div', {
      class: `tl-clip ${layer.type}`,
      style: {
        left: `${layer.start * pps}px`,
        width: `${Math.max(6, (layer.end - layer.start) * pps)}px`,
      },
    });
    clip.append(el('span', { class: 'clip-label', text: layer.name }));
    clip.append(el('div', { class: 'edge l' }), el('div', { class: 'edge r' }));

    clip.addEventListener('pointerdown', (e) => onClipDown(e, layer, clip, 'move'));
    clip.querySelector('.edge.l').addEventListener('pointerdown', (e) => onClipDown(e, layer, clip, 'left'));
    clip.querySelector('.edge.r').addEventListener('pointerdown', (e) => onClipDown(e, layer, clip, 'right'));
    clip.addEventListener('dblclick', () => {
      store.select(layer.id);
      store.setTime(layer.start);
    });

    track.append(clip);

    // keyframe diamonds (aggregated across all animated paths)
    const times = keyframeTimes(layer);
    for (const t of times) {
      const left = t * pps;
      const kf = el('div', {
        class: 'kf',
        style: { left: `${left}px` },
        title: `Keyframe @ ${fmtTime(t)} — drag to retime, right-click to delete`,
      });
      kf.addEventListener('pointerdown', (e) => onKeyframeDown(e, layer, t, kf));
      kf.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        contextMenu(e.clientX, e.clientY, [
          {
            label: 'Delete keyframe',
            danger: true,
            action: () => {
              store.act(() => {
                for (const [path, kfs] of Object.entries(layer.keyframes || {})) {
                  const idx = kfs.findIndex((k) => Math.abs(k.t - t) < 1e-3);
                  if (idx >= 0) kfs.splice(idx, 1);
                  if (!kfs.length) delete layer.keyframes[path];
                }
              });
              store.emit('project');
            },
          },
        ]);
      });
      track.append(kf);
    }

    track.addEventListener('pointerdown', (e) => {
      if (e.target !== track) return;
      selectLayer(layer.id);
      const rect = track.getBoundingClientRect();
      store.setTime(clamp((e.clientX - rect.left) / pps, 0, p.duration));
    });

    row.append(name, track);
    host.append(row);
  }

  if (!p.layers.length) {
    host.append(
      el('div', {
        class: 'empty-state',
        style: { padding: '18px' },
        html: '<strong>No layers yet</strong>Use the + buttons in the Layers panel to add one.',
      })
    );
  }
}

function selectLayer(id) {
  if (store.selection[0] === id) return;
  store.select(id);
}

function onClipDown(e, layer, clipEl, mode) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  selectLayer(layer.id);

  const startX = e.clientX;
  const s0 = layer.start;
  const e0 = layer.end;
  const src0 = layer.sourceStart || 0;
  const minLen = 0.08;
  const dur = store.project.duration;
  let moved = false;

  store.begin();

  const onMove = (ev) => {
    let dt = (ev.clientX - startX) / pps;
    if (ev.shiftKey) dt = Math.round(dt);
    else dt = Math.round(dt * 100) / 100;

    if (mode === 'move') {
      const len = e0 - s0;
      const ns = clamp(s0 + dt, 0, Math.max(0, dur - len));
      layer.start = ns;
      layer.end = ns + len;
    } else if (mode === 'left') {
      const ns = clamp(s0 + dt, 0, e0 - minLen);
      const delta = ns - s0;
      layer.start = ns;
      if (layer.type === 'video' && layer.sourceStart != null) {
        layer.sourceStart = Math.max(0, src0 + delta * (layer.speed || 1));
      }
    } else {
      const ne = clamp(e0 + dt, s0 + minLen, dur);
      layer.end = ne;
    }

    clipEl.style.left = `${layer.start * pps}px`;
    clipEl.style.width = `${Math.max(6, (layer.end - layer.start) * pps)}px`;
    moved = true;
    store.emit('transform');
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved) store.end();
    else store.cancel();
    store.emit('project');
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function onKeyframeDown(e, layer, t, kfEl) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  selectLayer(layer.id);

  const startX = e.clientX;
  const targets = [];
  for (const [path, kfs] of Object.entries(layer.keyframes || {})) {
    const kf = kfs.find((k) => Math.abs(k.t - t) < 1e-3);
    if (kf) targets.push({ path, kf });
  }
  if (!targets.length) return;

  let moved = false;
  let nt = t;
  store.begin();

  const onMove = (ev) => {
    let dt = (ev.clientX - startX) / pps;
    nt = clamp(Math.round((t + dt) * 1000) / 1000, 0, store.project.duration);
    for (const { kf } of targets) kf.t = nt;
    for (const { path } of targets) layer.keyframes[path].sort((a, b) => a.t - b.t);
    kfEl.style.left = `${nt * pps}px`;
    moved = true;
    store.emit('transform');
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved) store.end();
    else store.cancel();
    store.emit('project');
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

function updatePlayhead() {
  const ph = $('#playhead');
  if (!ph) return;
  const left = NAME_W + store.time * pps;
  ph.style.left = `${left}px`;
}

function updateSelection() {
  for (const row of document.querySelectorAll('.tl-row')) {
    row.classList.toggle('selected', store.selection.includes(row.dataset.id));
  }
}

// ---------------------------------------------------------------------------

export function refreshTimeline() {
  renderAll();
}
