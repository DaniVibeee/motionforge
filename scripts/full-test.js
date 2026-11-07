// Full interaction test.
const path = require('node:path');
const fs = require('node:fs');
const { _electron: electron } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const shots = path.join(root, 'test', 'shots');
fs.mkdirSync(shots, { recursive: true });

const videoSrc = path.join(root, 'test', 'assets', 'test.mp4').replace(/\\/g, '/');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

  await page.waitForTimeout(1600);
  const results = {};

  // ---- playback ----------------------------------------------------------
  await page.locator('#playBtn').click();
  await sleep(1400);
  const tPlaying = await page.evaluate(() => window.__mf.store.time);
  await page.locator('#playBtn').click();
  const tPaused = await page.evaluate(() => ({
    time: window.__mf.store.time,
    playing: window.__mf.store.playing,
  }));
  results.playback = { tPlaying, tPaused };

  // ---- select title and drag on canvas -----------------------------------
  const start = await page.evaluate(() => {
    const { store } = window.__mf;
    const title = store.project.layers.find((l) => l.name === 'Title');
    store.select(title.id);
    store.setTime(2.6);
    window.__mf.needsRender();
    return { id: title.id, x: title.transform.x, y: title.transform.y };
  });
  await sleep(600);

  const box = await page.locator('#bbox').boundingBox();
  results.bbox = box;
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 25, { steps: 10 });
    await page.mouse.up();
  }
  await sleep(400);
  const dragged = await page.evaluate(() => {
    const l = window.__mf.store.selectedLayer;
    return { x: l.transform.x, y: l.transform.y };
  });
  results.canvasDrag = { before: start, after: dragged };
  await page.screenshot({ path: path.join(shots, 'drag-result.png') });

  // undo canvas drag
  await page.evaluate(() => window.__mf.store.undo());
  await sleep(300);
  const undone = await page.evaluate(() => {
    const l = window.__mf.store.selectedLayer;
    return { x: l.transform.x, y: l.transform.y, undoDepth: window.__mf.store.undoStack.length };
  });
  results.undo = undone;

  // ---- add blur effect via UI --------------------------------------------
  await page.locator('.tab[data-tab="effects"]').click();
  await sleep(200);
  const pixelBefore = await page.evaluate(() => {
    const c = document.getElementById('stage');
    const d = c.getContext('2d').getImageData(340, 520, 400, 400).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 16) s += d[i] + d[i + 1] + d[i + 2];
    return s;
  });
  await page.locator('#inspector select').last().selectOption('blur');
  await page.locator('#inspector .btn.tiny', { hasText: 'Add' }).click();
  await sleep(700);
  const fxState = await page.evaluate(() => {
    const l = window.__mf.store.selectedLayer;
    return { effects: l.effects.map((e) => ({ type: e.type, enabled: e.enabled })) };
  });
  const pixelAfter = await page.evaluate(() => {
    const c = document.getElementById('stage');
    const d = c.getContext('2d').getImageData(340, 520, 400, 400).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 16) s += d[i] + d[i + 1] + d[i + 2];
    return s;
  });
  results.effects = { fxState, pixelBefore, pixelAfter, changed: pixelBefore !== pixelAfter };
  await page.screenshot({ path: path.join(shots, 'blur-added.png') });

  // remove effect via UI (undo)
  await page.evaluate(() => window.__mf.store.undo());
  await sleep(300);

  // ---- timeline: drag clip ------------------------------------------------
  await page.locator('#modeTimeline').click();
  await sleep(300);
  const clipSel = `#tlRows .tl-row[data-id="${start.id}"] .tl-clip`;
  const clipBox = await page.locator(clipSel).boundingBox();
  const edgeBox = await page.locator(`${clipSel} .edge.r`).boundingBox();
  const layerBefore = await page.evaluate((id) => {
    const l = window.__mf.store.project.layers.find((x) => x.id === id);
    return { start: l.start, end: l.end };
  }, start.id);
  if (edgeBox) {
    await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(edgeBox.x + edgeBox.width / 2 - 45, edgeBox.y + edgeBox.height / 2, { steps: 10 });
    await page.mouse.up();
  }
  await sleep(300);
  const layerAfter = await page.evaluate((id) => {
    const l = window.__mf.store.project.layers.find((x) => x.id === id);
    return { start: l.start, end: l.end };
  }, start.id);
  results.timelineClipDrag = { layerBefore, layerAfter };
  await page.evaluate(() => window.__mf.store.undo());
  await sleep(200);

  // ---- graph editor: drag keyframe and bezier handle ---------------------
  await page.locator('#modeGraph').click();
  await sleep(500);
  const gState = await page.evaluate(() => window.__mfGraph.state());
  results.graphInitial = {
    path: gState.selectedPath,
    points: gState.points,
    handles: gState.handles,
  };

  const gc = await page.locator('#graphCanvas').boundingBox();
  const p0 = gState.points[0];
  if (gc && p0) {
    await page.mouse.move(gc.x + p0.x, gc.y + p0.y);
    await page.mouse.down();
    await page.mouse.move(gc.x + p0.x + 40, gc.y + p0.y - 18, { steps: 10 });
    await page.mouse.up();
  }
  await sleep(500);
  const gAfter = await page.evaluate(() => window.__mfGraph.state());
  results.graphAfterDrag = {
    selected: gAfter.selected,
    points: gAfter.points,
    ease: gAfter.ease,
    handles: gAfter.handles,
  };
  await page.screenshot({ path: path.join(shots, 'graph-after-drag.png') });

  // drag outgoing bezier handle if available
  if (gAfter.handles && gAfter.handles.out) {
    const h = gAfter.handles.out;
    await page.mouse.move(gc.x + h.x, gc.y + h.y);
    await page.mouse.down();
    await page.mouse.move(gc.x + h.x + 25, gc.y + h.y - 30, { steps: 8 });
    await page.mouse.up();
    await sleep(400);
  }
  const gHandle = await page.evaluate(() => window.__mfGraph.state());
  results.graphAfterHandle = { ease: gHandle.ease, handles: gHandle.handles };
  await page.screenshot({ path: path.join(shots, 'graph-handle-drag.png') });

  // ---- project resize ----------------------------------------------------
  await page.locator('#projW').fill('720');
  await page.locator('#projW').dispatchEvent('change');
  await page.locator('#projH').fill('1280');
  await page.locator('#projH').dispatchEvent('change');
  await sleep(500);
  results.resize = await page.evaluate(() => ({
    w: window.__mf.store.project.width,
    h: window.__mf.store.project.height,
    canvas: (() => {
      const c = document.getElementById('stage');
      return { w: c.width, h: c.height };
    })(),
  }));
  await page.screenshot({ path: path.join(shots, 'resized-720x1280.png') });

  // ---- video layer playback ---------------------------------------------
  await page.evaluate(async (src) => {
    const mf = window.__mf;
    mf.store.setProject(mf.createDemoProject());
    const p = mf.store.project;
    const layer = mf.createLayer('video', p, {
      src,
      mediaName: 'test.mp4',
      mediaW: 720,
      mediaH: 1280,
      width: 600,
      height: 1066,
    });
    layer.name = 'Playback test';
    layer.end = 5;
    mf.store.addLayer(layer);
    mf.store.setTime(0);
    for (let i = 0; i < 120; i++) {
      if (mf.comp.buildContent(layer, 0)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    mf.needsRender();
  }, videoSrc);
  await sleep(800);
  await page.locator('#playBtn').click();
  await sleep(1500);
  results.videoPlayback = await page.evaluate(() => {
    const vids = [...window.__mf.mediaCache.videos.values()];
    const e = vids[vids.length - 1];
    return e
      ? {
          currentTime: e.el.currentTime,
          paused: e.el.paused,
          ready: e.ready,
          duration: e.duration,
          storeTime: window.__mf.store.time,
        }
      : null;
  });
  await page.locator('#playBtn').click();
  await page.screenshot({ path: path.join(shots, 'video-playback.png') });

  fs.writeFileSync(path.join(root, 'test', 'results.json'), JSON.stringify(results, null, 2));
  console.log('RESULTS_WRITTEN');
  console.log('ERRORS', errors.length ? errors.join('\n---\n') : 'none');

  await app.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
