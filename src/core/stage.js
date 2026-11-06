// Draws a scene at time t into any 2D context, at any size. Nothing here touches the
// clock or the screen, which is what makes export frames exact and repeatable.
import { LOOKS } from '../looks/index.js';
import { paletteOf, fontStack, FONT, MONO, makeRng } from './style.js';
import { FR } from './analysis.js';
import { composeLayout } from './layout.js';
import { footagePlan } from './chop.js';

// font and colour are empty for the Readouts font and the palette's dim colour.
export const FOOTER = { bpm: true, key: true, lufs: true, name: true, time: true, length: true, font: '', colour: '' };

export const defaultScene = () => ({
  mode: 'single',          // single | compose | auto | free
  look: 'strokes',
  cells: ['scope', 'spectrum', 'vector', 'loudness'],
  cellOpts: {},            // per look: { w, h, center }
  columns: 0,              // 0 picks a grid to suit the page
  free: [],                // Advanced: { id, x, y, w, h, palette?, fill?, mono? } in page fractions, last on top
  autoList: ['stipple', 'web', 'terrain', 'rorschach', 'swiss', 'tunnel'],
  autoBars: 4,
  palette: 'carbon',       // an id, or your own { bg, fg, accent, colors }
  font: '',                // title; empty means the default
  mono: '',                // readouts and look labels
  brush: 1,
  motion: 1,
  density: 1,
  seed: 0,
  params: {},
  title: '',
  chrome: true,
  labels: true,            // the small name in the corner of an element
  footer: { ...FOOTER },   // what the bottom line shows, and in what font and colour
  transparent: false,
  image: null,             // { w, h, data } for the Portrait pen
  video: null,             // a VideoSource for the Video look
  images: [],              // { bitmap, w, h, id, name } for Image Cuts
});

const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function frameBox(W, H, chrome) {
  const m = Math.min(W, H) * 0.055;
  if (!chrome) return { x: m * 0.4, y: m * 0.4, w: W - m * 0.8, h: H - m * 0.8 };
  const top = m + Math.min(W, H) * 0.085, bottom = m + Math.min(W, H) * 0.05;
  return { x: m, y: top, w: W - 2 * m, h: H - top - bottom };
}

export class Stage {
  constructor() { this.layers = new Map(); }

  seedFor(A, scene) { return ((A.seed ?? 1) + scene.seed * 7919) >>> 0; }

  paramsFor(look, scene) {
    const params = {};
    for (const p of look.params ?? []) params[p.id] = scene.params[look.id]?.[p.id] ?? p.def;
    return params;
  }

  // Where Compose would put things right now, as boxes on the page.
  composeBoxes(scene, W, H) {
    const box = frameBox(W, H, scene.chrome);
    const { cols, rows, items } = composeLayout(scene.cells, scene.cellOpts, W, H, scene.columns);
    const gap = Math.min(W, H) * 0.012;
    const cw = (box.w - gap * (cols - 1)) / cols, ch = (box.h - gap * (rows - 1)) / rows;
    return items.map((it) => ({
      id: it.id, x: box.x + it.x * (cw + gap), y: box.y + it.y * (ch + gap),
      w: it.w * cw + (it.w - 1) * gap, h: it.h * ch + (it.h - 1) * gap,
    }));
  }

  makeState(A, look, scene, W, H, box, t) {
    const i = A.idx(t);
    const seed = this.seedFor(A, scene), params = this.paramsFor(look, scene);
    return {
      W, H, box, A, t, i, look,
      u: Math.min(box.w, box.h) / 1000,
      prog: Number.isFinite(A.duration) ? Math.min(1, t / A.duration) : 0,
      clock: A.f.cum[i] * scene.motion,
      pal: paletteOf(scene.palette), mono: fontStack(scene.mono, MONO), font: fontStack(scene.font, FONT),
      labels: scene.labels ?? true,
      p: params, seed, rng: makeRng(seed),
      brush: scene.brush, motion: scene.motion, density: scene.density,
      transparent: scene.transparent, image: scene.image, video: scene.video, images: scene.images ?? [],
      title: scene.title || A.name || 'Untitled',
    };
  }

