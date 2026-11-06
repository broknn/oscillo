import { Analysis, SR, FR } from '../core/analysis.js';
import { Stage, defaultScene, frameBox } from '../core/stage.js';
import { composeLayout } from '../core/layout.js';
import { LOOK_LIST, LOOKS, GROUPS } from '../looks/index.js';
import { PALETTES, FONT_CHOICES, copyColours, paletteOf } from '../core/style.js';
import { parseMidi } from '../core/midi.js';
import { VideoSource } from './video.js';
import { FreeEditor } from './freeEditor.js';
import { inPage, dropIn, replaceItem, replaceCell } from '../core/freeform.js';
import { History } from '../core/history.js';
import { capturePreset, applyPreset, putPreset } from '../core/presets.js';
import { PAGES } from '../core/pages.js';
import { paletteFromPixels } from '../core/imagepalette.js';
import { encodeShare, decodeShare } from '../core/sharecode.js';
import { makeTrack } from '../core/demo.js';
import { exportVideo, renderPng, renderSvg, writePdf, sizeFor, customSide, bestStart, canVector, FORMATS, A3 } from './exporter.js';

const $ = (id) => document.getElementById(id);
const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const state = {
  tracks: [], cur: null,
  scene: defaultScene(),
  t: 0, playing: false, aspect: '16:9', layoutCell: null, autoCell: null, custom: null, fonts: [], presets: [],
  exporting: false, cancel: false,
};
const stage = new Stage();
const canvas = $('stage'), g = canvas.getContext('2d');
const waveCanvas = $('wave'), wg = waveCanvas.getContext('2d');

// --- audio ---------------------------------------------------------------------

const audio = { ctx: null, gain: null, volume: 1, src: null, startedAt: 0, offset: 0, buffer: null, bufferFor: null };

function ensureContext() {
  if (!audio.ctx) {
    audio.ctx = new AudioContext({ sampleRate: SR, latencyHint: 'playback' });
    audio.gain = audio.ctx.createGain();
    audio.gain.gain.value = audio.volume ** 2;
    audio.gain.connect(audio.ctx.destination);
  }
  return audio.ctx;
}

// Only the speakers hear this: analysis and exports use the track itself. Squared to suit the ear.
function setVolume(v) {
  audio.volume = v;
  audio.gain?.gain.setTargetAtTime(v ** 2, audio.ctx.currentTime, 0.01);
  try { localStorage.setItem('previewVolume', String(v)); } catch {}
}

function initVolume() {
  let saved = NaN;
  try { saved = parseFloat(localStorage.getItem('previewVolume')); } catch {}
  if (saved >= 0 && saved <= 1) audio.volume = saved;
  $('volume').value = Math.round(audio.volume * 100);
  $('volume').oninput = (e) => setVolume(e.target.value / 100);
}

function stopSource() {
  if (audio.src) { audio.src.onended = null; try { audio.src.stop(); } catch {} audio.src.disconnect(); audio.src = null; }
}

function play(from = state.t) {
  const A = state.cur?.A;
  if (!A) return;
  const ctx = ensureContext();
  ctx.resume();
  if (audio.bufferFor !== A) {
    audio.buffer = ctx.createBuffer(2, A.L.length, SR);
    audio.buffer.copyToChannel(A.L, 0);
    audio.buffer.copyToChannel(A.R, 1);
    audio.bufferFor = A;
  }
  stopSource();
  const src = ctx.createBufferSource();
  src.buffer = audio.buffer;
  src.connect(audio.gain);
  const at = Math.min(from, A.duration - 0.01);
  src.start(0, at);
  src.onended = () => { if (audio.src === src) { state.playing = false; state.t = 0; audio.src = null; syncTransport(); } };
  audio.src = src; audio.startedAt = ctx.currentTime; audio.offset = at;
  state.playing = true;
  syncTransport();
}

function pause() {
  state.t = clockTime();
  stopSource();
  state.playing = false;
  syncTransport();
}

function clockTime() {
  if (!state.playing) return state.t;
  const ctx = audio.ctx;
  return Math.max(0, audio.offset + ctx.currentTime - audio.startedAt - (ctx.outputLatency || 0));
}

function seek(t) {
  const A = state.cur?.A;
  if (!A) return;
  state.t = Math.max(0, Math.min(A.duration, t));
  if (state.playing) play(state.t);
}

function syncTransport() {
  $('play').textContent = state.playing ? 'Pause' : 'Play';
  $('play').disabled = !state.cur?.A;
}

// --- tracks --------------------------------------------------------------------

const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
const queue = [];
let analysing = false;

function addFiles(paths) {
  for (const path of paths) {
    const item = { path, name: path.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''), status: 'waiting', A: null };
    state.tracks.push(item);
    queue.push(item);
  }
  renderPlaylist();
  runQueue();
}

function runQueue() {
  if (analysing || !queue.length) return;
  analysing = true;
  const item = queue.shift();
  analyseItem(item).catch((e) => {
    item.status = 'failed'; item.error = e.message;
    console.error(e);
    busy(null);
  }).finally(() => {
    analysing = false;
    renderPlaylist();
    runQueue();
  });
}

// Tracks hold full PCM, so only the most recently used stay decoded.
function trimMemory(keep) {
  const held = state.tracks.filter((t) => t.A && t !== keep);
  while (held.length > 2) { const t = held.shift(); t.A = null; t.status = 'ready'; }
}

async function analyseItem(item, select = !state.cur) {
  item.status = 'reading';
  renderPlaylist();
  busy(`Reading ${item.name}`, 0);
  const { pcm, midi } = await window.sp.decode(item.path);
  const inter = new Float32Array(pcm), n = inter.length >> 1;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = inter[i * 2]; R[i] = inter[i * 2 + 1]; }
  item.status = 'listening';
  renderPlaylist();
  const done = await new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.result) resolve(data);
      else busy(`Listening to ${item.name}`, data.progress);
    };
    worker.onerror = (e) => reject(new Error(e.message));
    worker.postMessage({ L, R }, [L.buffer, R.buffer]);
  });
  const A = new Analysis(done.result, done.L, done.R);
  A.name = item.name; A.path = item.path;
  if (item.bpm) A.setTempo(item.bpm);
  if (midi) {
    try { A.notes = parseMidi(midi); A.hasMidi = true; A.noteLo = A.noteHi = undefined; } catch (e) { console.warn(e); }
  }
  item.A = A;
  item.status = fmt(A.duration);
  busy(null);
  if (select) selectTrack(item);
  else trimMemory(state.cur);
  return A;
}

