// Smoke test: launch the Electron app, capture console/page errors, screenshot.
const path = require('node:path');
const fs = require('node:fs');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const shots = path.join(root, 'test', 'shots');
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const errors = [];
  const logs = [];

  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    cwd: root,
    env: { ...process.env, MF_DEBUG: '1' },
  });

  const page = await app.firstWindow();
  page.on('console', (m) => {
    logs.push(`[${m.type()}] ${m.text()}`);
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}\n${e.stack || ''}`));

  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => ({
    hasApi: !!window.api,
    hasMf: !!window.__mf,
    layers: window.__mf ? window.__mf.store.project.layers.length : -1,
    project: window.__mf
      ? {
          w: window.__mf.store.project.width,
          h: window.__mf.store.project.height,
          duration: window.__mf.store.project.duration,
        }
      : null,
    canvas: (() => {
      const c = document.getElementById('stage');
      if (!c) return null;
      return { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight };
    })(),
  }));

  await page.screenshot({ path: path.join(shots, 'launch.png') });

  console.log('INFO', JSON.stringify(info, null, 2));
  console.log('LOGS', logs.slice(0, 40).join('\n'));
  console.log('ERRORS', errors.length ? errors.join('\n---\n') : 'none');

  await app.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
