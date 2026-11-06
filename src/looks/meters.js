// Meters read the sound the way studio instruments do. They draw from the current
// moment only, so they also work live in the Listen window.
import { rgba, num, flag } from '../core/style.js';
import { FR, NB, KEY_NAMES } from '../core/analysis.js';

const TAU = Math.PI * 2;

function panel(g, s, label, box = s.box) {
  if (s.p?.frame === 0) return;
  const { pal, u } = s;
  g.strokeStyle = rgba(pal.dim, 0.5);
  g.lineWidth = Math.max(1, u * 0.9);
  g.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
  if (!s.labels) return;
  const size = Math.max(9, u * 17);
  g.font = `${size}px ${s.mono}`;
  g.textAlign = 'left'; g.textBaseline = 'top';
  if (!s.transparent) {
    g.fillStyle = rgba(pal.bg, 0.8);
    g.fillRect(box.x + u * 10, box.y + u * 10, g.measureText(label).width + u * 12, size + u * 8);
  }
  g.fillStyle = pal.dim;
  g.fillText(label, box.x + u * 16, box.y + u * 14);
  g.textBaseline = 'alphabetic';
}

const scope = {
  id: 'scope', name: 'Scope', group: 'Meters', kind: 'instant',
  desc: 'Triggered waveform, left and right',
  params: [{ id: 'span', label: 'Time span', min: 400, max: 4800, step: 100, def: 2000 }, num('gain', 'Gain', 0.3, 3, 0.05, 1), num('line', 'Line', 0.3, 4, 0.05, 1), flag('right', 'Right channel'), flag('frame', 'Frame')],
  draw(g, s) {
    const { A, t, box, pal, u, p } = s;
    panel(g, s, 'SCOPE');
    const { l, r } = A.wave(t, p.span * 2);
    if (l.length < p.span + 2) return;
    let start = 0;
    for (let i = 1; i < l.length - p.span; i++) if (l[i - 1] <= 0 && l[i] > 0) { start = i; break; }
    const mid = box.y + box.h / 2;
    const trace = (d, c, w) => {
      g.strokeStyle = c; g.lineWidth = w; g.lineJoin = 'round';
      g.beginPath();
      const st = Math.max(1, Math.floor(p.span / box.w));
      for (let i = 0; i < p.span; i += st) {
        const x = box.x + (i / p.span) * box.w, y = mid - d[start + i] * box.h * 0.46 * p.gain;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    };
    if (p.right) trace(r, rgba(pal.at(0.15), 0.8), u * 1.6 * s.brush * p.line);
    trace(l, pal.accent, u * 2.2 * s.brush * p.line);
  },
};

const spectrum = {
  id: 'spectrum', name: 'Spectrum', group: 'Meters', kind: 'instant',
  desc: 'Log-frequency bars with peak hold',
  params: [num('bars', 'Bars', 8, 48, 1, 48), num('gap', 'Gap', 0, 10, 0.5, 3), num('contrast', 'Contrast', 1, 4, 0.1, 2), num('hold', 'Peak hold', 0, 120, 1, 40), flag('frame', 'Frame')],
  draw(g, s) {
    const { A, i, box, pal, u, p } = s;
    panel(g, s, 'SPECTRUM');
    const bars = p.bars, gap = u * p.gap;
    const bw = (box.w - u * 32 - gap * (bars - 1)) / bars, h = box.h - u * 60;
    const level = (f, k) => {
      const from = Math.floor((k * NB) / bars), to = Math.max(from + 1, Math.floor(((k + 1) * NB) / bars));
      let e = 0;
      for (let b = from; b < to; b++) e = Math.max(e, A.f.bands[f * NB + b]);
      return e;
    };
    for (let k = 0; k < bars; k++) {
      let hold = 0;
      for (let f = 0; f < p.hold && i - f >= 0; f++) hold = Math.max(hold, level(i - f, k) * (1 - f / (p.hold * 1.5)));
      const x = box.x + u * 16 + k * (bw + gap), bh = Math.pow(level(i, k), p.contrast) * h;
      g.fillStyle = pal.at(k / bars);
      g.fillRect(x, box.y + box.h - u * 16 - bh, bw, bh);
      if (!p.hold) continue;
      g.fillStyle = pal.fg;
      g.fillRect(x, box.y + box.h - u * 16 - Math.pow(hold, p.contrast) * h, bw, Math.max(1, u * 2.5));
    }
  },
};

const vector = {
  id: 'vector', name: 'Vector', group: 'Meters', kind: 'instant',
  desc: 'Stereo goniometer and correlation',
  params: [num('zoom', 'Zoom', 0.3, 2, 0.01, 0.707), num('span', 'Samples', 600, 4800, 100, 2400), num('dot', 'Dot size', 0.5, 5, 0.1, 1), flag('axes', 'Axes'), flag('meter', 'Correlation'), flag('frame', 'Frame')],
  draw(g, s) {
    const { A, t, i, box, pal, u, p } = s;
    panel(g, s, 'VECTOR');
    const { l, r } = A.wave(t, p.span);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2 - u * 10, R = Math.min(box.w, box.h) * 0.42;
    if (p.axes) {
      g.strokeStyle = rgba(pal.dim, 0.35);
      g.lineWidth = Math.max(1, u);
      g.beginPath();
      g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R);
      g.stroke();
    }
    g.fillStyle = rgba(pal.accent, 0.5);
    const d = Math.max(1, u * 2 * s.brush * p.dot);
    for (let k = 0; k < l.length; k += 2) {
      g.fillRect(cx + (r[k] - l[k]) * p.zoom * R, cy - (l[k] + r[k]) * p.zoom * R, d, d);
    }
    if (!p.meter) return;
    const c = A.f.corr[i], y = box.y + box.h - u * 22, w = box.w * 0.6, x0 = cx - w / 2;
    g.fillStyle = rgba(pal.dim, 0.4); g.fillRect(x0, y, w, Math.max(1, u * 2));
    g.fillStyle = c < 0 ? pal.at(1) : pal.fg;
    g.fillRect(cx + (c * w) / 2 - u * 3, y - u * 6, u * 6, u * 14);
  },
};