async function selectTrack(item) {
  if (state.playing) pause();
  if (!item.A) {
    if (item.status === 'failed') return;
    await analyseItem(item, false);
  }
  state.cur = item;
  state.t = 0;
  trimMemory(item);
  $('empty').hidden = true;
  $('facts').hidden = false;
  const A = item.A;
  showTempo();
  $('fKey').textContent = A.key.name;
  $('fLufs').textContent = `${A.lufs.toFixed(1)} LUFS`;
  $('fPeak').textContent = `${A.peakDb.toFixed(1)} dBFS`;
  $('fKick').textContent = A.byType.kick.length;
  $('fSnare').textContent = A.byType.snare.length;
  $('fHat').textContent = A.byType.hat.length;
  $('fNotes').textContent = `${A.notes.length}${A.hasMidi ? ' MIDI' : ''}`;
  for (const id of ['exportVideo', 'xPng', 'xPdf', 'xSvg', 'xCover']) $(id).disabled = false;
  syncSvgButton();
  syncTransport();
  renderPlaylist();
  drawWave();
}

function showTempo() { $('fBpm').value = state.cur.A.bpm; }

function setTempo(bpm) {
  const item = state.cur;
  if (!item?.A) return;
  if (bpm >= 30 && bpm <= 300) {
    item.A.setTempo(bpm);
    item.bpm = bpm;
    stage.layers.clear();
  }
  showTempo();
}

function renderPlaylist() {
  const ul = $('playlist');
  ul.replaceChildren(...state.tracks.map((t) => {
    const li = document.createElement('li');
    if (t === state.cur) li.className = 'on';
    if (t.status === 'failed') { li.classList.add('bad'); li.title = t.error; }
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = t.name;
    const st = document.createElement('span'); st.className = 'st'; st.textContent = t.status;
    li.append(nm, st);
    li.onclick = () => selectTrack(t);
    return li;
  }));
}

function busy(text, p = 0) {
  $('busy').hidden = !text;
  if (text) { $('busyText').textContent = text; $('busyBar').style.width = `${p * 100}%`; }
}

async function loadDemo() {
  const { L, R } = makeTrack({ bpm: 128, bars: 32, tonic: 57, mode: 'minor' });
  const n = L.length, b = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); b.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt ');
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 2, true);
  b.setUint32(24, SR, true); b.setUint32(28, SR * 4, true); b.setUint16(32, 4, true); b.setUint16(34, 16, true);
  str(36, 'data'); b.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) {
    b.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true);
    b.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true);
  }
  const file = await window.sp.tmpTrack(new Uint8Array(b.buffer));
  const item = { path: file, name: 'Demo beat', status: 'waiting', A: null };
  state.tracks.push(item);
  queue.push(item);
  renderPlaylist();
  runQueue();
  return item;
}

// --- drawing -------------------------------------------------------------------

function fitCanvas() {
  const wrap = $('stageWrap');
  const availW = wrap.clientWidth - 44, availH = wrap.clientHeight - 44;
  const ratio = FORMATS[state.aspect][0] / FORMATS[state.aspect][1];
  let w = availW, h = w / ratio;
  if (h > availH) { h = availH; w = h * ratio; }
  w = Math.max(40, Math.round(w)); h = Math.max(40, Math.round(h));
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (canvas.style.width !== `${w}px` || canvas.style.height !== `${h}px` || canvas.width !== Math.round(w * dpr)) {
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
}

function frame() {
  requestAnimationFrame(frame);
  const A = state.cur?.A;
  fitCanvas();
  if (!A || state.exporting) return;
  state.t = clockTime();
  const scene = state.scene;
  stage.lookAhead(A, state.t, scene);
  stage.render(g, canvas.width, canvas.height, A, state.t, scene);
  if (scene.mode === 'free') free.fit();
  $('time').textContent = `${fmt(state.t)} / ${fmt(A.duration)}`;
  drawPlayhead(A);
}

let waveImage = null;

function drawWave() {
  const A = state.cur?.A;
  if (!A) return;
  const dpr = devicePixelRatio || 1, W = Math.round(waveCanvas.clientWidth * dpr), H = Math.round(waveCanvas.clientHeight * dpr);
  waveCanvas.width = W; waveCanvas.height = H;
  const cols = A.overview.length / 2, mid = H / 2;
  wg.fillStyle = '#5a5c62';
  for (let x = 0; x < W; x++) {
    const c = Math.floor((x / W) * cols);
    const lo = A.overview[c * 2], hi = A.overview[c * 2 + 1];
    wg.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
  }
  wg.fillStyle = '#9a9d6a';
  for (const s of A.sections) wg.fillRect((s / A.duration) * W, 0, 1, H);
  waveImage = wg.getImageData(0, 0, W, H);
}

function drawPlayhead(A) {
  if (!waveImage) return;
  wg.putImageData(waveImage, 0, 0);
  wg.fillStyle = '#d7ff3e';
  wg.fillRect((state.t / A.duration) * waveCanvas.width, 0, 2, waveCanvas.height);
}

// --- controls ------------------------------------------------------------------

function seg(id, value, onChange) {
  const root = $(id);
  root.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === value);
    b.onclick = () => {
      root.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      onChange(b.dataset.v);
    };
  });
}

const segValue = (id) => $(id).querySelector('.on').dataset.v;

function renderLooks() {
  const list = $('lookList'), sc = state.scene;
  list.replaceChildren();
  for (const group of GROUPS) {
    const h = document.createElement('h3'); h.textContent = group; list.append(h);
    for (const look of LOOK_LIST.filter((l) => l.group === group)) {
      const b = document.createElement('button');
      b.className = 'look';
      const inList = sc.mode === 'compose' ? sc.cells : sc.mode === 'auto' ? sc.autoList : sc.mode === 'free' ? sc.free.map((it) => it.id) : null;
      const pos = inList ? inList.indexOf(look.id) : -1;
      if (sc.mode === 'single' ? sc.look === look.id : pos >= 0) b.classList.add('on');
      const name = document.createElement('b'); name.textContent = look.name;
      const em = document.createElement('em'); em.textContent = look.desc;
      if (pos >= 0) { const n = document.createElement('span'); n.className = 'n'; n.textContent = pos + 1; b.append(n); }
      b.append(name, em);
      b.onclick = () => pickLook(look.id);
      list.append(b);
    }
  }
  $('modeHint').textContent = {
    single: 'One look for the whole track.',
    compose: 'Pick up to 9 looks. Drag one tile onto another to swap them, or click a tile to size and adjust it.',
    auto: 'The picture cuts between your picks on the bar line. Choose a pick below to adjust it.',
    free: 'Click looks to add them, up to 9. Drag on the picture to place them and pull the handles to size them. Things snap into line; hold Alt to stop that, or Shift to keep the shape.',
  }[sc.mode];
  renderLayout();
  renderFree();
  renderParams();
  syncSvgButton();
}