  sheetLayer(A, look, scene, s) {
    const w = Math.ceil(s.W), h = Math.ceil(s.H);
    const key = [A.seed, look.id, w, h, Math.round(s.box.x), Math.round(s.box.y), Math.round(s.box.w), Math.round(s.box.h), s.pal.id, s.mono, s.labels, scene.brush, scene.density, scene.seed, JSON.stringify(s.p), scene.image?.id ?? 0, scene.transparent].join('|');
    let L = this.layers.get(key);
    if (!L) {
      const canvas = new OffscreenCanvas(w, h);
      L = { canvas, g: canvas.getContext('2d'), i: 0, mem: {}, key };
      this.layers.set(key, L);
      while (this.layers.size > 10) this.layers.delete(this.layers.keys().next().value);
    } else {
      // Refresh the entry so eviction drops the layer unused for longest.
      this.layers.delete(key); this.layers.set(key, L);
    }
    return L;
  }

  advanceSheet(L, look, s, target) {
    const n = s.A.n;
    const tick = Math.max(2, Math.ceil(n / ((look.ticks ?? 1600) * s.density)));
    if (target < L.i) {
      L.g.clearRect(0, 0, L.canvas.width, L.canvas.height);
      L.i = 0; L.mem = {};
    }
    s.mem = L.mem;
    if (L.i === 0) look.prep?.(L.g, s);
    while (L.i + tick <= target) {
      look.step(L.g, s, L.i, tick);
      L.i += tick;
    }
  }

  drawCell(g, A, id, scene, W, H, box, t) {
    const look = LOOKS[id] ?? LOOKS.scope;
    const s = this.makeState(A, look, scene, W, H, box, t);
    g.save();
    g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
    const missing = look.needsImage && !scene.image ? 'Choose a picture in Studio' : look.needsVideo && !scene.video ? 'Choose a video to start'
      : look.needsImages && !scene.images?.length ? 'Add pictures to start' : '';
    if (missing) {
      g.fillStyle = s.pal.dim;
      g.font = `400 ${s.u * 30}px ${fontStack(scene.font, FONT)}`;
      g.textAlign = 'center';
      g.fillText(missing, box.x + box.w / 2, box.y + box.h / 2);
      g.textAlign = 'left';
    } else if (look.kind === 'sheet') {
      const L = this.sheetLayer(A, look, scene, s);
      this.advanceSheet(L, look, s, s.i);
      g.drawImage(L.canvas, 0, 0);
    } else {
      look.draw(g, s);
    }
    g.restore();
    return s;
  }

  shows(A, t, scene, id) {
    if (scene.mode === 'compose') return scene.cells.includes(id);
    if (scene.mode === 'free') return scene.free.some((it) => it.id === id);
    return (scene.mode === 'auto' ? this.autoLook(A, scene, t) : scene.look) === id;
  }

  // The footage frames a moment needs. Empty unless the scene is showing the Video look.
  videoFrames(A, t, scene) {
    if (!scene.video || !this.shows(A, t, scene, 'video')) return [];
    const plan = footagePlan(A, t, this.paramsFor(LOOKS.video, scene), this.seedFor(A, scene), scene.video);
    return plan.layers.map((l) => l.frame);
  }

  // Export waits for exact frames. The preview only asks ahead and shows what it has.
  async prepare(A, t, scene) {
    const frames = this.videoFrames(A, t, scene);
    if (frames.length) await scene.video.ready(frames);
  }

  lookAhead(A, t, scene) {
    if (!scene.video) return;
    for (let k = 0; k < 14; k++) for (const f of this.videoFrames(A, t + k / 30, scene)) scene.video.want(f);
  }

