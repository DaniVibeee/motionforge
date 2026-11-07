'use strict';

const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { Readable } = require('node:stream');

const isDev = !app.isPackaged;

// Allow video layers to play without a prior user gesture (playback controls).
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---------------------------------------------------------------------------
// Custom protocol so the renderer can stream local media (images / videos)
// with byte-range support (required for seeking inside <video>).
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

const MIME = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

function mimeFor(p) {
  return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
}

function registerMediaProtocol() {
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);
      const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''));
      if (!filePath) return new Response('Bad request', { status: 400 });

      const stat = await fsp.stat(filePath);
      const total = stat.size;
      const range = request.headers.get('range');
      const type = mimeFor(filePath);

      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        let start = m && m[1] ? parseInt(m[1], 10) : 0;
        let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
        if (Number.isNaN(start) || Number.isNaN(end) || start > end) {
          start = 0;
          end = total - 1;
        }
        end = Math.min(end, total - 1);
        const stream = fs.createReadStream(filePath, { start, end });
        return new Response(Readable.toWeb(stream), {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store',
          },
        });
      }

      const stream = fs.createReadStream(filePath);
      return new Response(Readable.toWeb(stream), {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(total),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store',
        },
      });
    } catch (err) {
      return new Response('Not found: ' + err.message, { status: 404 });
    }
  });
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1180,
    minHeight: 720,
    backgroundColor: '#0b0d12',
    show: false,
    autoHideMenuBar: true,
    title: 'MotionForge',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  if (process.env.MF_DEBUG) {
    win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      console.log(`[renderer:${level}] ${message}  (${sourceId}:${line})`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.log(`[did-fail-load] ${code} ${desc} ${url}`);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      console.log(`[render-process-gone] ${JSON.stringify(details)}`);
    });
  }

  win.on('closed', () => {
    win = null;
  });
}

// ---------------------------------------------------------------------------
// ffmpeg resolution (bundled binary first, then PATH)
// ---------------------------------------------------------------------------
function ffmpegCandidates() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return [
    path.join(process.resourcesPath || '', 'bin', exe),
    path.join(__dirname, 'bin', exe),
    path.join(app.getPath('userData'), 'bin', exe),
    exe,
  ];
}

let ffmpegPath = null;
function resolveFFmpeg() {
  if (ffmpegPath) return ffmpegPath;
  for (const c of ffmpegCandidates()) {
    try {
      if (c !== 'ffmpeg' && fs.existsSync(c)) {
        ffmpegPath = c;
        return c;
      }
    } catch {}
  }
  ffmpegPath = 'ffmpeg';
  return ffmpegPath;
}

