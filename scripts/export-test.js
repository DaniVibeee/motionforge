// Export test: builds a scene with the demo + an imported video layer, exports MP4, verifies output.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const shots = path.join(root, 'test', 'shots');
const outDir = path.join(root, 'test', 'out');
fs.mkdirSync(shots, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const videoSrc = path.join(root, 'test', 'assets', 'test.mp4').replace(/\\/g, '/');
const outPath = path.join(outDir, 'export-test.mp4').replace(/\\/g, '/');

(async () => {
  const errors = [];
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    cwd: root,
    env: { ...process.env, MF_DEBUG: '1' },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.waitForTimeout(1500);

  const info = await page.evaluate(() => window.api.info());
  console.log('APPINFO', JSON.stringify(info));

  // Add a video layer and wait for it to decode.
  const videoReady = await page.evaluate(async (src) => {
    const mf = window.__mf;
    const p = mf.store.project;
    const layer = mf.createLayer('video', p, {
      src,
      mediaName: 'test.mp4',
      mediaW: 720,
      mediaH: 1280,
      width: 700,
      height: 1244,
    });
    layer.name = 'Test video';
    layer.end = 5;
    mf.store.addLayer(layer);
    mf.store.setTime(1.5);
    mf.needsRender();

    for (let i = 0; i < 120; i++) {
      const c = mf.comp.buildContent(layer, 1.5);
      if (c && c.w > 0) return { ok: true, w: c.w, h: c.h, tries: i };
      await new Promise((r) => setTimeout(r, 100));
    }
    return { ok: false };
  }, videoSrc);
  console.log('VIDEO', JSON.stringify(videoReady));

  // Let the renderer seek and draw the video frame.
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__mf.needsRender());
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(shots, 'video-layer.png') });

  // Export
  const t0 = Date.now();
  const result = await page.evaluate(
    async ({ outPath }) => {
      return await window.__mf.runExport({
        scale: 0.5,
        fps: 30,
        crf: 20,
        outputPath: outPath,
        includeAudio: true,
        onProgress: () => {},
        shouldCancel: () => false,
      });
    },
    { outPath }
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('EXPORT', JSON.stringify(result), `in ${secs}s`);

  await page.screenshot({ path: path.join(shots, 'after-export.png') });

  if (result.ok) {
    const probe = execFileSync(
      path.join(root, 'bin', 'ffprobe.exe'),
      [
        '-v', 'error',
        '-show_entries', 'stream=index,codec_name,codec_type,width,height,r_frame_rate',
        '-show_entries', 'format=duration,size,bit_rate',
        '-of', 'json',
        outPath,
      ],
      { encoding: 'utf8' }
    );
    console.log('PROBE', probe);

    // extract a frame for visual verification
    const framePath = path.join(shots, 'export-frame-2.5s.png');
    execFileSync(path.join(root, 'bin', 'ffmpeg.exe'), [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-ss', '2.5',
      '-i', outPath,
      '-frames:v', '1',
      framePath,
    ]);
    console.log('FRAME', framePath, fs.statSync(framePath).size);
  }

  console.log('ERRORS', errors.length ? errors.join('\n---\n') : 'none');
  await app.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