function optionRow(label, values, current, onPick) {
  const row = document.createElement('div'); row.className = 'optrow';
  const name = document.createElement('span'); name.textContent = label;
  const group = document.createElement('div'); group.className = 'seg';
  for (const [value, text] of values) {
    const b = document.createElement('button');
    b.textContent = text;
    b.dataset.v = value;
    b.classList.toggle('on', value === current);
    b.onclick = () => onPick(value);
    group.append(b);
  }
  row.append(name, group);
  return row;
}

function swapCells(a, b) {
  const list = state.scene.cells, i = list.indexOf(a), j = list.indexOf(b);
  [list[i], list[j]] = [list[j], list[i]];
  renderLooks();
}

// Pointer events rather than HTML drag, which the window keeps for dropping in tracks.
function tileEvents(tile, id) {
  tile.onpointerdown = (down) => {
    let dragging = false, over = null;
    const target = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest('#layoutMap .tile') ?? null;
    const mark = (next) => {
      if (over === next) return;
      over?.classList.remove('target');
      next?.classList.add('target');
      over = next;
    };
    const stop = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    const move = (e) => {
      dragging ||= Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > 4;
      if (!dragging) return;
      tile.classList.add('lifted');
      const t = target(e);
      mark(t === tile ? null : t);
    };
    const up = () => {
      stop();
      if (!dragging) {
        state.layoutCell = state.layoutCell === id ? null : id;
        renderLayout();
        renderParams();
      } else if (over) swapCells(id, over.dataset.id);
      else renderLayout();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  };
}

function renderLayout() {
  const sc = state.scene, host = $('layout');
  host.hidden = sc.mode !== 'compose';
  if (host.hidden) return;
  if (!sc.cells.includes(state.layoutCell)) state.layoutCell = null;

  const [W, H] = FORMATS[state.aspect];
  const { cols, rows, items } = composeLayout(sc.cells, sc.cellOpts, W, H, sc.columns);
  const map = $('layoutMap');
  map.style.aspectRatio = `${W} / ${H}`;
  map.style.width = W >= H ? '100%' : `${Math.round((230 * W) / H)}px`;
  map.replaceChildren(...items.map((it) => {
    const tile = document.createElement('button');
    tile.className = `tile${it.id === state.layoutCell ? ' on' : ''}`;
    tile.dataset.id = it.id;
    tile.textContent = LOOKS[it.id]?.name ?? it.id;
    Object.assign(tile.style, {
      left: `${(it.x / cols) * 100}%`, top: `${(it.y / rows) * 100}%`,
      width: `${(it.w / cols) * 100}%`, height: `${(it.h / rows) * 100}%`,
    });
    tileEvents(tile, it.id);
    return tile;
  }));

  const column = [[0, 'Auto'], [1, '1'], [2, '2'], [3, '3'], [4, '4']];
  $('layoutCols').replaceChildren(optionRow('Columns', column, sc.columns, (v) => { sc.columns = v; renderLayout(); }));

  const cellHost = $('layoutCell');
  cellHost.replaceChildren();
  const id = state.layoutCell, item = items.find((it) => it.id === id);
  if (!item) return;
  const opts = (sc.cellOpts[id] ??= {});
  const set = (key, value) => { opts[key] = value; renderLayout(); };
  const title = document.createElement('h3'); title.textContent = LOOKS[id]?.name ?? id;
  const sizes = [[1, '1'], [2, '2'], [3, '3']];
  const at = sc.cells.indexOf(id);
  const shift = (by) => { const other = sc.cells[at + by]; if (other) swapCells(id, other); };
  const centre = optionRow('Row', [[false, 'Keep in place'], [true, 'Centre']], !!opts.center, (v) => set('center', v));
  if (!item.room && !opts.center) {
    const b = centre.querySelector('[data-v="true"]');
    b.disabled = true;
    b.title = 'This row is full. Remove a neighbour or change the columns to make room.';
  }
  const order = optionRow('Move', [[-1, 'Earlier'], [1, 'Later']], 0, shift);
  order.querySelector('[data-v="-1"]').disabled = at === 0;
  order.querySelector('[data-v="1"]').disabled = at === sc.cells.length - 1;
  cellHost.append(title, replaceRow(id, (to) => replaceSelected(to)),
    optionRow('Width', sizes, opts.w ?? 1, (v) => set('w', v)),
    optionRow('Height', sizes, opts.h ?? 1, (v) => set('h', v)),
    centre, order);
  opacitySlider(cellHost, opts);
}

// Changes the selected element's look and leaves it where it is, at the same size.
function replaceRow(current, onPick) {
  const row = document.createElement('label'); row.className = 'field';
  const name = document.createElement('span'); name.textContent = 'Replace with';
  const list = document.createElement('select');
  for (const group of GROUPS) {
    const set = document.createElement('optgroup'); set.label = group;
    set.append(...LOOK_LIST.filter((l) => l.group === group).map((l) => new Option(l.name, l.id)));
    list.append(set);
  }
  list.value = current;
  list.onchange = () => onPick(list.value);
  row.append(name, list);
  return row;
}

function replaceSelected(to) {
  const sc = state.scene;
  if (sc.mode === 'free' && free.selected) {
    replaceItem(sc.free, free.selected, to);
    free.selected = to;
  } else if (sc.mode === 'compose' && state.layoutCell) {
    replaceCell(sc.cells, sc.cellOpts, state.layoutCell, to);
    state.layoutCell = to;
  } else return;
  renderLooks();
  renderParams();
}

// --- advanced mode --------------------------------------------------------------

const free = new FreeEditor({
  layer: $('freeLayer'), canvas, scene: () => state.scene,
  onChange: () => renderFree(),
  onSelect: () => { renderFree(); renderParams(); },
});

// Advanced starts from what's on screen, so it's a way to refine a layout, not to redo it.
function enterFree(from) {
  const sc = state.scene;
  if (sc.free.length) return;
  const [W, H] = FORMATS[state.aspect];
  const boxes = from === 'compose' ? stage.composeBoxes(sc, W, H) : [{ id: sc.look, ...frameBox(W, H, sc.chrome) }];
  sc.free = boxes.map((b) => inPage({ id: b.id, x: b.x / W, y: b.y / H, w: b.w / W, h: b.h / H, opacity: sc.cellOpts[b.id]?.opacity ?? 1 }));
  free.selected = sc.free[sc.free.length - 1]?.id ?? null;
  if (sc.chrome && !sc.free.some((it) => it.id === 'title')) sc.free.push(titleBox(W, H));
}

// The title as it sits on the page, turned into an element that can be moved.
function titleBox(W, H) {
  const min = Math.min(W, H), m = min * 0.055, text = min * 0.042;
  const name = state.scene.title || state.cur?.A?.name || 'Untitled';
  const h = text / 0.7, w = (name.length * text * 0.6) / 0.75;
  return inPage({ id: 'title', x: m / W, y: (m + text * 0.65 - h / 2) / H, w: w / W, h: h / H });
}

function removeFree(id) {
  const sc = state.scene;
  sc.free = sc.free.filter((it) => it.id !== id);
  if (free.selected === id) free.selected = null;
  renderLooks();
}

function reorderFree(id, to) {
  const list = state.scene.free, at = list.findIndex((it) => it.id === id);
  const [it] = list.splice(at, 1);
  list.splice(to, 0, it);
  renderFree();
}

function numberField(label, value, onChange) {
  const row = document.createElement('label'); row.className = 'pct';
  const name = document.createElement('span'); name.textContent = label;
  const box = document.createElement('input');
  box.type = 'number'; box.step = 0.5; box.value = Math.round(value * 1000) / 10;
  box.onchange = () => { if (Number.isFinite(box.valueAsNumber)) onChange(box.valueAsNumber / 100); };
  row.append(name, box);
  return row;
}

function renderFree() {
  const sc = state.scene, on = sc.mode === 'free', layer = $('freeLayer');
  $('free').hidden = !on;
  layer.hidden = !on;
  if (!on) return;
  free.draw();

  $('freeList').replaceChildren(...[...sc.free].reverse().map((it) => {
    const b = document.createElement('button');
    b.className = `layerrow${it.id === free.selected ? ' on' : ''}`;
    b.textContent = LOOKS[it.id]?.name ?? it.id;
    b.onclick = () => free.select(it.id);
    return b;
  }));

  const host = $('freeCell'), it = free.item, at = sc.free.indexOf(it);
  host.replaceChildren();
  if (!it) return;
  const edit = (patch) => { Object.assign(it, inPage({ ...it, ...patch })); renderFree(); };
  const fields = document.createElement('div'); fields.className = 'pctgrid';
  fields.append(numberField('X %', it.x, (v) => edit({ x: v })), numberField('Y %', it.y, (v) => edit({ y: v })),
    numberField('W %', it.w, (v) => edit({ w: v })), numberField('H %', it.h, (v) => edit({ h: v })));
  const fit = optionRow('Place', [['page', 'Fill page'], ['h', 'Centre across'], ['v', 'Centre down']], '', (v) => {
    if (v === 'page') edit({ x: 0, y: 0, w: 1, h: 1 });
    if (v === 'h') edit({ x: (1 - it.w) / 2 });
    if (v === 'v') edit({ y: (1 - it.h) / 2 });
  });
  const order = optionRow('Layer', [['up', 'Forward'], ['down', 'Back']], '', (v) => reorderFree(it.id, at + (v === 'up' ? 1 : -1)));
  order.querySelector('[data-v="up"]').disabled = at === sc.free.length - 1;
  order.querySelector('[data-v="down"]').disabled = at === 0;
  const remove = document.createElement('button');
  remove.className = 'ghost wide'; remove.textContent = 'Remove from page';
  remove.onclick = () => removeFree(it.id);
  host.append(replaceRow(it.id, (to) => replaceSelected(to)), fields, fit, order, elementColours(it), remove);
}

// --- presets --------------------------------------------------------------------

function storePresets(list) {
  state.presets = list;
  renderPresets();
  return window.sp.writePresets(list);
}

function syncPresetSave() {
  const name = $('presetName').value.trim();
  $('savePreset').disabled = !name;
  $('savePreset').textContent = state.presets.some((p) => p.name === name) ? 'Replace' : 'Save';
}

function setSeg(id, value) {
  $(id).querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === value));
}

