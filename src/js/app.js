// ---------------------------------------------------------------------------
// MotionForge — application bootstrap / controller
// ---------------------------------------------------------------------------

import {
  store,
  clamp,
  fmtTime,
  getValue,
  setAnimatable,
  setKeyframe,
  easePreset,
  createProject,
  createLayer,
  createEffect,
  fitSizeToComp,
  SIZE_PRESETS,
  TYPE_NAMES,
} from './core.js';
import {
  Compositor,
  mediaUrl,
  getImage,
  getVideo,
  syncVideos,
  pauseAllVideos,
  mediaCache,
} from './compositor.js';
import { initTimeline } from './timeline.js';
import { initGraph } from './graph.js';
import { initInspector } from './inspector.js';
import { runExport, runFallbackExport } from './export.js';
import { el, $, $$, toast, typeIcon, debounce } from './ui.js';

const canvas = $('#stage');
const comp = new Compositor(canvas);
const bbox = $('#bbox');

let needsRender = true;
let viewZoom = 100;
let appInfo = null;
let exporting = false;
let cancelRequested = false;
let layerDragId = null;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  try {
    appInfo = await window.api.info();
  } catch {
    appInfo = { ffmpeg: false };
  }

  initTimeline();
  initGraph();
  initInspector();
  initTopbar();
  initProjectPanel();
  initLayerPanel();
  initTransport();
  initStage();
  initExportModal();
  initShortcuts();
  bindStore();

  store.setProject(createDemoProject());

  comp.resizeToProject();
  fitStage();
  syncProjectInputs();
  renderLayerList();
  updateHistoryButtons();
  startLoop();

  if (!appInfo.ffmpeg) {
    toast('ffmpeg not found — MP4 export will fall back to WebM.', 'err', 6000);
  }
}

function bindStore() {
  store.on('project', () => {
    comp.resizeToProject();
    fitStage();
    syncProjectInputs();
    renderLayerList();
    const empty = $('#stageEmpty');
    if (empty) empty.hidden = store.project.layers.length > 0;
    needsRender = true;
    updateOverlay();
    updateDurationLabel();
  });

  store.on('selection', () => {
    renderLayerList();
    needsRender = true;
    updateOverlay();
  });

  store.on('time', () => {
    updateTimeLabel();
    needsRender = true;
    updateOverlay();
    if (!store.playing) seekAndRender();
  });

  store.on('transform', () => {
    needsRender = true;
    updateOverlay();
  });

  store.on('history', updateHistoryButtons);
  store.on('play', updatePlayButton);

  window.addEventListener('mf:media', () => {
    needsRender = true;
  });
}