  autoLook(A, scene, t) {
    const list = scene.autoList.length ? scene.autoList : ['scope'];
    const bars = A.downbeats ?? [];
    let k = 0;
    if (bars.length > 1) {
      let lo = 0, hi = bars.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (bars[m] <= t) lo = m; else hi = m - 1; }
      k = Math.floor(lo / scene.autoBars);
    } else k = Math.floor(t / 8);
    return list[k % list.length];
  }

  // Looks set their own alpha while drawing, so a faded element is drawn apart and laid in whole.
  withOpacity(g, W, H, box, opacity, draw) {
    if (opacity >= 1) return draw(g);
    if (opacity <= 0) return undefined;
    const w = Math.ceil(W), h = Math.ceil(H);
    this.fadePad ??= new OffscreenCanvas(w, h).getContext('2d');
    const pad = this.fadePad;
    if (pad.canvas.width !== w || pad.canvas.height !== h) { pad.canvas.width = w; pad.canvas.height = h; }
    pad.clearRect(0, 0, w, h);
    draw(pad);
    g.save();
    g.globalAlpha = opacity;
    g.drawImage(pad.canvas, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
    g.restore();
    return undefined;
  }

  // An element can bring its own colours, and then its own background to sit them on.
  drawElement(g, A, it, scene, W, H, t) {
    const box = { x: it.x * W, y: it.y * H, w: it.w * W, h: it.h * H };
    this.withOpacity(g, W, H, box, it.opacity ?? 1, (to) => this.drawOwn(to, A, it, scene, W, H, box, t));
  }

  drawOwn(g, A, it, scene, W, H, box, t) {
    const own = { ...scene, palette: it.palette ?? scene.palette, mono: it.mono ?? scene.mono, font: it.mono ?? scene.font };
    if (it.fill ?? !!it.palette) {
      g.fillStyle = paletteOf(own.palette).bg;
      g.fillRect(box.x, box.y, box.w, box.h);
    }
    this.drawCell(g, A, it.id, own, W, H, box, t);
    if (!it.outline) return;
    g.strokeStyle = paletteOf(own.palette).dim; g.lineWidth = Math.max(1, Math.min(W, H) / 1000);
    g.strokeRect(box.x, box.y, box.w, box.h);
  }

  render(g, W, H, A, t, scene) {
    g.save();
    if (scene.transparent) g.clearRect(0, 0, W, H);
    else { g.fillStyle = paletteOf(scene.palette).bg; g.fillRect(0, 0, W, H); }
    const box = frameBox(W, H, scene.chrome);

    if (scene.mode === 'compose') {
      for (const cell of this.composeBoxes(scene, W, H)) {
        const opacity = scene.cellOpts[cell.id]?.opacity ?? 1;
        this.withOpacity(g, W, H, cell, opacity, (to) => this.drawCell(to, A, cell.id, scene, W, H, cell, t));
      }
    } else if (scene.mode === 'free') {
      for (const it of scene.free) this.drawElement(g, A, it, scene, W, H, t);
    } else {
      const id = scene.mode === 'auto' ? this.autoLook(A, scene, t) : scene.look;
      this.drawCell(g, A, id, scene, W, H, box, t);
    }
    if (scene.chrome) this.drawChrome(g, W, H, A, t, scene);
    g.restore();
  }

  drawChrome(g, W, H, A, t, scene) {
    const pal = paletteOf(scene.palette);
    const min = Math.min(W, H), m = min * 0.055;
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    // The Title element stands in for this one.
    if (!this.shows(A, t, scene, 'title')) {
      g.fillStyle = pal.fg;
      g.font = `700 ${min * 0.042}px ${fontStack(scene.font, FONT)}`;
      g.fillText(scene.title || A.name || 'Untitled', m, m + min * 0.042);
    }

    const sz = min * 0.0185, show = { ...FOOTER, ...scene.footer };
    g.font = `400 ${sz}px ${fontStack(show.font || scene.mono, MONO)}`;
    const y = H - m + sz * 0.2;
    const lookName = scene.mode === 'single' ? LOOKS[scene.look]?.name : { auto: 'Auto edit', free: 'Advanced' }[scene.mode] ?? 'Compose';
    const stats = [];
    if (show.bpm && A.bpm) stats.push(`${A.bpm} BPM`);
    if (show.key && A.key?.name) stats.push(A.key.name);
    if (show.lufs && Number.isFinite(A.lufs)) stats.push(`${A.lufs.toFixed(1)} LUFS`);
    g.fillStyle = show.colour || pal.dim;
    g.fillText(stats.join('   '), m, y);
    g.textAlign = 'right';
    const clock = [show.time && fmtTime(t), show.length && Number.isFinite(A.duration) && fmtTime(A.duration)].filter(Boolean).join(' / ');
    g.fillText([show.name && lookName, clock].filter(Boolean).join('   '), W - m, y);
    g.textAlign = 'left';
  }
}

export const lastFrameTime = (A) => (A.n - 1) / FR;