// A custom shape is only meaningful with its pixels, so presets keep them together.
const presetSize = () => (state.aspect === 'custom' ? FORMATS.custom : undefined);

function setCustomSize(w, h) {
  FORMATS.custom = [customSide(w), customSide(h)];
  [$('xW').value, $('xH').value] = FORMATS.custom;
  if (state.aspect === 'custom') renderLayout();
}

function setShape(v) {
  state.aspect = v;
  setSeg('xFormat', v);
  $('xCustom').hidden = v !== 'custom';
  $('xResRow').hidden = v === 'custom';
  renderLayout();
}

let history = null;

function snapshot() {
  const now = capturePreset('', state.scene, state.aspect, presetSize());
  for (const id of Object.keys(now.scene.cellOpts)) if (!Object.keys(now.scene.cellOpts[id]).length) delete now.scene.cellOpts[id];
  return JSON.stringify(now);
}

// Runs after the control's own handler has made its change.
const noteChange = () => setTimeout(() => history?.note(snapshot()));

function restore(saved) {
  if (!saved) return;
  const { layoutCell, autoCell } = state, element = free.selected, sc = state.scene;
  loadPreset(JSON.parse(saved));
  if (sc.cells.includes(layoutCell)) state.layoutCell = layoutCell;
  if (sc.autoList.includes(autoCell)) state.autoCell = autoCell;
  if (sc.free.some((it) => it.id === element)) free.selected = element;
  renderLooks();
  renderParams();
  history.sync(snapshot());
}

function loadPreset(preset) {
  const sc = state.scene;
  applyPreset(sc, preset, defaultScene(), LOOKS);
  if (preset.size) setCustomSize(...preset.size);
  if (preset.aspect in FORMATS) setShape(preset.aspect);
  setSeg('mode', sc.mode);
  state.custom = typeof sc.palette === 'object' ? sc.palette : state.custom;
  state.layoutCell = state.autoCell = free.selected = null;
  $('chrome').checked = sc.chrome;
  $('labels').checked = sc.labels;
  $('overlay').checked = sc.transparent;
  canvas.classList.toggle('checker', sc.transparent);
  renderLooks();
  renderStudio();
  fontPickers();
  noteChange();
}

function shareNote(message) {
  $('shareStatus').textContent = message;
  $('shareStatus').hidden = false;
}

async function copyShare(preset) {
  const code = await encodeShare(preset);
  await window.sp.copyText(code);
  shareNote(`Copied the code for "${preset.name}" (${code.length} characters).`);
  return code;
}

async function loadShare(code) {
  try {
    const preset = await decodeShare(code, LOOKS, defaultScene());
    loadPreset(preset);
    $('shareCode').value = '';
    $('loadShare').disabled = true;
    $('presetName').value = preset.name;
    syncPresetSave();
    shareNote(`Loaded "${preset.name}". Press Save under Your presets to keep it.`);
    return preset;
  } catch {
    shareNote("That code didn't work. Check that the whole code was copied.");
    return null;
  }
}

function renderFooter() {
  const sc = state.scene, host = $('footerParts');
  host.replaceChildren();
  const parts = { bpm: 'BPM', key: 'Key', lufs: 'Loudness', name: 'Look or mode name', time: 'Time', length: 'Length' };
  for (const [part, label] of Object.entries(parts)) toggle(host, label, sc.footer[part], (v) => { sc.footer[part] = !!v; });
  $('footerColour').value = sc.footer.colour || paletteOf(sc.palette).dim;
  $('footerColourReset').disabled = !sc.footer.colour;
}