const loudness = {
  id: 'loudness', name: 'Loudness', group: 'Meters', kind: 'instant',
  desc: 'Momentary and short-term LUFS with history',
  params: [num('seconds', 'History', 5, 60, 1, 20), num('floor', 'Range', -60, -20, 1, -40), num('line', 'Line', 0.3, 4, 0.05, 1), flag('momentary', 'Momentary'), flag('readout', 'Readout'), flag('frame', 'Frame')],
  draw(g, s) {
    const { A, i, box, pal, u, p } = s;
    panel(g, s, 'LOUDNESS');
    const scaleY = (l) => box.y + box.h - u * 24 - ((Math.max(p.floor, Math.min(0, l)) - p.floor) / -p.floor) * (box.h * 0.55);
    for (const l of [-50, -40, -30, -23, -14, -8]) {
      if (l <= p.floor) continue;
      g.strokeStyle = rgba(pal.dim, 0.3); g.lineWidth = Math.max(1, u * 0.8);
      g.beginPath(); g.moveTo(box.x, scaleY(l)); g.lineTo(box.x + box.w, scaleY(l)); g.stroke();
      g.fillStyle = pal.dim; g.font = `${Math.max(8, u * 14)}px ${s.mono}`;
      g.fillText(String(l), box.x + u * 16, scaleY(l) - u * 4);
    }
    const span = Math.round(FR * p.seconds), step = Math.max(1, Math.floor(span / box.w));
    const curve = (arr, c, w) => {
      g.strokeStyle = c; g.lineWidth = w; g.beginPath();
      let first = true;
      for (let k = i - span; k <= i; k += step) {
        if (k < 0) continue;
        const x = box.x + box.w * (1 - (i - k) / span), y = scaleY(arr[k]);
        first ? g.moveTo(x, y) : g.lineTo(x, y);
        first = false;
      }
      g.stroke();
    };
    if (p.momentary) curve(A.f.loudM, rgba(pal.at(0.2), 0.8), u * 1.6 * p.line);
    curve(A.f.loudS, pal.accent, u * 3 * s.brush * p.line);
    if (!p.readout) return;
    const m = A.f.loudM[i], st = A.f.loudS[i];
    g.fillStyle = pal.fg;
    g.font = `600 ${u * 110}px ${s.mono}`;
    g.textAlign = 'right';
    g.fillText(m < -60 ? '-inf' : m.toFixed(1), box.x + box.w - u * 18, box.y + u * 120);
    g.fillStyle = pal.dim;
    g.font = `${u * 22}px ${s.mono}`;
    g.fillText(`M LUFS   S ${st < -60 ? '-inf' : st.toFixed(1)}`, box.x + box.w - u * 18, box.y + u * 152);
    g.textAlign = 'left';
  },
};

