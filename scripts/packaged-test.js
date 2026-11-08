// Verifies the packaged Windows build launches and exports.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const exe = process.env.MF_EXE || path.join(root, 'release', 'win-unpacked', 'Nameless Editing.exe');
const outDir = path.join(root, 'test', 'out');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'packaged-export.mp4').replace(/\\/g, '/');

(async () => {
  if (!fs.existsSync(exe)) {
    console.error(`missing packaged exe: ${exe}`);
    process.exit(1);
  }

  const errors = [];
  const app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env, MF_DEBUG: '1' } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.waitForTimeout(2200);

  const info = await page.evaluate(() => ({
    api: window.api.info(),
    layers: window.__mf ? window.__mf.store.project.layers.length : -1,
    title: document.title,
  }));

  await page.evaluate(() => {
    window.__mf.store.setTime(2.4);
    window.__mf.needsRender();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(root, 'test', 'shots', 'packaged.png') });

  const t0 = Date.now();
  const result = await page.evaluate(
    async (outPath) =>
      window.__mf.runExport({
        scale: 0.5,
        fps: 30,
        crf: 20,
        outputPath: outPath,
        includeAudio: true,
        onProgress: () => {},
        shouldCancel: () => false,
      }),
    outPath
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  let probe = '';
  if (result.ok) {
    probe = execFileSync(
      path.join(root, 'bin', 'ffmpeg.exe'),
      ['-hide_banner', '-i', outPath],
      { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] }
    );
  }

  console.log('INFO', JSON.stringify(info, null, 2));
  console.log('EXPORT', JSON.stringify(result), `in ${secs}s`);
  console.log('PROBE', probe.split('\n').filter((l) => /Duration|Stream|Video|Audio/.test(l)).join('\n'));
  console.log('SIZE', result.ok ? fs.statSync(outPath).size : 0);
  console.log('ERRORS', errors.length ? errors.join('\n---\n') : 'none');

  await app.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