function renderPresets() {
  const row = (preset) => {
    const line = document.createElement('div'); line.className = 'presetrow';
    const open = document.createElement('button');
    open.className = 'presetname'; open.textContent = preset.name; open.title = 'Load this preset';
    open.onclick = () => loadPreset(preset);
    const update = document.createElement('button');
    update.className = 'ghost'; update.textContent = 'Update'; update.title = 'Save what is on screen over this preset';
    update.onclick = () => storePresets(putPreset(state.presets, capturePreset(preset.name, state.scene, state.aspect, presetSize())));
    const remove = document.createElement('button');
    remove.className = 'ghost'; remove.textContent = 'Delete';
    remove.onclick = () => {
      if (remove.dataset.sure) storePresets(state.presets.filter((p) => p !== preset));
      else { remove.dataset.sure = '1'; remove.textContent = 'Sure?'; }
    };
    remove.onblur = () => { delete remove.dataset.sure; remove.textContent = 'Delete'; };
    const share = document.createElement('button');
    share.className = 'ghost'; share.textContent = 'Code'; share.title = 'Copy a share code for this preset';
    share.onclick = () => copyShare(preset);
    line.append(open, update, remove, share);
    return line;
  };
  $('presetList').replaceChildren(...state.presets.map(row));
  $('pageList').replaceChildren(...PAGES.map((preset) => {
    const line = document.createElement('div'); line.className = 'presetrow';
    const open = document.createElement('button');
    open.className = 'presetname'; open.textContent = preset.name; open.title = 'Load this page. Your layout and colours are replaced.';
    open.onclick = () => loadPreset(preset);
    line.append(open);
    return line;
  }));
  syncPresetSave();
}

function opacitySlider(host, holder) {
  slider(host, 'Opacity %', 0, 100, 1, Math.round((holder.opacity ?? 1) * 100), (v) => { holder.opacity = v / 100; });
}

function elementColours(it) {
  const sc = state.scene, wrap = document.createElement('div'); wrap.className = 'elementcolours';
  opacitySlider(wrap, it);
  const mine = typeof it.palette === 'object';
  const line = (text, control) => {
    const row = document.createElement('label'); row.className = 'field';
    const name = document.createElement('span'); name.textContent = text;
    row.append(name, control);
    wrap.append(row);
  };
  const colours = document.createElement('select');
  colours.append(new Option('Same as page', ''), ...Object.values(PALETTES).map((p) => new Option(p.label, p.id)), new Option('Custom', 'custom'));
  colours.value = mine ? 'custom' : it.palette ?? '';
  colours.onchange = () => {
    const v = colours.value;
    if (v === 'custom') it.palette = copyColours(it.palette ?? sc.palette);
    else if (v) it.palette = v;
    else delete it.palette;
    renderFree();
  };
  line('Colours', colours);
  const fromPicture = document.createElement('button');
  fromPicture.className = 'ghost wide'; fromPicture.textContent = 'Colours from a picture';
  fromPicture.onclick = async () => {
    const got = await pictureColours(await window.sp.pickImage());
    if (!got?.palette) return;
    it.palette = got.palette;
    renderFree();
    noteChange();
  };
  wrap.append(fromPicture);

  const mono = document.createElement('select');
  fontOptions(mono, it.mono, 'Same as page');
  mono.onchange = () => { if (mono.value) it.mono = mono.value; else delete it.mono; };
  line('Font', mono);

  if (mine) {
    const wells = document.createElement('div'); wells.className = 'swatches';
    colourEditor(wells, it.palette, () => { it.palette = { ...it.palette }; });
    wrap.append(wells);
  }
  const fill = it.fill ?? !!it.palette;
  toggle(wrap, 'Fill behind this element', fill, (v) => { it.fill = v; });
  toggle(wrap, 'Outline this element', !!it.outline, (v) => { it.outline = v; });
  return wrap;
}

function pickLook(id) {
  const sc = state.scene;
  if (sc.mode === 'single') sc.look = id;
  else if (sc.mode === 'free') {
    if (sc.free.some((it) => it.id === id)) { removeFree(id); return; }
    if (sc.free.length < 9) {
      sc.free.push({ id, ...dropIn(sc.free.length) });
      free.selected = id;
    }
  } else {
    const list = sc.mode === 'compose' ? sc.cells : sc.autoList;
    const at = list.indexOf(id);
    if (at >= 0) {
      list.splice(at, 1);
      if (sc.mode === 'compose') delete sc.cellOpts[id];
    }
    else if (sc.mode !== 'compose' || list.length < 9) list.push(id);
  }
  renderLooks();
}

