// Everything that leaves the app: video, posters and covers.
import { Stage, lastFrameTime, frameBox } from '../core/stage.js';
import { SvgContext } from '../core/svgctx.js';
import { LOOKS } from '../looks/index.js';
import { FR } from '../core/analysis.js';
import { paletteOf } from '../core/style.js';

export const FORMATS = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], custom: [1280, 720] };

// Video needs even sides, and encoders stop at 8K.
export const customSide = (v) => Math.max(64, Math.min(7680, Math.round((Number.isFinite(v) ? v : 720) / 2) * 2));

export const A3 = { w: 3508, h: 4961 };

export function sizeFor(format, res) {
  const [w, h] = FORMATS[format];
  const k = res === '4K' && format !== 'custom' ? 2 : 1;
  return { w: w * k, h: h * k };
}

// Where a short clip should start: the loudest stretch, snapped back to a bar.
export function bestStart(A, dur) {
  if (dur >= A.duration) return 0;
  const win = Math.round(dur * FR), f = A.f.level;
  let sum = 0, best = -1, at = 0;
  for (let i = 0; i < A.n; i++) {
    sum += f[i];
    if (i >= win) sum -= f[i - win];
    if (i >= win && sum > best) { best = sum; at = i - win; }
  }
  const t = at / FR;
  let snap = 0;
  for (const d of A.downbeats) { if (d <= t) snap = d; else break; }
  return Math.min(snap, A.duration - dur);
}

export async function exportVideo({ A, scene, w, h, fps, start, dur, out, onProgress, cancelled }) {
  const alpha = scene.transparent;
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const stage = new Stage();
  const total = Math.round(dur * fps);
  await window.sp.exportStart({ w, h, fps, start, dur, alpha, audio: A.path, out });
  const t0 = performance.now();
  try {
    for (let f = 0; f < total; f++) {
      if (cancelled()) { await window.sp.exportCancel(out); return { cancelled: true }; }
      await stage.prepare(A, start + f / fps, scene);
      stage.render(g, w, h, A, start + f / fps, scene);
      await window.sp.exportFrame(g.getImageData(0, 0, w, h).data);
      if (f % 5 === 0) {
        onProgress?.(f / total, f / ((performance.now() - t0) / 1000));
        await new Promise((r) => setTimeout(r));
      }
    }
    await window.sp.exportFinish();
  } catch (e) {
    await window.sp.exportCancel(out);
    throw e;
  }
  return { out, frames: total, fps: total / ((performance.now() - t0) / 1000) };
}

const posterTime = (A, scene, t) => (LOOKS[scene.look]?.kind === 'sheet' && scene.mode === 'single' ? lastFrameTime(A) : t);

export async function renderPng(A, scene, t, w, h) {
  const canvas = new OffscreenCanvas(w, h);
  const stage = new Stage(), at = posterTime(A, scene, t);
  await stage.prepare(A, at, scene);
  stage.render(canvas.getContext('2d'), w, h, A, at, scene);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

export const canVector = (scene) => scene.mode === 'single' && LOOKS[scene.look]?.svg !== false;

// CSS pixels of an A3 sheet. Sizes are all relative, so it scales cleanly.
export function renderSvg(A, scene, t) {
  const W = 1123, H = 1587;
  const svg = new SvgContext(W, H, paletteOf(scene.palette).bg);
  const stage = new Stage();
  const look = LOOKS[scene.look];
  const flat = { ...scene, transparent: false };
  const at = posterTime(A, scene, t);
  const box = frameBox(W, H, scene.chrome);
  const s = stage.makeState(A, look, flat, W, H, box, at);
  svg.save();
  svg.beginPath(); svg.rect(box.x, box.y, box.w, box.h); svg.clip();
  if (look.kind === 'sheet') {
    stage.advanceSheet({ g: svg, i: 0, mem: {}, canvas: { width: W, height: H } }, look, s, A.n - 1);
  } else {
    look.draw(svg, s);
  }
  svg.restore();
  if (scene.chrome) stage.drawChrome(svg, W, H, A, at, flat);
  return svg.toString();
}

export async function writePdf(A, scene, t, out) {
  const page = canVector(scene)
    ? renderSvg(A, scene, t).replace('<svg ', '<svg style="width:297mm;height:420mm;display:block" ')
    : `<img style="width:297mm;height:420mm;display:block" src="data:image/png;base64,${toBase64(await renderPng(A, scene, t, A3.w, A3.h))}">`;
  const html = `<!doctype html><meta charset="utf-8"><style>@page{size:297mm 420mm;margin:0}html,body{margin:0;padding:0}</style>${page}`;
  return window.sp.writePdf(html, out);
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(s);
}