let spectroBuffer = null;
const spectrogram = {
  id: 'spectrogram', name: 'Spectrogram', group: 'Meters', kind: 'instant', svg: false,
  desc: 'Scrolling waterfall of the last few seconds',
  params: [{ id: 'seconds', label: 'Seconds', min: 2, max: 20, step: 1, def: 8 }, num('contrast', 'Contrast', 1, 4, 0.1, 2), flag('smooth', 'Smooth'), flag('frame', 'Frame')],
  draw(g, s) {
    const { A, i, box, pal, p } = s;
    const cols = 360, step = Math.max(1, Math.round((FR * p.seconds) / cols));
    if (!spectroBuffer) {
      spectroBuffer = new OffscreenCanvas(cols, NB);
      spectroBuffer.lut = new Uint8Array(256 * 3);
      spectroBuffer.lutFor = null;
    }
    const c = spectroBuffer, x = c.getContext('2d');
    if (c.lutFor !== pal.id) {
      pal.ramp.forEach((h, k) => {
        const n = parseInt(h.slice(1), 16);
        c.lut[k * 3] = n >> 16; c.lut[k * 3 + 1] = (n >> 8) & 255; c.lut[k * 3 + 2] = n & 255;
      });
      c.lutFor = pal.id;
    }
    const img = x.createImageData(cols, NB), d = img.data;
    for (let col = 0; col < cols; col++) {
      const f = i - (cols - 1 - col) * step;
      if (f < 0) continue;
      for (let b = 0; b < NB; b++) {
        const e = Math.pow(A.f.bands[f * NB + b], p.contrast), q = Math.floor(e * 255);
        const o = ((NB - 1 - b) * cols + col) * 4;
        d[o] = c.lut[q * 3]; d[o + 1] = c.lut[q * 3 + 1]; d[o + 2] = c.lut[q * 3 + 2];
        d[o + 3] = Math.min(255, e * 500);
      }
    }
    x.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = !!p.smooth;
    g.drawImage(c, box.x, box.y, box.w, box.h);
    panel(g, s, 'SPECTROGRAM');
  },
};

const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const keywheel = {
  id: 'keywheel', name: 'Key Wheel', group: 'Meters', kind: 'instant',
  desc: 'Pitch energy on the circle of fifths',
  params: [num('width', 'Slice width', 0.2, 0.5, 0.01, 0.46), num('core', 'Core', 0.1, 0.7, 0.01, 0.34), num('reach', 'Reach', 0.1, 0.6, 0.01, 0.46), flag('labels', 'Note names'), flag('frame', 'Frame')],
  draw(g, s) {
    const { A, i, box, pal, u, p } = s;
    panel(g, s, 'KEY');
    const c = A.chromaAt(i);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.min(box.w, box.h) * 0.46;
    const tonic = A.key?.tonic ?? -1;
    FIFTHS.forEach((pc, k) => {
      const a = (k / 12) * TAU - Math.PI / 2, w = (TAU / 12) * p.width, e = c[pc];
      g.fillStyle = pal.at(k / 11);
      g.globalAlpha = 0.2 + 0.8 * e * e;
      g.beginPath();
      g.arc(cx, cy, R * (p.core + 0.08 + p.reach * e), a - w, a + w);
      g.arc(cx, cy, R * p.core, a + w, a - w, true);
      g.closePath(); g.fill();
      g.globalAlpha = 1;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (!p.labels) return;
      g.fillStyle = pc === tonic ? pal.accent : pal.fg;
      g.font = `${pc === tonic ? 700 : 400} ${u * 26}px ${s.mono}`;
      g.fillText(KEY_NAMES[pc], cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98);
    });
    g.fillStyle = pal.fg;
    g.font = `600 ${u * 40}px ${s.mono}`;
    g.fillText(A.key?.name?.split(' ')[0] ?? '', cx, cy - u * 12);
    g.fillStyle = pal.dim;
    g.font = `${u * 20}px ${s.mono}`;
    g.fillText(A.key?.mode ?? '', cx, cy + u * 24);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  },
};

const rack = {
  id: 'rack', name: 'Rack', group: 'Meters', kind: 'instant', svg: false,
  desc: 'Waveform, spectrum, stereo and loudness in one frame',
  params: [num('gap', 'Gap', 0, 60, 1, 12), flag('frames', 'Frames')],
  draw(g, s) {
    const { box, u, p: own } = s;
    const gap = u * own.gap, w = (box.w - gap) / 2, h = (box.h - gap) / 2;
    const parts = [scope, spectrum, vector, loudness];
    parts.forEach((look, k) => {
      const cell = { x: box.x + (k % 2) * (w + gap), y: box.y + (k >> 1) * (h + gap), w, h };
      const p = {};
      for (const q of look.params ?? []) p[q.id] = q.def;
      p.frame = own.frames;
      g.save();
      g.beginPath(); g.rect(cell.x, cell.y, cell.w, cell.h); g.clip();
      look.draw(g, { ...s, box: cell, u: Math.min(w, h) / 1000, p });
      g.restore();
    });
  },
};

export default [scope, spectrum, vector, loudness, spectrogram, keywheel, rack];