const seekAndRender = debounce(async () => {
  if (store.playing || exporting) return;
  await comp.prepare(store.time);
  needsRender = true;
}, 55);

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function startLoop() {
  let last = performance.now();

  const loop = (ts) => {
    const dt = Math.min(0.1, (ts - last) / 1000);
    last = ts;

    if (store.playing && !exporting) {
      let t = store.time + dt;
      if (t >= store.project.duration) t = 0;
      store.setTime(t);
      syncVideos(store.time, true);
      needsRender = true;
    }

    if (needsRender) {
      comp.render(store.time);
      needsRender = false;
      updateOverlay();
    }

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

function requestRender() {
  needsRender = true;
}

// ---------------------------------------------------------------------------
// Project settings
// ---------------------------------------------------------------------------

function initProjectPanel() {
  const preset = $('#sizePreset');
  SIZE_PRESETS.forEach((s, i) => {
    preset.append(el('option', { value: String(i), text: s.label }));
  });
  preset.append(el('option', { value: 'custom', text: 'Custom' }));

  preset.addEventListener('change', () => {
    if (preset.value === 'custom') return;
    const s = SIZE_PRESETS[Number(preset.value)];
    if (!s) return;
    applyProjectChange(() => {
      store.project.width = s.w;
      store.project.height = s.h;
    });
  });

  $('#projW').addEventListener('change', (e) => {
    const v = clamp(Math.round(Number(e.target.value) || 1080), 16, 7680);
    applyProjectChange(() => {
      store.project.width = v;
    });
  });
  $('#projH').addEventListener('change', (e) => {
    const v = clamp(Math.round(Number(e.target.value) || 1920), 16, 7680);
    applyProjectChange(() => {
      store.project.height = v;
    });
  });
  $('#projFps').addEventListener('change', (e) => {
    applyProjectChange(() => {
      store.project.fps = Number(e.target.value);
    });
  });
  $('#projDur').addEventListener('change', (e) => {
    const v = clamp(Number(e.target.value) || 8, 0.5, 600);
    applyProjectChange(() => {
      const p = store.project;
      p.duration = v;
      for (const l of p.layers) {
        l.start = clamp(l.start, 0, v - 0.05);
        l.end = clamp(l.end, l.start + 0.05, v);
      }
    });
    store.setTime(clamp(store.time, 0, v));
  });

  const bg = $('#projBg');
  const bgHex = $('#projBgHex');
  bg.addEventListener('input', () => {
    bgHex.value = bg.value;
    store.project.background = bg.value;
    requestRender();
  });
  bg.addEventListener('change', () => {
    store.act(() => {
      store.project.background = bg.value;
    });
    store.emit('project');
  });
  bgHex.addEventListener('change', () => {
    const v = normalizeHex(bgHex.value);
    bg.value = v;
    applyProjectChange(() => {
      store.project.background = v;
    });
  });

  $('#projName').addEventListener('change', (e) => {
    store.project.name = e.target.value.trim() || 'Untitled';
    store.dirty = true;
  });
}

function applyProjectChange(fn) {
  store.act(fn);
  store.emit('project');
  store.emit('time');
}

function syncProjectInputs() {
  const p = store.project;
  $('#projName').value = p.name || 'Untitled';
  $('#projW').value = String(p.width);
  $('#projH').value = String(p.height);
  $('#projFps').value = String(p.fps);
  $('#projDur').value = String(p.duration);
  const bg = normalizeHex(p.background);
  $('#projBg').value = bg;
  $('#projBgHex').value = bg;

  const presetIndex = SIZE_PRESETS.findIndex((s) => s.w === p.width && s.h === p.height);
  $('#sizePreset').value = presetIndex >= 0 ? String(presetIndex) : 'custom';
  updateDurationLabel();
}

function updateDurationLabel() {
  const d = $('#durLabel');
  if (d) d.textContent = fmtTime(store.project.duration);
}

function normalizeHex(v) {
  if (!v) return '#000000';
  let s = String(v).trim();
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-fA-F]{3}$/.test(s)) s = '#' + s.slice(1).split('').map((c) => c + c).join('');
  if (!/^#[0-9a-fA-F]{6}$/.test(s)) return '#000000';
  return s.toLowerCase();
}

// ---------------------------------------------------------------------------
// Layer list
// ---------------------------------------------------------------------------

function initLayerPanel() {
  for (const btn of $$('.add-btn')) {
    btn.addEventListener('click', () => addLayerOfType(btn.dataset.add));
  }
}

async function addLayerOfType(kind) {
  const p = store.project;
  if (kind === 'image' || kind === 'video') {
    await importMedia(kind);
    return;
  }

  let layer;
  if (kind === 'text') {
    layer = createLayer('text', p);
    layer.name = uniqueName('Text');
    layer.transform.y = Math.round(p.height * 0.5);
  } else if (kind === 'shape') {
    layer = createLayer('shape', p);
    layer.name = uniqueName('Shape');
  } else {
    layer = createLayer('solid', p);
    layer.name = uniqueName('Solid');
  }

  store.addLayer(layer);
  toast(`${TYPE_NAMES[layer.type]} layer added`, 'ok', 1500);
}

function uniqueName(base) {
  const names = new Set(store.project.layers.map((l) => l.name));
  if (!names.has(base)) return base;
  let i = 2;
  while (names.has(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

function renderLayerList() {
  const host = $('#layerList');
  if (!host) return;
  host.innerHTML = '';
  const p = store.project;
  $('#layerCount').textContent = String(p.layers.length);

  for (const layer of p.layers) {
    const selected = store.selection.includes(layer.id);
    const row = el('div', {
      class: `layer-row ${selected ? 'selected' : ''}`,
      draggable: 'true',
      dataset: { id: layer.id },
    });

    const thumb = el('div', { class: 'layer-thumb' });
    if (layer.type === 'image' && layer.src) {
      thumb.append(el('img', { src: mediaUrl(layer.src), draggable: 'false' }));
    } else if (layer.type === 'text') {
      thumb.append(el('span', { text: 'T', style: { fontWeight: '700', fontSize: '12px' } }));
    } else {
      thumb.append(el('span', { text: typeIcon(layer.type) }));
    }

    const body = el(
      'div',
      { class: 'layer-body' },
      el('div', { class: 'layer-name', text: layer.name }),
      el('div', { class: 'layer-sub', text: TYPE_NAMES[layer.type] })
    );

    const eye = el('button', {
      class: `layer-eye ${layer.visible ? '' : 'off'}`,
      text: layer.visible ? '●' : '○',
      title: 'Toggle visibility',
      onclick: (e) => {
        e.stopPropagation();
        store.act(() => {
          layer.visible = !layer.visible;
        });
        store.emit('project');
      },
    });

    const drag = el('span', { class: 'layer-drag', text: '⠿' });

    row.append(drag, thumb, body, eye);
    row.addEventListener('pointerdown', () => store.select(layer.id));

    row.addEventListener('dragstart', (e) => {
      layerDragId = layer.id;
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      for (const r of $$('.layer-row')) r.classList.remove('drop-target');
      layerDragId = null;
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drop-target');
      if (!layerDragId || layerDragId === layer.id) return;
      const idx = store.project.layers.findIndex((l) => l.id === layer.id);
      store.moveLayer(layerDragId, idx);
    });

    host.append(row);
  }
}

async function importMedia(kind) {
  let res;
  try {
    res = await window.api.importMedia(kind);
  } catch (err) {
    toast(`Import failed: ${err.message}`, 'err');
    return;
  }
  if (!res || !res.ok) return;

  for (const file of res.files) {
    if (kind === 'image') await addImageFile(file);
    else if (kind === 'video') await addVideoFile(file);
  }
}

function awaitImage(path) {
  return new Promise((resolve) => {
    const entry = getImage(path);
    if (entry.ready) return resolve(entry);
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (entry.ready || entry.error || tries > 300) {
        clearInterval(timer);
        resolve(entry);
      }
    }, 25);
  });
}

function awaitVideo(path) {
  return new Promise((resolve) => {
    const entry = getVideo(path);
    if (entry.ready) return resolve(entry);
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (entry.ready || entry.error || tries > 400) {
        clearInterval(timer);
        resolve(entry);
      }
    }, 25);
  });
}