function slider(host, label, min, max, step, value, onInput) {
  const row = document.createElement('label'); row.className = 'slider';
  const s = document.createElement('span'); s.textContent = label;
  const r = document.createElement('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value;
  const o = document.createElement('output'); o.textContent = value;
  r.oninput = () => { o.textContent = r.value; onInput(parseFloat(r.value)); };
  row.append(s, r, o);
  host.append(row);
}

async function setVideo(path) {
  const sc = state.scene, name = path.split(/[\\/]/).pop();
  $('videoName').textContent = `Preparing ${name}`;
  busy(`Preparing ${name}`, 0.1);
  try {
    const info = await window.sp.prepareVideo(path);
    const source = await new VideoSource(info).open();
    const old = sc.video;
    sc.video = source;
    if (old) { old.close(); window.sp.dropVideo(old.dir); }
    $('videoName').textContent = name;
    // A video with nothing else loaded brings its own sound as the track.
    if (!state.tracks.length) addFiles([path]);
    if (sc.mode === 'single') sc.look = 'video';
    renderLooks();
  } catch (e) {
    $('videoName').textContent = `Could not read ${name}`;
    console.error(e);
  } finally {
    busy(null);
  }
  return sc.video;
}

const chooseImages = async () => addImages(await window.sp.pickImages());

async function addImages(files) {
  for (const r of files) {
    const full = await createImageBitmap(new Blob([r.bytes]));
    const k = Math.min(1, 1600 / Math.max(full.width, full.height));
    const w = Math.round(full.width * k), h = Math.round(full.height * k);
    const bitmap = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    full.close();
    state.scene.images.push({ bitmap, w, h, id: Date.now() + Math.random(), name: r.name });
  }
  renderParams();
}

async function chooseVideo() {
  const path = await window.sp.pickVideo();
  if (path) await setVideo(path);
}

function renderStudio() {
  const sc = state.scene;
  renderFooter();
  const host = $('palettes');
  const mine = typeof sc.palette === 'object';
  const tile = (p, on, pick) => {
    const b = document.createElement('button');
    b.className = `pal${on ? ' on' : ''}`;
    const swatch = document.createElement('i');
    for (const c of [p.bg, ...p.colors]) { const s = document.createElement('s'); s.style.background = c; swatch.append(s); }
    b.append(swatch, p.label);
    b.onclick = pick;
    return b;
  };
  host.replaceChildren(...Object.values(PALETTES).map((p) => tile(p, p.id === sc.palette, () => { sc.palette = p.id; renderStudio(); })),
    tile({ ...paletteOf(state.custom ?? sc.palette), label: 'Custom' }, mine, () => {
      state.custom ??= copyColours(sc.palette);
      sc.palette = state.custom;
      renderStudio();
    }));
  $('customColours').hidden = !mine;
  if (!mine) $('paletteNote').hidden = true;
  if (mine) colourEditor($('customColours'), sc.palette, () => {
    sc.palette = { ...sc.palette };
    state.custom = sc.palette;
    renderSwatchesOnly();
  });
  fontPickers();
  const sl = $('sliders');
  sl.replaceChildren();
  slider(sl, 'Brush', 0.3, 3, 0.05, sc.brush, (v) => { sc.brush = v; });
  slider(sl, 'Motion', 0.2, 3, 0.05, sc.motion, (v) => { sc.motion = v; });
  slider(sl, 'Density', 0.3, 2, 0.05, sc.density, (v) => { sc.density = v; });
  renderParams();
}

// A small copy is plenty to find a picture's colours.
async function paletteFromBytes(bytes) {
  const picture = await createImageBitmap(new Blob([bytes]));
  const k = Math.min(1, 200 / Math.max(picture.width, picture.height));
  const w = Math.max(1, Math.round(picture.width * k)), h = Math.max(1, Math.round(picture.height * k));
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(picture, 0, 0, w, h);
  picture.close();
  return paletteFromPixels(x.getImageData(0, 0, w, h).data);
}

// Null if the dialog was cancelled. Anything else that stops it comes back as a message.
async function pictureColours(file) {
  if (!file) return null;
  try {
    const palette = await paletteFromBytes(file.bytes);
    return palette ? { palette, note: `Colours from ${file.name}. Adjust them above.` } : { note: `${file.name} has no visible colours.` };
  } catch {
    return { note: `Couldn't read ${file.name}.` };
  }
}

async function setPictureColours(file) {
  const got = await pictureColours(file);
  if (!got) return;
  if (got.palette) {
    state.scene.palette = state.custom = got.palette;
    renderStudio();
    noteChange();
  }
  $('paletteNote').textContent = got.note;
  $('paletteNote').hidden = false;
}

// Colour wells for your own palette. The five along the bottom are the look's colour ramp.
function colourEditor(host, def, onChange) {
  host.replaceChildren();
  const well = (label, value, set) => {
    const row = document.createElement('label'); row.title = label;
    const box = document.createElement('input');
    box.type = 'color'; box.value = value;
    box.oninput = () => { set(box.value); onChange(); };
    const name = document.createElement('span'); name.textContent = label;
    row.append(box, name);
    host.append(row);
  };
  well('Back', def.bg, (v) => { def.bg = v; });
  well('Text', def.fg, (v) => { def.fg = v; });
  well('Accent', def.accent, (v) => { def.accent = v; });
  def.colors.forEach((c, k) => well(`Ramp ${k + 1}`, c, (v) => { def.colors[k] = v; def.colors = [...def.colors]; }));
}

// The Custom tile follows its wells without rebuilding them mid-drag.
function renderSwatchesOnly() {
  const p = paletteOf(state.scene.palette);
  $('palettes').querySelectorAll('.pal.on s').forEach((s, k) => { s.style.background = [p.bg, ...p.colors][k]; });
}

function fontOptions(list, current, blank) {
  const names = [...new Set([...FONT_CHOICES, ...state.fonts, ...(current ? [current] : [])])].sort((a, b) => a.localeCompare(b));
  list.replaceChildren(new Option(blank, ''), ...names.map((name) => {
    const o = new Option(name, name);
    o.style.fontFamily = `"${name}"`;
    return o;
  }));
  list.value = current ?? '';
}

function fontPickers() {
  const sc = state.scene;
  fontOptions($('fontTitle'), sc.font, 'Default');
  fontOptions($('fontMono'), sc.mono, 'Default');
  fontOptions($('fontFooter'), sc.footer.font, 'Same as Readouts');
}

async function loadInstalledFonts() {
  const b = $('moreFonts');
  try {
    const fonts = await window.queryLocalFonts();
    state.fonts = [...new Set(fonts.map((f) => f.family))];
    b.textContent = `${state.fonts.length} installed fonts added`;
    b.disabled = true;
    fontPickers();
    renderFree();
  } catch (e) {
    b.textContent = 'Could not read installed fonts';
    console.error(e);
  }
}

function chooser(host, label, options, value, onChange) {
  const row = document.createElement('label'); row.className = 'slider picker';
  const s = document.createElement('span'); s.textContent = label;
  const list = document.createElement('select');
  options.forEach((text, k) => list.append(new Option(text, k)));
  list.value = value;
  list.onchange = () => onChange(Number(list.value));
  row.append(s, list);
  host.append(row);
}

function pickList(host, param, value, onChange) {
  const wrap = document.createElement('div'); wrap.className = 'picklist';
  const head = document.createElement('div'); head.className = 'pickhead';
  const name = document.createElement('span'); name.textContent = param.label;
  const every = param.options.map((_, k) => k);
  const quick = (text, list) => {
    const b = document.createElement('button');
    b.className = 'ghost'; b.textContent = text;
    b.onclick = (e) => { e.preventDefault(); onChange(list); renderParams(); };
    return b;
  };
  head.append(name, quick('All', every), quick('None', []));
  const grid = document.createElement('div'); grid.className = 'pickgrid';
  const chosen = new Set(value);
  param.options.forEach((text, k) => {
    const row = document.createElement('label'); row.className = 'check';
    const box = document.createElement('input'); box.type = 'checkbox'; box.checked = chosen.has(k);
    box.dataset.pick = k;
    box.onchange = () => {
      if (box.checked) chosen.add(k); else chosen.delete(k);
      onChange(every.filter((i) => chosen.has(i)));
    };
    row.append(box, text);
    grid.append(row);
  });
  wrap.append(head, grid);
  host.append(wrap);
}

function toggle(host, label, value, onChange) {
  const row = document.createElement('label'); row.className = 'check';
  const box = document.createElement('input'); box.type = 'checkbox'; box.checked = !!value;
  box.onchange = () => onChange(box.checked ? 1 : 0);
  row.append(box, label);
  host.append(row);
}

// Which look the settings panel edits: the page's, the Compose tile, or an Auto edit pick.
function paramLook() {
  const sc = state.scene;
  if (sc.mode === 'single') return sc.look;
  if (sc.mode === 'compose') return state.layoutCell;
  if (sc.mode === 'free') return free.selected;
  return sc.autoList.includes(state.autoCell) ? state.autoCell : sc.autoList[0] ?? null;
}

function renderParams() {
  const sc = state.scene, id = paramLook(), look = LOOKS[id];
  const host = $('lookParams'), pick = $('autoPick');
  host.replaceChildren();
  host.classList.toggle('reserve', sc.mode === 'single');
  $('lookParamsWrap').hidden = !look;
  pick.hidden = sc.mode !== 'auto';
  if (!look) return;
  if (sc.mode === 'auto') {
    pick.replaceChildren(...sc.autoList.map((pickId) => new Option(LOOKS[pickId].name, pickId)));
    pick.value = id;
  }
  $('lookParamsTitle').textContent = sc.mode === 'auto' ? 'Settings' : `${look.name} settings`;
  $('resetParams').onclick = () => { delete sc.params[id]; renderParams(); };
  if (look.needsVideo) {
    const b = document.createElement('button');
    b.className = 'ghost choosevideo';
    b.textContent = sc.video ? `Change video (${sc.video.name})` : 'Choose video';
    b.onclick = chooseVideo;
    host.append(b);
  }
  if (look.needsImages) {
    const row = document.createElement('div'); row.className = 'addpictures';
    const add = document.createElement('button');
    add.className = 'ghost'; add.textContent = `Add pictures (${sc.images.length})`;
    add.onclick = chooseImages;
    row.append(add);
    if (sc.images.length) {
      const clear = document.createElement('button');
      clear.className = 'ghost'; clear.textContent = 'Clear';
      clear.onclick = () => { for (const it of sc.images) it.bitmap.close(); sc.images = []; renderParams(); };
      row.append(clear);
    }
    host.append(row);
  }
  const vals = (sc.params[id] ??= {});
  const on = (key) => vals[key] ?? look.params.find((q) => q.id === key)?.def;
  // A setting shows when its parent does and the parent has the right value.
  const shown = (q) => {
    if (!q.when) return true;
    const parent = look.params.find((o) => o.id === q.when);
    return (q.is === undefined ? !!on(q.when) : on(q.when) === q.is) && shown(parent);
  };
  for (const p of look.params) {
    if (!shown(p)) continue;
    if (p.type === 'toggle') toggle(host, p.label, vals[p.id] ?? p.def, (v) => { vals[p.id] = v; renderParams(); });
    else if (p.type === 'choice') chooser(host, p.label, p.options, vals[p.id] ?? p.def, (v) => { vals[p.id] = v; renderParams(); });
    else if (p.type === 'picks') pickList(host, p, vals[p.id] ?? p.def, (v) => { vals[p.id] = v; });
    else slider(host, p.label, p.min, p.max, p.step, vals[p.id] ?? p.def, (v) => { vals[p.id] = v; });
  }
}

function syncSvgButton() {
  const ok = canVector(state.scene);
  $('xSvg').disabled = !state.cur?.A || !ok;
  $('xSvg').title = ok ? '' : 'This look is made of pixels, so it has no vector version';
}

function bindControls() {
  $('addTrack').onclick = async () => addFiles(await window.sp.pickAudio());
  $('demo').onclick = loadDemo;
  $('listen').onclick = () => window.sp.openListen();
  $('play').onclick = () => (state.playing ? pause() : play());
  initVolume();

  document.querySelectorAll('#tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.dataset.tab !== b.dataset.tab; });
    };
  });

  seg('mode', state.scene.mode, (v) => {
    const was = state.scene.mode;
    state.scene.mode = v;
    if (v === 'free') enterFree(was);
    renderLooks();
  });
  $('presetName').oninput = syncPresetSave;
  $('savePreset').onclick = async () => {
    const name = $('presetName').value.trim();
    await storePresets(putPreset(state.presets, capturePreset(name, state.scene, state.aspect, presetSize())));
    $('presetName').value = '';
    syncPresetSave();
  };
  window.sp.readPresets().then((list) => { state.presets = list; renderPresets(); });
  $('fBpm').onchange = (e) => setTempo(e.target.valueAsNumber);
  $('bpmHalf').onclick = () => setTempo(state.cur.A.bpm / 2);
  $('bpmDouble').onclick = () => setTempo(state.cur.A.bpm * 2);
  seg('xFormat', '16:9', setShape);
  const typedSize = () => setCustomSize($('xW').valueAsNumber, $('xH').valueAsNumber);
  $('xW').onchange = typedSize; $('xH').onchange = typedSize;
  seg('xLength', '15', () => {});
  seg('xRes', 'HD', () => {});
  seg('xFps', '60', () => {});
  seg('xStart', 'best', () => {});

  $('autoPick').onchange = (e) => { state.autoCell = e.target.value; renderParams(); };
  $('title').oninput = (e) => { state.scene.title = e.target.value; };
  $('chrome').onchange = (e) => { state.scene.chrome = e.target.checked; };
  $('labels').onchange = (e) => { state.scene.labels = e.target.checked; };
  $('overlay').onchange = (e) => {
    state.scene.transparent = e.target.checked;
    canvas.classList.toggle('checker', e.target.checked);
  };
  $('reseed').onclick = () => { state.scene.seed++; };
  $('resetLook').onclick = () => {
    const sc = state.scene;
    sc.brush = sc.motion = sc.density = 1;
    sc.seed = 0;
    renderStudio();
  };
  $('fontTitle').onchange = (e) => { state.scene.font = e.target.value; };
  $('fontMono').onchange = (e) => { state.scene.mono = e.target.value; };
  $('fontFooter').onchange = (e) => { state.scene.footer.font = e.target.value; };
  $('footerColour').oninput = (e) => { state.scene.footer.colour = e.target.value; $('footerColourReset').disabled = false; };
  $('footerColourReset').onclick = () => { state.scene.footer.colour = ''; renderFooter(); };
  $('copyShare').onclick = () => copyShare(capturePreset('Shared setup', state.scene, state.aspect, presetSize()));
  $('shareCode').oninput = (e) => { $('loadShare').disabled = !e.target.value.trim(); };
  $('loadShare').onclick = () => loadShare($('shareCode').value);
  $('moreFonts').onclick = loadInstalledFonts;
  $('pickVideo').onclick = chooseVideo;
  window.sp.onVideoProgress((frames) => busy(`Preparing video: ${frames} frames`, 0.5));
  $('paletteImage').onclick = async () => setPictureColours(await window.sp.pickImage());
  $('pickImage').onclick = async () => {
    const r = await window.sp.pickImage();
    if (!r) return;
    const bmp = await createImageBitmap(new Blob([r.bytes]));
    const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
    x.drawImage(bmp, 0, 0, w, h);
    state.scene.image = { w, h, data: x.getImageData(0, 0, w, h).data, id: Date.now() };
    $('imageName').textContent = r.name;
    if (state.scene.mode === 'single') { state.scene.look = 'portrait'; renderLooks(); }
  };

  $('exportVideo').onclick = () => (state.exporting ? (state.cancel = true) : doExportVideo());
  $('xPng').onclick = () => stillExport('png');
  $('xPdf').onclick = () => stillExport('pdf');
  $('xSvg').onclick = () => stillExport('svg');
  $('xCover').onclick = () => stillExport('cover');

  waveCanvas.onpointerdown = (e) => {
    const A = state.cur?.A;
    if (!A) return;
    const to = (ev) => seek(((ev.clientX - waveCanvas.getBoundingClientRect().left) / waveCanvas.clientWidth) * A.duration);
    to(e);
    waveCanvas.setPointerCapture(e.pointerId);
    waveCanvas.onpointermove = to;
    waveCanvas.onpointerup = () => { waveCanvas.onpointermove = null; };
  };

  history = new History(snapshot());
  for (const event of ['click', 'change', 'pointerup', 'keyup']) addEventListener(event, noteChange, true);

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.ctrlKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
      e.preventDefault();
      restore(e.code === 'KeyY' || e.shiftKey ? history.redo() : history.undo());
      return;
    }
    const picked = state.scene.mode === 'free' ? free.item : null;
    if (picked) {
      const nudge = e.shiftKey ? 0.025 : 0.005;
      const by = { ArrowLeft: [-nudge, 0], ArrowRight: [nudge, 0], ArrowUp: [0, -nudge], ArrowDown: [0, nudge] }[e.code];
      if (by) {
        e.preventDefault();
        Object.assign(picked, inPage({ ...picked, x: picked.x + by[0], y: picked.y + by[1] }));
        renderFree();
        return;
      }
      if (e.code === 'Delete') { removeFree(picked.id); return; }
      if (e.code === 'Escape') { free.select(null); return; }
    }
    if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
    if (e.code === 'ArrowLeft') seek(state.t - 5);
    if (e.code === 'ArrowRight') seek(state.t + 5);
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      const i = LOOK_LIST.findIndex((l) => l.id === state.scene.look);
      const next = LOOK_LIST[(i + (e.code === 'ArrowDown' ? 1 : LOOK_LIST.length - 1)) % LOOK_LIST.length];
      if (state.scene.mode === 'single') { e.preventDefault(); pickLook(next.id); }
    }
  });
  addEventListener('resize', () => drawWave());

  addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
  addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const files = [...e.dataTransfer.files];
    const audioFiles = files.filter((f) => /\.(mp3|wav|aiff?|flac|m4a|ogg|opus|aac)$/i.test(f.name));
    const videoFile = files.find((f) => /\.(mp4|mov|m4v|mkv|webm|avi)$/i.test(f.name));
    addFiles(audioFiles.map((f) => window.sp.pathOf(f)));
    if (videoFile) setVideo(window.sp.pathOf(videoFile));
  });
}

