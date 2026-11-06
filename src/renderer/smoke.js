// End-to-end self test, run with: npm run smoke
// Loads the demo beat through the real path, draws every look, runs every export,
// and writes pictures and a report for inspection.
import { LOOK_LIST, LOOKS } from '../looks/index.js';
import { PAGES } from '../core/pages.js';
import { applyPreset, capturePreset } from '../core/presets.js';
import { Stage, defaultScene } from '../core/stage.js';
import { PALETTES } from '../core/style.js';

const app = window.app;

// Three pictures of different shapes and colours, for Image Cuts.
async function testPictures() {
  return Promise.all([['#d8344a', 300, 150], ['#2b6be0', 150, 300], ['#32b56c', 240, 240]].map(async ([colour, w, h], k) => {
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    x.fillStyle = colour; x.fillRect(0, 0, w, h);
    x.fillStyle = '#fff'; x.fillRect(w * 0.3, h * 0.3, w * 0.4, h * 0.4);
    return { bitmap: await createImageBitmap(c), w, h, id: k + 1, name: `test ${k}` };
  }));
}
const report = { ok: true, errors: [], steps: {} };
const fail = (m) => { report.ok = false; report.errors.push(m); console.error(m); };
addEventListener('error', (e) => fail(`window error: ${e.message}`));
addEventListener('unhandledrejection', (e) => fail(`rejection: ${e.reason?.message ?? e.reason}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const { out } = await window.sp.smokeInfo();
const sep = out.includes('\\') ? '\\' : '/';
const file = (n) => `${out}${sep}${n}`;

async function contact(A, name, ids, palette, W = 6, tile = 430) {
  const H = Math.ceil(ids.length / W);
  const sheet = new OffscreenCanvas(W * tile, H * tile), sg = sheet.getContext('2d');
  sg.fillStyle = '#222'; sg.fillRect(0, 0, sheet.width, sheet.height);
  const palettes = Array.isArray(palette) ? palette : [palette];
  const times = {};
  for (let k = 0; k < ids.length; k++) {
    const c = new OffscreenCanvas(tile - 6, tile - 6), g = c.getContext('2d');
    const scene = { ...defaultScene(), look: ids[k], palette: palettes[k % palettes.length] };
    const t0 = performance.now();
    try {
      new Stage().render(g, c.width, c.height, A, A.duration * 0.72, scene);
    } catch (e) { fail(`look ${ids[k]}: ${e.stack}`); }
    times[ids[k]] = Math.round(performance.now() - t0);
    sg.drawImage(c, (k % W) * tile + 3, Math.floor(k / W) * tile + 3);
    await wait(0);
  }
  const blob = await sheet.convertToBlob({ type: 'image/png' });
  await window.sp.write(file(name), new Uint8Array(await blob.arrayBuffer()));
  return times;
}

try {
  const item = await app.loadDemo();
  while (!item.A && item.status !== 'failed') await wait(100);
  if (!item.A) throw new Error(`Demo failed: ${item.error}`);
  const A = item.A;
  report.steps.analysis = { bpm: A.bpm, key: A.key.name, lufs: A.lufs, peak: A.peakDb, hits: A.hits.length, notes: A.notes.length, sections: A.sections.length };
  const ids = LOOK_LIST.map((l) => l.id);
  report.lookCount = ids.length;

  report.steps.renderMs = await contact(A, 'looks-dark.png', ids, ['carbon', 'plasma', 'ember', 'moss', 'ultra']);
  await contact(A, 'looks-light.png', ids, ['newsprint', 'riso', 'bone']);

  // Footage through the real path: FFmpeg to frames, frames to bitmaps.
  const footage = await app.setVideo(await window.sp.smokeVideo());
  if (!footage) throw new Error('Video did not load');
  report.steps.footage = { frames: footage.frames, size: [footage.w, footage.h], dur: footage.duration };
  if (footage.frames !== 210 || footage.w !== 640) fail('test footage came in wrong');

  // Every setting has to change the picture and survive both ends of its range.
  {
    const w = 300, ic = new OffscreenCanvas(w, w), ix = ic.getContext('2d', { willReadFrequently: true });
    ix.fillStyle = '#123a7a'; ix.fillRect(0, 0, w, w);
    ix.fillStyle = '#ffcf33'; ix.fillRect(60, 60, 180, 180);
    const image = { w, h: w, data: ix.getImageData(0, 0, w, w).data, id: 7 };
    const images = await testPictures();
    const dead = [];
    let count = 0;
    for (const look of LOOK_LIST) {
      if (!look.params?.length) fail(`${look.id} has no settings`);
      for (const q of look.params ?? []) {
        const video = look.needsVideo ? footage : null;
        const dense = look.needsVideo || look.needsImages;
        const fixed = look.needsImages ? { cut: 0 } : look.needsVideo ? { cropZoom: 2, chop: 1, time: q.id === 'every' || q.id === 'mix' ? 18 : 7, gate: 2, target: 1, dissolve: 0.2, soft: 0.02, zoom: 1, rgb: 1, tint: 1 } : {};
        const shot = async (v, t) => {
          const c = new OffscreenCanvas(260, 260), g = c.getContext('2d', { willReadFrequently: true });
          const scene = { ...defaultScene(), look: look.id, image, images, video, palette: 'plasma', params: { [look.id]: { ...fixed, [q.id]: v } } };
          try { const st = new Stage(); await st.prepare(A, t, scene); st.render(g, 260, 260, A, t, scene); } catch (e) { fail(`${look.id}.${q.id}=${v}: ${e.message}`); }
          return g.getImageData(0, 0, 260, 260).data;
        };
        const changed = async (t) => {
          const a = await shot(q.min, t), b = await shot(q.max, t);
          let n = 0;
          for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
          return n;
        };
        // Some details, such as the tips on Roots, only exist near the end of a track.
        let diff = 0;
        for (const t of dense ? [38, 38.07, 38.14, 38.21, 38.28, 38.35, 38.5, 38.7, 38.9, 39.1] : [38, A.duration - 0.5]) diff = Math.max(diff, await changed(t));
        count++;
        if (diff < 40) dead.push(`${look.id}.${q.id} (${diff})`);
      }
      await wait(0);
    }
    report.steps.settings = count;
    if (dead.length) fail(`settings with no effect: ${dead.join(', ')}`);

    // Crop: at the far corners the footage must still fill the frame.
    const cropTries = [{}, { cropZoom: 3 }, { cropZoom: 3, cropX: -1, cropY: -1 }, { cropZoom: 3, cropX: 1, cropY: 1 }];
    const sheet = new OffscreenCanvas(320 * cropTries.length, 180), sx = sheet.getContext('2d');
    for (const [k, crop] of cropTries.entries()) {
      const c = new OffscreenCanvas(320, 180), g = c.getContext('2d', { willReadFrequently: true });
      const scene = { ...defaultScene(), look: 'video', video: footage, chrome: false, palette: 'plasma', params: { video: crop } };
      const st = new Stage();
      await st.prepare(A, 38, scene);
      st.render(g, 320, 180, A, 38, scene);
      sx.drawImage(c, k * 320, 0);
      const bg = g.getImageData(0, 0, 1, 1).data, far = g.getImageData(160, 90, 1, 1).data;
      report.steps.crop = [...(report.steps.crop ?? []), [...bg].slice(0, 3).join() + ' ' + [...far].slice(0, 3).join()];
    }
    await window.sp.write(file('crop.png'), new Uint8Array(await (await sheet.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }

  // Instant looks must be pure: the same moment twice gives identical pixels.
  const pure = [];
  for (const id of LOOK_LIST.filter((l) => l.kind === 'instant').map((l) => l.id)) {
    const hashOf = () => {
      const c = new OffscreenCanvas(160, 160), g = c.getContext('2d', { willReadFrequently: true });
      new Stage().render(g, 160, 160, A, 20.5, { ...defaultScene(), look: id });
      const d = g.getImageData(0, 0, 160, 160).data;
      let h = 0;
      for (let i = 0; i < d.length; i++) h = (Math.imul(h, 31) + d[i]) | 0;
      return h;
    };
    if (hashOf() !== hashOf()) pure.push(id);
  }
  if (pure.length) fail(`not repeatable: ${pure.join(', ')}`);
  report.steps.repeatable = pure.length === 0;

  // Sheet pages must not depend on how the playhead got there.
  {
    const c1 = new OffscreenCanvas(300, 300), g1 = c1.getContext('2d', { willReadFrequently: true });
    const c2 = new OffscreenCanvas(300, 300), g2 = c2.getContext('2d', { willReadFrequently: true });
    const scene = { ...defaultScene(), look: 'seismo' };
    const a = new Stage(), b = new Stage();
    a.render(g1, 300, 300, A, 30, scene);
    for (const t of [5, 40, 12, 30]) b.render(g2, 300, 300, A, t, scene);
    const da = g1.getImageData(0, 0, 300, 300).data, db = g2.getImageData(0, 0, 300, 300).data;
    let diff = 0;
    for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diff++;
    report.steps.sheetSeekDiff = diff;
    if (diff) fail(`sheet differs after scrubbing: ${diff} bytes`);
  }

  // A file that is not audio must fail on its own line and leave the app working.
  {
    const bad = file('not-audio.mp3');
    await window.sp.write(bad, 'this is not audio');
    const before = app.state.tracks.length;
    app.addFiles([bad]);
    const it = app.state.tracks[before];
    for (let k = 0; k < 100 && it.status !== 'failed'; k++) await wait(50);
    report.steps.badFile = it.status;
    if (it.status !== 'failed' || app.state.cur !== item) fail(`bad file: ${it.status}`);
  }

  // Real render cost: read a pixel back so the GPU queue has to finish.
  {
    const c = new OffscreenCanvas(1920, 1080), g = c.getContext('2d', { willReadFrequently: true }), cost = {};
    for (const id of LOOK_LIST.filter((l) => l.kind === 'instant').map((l) => l.id)) {
      const st = new Stage(), t0 = performance.now();
      for (let k = 0; k < 6; k++) { st.render(g, 1920, 1080, A, 30 + k / 30, { ...defaultScene(), look: id }); g.getImageData(0, 0, 1, 1); }
      cost[id] = Math.round((performance.now() - t0) / 6);
    }
    report.steps.msPerFrame1080p = cost;
  }

  // Sync check: the spectrum's bass bars, measured later from the finished file.
  app.state.scene.look = 'spectrum';
  app.state.scene.palette = 'graphite';
  app.state.scene.chrome = false;
  document.querySelector('#xFormat [data-v="1:1"]').click();
  document.querySelector('#xFps [data-v="60"]').click();
  document.querySelector('#xStart [data-v="head"]').click();
  app.seek(20);
  await app.doExportVideo(file('sync.mp4'));
  document.querySelector('#xStart [data-v="best"]').click();
  document.querySelector('#xFps [data-v="30"]').click();
  app.state.scene.chrome = true;

  // Video: the three real paths through FFmpeg.
  document.querySelector('#xFormat [data-v="9:16"]').click();
  document.querySelector('#xLength [data-v="15"]').click();
  document.querySelector('#xFps [data-v="30"]').click();
  app.state.scene.look = 'tunnel';
  app.state.scene.palette = 'plasma';
  const vid = await app.doExportVideo(file('clip-9x16.mp4'));
  report.steps.video = { fps: vid.fps, frames: vid.frames, probe: await window.sp.probe(file('clip-9x16.mp4')) };

  document.querySelector('#xFormat [data-v="16:9"]').click();
  document.querySelector('#xRes [data-v="4K"]').click();
  app.state.scene.look = 'seismo';
  app.state.scene.palette = 'newsprint';
  const v4 = await app.doExportVideo(file('clip-4k.mp4'));
  report.steps.video4k = { fps: v4.fps, frames: v4.frames };
  document.querySelector('#xRes [data-v="HD"]').click();

  app.state.scene.look = 'spectrum';
  app.state.scene.transparent = true;
  app.state.scene.palette = 'carbon';
  const ov = await app.doExportVideo(file('overlay.mov'));
  report.steps.overlay = { fps: ov.fps, probe: await window.sp.probe(file('overlay.mov')) };
  app.state.scene.transparent = false;

  app.state.scene.mode = 'auto';
  document.querySelector('#xLength [data-v="30"]').click();
  const au = await app.doExportVideo(file('auto-edit.mp4'));
  report.steps.auto = { fps: au.fps };
  app.state.scene.mode = 'compose';
  await app.stillExport('cover', file('compose-cover.png'));

  // Compose layout through the real editor: five sheet looks on a tall page.
  {
    const sc = app.state.scene;
    document.querySelector('#xFormat [data-v="9:16"]').click();
    sc.cells = ['strokes', 'seismo', 'ridges', 'groove', 'sunburst'];
    sc.palette = 'plasma';
    app.renderLooks();
    await wait(50);
    const tile = (id) => document.querySelector(`#layoutMap [data-id="${id}"]`);
    const $title = () => document.getElementById('lookParamsTitle').textContent;
    const pointer = (type, x, y) => dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, bubbles: true }));
    const centre = (el) => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const click = (id) => {
      const [x, y] = centre(tile(id));
      tile(id).dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
      pointer('pointerup', x, y);
    };
    const drag = (a, b) => {
      const [x, y] = centre(tile(a)), [tx, ty] = centre(tile(b));
      tile(a).dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
      pointer('pointermove', x + 8, y);
      pointer('pointermove', tx, ty);
      pointer('pointerup', tx, ty);
    };
    const shot = async (name) => {
      const c = new OffscreenCanvas(1080, 1920);
      new Stage().render(c.getContext('2d'), 1080, 1920, A, 40, sc);
      await window.sp.write(file(name), new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
    };

    click('sunburst');
    document.querySelector('#layoutCell .optrow:nth-of-type(3) [data-v="true"]').click();
    await shot('compose-centred.png');
    if (!sc.cellOpts.sunburst?.center) fail('centre control did nothing');
    if (tile('sunburst').style.left !== '25%') fail(`centred tile at ${tile('sunburst').style.left}`);

    click('sunburst');
    click('ridges');
    if ($title() !== 'Ridges settings') fail(`settings title: ${$title()}`);
    const range = document.querySelector('#lookParams input[type=range]');
    range.value = 60;
    range.dispatchEvent(new Event('input'));
    if (sc.params.ridges?.rows !== 60) fail('settings slider did not reach the scene');
    document.querySelector('#layoutCell .optrow:nth-of-type(1) [data-v="2"]').click();
    if (tile('ridges').style.width !== '100%') fail(`wide tile is ${tile('ridges').style.width}`);
    drag('strokes', 'sunburst');
    if (sc.cells[0] !== 'sunburst' || sc.cells[4] !== 'strokes') fail(`swap gave ${sc.cells}`);
    await shot('compose-wide.png');
    report.steps.composeLayout = { cells: [...sc.cells], opts: sc.cellOpts };
    await wait(400);
    await window.sp.smokeCapture('ui-compose.png', 'main');

    // Five sheet looks must all stay cached, or every frame replays the whole track.
    const st = new Stage(), c = new OffscreenCanvas(540, 960), g = c.getContext('2d', { willReadFrequently: true });
    st.render(g, 540, 960, A, 40, sc);
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) { st.render(g, 540, 960, A, 40 + k / 60, sc); g.getImageData(0, 0, 1, 1); }
    report.steps.composeMsPerFrame = Math.round((performance.now() - t0) / 10);

    sc.cells = ['scope', 'spectrum', 'vector', 'loudness'];
    sc.cellOpts = {};
    sc.params = {};
    document.querySelector('#xFormat [data-v="16:9"]').click();
  }
  app.state.scene.mode = 'single';

  // Beat Chop out to a real file, then back in to prove the frames landed where planned.
  {
    const sc = app.state.scene;
    sc.mode = 'single'; sc.look = 'video'; sc.chrome = false;
    sc.params.video = { chop: 1, time: 5, gate: 0 };    // Hold beat
    document.querySelector('#xFormat [data-v="16:9"]').click();
    document.querySelector('#xFps [data-v="30"]').click();
    document.querySelector('#xLength [data-v="15"]').click();
    document.querySelector('#xStart [data-v="head"]').click();
    app.seek(12);
    const r = await app.doExportVideo(file('chop.mp4'));
    report.steps.chopExport = { fps: r.fps, frames: r.frames };
    document.querySelector('#xStart [data-v="best"]').click();

    await wait(500);
    await window.sp.smokeCapture('ui-video.png', 'main');

    const repeat = async (name, params) => {
      sc.params.video = params;
      const c = new OffscreenCanvas(960, 540), st = new Stage();
      await st.prepare(A, 20.31, sc);
      st.render(c.getContext('2d'), 960, 540, A, 20.31, sc);
      await window.sp.write(file(name), new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
    };
    await repeat('chop-gate.png', { chop: 1, time: 0, gate: 9, target: 2 });
    sc.params = {}; sc.chrome = true;
  }

  // Advanced mode: real drags on the overlay, then the result through export.
  {
    const sc = app.state.scene, A = app.state.cur.A;
    document.querySelector('#mode [data-v="compose"]').click();
    sc.cells = ['scope', 'video', 'spectrum'];
    app.renderLooks();
    document.querySelector('#mode [data-v="free"]').click();
    if (sc.free.length !== 4 || sc.free[3].id !== 'title') fail(`Advanced should start from Compose and the title: ${sc.free.map((it) => it.id)}`);

    const layer = document.getElementById('freeLayer'), rect = layer.getBoundingClientRect();
    const canvas = document.getElementById('stage');
    if (Math.abs(rect.width - canvas.getBoundingClientRect().width) > 1) fail('overlay does not match the picture');
    const pull = (node, dx, dy) => {
      const r = node.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
      dispatchEvent(new PointerEvent('pointermove', { clientX: x + dx * rect.width, clientY: y + dy * rect.height, altKey: true }));
      dispatchEvent(new PointerEvent('pointerup', { clientX: x + dx * rect.width, clientY: y + dy * rect.height }));
    };
    const target = sc.free[0], was = { ...target };
    app.free.select(target.id);
    pull(layer.querySelector(`.freebox[data-id="${target.id}"]`), 0.03, 0.02);
    if (Math.abs(target.x - was.x - 0.03) > 0.004) fail(`Advanced drag moved x by ${target.x - was.x}`);
    pull(layer.querySelector('.grip.se'), -0.05, -0.05);
    if (Math.abs(target.w - was.w + 0.05) > 0.004) fail(`Advanced resize changed w by ${target.w - was.w}`);
    report.steps.advanced = { items: sc.free.length, box: target };

    Object.assign(sc.free[1], { x: 0.05, y: 0.1, w: 0.6, h: 0.7 });
    Object.assign(sc.free[2], { x: 0.5, y: 0.55, w: 0.45, h: 0.4 });
    app.renderLooks();
    await wait(400);
    await window.sp.smokeCapture('ui-advanced.png', 'main');
    const c = new OffscreenCanvas(1080, 1920), st = new Stage();
    await st.prepare(A, 22, sc);
    st.render(c.getContext('2d'), 1080, 1920, A, 22, sc);
    await window.sp.write(file('advanced-9x16.png'), new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
    document.querySelector('#xLength [data-v="15"]').click();
    const r = await app.doExportVideo(file('advanced.mp4'));
    report.steps.advancedExport = { fps: r.fps, frames: r.frames };

    const was2 = A.bpm;
    app.setTempo(was2 / 2);
    if (A.bpm !== was2 / 2 || document.getElementById('fBpm').value != was2 / 2) fail('typed tempo did not take');
    document.getElementById('bpmDouble').click();
    if (A.bpm !== was2) fail('tempo did not double back');
    document.querySelector('#mode [data-v="single"]').click();
  }

  // Video effects: each lands on its own drum, leaves the other moments alone, and repeats.
  {
    const A = app.state.cur.A, sc = app.state.scene;
    const strongest = (list) => list.reduce((best, h) => (h.strength > best.strength ? h : best)).t;
    const kickAt = strongest(A.byType.kick.filter((h) => h.t > 20)) + 0.01;
    const snareAt = strongest(A.byType.snare.filter((h) => h.t > 20)) + 0.01;
    const shot = async (t, params, name) => {
      const scene = { ...defaultScene(), look: 'video', video: sc.video, palette: 'plasma', chrome: false, params: { video: params } };
      const c = new OffscreenCanvas(960, 540), x = c.getContext('2d', { willReadFrequently: true }), st = new Stage();
      await st.prepare(A, t, scene);
      st.render(x, 960, 540, A, t, scene);
      if (name) await window.sp.write(file(name), new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
      return x.getImageData(0, 0, 960, 540).data;
    };
    const diff = (p, q) => { let n = 0; for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 30) n++; return n; };
    const plain = async (t) => shot(t, {});
    const fx = {
      kickZoom: diff(await plain(kickAt), await shot(kickAt, { zoom: 1, zoomAmt: 0.4 }, 'fx-zoom.png')),
      snareSplit: diff(await plain(snareAt), await shot(snareAt, { rgb: 1, rgbAmt: 80 }, 'fx-split.png')),
      recolour: diff(await plain(22), await shot(22, { tint: 1 }, 'fx-tint.png')),
      repeat: diff(await shot(snareAt, { zoom: 1, rgb: 1, tint: 1, tintMix: 0.7 }), await shot(snareAt, { zoom: 1, rgb: 1, tint: 1, tintMix: 0.7 }, 'fx-all.png')),
    };
    const quiet = A.byType.kick.length ? A.duration + 1 : 0;
    fx.quiet = diff(await plain(quiet), await shot(quiet, { zoom: 1, rgb: 1 }));
    report.steps.videoFx = fx;
    if (fx.kickZoom < 5000 || fx.snareSplit < 5000 || fx.recolour < 5000) fail(`video effects too weak: ${JSON.stringify(fx)}`);
    if (fx.repeat !== 0) fail('video effects are not repeatable');
    if (fx.quiet > 200) fail(`drum effects moved with no drum: ${fx.quiet}`);
  }

  // Mix: the list appears only for Mix, and ticking boxes reaches the picture.
  {
    const sc = app.state.scene;
    sc.mode = 'single'; sc.look = 'video'; sc.params.video = { chop: 1, time: 0 };
    app.renderLooks();
    if (document.querySelector('.picklist')) fail('Mix list showed with another pattern chosen');
    const timeBox = document.querySelector('#lookParams select');
    timeBox.value = '18'; timeBox.dispatchEvent(new Event('change'));
    if (!document.querySelector('.picklist')) fail('Mix list did not show');
    document.querySelector('.pickhead button:last-child').click();
    if (sc.params.video.mix?.length !== 0) fail('None did not clear the list');
    if (document.querySelector('.pickgrid input:checked')) fail('None left boxes ticked');
    for (const k of [5, 15]) document.querySelector(`.pickgrid input[data-pick="${k}"]`).click();
    if (String(sc.params.video.mix) !== '5,15') fail(`Mix list wrong: ${sc.params.video.mix}`);
    await wait(300);
    await window.sp.smokeCapture('ui-mix.png', 'main');
    document.querySelector('.pickhead button').click();
    if (sc.params.video.mix?.length !== 18) fail('All did not fill the list');
    sc.params.video = { chop: 0 };
    app.renderLooks();
    if (document.querySelector('.picklist')) fail('Mix list showed with Beat Chop off');
    sc.params = {};
    app.renderLooks();
  }

  // Presets: through the real tab, the real file, and back onto a changed scene.
  {
    const sc = app.state.scene, tab = document.querySelector('[data-tab="presets"]');
    tab.click();
    const name = document.getElementById('presetName'), save = document.getElementById('savePreset');
    const typeName = (v) => { name.value = v; name.dispatchEvent(new Event('input')); };
    sc.mode = 'single'; sc.look = 'video'; sc.palette = 'ember'; sc.font = 'Impact'; sc.chrome = false;
    sc.params.video = { chop: 1, zoom: 1, tint: 1 };
    typeName('Smoke one');
    if (save.textContent !== 'Save') fail('new name should offer Save');
    save.click();
    await wait(200);
    typeName('Smoke one');
    if (save.textContent !== 'Replace') fail('taken name should offer Replace');
    typeName('');
    if (!save.disabled) fail('empty name should not save');

    const stored = await window.sp.readPresets();
    if (stored.length !== 1 || stored[0].scene.params.video.tint !== 1) fail(`preset file wrong: ${stored.length}`);
    if ('video' in stored[0].scene) fail('preset saved the video');

    const footage = sc.video;
    sc.palette = 'moss'; sc.font = ''; sc.mode = 'compose'; sc.params = {}; sc.chrome = true;
    document.querySelector('#presetList .presetname').click();
    if (sc.palette !== 'ember' || sc.font !== 'Impact' || sc.mode !== 'single' || sc.look !== 'video' || !sc.params.video?.zoom || sc.chrome) fail('preset did not restore');
    if (sc.video !== footage) fail('preset dropped the video');
    if (!document.querySelector('#mode [data-v="single"]').classList.contains('on') || document.getElementById('chrome').checked) fail('preset did not update the controls');
    await wait(300);
    await window.sp.smokeCapture('ui-presets.png', 'main');

    const del = document.querySelectorAll('#presetList .ghost')[1];
    del.click();
    if (document.querySelectorAll('#presetList .presetrow').length !== 1) fail('delete should ask first');
    del.click();
    await wait(200);
    if ((await window.sp.readPresets()).length !== 0) fail('preset did not delete');
    report.steps.presets = 'ok';
    document.querySelector('[data-tab="looks"]').click();
    sc.font = ''; sc.palette = 'carbon'; sc.chrome = true; sc.params = {};
    document.getElementById('chrome').checked = true;
    app.renderStudio(); app.renderLooks();
  }

  // Colours and fonts: each has to change real pixels, at page and element level.
  {
    const A = app.state.cur.A, sc = app.state.scene;
    const pixels = async (scene) => {
      const c = new OffscreenCanvas(480, 480), x = c.getContext('2d', { willReadFrequently: true });
      new Stage().render(x, 480, 480, A, 22, scene);
      return x.getImageData(0, 0, 480, 480).data;
    };
    const differs = async (a, b) => {
      const p = await pixels(a), q = await pixels(b);
      let n = 0;
      for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 30) n++;
      return n;
    };
    const page = { ...defaultScene(), title: 'Font test', look: 'loudness' };
    const mine = { bg: '#102030', fg: '#ffeeaa', accent: '#ff0000', colors: ['#001100', '#114411', '#227722', '#33aa33', '#44ff44'] };
    const checks = {
      customPalette: await differs(page, { ...page, palette: mine }),
      titleFont: await differs(page, { ...page, font: 'Impact' }),
      readoutFont: await differs(page, { ...page, mono: 'Courier New' }),
    };
    const free = { ...defaultScene(), mode: 'free', free: [{ id: 'spectrum', x: 0.1, y: 0.1, w: 0.8, h: 0.8 }] };
    const coloured = { ...free, free: [{ ...free.free[0], palette: mine }] };
    checks.elementColours = await differs(free, coloured);
    checks.elementFill = await differs(coloured, { ...free, free: [{ ...free.free[0], palette: mine, fill: 0 }] });
    const sheetA = { ...defaultScene(), mode: 'free', free: [{ id: 'strokes', x: 0, y: 0, w: 1, h: 1 }] };
    checks.elementSheet = await differs(sheetA, { ...sheetA, free: [{ ...sheetA.free[0], palette: 'ember' }] });
    const backdrop = { id: 'video', x: 0, y: 0, w: 1, h: 1 };
    const over = (opacity) => ({ ...defaultScene(), mode: 'free', video: sc.video, free: [backdrop, { id: 'spectrum', x: 0.2, y: 0.2, w: 0.6, h: 0.6, opacity }] });
    const under = { ...defaultScene(), mode: 'free', video: sc.video, free: [backdrop] };
    await new Stage().prepare(A, 22, under);
    await sc.video.ready(new Stage().videoFrames(A, 22, under));
    const opacity = {
      half: await differs(over(1), over(0.5)),
      full: await differs(over(1), { ...over(1), free: over(1).free.map((it) => ({ ...it, opacity: undefined })) }),
      none: await differs(over(0), under),
      halfFromNone: await differs(over(0.5), under),
    };
    const faded = { ...defaultScene(), mode: 'compose', cells: ['spectrum'], cellOpts: { spectrum: { opacity: 0.3 } } };
    opacity.compose = await differs({ ...faded, cellOpts: {} }, faded);
    report.steps.opacity = opacity;
    if (opacity.half < 1000 || opacity.halfFromNone < 1000 || opacity.compose < 1000) fail(`opacity had too little effect: ${JSON.stringify(opacity)}`);
    if (opacity.full || opacity.none) fail(`opacity ends are wrong: ${JSON.stringify(opacity)}`);

    const titled = (it) => ({ ...defaultScene(), mode: 'free', free: [{ id: 'title', x: 0.1, y: 0.7, w: 0.6, h: 0.15, ...it }] });
    const looseTitle = {
      moved: await differs(titled({}), titled({ x: 0.3, y: 0.1 })),
      ownFont: await differs(titled({}), titled({ mono: 'Impact' })),
      coloured: await differs(titled({}), titled({ palette: 'ember', fill: 0 })),
      chromeGone: await differs(titled({ opacity: 0 }), { ...titled({}), free: [] }),
      labels: await differs({ ...defaultScene(), look: 'scope' }, { ...defaultScene(), look: 'scope', labels: false }),
    };
    report.steps.title = looseTitle;
    const labelBox = document.getElementById('labels');
    labelBox.click();
    if (sc.labels !== false) fail('corner labels box did nothing');
    labelBox.click();
    for (const [k, v] of Object.entries(looseTitle)) if (v < 20) fail(`title check ${k} changed ${v} pixels`);

    report.steps.styling = checks;
    await window.sp.smokeFonts();
    await wait(1500);
    report.steps.installedFonts = app.state.fonts.length;
    if (app.state.fonts.length < 5) fail(`Installed fonts: ${app.state.fonts.length}`);
    for (const [name, n] of Object.entries(checks)) if (n < 20) fail(`${name} changed only ${n} pixels`);

    document.querySelector('[data-tab="studio"]').click();
    const custom = [...document.querySelectorAll('#palettes .pal')].pop();
    custom.click();
    if (typeof sc.palette !== 'object' || document.getElementById('customColours').hidden) fail('Custom colours did not open');
    const well = document.querySelector('#customColours input');
    well.value = '#ff00ff'; well.dispatchEvent(new Event('input'));
    if (sc.palette.bg !== '#ff00ff') fail('Colour well did not take');
    await wait(300);
    await window.sp.smokeCapture('ui-colours.png', 'main');
    const r = await app.doExportVideo(file('custom.mp4'));
    if (!r?.frames) fail('Export with custom colours failed');
    document.querySelector('[data-tab="looks"]').click();
    sc.palette = 'carbon';
    app.renderStudio();

    document.querySelector('#mode [data-v="free"]').click();
    const first = sc.free[0];
    app.free.select(first.id);
    const pick = document.querySelector('.elementcolours select');
    const fade = document.querySelector('.elementcolours input[type="range"]');
    fade.value = 40; fade.dispatchEvent(new Event('input'));
    if (first.opacity !== 0.4) fail(`element opacity slider gave ${first.opacity}`);
    pick.value = 'custom'; pick.dispatchEvent(new Event('change'));
    if (typeof first.palette !== 'object' || !document.querySelector('.elementcolours .swatches input')) fail('Element colours did not open');
    await wait(300);
    await window.sp.smokeCapture('ui-element.png', 'main');
    sc.free = [];
    document.querySelector('#mode [data-v="single"]').click();
  }

  // Stills, on a pen that exercises strokes, fills and alpha.
  app.state.scene.look = 'strokes';
  app.state.scene.palette = 'newsprint';
  await app.stillExport('png', file('poster.png'));
  await app.stillExport('svg', file('poster.svg'));
  await app.stillExport('pdf', file('poster.pdf'));
  await app.stillExport('cover', file('cover.png'));
  app.state.scene.look = 'blobs';
  await app.stillExport('pdf', file('poster-raster.pdf'));

  // The SVG has to survive a real parser, not just be written out.
  {
    const svg = await (await fetch(`file:///${file('poster.svg').replace(/\\/g, '/')}`)).text();
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await img.decode();
    const c = new OffscreenCanvas(794, 1123), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 794, 1123);
    // The vector page has to match the pixel page, not just parse.
    const png = await createImageBitmap(await (await fetch(`file:///${file('poster.png').replace(/\\/g, '/')}`)).blob());
    const r = new OffscreenCanvas(794, 1123), rg = r.getContext('2d', { willReadFrequently: true });
    rg.imageSmoothingQuality = 'high';
    rg.drawImage(png, 0, 0, 794, 1123);
    const da = g.getImageData(0, 0, 794, 1123).data, db = rg.getImageData(0, 0, 794, 1123).data;
    let sum = 0;
    for (let i = 0; i < da.length; i++) sum += Math.abs(da[i] - db[i]);
    report.steps.svgVsPng = +(sum / da.length).toFixed(2);
    await window.sp.write(file('poster-svg-rendered.png'), new Uint8Array(await (await c.convertToBlob()).arrayBuffer()));
    report.steps.svgSize = [img.naturalWidth, img.naturalHeight];
  }

  // Portrait needs a picture: a made-up one with obvious shapes to recognise.
  {
    const w = 600, h = 600, c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#123a7a'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffcf33'; x.beginPath(); x.arc(300, 240, 150, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#e8391d'; x.fillRect(90, 440, 420, 90);
    app.state.scene.image = { w, h, data: x.getImageData(0, 0, w, h).data, id: 1 };
    app.state.scene.look = 'portrait';
    await app.stillExport('cover', file('portrait.png'));
    app.state.scene.image = null;
  }

  // Listen: open it, sound the demo through the speakers, see whether it hears.
  app.state.scene.look = 'groove';
  app.state.scene.palette = 'carbon';
  app.renderLooks(); app.renderStudio();
  app.seek(8);
  await wait(800);
  await window.sp.smokeCapture('ui.png', 'main');
  {
    // Ready-made pages, through the same load path as a preset.
    const pics = await testPictures();
    const c = new OffscreenCanvas(360 * PAGES.length, 640), x = c.getContext('2d');
    for (const [k, preset] of PAGES.entries()) {
      const one = new OffscreenCanvas(360, 640);
      const scene = applyPreset({ ...defaultScene(), images: pics }, preset, defaultScene(), LOOKS);
      new Stage().render(one.getContext('2d'), 360, 640, app.state.cur.A, 30, scene);
      x.drawImage(one, k * 360, 0);
    }
    await window.sp.write(file('pages.png'), new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));

    // Add pictures: real file bytes, scaled down, and shown on the look's settings.
    const big = new OffscreenCanvas(3200, 800);
    big.getContext('2d').fillRect(0, 0, 3200, 800);
    const bytes = new Uint8Array(await (await big.convertToBlob({ type: 'image/png' })).arrayBuffer());
    const before = app.state.scene;
    await app.addImages([{ name: 'wide.png', bytes }]);
    const added = before.images[0];
    report.steps.addImages = added && { w: added.w, h: added.h };
    if (added?.w !== 1600 || added.h !== 400) fail('picture was not scaled down');
    const oldLook = before.look;
    before.look = 'cuts';
    app.renderParams();
    const button = document.querySelector('.addpictures button');
    if (!/\(1\)/.test(button?.textContent ?? '')) fail(`add pictures button: ${button?.textContent}`);
    document.querySelectorAll('.addpictures button')[1].click();
    if (app.state.scene.images.length) fail('clear left pictures');
    before.look = oldLook;
    app.renderParams();

    // Bottom text: every part, the font and the colour must change the picture.
    {
      const shot = (footer) => {
        const c = new OffscreenCanvas(640, 360);
        new Stage().render(c.getContext('2d'), 640, 360, app.state.cur.A, 30, { ...defaultScene(), look: 'title', footer: { ...defaultScene().footer, ...footer } });
        return c.getContext('2d').getImageData(0, 0, 640, 360).data;
      };
      const base = shot({}), changed = (a) => a.some((v, i) => v !== base[i]);
      const tries = { bpm: { bpm: false }, key: { key: false }, lufs: { lufs: false }, name: { name: false }, time: { time: false }, length: { length: false }, colour: { colour: '#ff0000' }, font: { font: 'Georgia' } };
      for (const [what, footer] of Object.entries(tries)) if (!changed(shot(footer))) fail(`bottom text setting did nothing: ${what}`);
    }

    // Share codes: through the buttons' own code, and a bad code changes nothing.
    {
      const sc = app.state.scene, was = { palette: sc.palette, footer: sc.footer, brush: sc.brush };
      sc.palette = 'paper'; sc.footer = { ...sc.footer, name: false, colour: '#123456' }; sc.brush = 1.7;
      const code = await app.copyShare({ ...capturePreset('Friend setup', sc, '9:16'), });
      sc.palette = 'carbon'; sc.footer = { ...was.footer }; sc.brush = 1;
      const back = await app.loadShare(code);
      const now = app.state.scene;
      report.steps.shareCode = { chars: code.length };
      if (!back || now.palette !== 'paper' || now.footer.name || now.footer.colour !== '#123456' || now.brush !== 1.7) fail('share code did not restore the setup');
      if (document.getElementById('presetName').value !== 'Friend setup') fail('share code name not offered');
      if (await app.loadShare('OSC1-nonsense')) fail('bad share code was accepted');
      if (app.state.scene.palette !== 'paper') fail('bad share code changed the setup');
      document.getElementById('presetName').value = '';
      app.state.scene.palette = was.palette; app.state.scene.footer = was.footer; app.state.scene.brush = was.brush;
      document.querySelector('#xFormat [data-v="16:9"]').click();
    }

    // Replace in place, then undo and redo with the keyboard.
    {
      const sc = app.state.scene, was = { mode: sc.mode, free: sc.free, cells: sc.cells };
      const press = async (code, shiftKey = false) => { dispatchEvent(new KeyboardEvent('keydown', { code, ctrlKey: true, shiftKey })); await wait(20); };
      const settle = async () => { app.noteChange(); await wait(20); };
      sc.mode = 'free';
      sc.free = [{ id: 'clock', x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, { id: 'dots', x: 0.5, y: 0.5, w: 0.2, h: 0.2 }];
      app.free.selected = 'clock';
      app.renderLooks();
      await settle();
      if (!document.querySelector('#freeProps select, #lookParams select, select option[value="tape"]')) fail('no replace list');
      app.replaceSelected('tape');
      await settle();
      const spot = () => app.state.scene.free.map((it) => `${it.id}@${it.x}`).join();
      if (spot() !== 'tape@0.1,dots@0.5') fail(`replace moved things: ${spot()}`);
      app.replaceSelected('dots');
      await settle();
      if (spot() !== 'dots@0.1,tape@0.5') fail(`replace should trade places: ${spot()}`);
      await press('KeyZ');
      if (spot() !== 'tape@0.1,dots@0.5') fail(`undo failed: ${spot()}`);
      if (app.free.selected !== 'tape' && app.free.selected !== 'dots') fail('undo lost the selection');
      await press('KeyZ');
      if (spot() !== 'clock@0.1,dots@0.5') fail(`second undo failed: ${spot()}`);
      await press('KeyY');
      if (spot() !== 'tape@0.1,dots@0.5') fail(`redo failed: ${spot()}`);
      await press('KeyZ', true);
      if (spot() !== 'dots@0.1,tape@0.5') fail(`ctrl shift z failed: ${spot()}`);
      const live = app.state.scene;
      live.mode = was.mode; live.free = was.free; live.cells = was.cells;
      app.free.selected = null;
      app.renderLooks();
      await settle();
      report.steps.undo = true;
    }

    // Custom shape: typed pixels reach the export size and the preview's proportions.
    const pick = document.querySelector('#xFormat [data-v="custom"]');
    pick.click();
    if (document.getElementById('xCustom').hidden) fail('custom pixels did not show');
    const wide = document.getElementById('xW'), tall = document.getElementById('xH');
    wide.value = 1001; tall.value = 301;
    wide.dispatchEvent(new Event('change'));
    document.querySelector('#xRes [data-v="4K"]').click();
    const size = app.exportSize();
    app.fitCanvas(); // the frame loop doesn't run in a hidden window
    const stageCanvas = document.getElementById('stage');
    report.steps.customShape = { size, preview: stageCanvas.width / stageCanvas.height };
    if (size.w !== 1002 || size.h !== 302) fail(`custom size wrong: ${JSON.stringify(size)}`);
    if (Math.abs(stageCanvas.width / stageCanvas.height - 1002 / 302) > 0.05) fail('preview did not take the custom shape');
    document.querySelector('#xRes [data-v="HD"]').click();
    document.querySelector('#xFormat [data-v="16:9"]').click();
    if (!document.getElementById('xCustom').hidden) fail('custom pixels stayed up');
  }

  if (!(await window.sp.smokeInfo()).muted) fail('tests must not play out loud');
  await window.sp.openListen();
  await wait(2000);
  if (await window.sp.smokeListenPin()) fail('Listen stayed on top after unpinning');
  if (!(await window.sp.smokeListenPin())) fail('Listen did not pin again');
  app.seek(10);
  app.play();
  await wait(7000);
  await window.sp.smokeCapture('listen.png', 'listen');
  await window.sp.smokeCapture('ui-playing.png', 'main');
  report.steps.playheadAfter7s = app.state.t;
  {
    // Measured after the volume, where the speakers listen.
    const meter = app.audio.ctx.createAnalyser();
    app.audio.gain.connect(meter);
    const level = async () => {
      await wait(400);
      const d = new Float32Array(meter.fftSize);
      meter.getFloatTimeDomainData(d);
      return Math.sqrt(d.reduce((sum, v) => sum + v * v, 0) / d.length);
    };
    const box = document.getElementById('volume');
    const set = (v) => { box.value = v; box.dispatchEvent(new Event('input')); };
    const before = app.state.cur.A.L.slice(0, 48000);
    const loud = await level();
    set(0);
    const silent = await level();
    set(100);
    const back = await level();
    report.steps.volume = { loud, silent, back };
    if (!(loud > 0.001) || silent > 0.0001 || !(back > 0.001)) fail(`volume wrong: ${JSON.stringify(report.steps.volume)}`);
    if (before.some((v, k) => v !== app.state.cur.A.L[k])) fail('volume touched the track audio');
    if (localStorage.getItem('previewVolume') !== '1') fail('volume was not remembered');
    app.audio.gain.disconnect(meter);
  }
  app.pause();
} catch (e) {
  fail(e.stack ?? String(e));
}
await wait(200);
await window.sp.smokeDone(report);
void PALETTES;