async function addImageFile(file) {
  const entry = await awaitImage(file.path);
  if (!entry || !entry.ready) {
    toast(`Could not load ${file.name}`, 'err');
    return;
  }
  const size = fitSizeToComp(entry.w, entry.h, store.project);
  const layer = createLayer('image', store.project, {
    src: file.path,
    mediaName: file.name,
    mediaW: entry.w,
    mediaH: entry.h,
    width: size.w,
    height: size.h,
  });
  layer.name = baseName(file.name);
  store.addLayer(layer);
  toast(`Imported ${file.name}`, 'ok', 1800);
}

async function addVideoFile(file) {
  const entry = await awaitVideo(file.path);
  if (!entry || !entry.ready) {
    toast(`Could not load ${file.name}`, 'err');
    return;
  }
  const size = fitSizeToComp(entry.w, entry.h, store.project);
  const layer = createLayer('video', store.project, {
    src: file.path,
    mediaName: file.name,
    mediaW: entry.w,
    mediaH: entry.h,
    width: size.w,
    height: size.h,
  });
  layer.name = baseName(file.name);
  layer.end = Math.min(store.project.duration, Math.max(0.3, entry.duration || store.project.duration));
  store.addLayer(layer);
  toast(`Imported ${file.name}`, 'ok', 1800);
}

function baseName(name) {
  return String(name).replace(/\.[^.]+$/, '');
}

// ---------------------------------------------------------------------------
// Topbar / file operations
// ---------------------------------------------------------------------------

