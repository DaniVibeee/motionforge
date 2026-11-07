// ---------------------------------------------------------------------------
// MotionForge — export pipeline (frame-accurate render -> ffmpeg)
// ---------------------------------------------------------------------------

import { store, clamp } from './core.js';
import { Compositor, pauseAllVideos } from './compositor.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runExport({
  scale = 1,
  fps,
  crf = 20,
  outputPath,
  includeAudio = true,
  onProgress = () => {},
  shouldCancel = () => false,
}) {
  const p = store.project;
  const outW = Math.max(2, Math.round((p.width * scale) / 2) * 2);
  const outH = Math.max(2, Math.round((p.height * scale) / 2) * 2);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const comp = new Compositor(canvas);
  comp.setScale(outW / p.width, outH / p.height);

  pauseAllVideos();

  const useFps = Number(fps) || p.fps || 30;
  const total = Math.max(1, Math.round(p.duration * useFps));

  // Pick an audio source: only when exactly one visible video layer has audio.
  let audio = null;
  if (includeAudio) {
    const candidates = p.layers.filter(
      (l) => l.type === 'video' && l.visible && l.src && (l.volume == null || l.volume > 0)
    );
    if (candidates.length === 1) {
      const l = candidates[0];
      audio = {
        path: l.src,
        start: Math.max(0, l.sourceStart || 0),
        duration: Math.max(0.05, (l.end - l.start) * (l.speed || 1)),
        delay: Math.max(0, l.start),
        tempo: l.speed || 1,
        volume: clamp(l.volume == null ? 1 : l.volume, 0, 1),
      };
    }
  }

  const started = await window.api.exportStart({
    outputPath,
    width: outW,
    height: outH,
    fps: useFps,
    crf,
    preset: 'veryfast',
    audio,
    duration: p.duration,
  });

  if (!started.ok) return { ok: false, error: started.error };

  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  try {
    for (let i = 0; i < total; i++) {
      if (shouldCancel()) {
        await window.api.exportCancel();
        return { ok: false, canceled: true };
      }

      const t = i / useFps;
      await comp.prepare(t);
      comp.render(t);

      const img = ctx.getImageData(0, 0, outW, outH);
      const res = await window.api.exportFrame(img.data);
      if (!res || !res.ok) {
        await window.api.exportCancel();
        return { ok: false, error: res?.error || 'Frame write failed' };
      }

      onProgress((i + 1) / total, i + 1, total);
      if (i % 3 === 0) await sleep(0);
    }

    const fin = await window.api.exportFinish();
    if (!fin.ok) return { ok: false, error: fin.error };
    return { ok: true, path: fin.outputPath || outputPath, frames: total };
  } catch (err) {
    await window.api.exportCancel();
    return { ok: false, error: err.message };
  }
}

// Realtime WebM fallback used only if ffmpeg is unavailable.
export async function runFallbackExport({ scale = 1, fps, onProgress = () => {}, shouldCancel = () => false }) {
  const p = store.project;
  const outW = Math.max(2, Math.round((p.width * scale) / 2) * 2);
  const outH = Math.max(2, Math.round((p.height * scale) / 2) * 2);

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const comp = new Compositor(canvas);
  comp.setScale(outW / p.width, outH / p.height);
  pauseAllVideos();

  const useFps = Number(fps) || p.fps || 30;
  const total = Math.max(1, Math.round(p.duration * useFps));

  const stream = canvas.captureStream(useFps);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise((r) => {
    rec.onstop = r;
  });
  rec.start(200);

  const frameMs = 1000 / useFps;
  const t0 = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      if (shouldCancel()) {
        rec.stop();
        await stopped;
        return { ok: false, canceled: true };
      }
      const wait = t0 + i * frameMs - performance.now();
      if (wait > 0) await sleep(wait);
      await comp.prepare(i / useFps);
      comp.render(i / useFps);
      onProgress((i + 1) / total, i + 1, total);
    }
  } finally {
    if (rec.state !== 'inactive') rec.stop();
  }
  await stopped;

  const blob = new Blob(chunks, { type: 'video/webm' });
  const buf = await blob.arrayBuffer();
  const res = await window.api.saveBuffer(buf, `${p.name || 'export'}.webm`);
  return res && res.ok ? { ok: true, path: res.path, fallback: true } : { ok: false, error: res?.error || 'Save failed' };
}
