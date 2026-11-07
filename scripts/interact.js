// Interaction test: preview, selection, canvas drag, inspector, graph editor.
const path = require('node:path');
const fs = require('node:fs');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const shots = path.join(root, 'test', 'shots');
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const errors = [];
  const app = await electron.launch({
    executablePath: require('electron'),
    args: ['.'],
    cwd: root,
    env: { ...process.env, MF_DEBUG: '1' },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}\n${e.stack || ''}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.waitForTimeout(1800);

  // Preview mid-animation
  await page.evaluate(() => {
    const { store } = window.__mf;
    store.setTime(2.6);
    window.__mf.needsRender();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, 'preview-2.6s.png') });

  // Select the title layer
  const sel = await page.evaluate(() => {
    const { store } = window.__mf;
    const title = store.project.layers.find((l) => l.name === 'Title');
    store.select(title.id);
    store.setTime(2.6);
    window.__mf.needsRender();
    return { id: title.id, x: title.transform.x, y: title.transform.y, scale: title.transform.scale };
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(shots, 'selected-title.png') });

  const bboxVisible = await page.evaluate(() => {
    const b = document.getElementById('bbox');
    const r = b.getBoundingClientRect();
    return { cls: b.className, w: r.width, h: r.height, transform: b.style.transform };
  });

  // Drag the layer on the canvas
  const before = await page.evaluate(() => {
    const { store } = window.__mf;
    const l = store.selectedLayer;
    return { x: window.__mf.store.time, tx: l.transform.x, ty: l.transform.y };
  });
  const box = await page.locator('#bbox').boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 8 });
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const l = window.__mf.store.selectedLayer;
    return { tx: l.transform.x, ty: l.transform.y, kfs: Object.keys(l.keyframes).length };
  });

  // Inspector: toggle a keyframe on rotation
  const kfBefore = await page.evaluate(() => {
    const l = window.__mf.store.selectedLayer;
    return { rot: (l.keyframes['transform.rotation'] || []).length };
  });
  const rotRow = page.locator('.prop-row').nth(3);
  await rotRow.locator('.kf-btn').click();
  await page.waitForTimeout(300);
  const kfAfter = await page.evaluate(() => {
    const l = window.__mf.store.selectedLayer;
    return { rot: (l.keyframes['transform.rotation'] || []).length };
  });

  await page.screenshot({ path: path.join(shots, 'inspector-effects.png') });

  // Effects tab
  await page.locator('.tab[data-tab="effects"]').click();
  await page.waitForTimeout(300);
  const fx = await page.evaluate(() => {
    const l = window.__mf.store.selectedLayer;
    const sel = document.getElementById('inspector')?.querySelector('select');
    return { effects: l.effects.length, hasSelect: !!sel };
  });
  await page.screenshot({ path: path.join(shots, 'effects-tab.png') });

  // Graph editor
  await page.locator('#modeGraph').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shots, 'graph-editor.png') });

  const graph = await page.evaluate(() => {
    const c = document.getElementById('graphCanvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let nonEmpty = 0;
    for (let i = 3; i < d.length; i += 4000) if (d[i] > 0) nonEmpty++;
    return { w: c.width, h: c.height, nonEmpty };
  });

  console.log('SELECT', JSON.stringify(sel));
  console.log('BBOX', JSON.stringify(bboxVisible));
  console.log('DRAG', JSON.stringify({ before, after }));
  console.log('KF', JSON.stringify({ kfBefore, kfAfter }));
  console.log('FX', JSON.stringify(fx));
  console.log('GRAPH', JSON.stringify(graph));
  console.log('ERRORS', errors.length ? errors.join('\n---\n') : 'none');

  await app.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