function initTopbar() {
  $('#undoBtn').addEventListener('click', () => store.undo());
  $('#redoBtn').addEventListener('click', () => store.redo());
  $('#saveBtn').addEventListener('click', saveProject);
  $('#openBtn').addEventListener('click', openProject);
  $('#newBtn').addEventListener('click', newProject);
  $('#exportBtn').addEventListener('click', openExportModal);
}

function updateHistoryButtons() {
  $('#undoBtn').disabled = store.undoStack.length === 0;
  $('#redoBtn').disabled = store.redoStack.length === 0;
}

async function saveProject() {
  try {
    const data = JSON.stringify(store.project, null, 2);
    const res = await window.api.saveProject(data, store.project.name || 'project');
    if (res.ok) {
      store.filePath = res.path;
      store.dirty = false;
      toast('Project saved', 'ok', 2000);
    }
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'err');
  }
}

async function openProject() {
  try {
    const res = await window.api.openProject();
    if (!res.ok) return;
    const data = JSON.parse(res.data);
    if (!data || !Array.isArray(data.layers)) throw new Error('Invalid project file');
    store.setProject({ ...createProject(), ...data });
    store.filePath = res.path;
    fitStage();
    toast('Project opened', 'ok', 2000);
  } catch (err) {
    toast(`Could not open project: ${err.message}`, 'err', 4000);
  }
}