function ffmpegAvailable() {
  const p = resolveFFmpeg();
  if (p === 'ffmpeg') return false;
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Export session (raw RGBA frames piped into ffmpeg)
// ---------------------------------------------------------------------------
let exportSession = null;

function killExport() {
  if (!exportSession) return;
  const s = exportSession;
  exportSession = null;
  try {
    s.proc.stdin.destroy();
  } catch {}
  try {
    s.proc.kill('SIGKILL');
  } catch {}
}

function probeAudio(bin, file) {
  return new Promise((resolve) => {
    let err = '';
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    try {
      const proc = spawn(bin, ['-hide_banner', '-i', file], { windowsHide: true });
      proc.stderr.on('data', (d) => {
        err += d.toString();
        if (err.length > 60000) err = err.slice(-60000);
      });
      proc.on('error', () => finish(false));
      proc.on('close', () => finish(/Stream #\d+:\d+.*: Audio:/.test(err)));
      setTimeout(() => {
        try {
          proc.kill();
        } catch {}
        finish(false);
      }, 5000);
    } catch {
      finish(false);
    }
  });
}

function tempoFilter(speed) {
  let s = Math.max(0.01, Number(speed) || 1);
  const parts = [];
  while (s > 2) {
    parts.push('atempo=2.0');
    s /= 2;
  }
  while (s < 0.5) {
    parts.push('atempo=0.5');
    s *= 2;
  }
  if (Math.abs(s - 1) > 0.01) parts.push(`atempo=${s.toFixed(4)}`);
  return parts;
}

async function startExport(opts) {
  if (exportSession) killExport();
  const bin = resolveFFmpeg();
  const { outputPath, width, height, fps, crf = 18, preset = 'veryfast', audio = null, duration = 0 } = opts;

  let hasAudio = false;
  if (audio && audio.path && fs.existsSync(audio.path)) {
    hasAudio = await probeAudio(bin, audio.path);
  }

  return new Promise((resolve) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${width}x${height}`,
      '-r', String(fps),
      '-i', 'pipe:0',
    ];

    if (hasAudio) {
      const ss = Math.max(0, Number(audio.start) || 0);
      const at = Math.max(0.05, Number(audio.duration) || duration || 1);
      args.push('-ss', String(ss), '-t', String(at), '-i', audio.path);
      args.push('-map', '0:v:0', '-map', '1:a:0?', '-c:a', 'aac', '-b:a', '192k');

      const filters = [];
      const delay = Math.max(0, Number(audio.delay) || 0);
      if (delay > 0.001) filters.push(`adelay=${Math.round(delay * 1000)}:all=1`);
      const vol = Number(audio.volume);
      if (Number.isFinite(vol) && vol < 0.999) filters.push(`volume=${Math.max(0, vol).toFixed(3)}`);
      filters.push(...tempoFilter(audio.tempo));
      if (filters.length) args.push('-af', filters.join(','));
    } else {
      args.push('-an');
    }

    args.push(
      '-c:v', 'libx264',
      '-preset', preset,
      '-crf', String(crf),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-r', String(fps)
    );
    if (duration > 0) args.push('-t', String(duration));
    args.push(outputPath);

    const proc = spawn(bin, args, { windowsHide: true });
    const session = { proc, outputPath, stderr: '', done: false };
    exportSession = session;

    proc.stderr.on('data', (d) => {
      session.stderr += d.toString();
      if (session.stderr.length > 20000) session.stderr = session.stderr.slice(-20000);
    });

    proc.on('error', (err) => {
      session.error = err.message;
    });

    proc.on('close', (code) => {
      session.done = true;
      session.exitCode = code;
      if (exportSession === session) exportSession = null;
    });

    // give it a moment to fail fast (bad path, missing binary)
    setTimeout(() => {
      if (session.error) resolve({ ok: false, error: session.error });
      else resolve({ ok: true });
    }, 120);
  });
}

function writeFrame(buffer) {
  return new Promise((resolve) => {
    const s = exportSession;
    if (!s || s.done) return resolve({ ok: false, error: 'no export session' });
    const buf = Buffer.from(buffer);
    const flushed = s.proc.stdin.write(buf, () => {});
    if (flushed) return resolve({ ok: true });
    s.proc.stdin.once('drain', () => resolve({ ok: true }));
    setTimeout(() => resolve({ ok: true }), 5000);
  });
}

function finishExport() {
  return new Promise((resolve) => {
    const s = exportSession;
    if (!s) return resolve({ ok: false, error: 'no export session' });
    const done = () => {
      if (s.error) return resolve({ ok: false, error: s.error });
      if (s.exitCode !== 0) return resolve({ ok: false, error: s.stderr || `ffmpeg exited with ${s.exitCode}` });
      resolve({ ok: true, outputPath: s.outputPath });
    };
    if (s.done) return done();
    s.proc.once('close', done);
    try {
      s.proc.stdin.end();
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function safeJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  ffmpeg: ffmpegAvailable(),
  ffmpegPath: resolveFFmpeg(),
  dev: isDev,
}));

ipcMain.handle('project:save', async (_e, { data, suggestedName }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Save project',
    defaultPath: path.join(app.getPath('documents'), `${suggestedName || 'project'}.mfproj`),
    filters: [{ name: 'MotionForge Project', extensions: ['mfproj'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  await fsp.writeFile(res.filePath, data, 'utf8');
  return { ok: true, path: res.filePath };
});

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Open project',
    properties: ['openFile'],
    filters: [{ name: 'MotionForge Project', extensions: ['mfproj'] }, { name: 'All files', extensions: ['*'] }],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  const p = res.filePaths[0];
  const data = await fsp.readFile(p, 'utf8');
  return { ok: true, path: p, data };
});

ipcMain.handle('media:import', async (_e, kind) => {
  const filters =
    kind === 'video'
      ? [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'] }]
      : kind === 'audio'
        ? [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }]
        : [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] }];

  const res = await dialog.showOpenDialog(win, {
    title: `Import ${kind}`,
    properties: ['openFile', 'multiSelections'],
    filters: [...filters, { name: 'All files', extensions: ['*'] }],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };

  const files = [];
  for (const p of res.filePaths) {
    try {
      const st = await fsp.stat(p);
      files.push({ path: p, name: path.basename(p), size: st.size, kind });
    } catch {}
  }
  return { ok: true, files };
});

ipcMain.handle('export:choose', async (_e, suggestedName) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Export video',
    defaultPath: path.join(app.getPath('videos'), `${suggestedName || 'export'}.mp4`),
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  return { ok: true, path: res.filePath };
});

ipcMain.handle('export:start', async (_e, opts) => {
  if (!ffmpegAvailable()) return { ok: false, error: 'ffmpeg-not-found' };
  return startExport(opts);
});

ipcMain.handle('export:frame', async (_e, buffer) => {
  return writeFrame(buffer);
});

ipcMain.handle('export:finish', async () => finishExport());

ipcMain.handle('export:cancel', async () => {
  killExport();
  return { ok: true };
});

ipcMain.handle('export:saveBuffer', async (_e, { buffer, suggestedName }) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Save video',
    defaultPath: path.join(app.getPath('videos'), suggestedName || 'export.webm'),
    filters: [{ name: 'WebM Video', extensions: ['webm'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  await fsp.writeFile(res.filePath, Buffer.from(buffer));
  return { ok: true, path: res.filePath };
});

ipcMain.handle('shell:showItem', async (_e, p) => {
  shell.showItemInFolder(p);
  return { ok: true };
});

ipcMain.handle('shell:openPath', async (_e, p) => {
  await shell.openPath(p);
  return { ok: true };
});

ipcMain.handle('media:probe', async (_e, p) => {
  // Basic metadata for imported media (dimensions / duration) using ffprobe if present,
  // otherwise the renderer measures it with <img>/<video>.
  return { ok: false };
});

// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  registerMediaProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  killExport();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => killExport());