function exportSettings() {
  const A = state.cur.A;
  const len = segValue('xLength');
  const dur = len === 'full' ? A.duration : Math.min(A.duration, +len);
  return {
    ...sizeFor(segValue('xFormat'), segValue('xRes')),
    fps: +segValue('xFps'), dur,
    start: len === 'full' ? 0 : segValue('xStart') === 'best' ? bestStart(A, dur) : Math.min(state.t, A.duration - dur),
  };
}

const safeName = (s) => s.replace(/[<>:"/\\|?*]+/g, '').trim() || 'oscillo';

async function doExportVideo(forceOut) {
  const A = state.cur.A, cfg = exportSettings(), alpha = state.scene.transparent;
  const stem = `${safeName(state.scene.title || A.name)} ${segValue('xFormat').replace(':', 'x')}`;
  const out = forceOut ?? await window.sp.saveDialog({
    name: `${stem}.${alpha ? 'mov' : 'mp4'}`,
    filters: [alpha ? { name: 'ProRes 4444', extensions: ['mov'] } : { name: 'MP4', extensions: ['mp4'] }],
  });
  if (!out) return null;
  if (state.playing) pause();
  state.exporting = true; state.cancel = false;
  $('exportVideo').textContent = 'Cancel';
  const scene = structuredClone({ ...state.scene, image: null, video: null, images: [] });
  scene.image = state.scene.image;
  scene.images = state.scene.images;
  scene.video = state.scene.video;
  try {
    const r = await exportVideo({
      A, scene, ...cfg, out,
      cancelled: () => state.cancel,
      onProgress: (p, rate) => {
        busy(`Rendering ${Math.round(p * 100)}%, ${rate.toFixed(0)} frames/s`, p);
      },
    });
    $('xStatus').textContent = r.cancelled ? 'Export cancelled.' : `Saved ${out.split(/[\\/]/).pop()}`;
    return r;
  } catch (e) {
    $('xStatus').textContent = `Export failed: ${e.message}`;
    throw e;
  } finally {
    state.exporting = false;
    busy(null);
    $('exportVideo').textContent = 'Export video';
  }
}

async function stillExport(kind, forceOut) {
  const A = state.cur.A, scene = state.scene;
  const base = safeName(scene.title || A.name);
  const spec = {
    png: { name: `${base} poster.png`, ext: 'png' },
    pdf: { name: `${base} poster.pdf`, ext: 'pdf' },
    svg: { name: `${base} poster.svg`, ext: 'svg' },
    cover: { name: `${base} cover.png`, ext: 'png' },
  }[kind];
  const out = forceOut ?? await window.sp.saveDialog({ name: spec.name, filters: [{ name: spec.ext.toUpperCase(), extensions: [spec.ext] }] });
  if (!out) return null;
  busy('Printing the page', 0.5);
  await new Promise((r) => setTimeout(r, 30));
  try {
    if (kind === 'png') await window.sp.write(out, await renderPng(A, scene, state.t, A3.w, A3.h));
    if (kind === 'cover') await window.sp.write(out, await renderPng(A, scene, state.t, 3000, 3000));
    if (kind === 'svg') await window.sp.write(out, renderSvg(A, scene, state.t));
    if (kind === 'pdf') await writePdf(A, scene, state.t, out);
    $('xStatus').textContent = `Saved ${out.split(/[\\/]/).pop()}`;
  } catch (e) {
    $('xStatus').textContent = `Export failed: ${e.message}`;
    throw e;
  } finally {
    busy(null);
  }
  return out;
}

bindControls();
renderLooks();
renderStudio();
syncTransport();
requestAnimationFrame(frame);

if (new URLSearchParams(location.search).has('smoke')) {
  window.app = { state, stage, audio, free, fitCanvas, paletteFromBytes, setPictureColours, noteChange, replaceSelected, renderLooks, addImages, renderParams, copyShare, loadShare, exportSize: () => sizeFor(segValue('xFormat'), segValue('xRes')), renderFree, setTempo, setVideo, loadDemo, addFiles, seek, play, pause, doExportVideo, stillExport, selectTrack, renderLooks, renderStudio, FORMATS, FR };
  import('./smoke.js');
}