function newProject() {
  if (store.dirty && !window.confirm('Discard unsaved changes and start a new project?')) return;
  const p = createProject();
  store.setProject(p);
  fitStage();
  toast('New project', '', 1500);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function initTransport() {
  $('#playBtn').addEventListener('click', togglePlay);
  $('#fitBtn').addEventListener('click', () => {
    viewZoom = 100;
    $('#viewZoom').value = '100';
    $('#viewZoomVal').textContent = '100%';
    fitStage();
  });

  const zoom = $('#viewZoom');
  zoom.addEventListener('input', () => {
    viewZoom = Number(zoom.value);
    $('#viewZoomVal').textContent = `${viewZoom}%`;
    fitScaleStage();
  });

  updateTimeLabel();
}

function togglePlay() {
  if (store.playing) {
    store.setPlaying(false);
    pauseAllVideos();
  } else {
    if (store.time >= store.project.duration - 1e-3) store.setTime(0);
    store.setPlaying(true);
    syncVideos(store.time, true);
  }
}

function updatePlayButton() {
  $('#playIcon').textContent = store.playing ? '❚❚' : '▶';
  updateOverlay();
}

function updateTimeLabel() {
  const t = $('#timeLabel');
  if (t) t.textContent = fmtTime(store.time);
}

// ---------------------------------------------------------------------------
// Stage / overlay handles
// ---------------------------------------------------------------------------

function initStage() {
  new ResizeObserver(() => {
    fitScaleStage();
  }).observe($('#stageOuter'));

  bbox.addEventListener('pointerdown', onBBoxDown);
}

function fitScaleStage() {
  const p = store.project;
  const outer = $('#stageOuter');
  const rect = outer.getBoundingClientRect();
  const pad = 32;
  const availW = Math.max(40, rect.width - pad);
  const availH = Math.max(40, rect.height - pad);
  const fit = Math.min(availW / p.width, availH / p.height);
  const s = fit * (viewZoom / 100);
  const w = Math.max(16, Math.round(p.width * s));
  const h = Math.max(16, Math.round(p.height * s));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const inner = $('#stageInner');
  inner.style.width = `${w}px`;
  inner.style.height = `${h}px`;
  needsRender = true;
  updateOverlay();
}

const fitStage = fitScaleStage;

function updateOverlay() {
  const layer = store.selectedLayer;
  const p = store.project;

  const hide = () => bbox.classList.remove('visible');

  if (!layer || !layer.visible || store.playing) return hide();
  if (store.time < layer.start - 1e-6 || store.time > layer.end + 1e-6) return hide();

  const content = comp.buildContent(layer, store.time);
  if (!content) return hide();

  const cssW = canvas.clientWidth || 1;
  const s = cssW / p.width;

  const x = getValue(layer, 'transform.x', store.time);
  const y = getValue(layer, 'transform.y', store.time);
  const scale = getValue(layer, 'transform.scale', store.time);
  const rot = getValue(layer, 'transform.rotation', store.time);

  const w = Math.max(4, content.w * scale * s);
  const h = Math.max(4, content.h * scale * s);

  bbox.style.width = `${w}px`;
  bbox.style.height = `${h}px`;
  bbox.style.transform = `translate(${x * s - w / 2}px, ${y * s - h / 2}px) rotate(${rot}deg)`;
  bbox.classList.add('visible');
}

function onBBoxDown(e) {
  const layer = store.selectedLayer;
  if (!layer) return;
  e.preventDefault();
  e.stopPropagation();

  const handle = e.target.dataset ? e.target.dataset.handle : null;

  const p = store.project;
  const rect = canvas.getBoundingClientRect();
  const s = (rect.width || 1) / p.width;

  const x0 = getValue(layer, 'transform.x', store.time);
  const y0 = getValue(layer, 'transform.y', store.time);
  const sc0 = getValue(layer, 'transform.scale', store.time);
  const rot0 = getValue(layer, 'transform.rotation', store.time);

  const startX = e.clientX;
  const startY = e.clientY;
  const cx = rect.left + x0 * s;
  const cy = rect.top + y0 * s;
  const dist0 = Math.max(1, Math.hypot(startX - cx, startY - cy));
  const ang0 = Math.atan2(startY - cy, startX - cx);

  store.begin();
  if (handle === 'rot') bbox.classList.add('rotating');
  let moved = false;

  const onMove = (ev) => {
    if (handle === 'rot') {
      const ang = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let deg = rot0 + ((ang - ang0) * 180) / Math.PI;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      setAnimatable(layer, 'transform.rotation', Math.round(deg * 100) / 100, store.time);
    } else if (handle) {
      const dist = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      const ns = clamp(sc0 * (dist / dist0), 0.01, 60);
      setAnimatable(layer, 'transform.scale', Math.round(ns * 1000) / 1000, store.time);
    } else {
      const dx = (ev.clientX - startX) / s;
      const dy = (ev.clientY - startY) / s;
      setAnimatable(layer, 'transform.x', Math.round((x0 + dx) * 100) / 100, store.time);
      setAnimatable(layer, 'transform.y', Math.round((y0 + dy) * 100) / 100, store.time);
    }
    moved = true;
    store.emit('transform');
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    bbox.classList.remove('rotating');
    if (moved) store.end();
    else store.cancel();
    store.emit('project');
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function initExportModal() {
  $('#exportModal').hidden = true;

  $('#expClose').addEventListener('click', () => {
    if (exporting) return;
    $('#exportModal').hidden = true;
  });
  $('#expCancel').addEventListener('click', async () => {
    if (exporting) {
      cancelRequested = true;
      $('#expStatus').textContent = 'Cancelling…';
      return;
    }
    $('#exportModal').hidden = true;
  });
  $('#expStart').addEventListener('click', startExport);
  $('#expScale').addEventListener('change', updateExportSummary);
  $('#expFps').addEventListener('change', updateExportSummary);
}

function openExportModal() {
  const p = store.project;
  const modal = $('#exportModal');
  modal.hidden = false;

  const option = $('#expFps').querySelector('option[value="project"]');
  if (option) option.textContent = `Project (${p.fps})`;

  $('#expBar').style.width = '0%';
  $('#expStart').disabled = false;
  $('#expStart').textContent = 'Export';
  $('#expHint').innerHTML = '';
  $('#expStatus').textContent = appInfo?.ffmpeg
    ? 'Ready — H.264 MP4.'
    : 'ffmpeg not found — will export WebM instead.';

  updateExportSummary();
}

function exportDimensions() {
  const p = store.project;
  const scale = Number($('#expScale').value) || 1;
  const fpsVal = $('#expFps').value;
  const fps = fpsVal === 'project' ? p.fps : Number(fpsVal);
  const w = Math.max(2, Math.round((p.width * scale) / 2) * 2);
  const h = Math.max(2, Math.round((p.height * scale) / 2) * 2);
  const total = Math.max(1, Math.round(p.duration * fps));
  return { scale, fps, w, h, total };
}

function updateExportSummary() {
  const { fps, w, h, total } = exportDimensions();
  const p = store.project;
  $('#expSummary').innerHTML = `<b>${w} × ${h}</b> · ${fps} fps · <b>${total}</b> frames · ${p.duration.toFixed(
    2
  )}s<br/>Video: H.264 (MP4) · Audio: ${hasAudioSource() ? 'included' : 'none detected'}`;
}

function hasAudioSource() {
  const vids = store.project.layers.filter((l) => l.type === 'video' && l.visible && l.src);
  return vids.length === 1;
}

async function startExport() {
  if (exporting) return;
  const p = store.project;
  if (!p.layers.length) {
    toast('Add at least one layer before exporting', 'err', 2500);
    return;
  }

  const { scale, fps, total } = exportDimensions();
  const crf = Number($('#expQuality').value) || 20;
  const suggested = (p.name || 'export').replace(/[\\/:*?"<>|]+/g, '-');

  let pathRes;
  try {
    pathRes = await window.api.chooseExportPath(suggested);
  } catch (err) {
    toast(`Could not choose output: ${err.message}`, 'err');
    return;
  }
  if (!pathRes.ok) return;

  // The exporter seeks the same <video> elements the preview uses; stop all
  // preview playback and synchronization so frames are not stolen mid-export.
  if (store.playing) store.setPlaying(false);
  pauseAllVideos();

  exporting = true;
  cancelRequested = false;
  $('#expStart').disabled = true;
  $('#expStart').textContent = 'Exporting…';
  $('#expBar').style.width = '0%';
  $('#expStatus').textContent = 'Preparing…';
  $('#expHint').innerHTML = '';

  const started = performance.now();
  const onProgress = debounce((u, done, all) => {
    const pct = Math.round(u * 100);
    $('#expBar').style.width = `${pct}%`;
    const elapsed = (performance.now() - started) / 1000;
    const rate = done / Math.max(0.001, elapsed);
    const eta = Math.max(0, (all - done) / Math.max(0.001, rate));
    $('#expStatus').textContent = `Frame ${done} / ${all} · ${pct}% · ${rate.toFixed(1)} fps · ETA ${eta.toFixed(0)}s`;
  }, 70);

  let result;
  if (appInfo?.ffmpeg) {
    result = await runExport({
      scale,
      fps,
      crf,
      outputPath: pathRes.path,
      includeAudio: true,
      onProgress,
      shouldCancel: () => cancelRequested,
    });
  } else {
    result = await runFallbackExport({
      scale,
      fps,
      onProgress,
      shouldCancel: () => cancelRequested,
    });
  }

  exporting = false;
  $('#expStart').disabled = false;
  $('#expStart').textContent = 'Export';

  if (result.ok) {
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    $('#expBar').style.width = '100%';
    $('#expStatus').textContent = `Done in ${secs}s — ${result.path}`;
    const hint = $('#expHint');
    hint.innerHTML = '';
    hint.append(
      el('button', {
        class: 'btn tiny',
        text: 'Show in folder',
        onclick: () => window.api.showItemInFolder(result.path),
      })
    );
    toast(`Exported ${total} frames to ${result.path}`, 'ok', 5000);
  } else if (result.canceled) {
    $('#expStatus').textContent = 'Export cancelled.';
    $('#expBar').style.width = '0%';
  } else {
    $('#expStatus').textContent = `Export failed: ${result.error}`;
    toast(`Export failed: ${result.error}`, 'err', 6000);
  }
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function initShortcuts() {
  window.addEventListener('keydown', (e) => {
    // Don't let editing shortcuts disturb the timeline mid-export.
    if (exporting) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';

    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
        e.preventDefault();
        store.redo();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProject();
      } else if (e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openProject();
      } else if (e.key.toLowerCase() === 'd' && !typing) {
        e.preventDefault();
        if (store.selectedLayer) store.duplicateLayer(store.selectedLayer.id);
      }
      return;
    }

    if (typing) return;

    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      store.setTime(store.time - (e.shiftKey ? 1 : 1 / store.project.fps));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      store.setTime(store.time + (e.shiftKey ? 1 : 1 / store.project.fps));
    } else if (e.key === 'Home') {
      e.preventDefault();
      store.setTime(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      store.setTime(store.project.duration);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (store.selectedLayer) {
        e.preventDefault();
        store.removeLayer(store.selectedLayer.id);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Demo project
// ---------------------------------------------------------------------------

function createDemoProject() {
  const p = createProject();
  p.name = 'Welcome';
  p.width = 1080;
  p.height = 1920;
  p.fps = 30;
  p.duration = 6;
  p.background = '#0a0a12';

  // softly glowing disc behind everything
  const disc = createLayer('shape', p);
  disc.name = 'Aurora';
  disc.shape.kind = 'ellipse';
  disc.shape.width = 1020;
  disc.shape.height = 1020;
  disc.shape.fill = '#5b3bff';
  disc.blend = 'screen';
  disc.transform.x = p.width / 2;
  disc.transform.y = p.height * 0.44;
  disc.effects.push(createEffect('glow'));

  addKf(disc, 'transform.scale', 0, 0.7, 'smooth');
  addKf(disc, 'transform.scale', 3, 1.02, 'smooth');
  addKf(disc, 'transform.scale', 6, 1.16, 'smooth');
  addKf(disc, 'transform.rotation', 0, -10, 'linear');
  addKf(disc, 'transform.rotation', 6, 40, 'linear');
  addKf(disc, 'transform.opacity', 0, 55);
  addKf(disc, 'transform.opacity', 2, 90);

  // main title
  const title = createLayer('text', p);
  title.name = 'Title';
  const T = title.text;
  T.content = 'MOTION\nFORGE';
  T.fontSize = 168;
  T.fontWeight = 800;
  T.letterSpacing = -4;
  T.lineHeight = 0.98;
  T.maxWidth = 1000;
  T.shadow = true;
  T.shadowBlur = 46;
  T.shadowY = 14;
  title.transform.x = p.width / 2;
  title.transform.y = p.height * 0.42;

  addKf(title, 'transform.scale', 0.15, 0.72);
  addKf(title, 'transform.scale', 1.1, 1.0, 'back');
  addKf(title, 'transform.opacity', 0.15, 0);
  addKf(title, 'transform.opacity', 0.65, 100);

  // subtitle
  const sub = createLayer('text', p);
  sub.name = 'Subtitle';
  const S = sub.text;
  S.content = 'DESKTOP MOTION EDITOR';
  S.fontSize = 28;
  S.fontWeight = 600;
  S.letterSpacing = 11;
  S.color = '#b9a8ff';
  S.maxWidth = 900;
  sub.transform.y = p.height * 0.42 + 205;

  addKf(sub, 'transform.opacity', 1.4, 0);
  addKf(sub, 'transform.opacity', 2.1, 100);

  // accent rule
  const rule = createLayer('shape', p);
  rule.name = 'Accent rule';
  rule.shape.kind = 'rect';
  rule.shape.width = 300;
  rule.shape.height = 7;
  rule.shape.radius = 4;
  rule.shape.fill = '#ff4d8d';
  rule.transform.y = sub.transform.y + 90;

  addKf(rule, 'transform.scale', 0.15, 0, 'linear');
  addKf(rule, 'transform.scale', 0.15, 0, 'linear');
  addKf(rule, 'transform.scale', 1.9, 0, 'snappy');
  addKf(rule, 'transform.scale', 2.6, 1, 'snappy');
  addKf(rule, 'transform.opacity', 1.9, 0);
  addKf(rule, 'transform.opacity', 2.2, 100);

  p.layers = [title, sub, rule, disc];
  return p;
}

function addKf(layer, path, t, v, easeId) {
  const kf = setKeyframe(layer, path, t, v);
  if (easeId) kf.ease = easePreset(easeId);
  return kf;
}

// ---------------------------------------------------------------------------
// Debug bridge (used for automated verification; harmless in production)
// ---------------------------------------------------------------------------

window.__mf = {
  store,
  comp,
  mediaCache,
  runExport,
  runFallbackExport,
  fitStage,
  createDemoProject,
  createLayer,
  createEffect,
  setKeyframe,
  easePreset,
  exportDimensions,
  needsRender: () => {
    needsRender = true;
  },
};

// ---------------------------------------------------------------------------

boot();
