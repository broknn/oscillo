// Sheet looks print the track onto a page in time order. step() only ever adds ink,
// so scrubbing back replays from the start and the finished page is the poster.
import { fbm, hash2, num, flag } from '../core/style.js';
import { FR, HOP } from '../core/analysis.js';

const TAU = Math.PI * 2;

const strokes = {
  id: 'strokes', name: 'Strokes', group: 'Sheet', kind: 'sheet', ticks: 1100,
  desc: 'Low to high bands paint a canvas along a flow field',
  params: [{ id: 'curl', label: 'Curl', min: 0.5, max: 6, step: 0.1, def: 2.6 }, { id: 'layers', label: 'Layers', min: 3, max: 10, step: 1, def: 7 }, num('length', 'Length', 0.3, 3, 0.05, 1), num('floor', 'Threshold', 0.05, 0.7, 0.01, 0.22), num('field', 'Flow size', 0.08, 0.6, 0.01, 0.22)],
  step(g, s, i, tick) {
    const { A, box, pal, u, p } = s;
    const x0 = box.x + (i / A.n) * box.w;
    g.lineCap = 'round';
    for (let b = 0; b < p.layers; b++) {
      const e = A.bandGroup(i + (tick >> 1), b, p.layers);
      if (e < p.floor) continue;
      const v = (b + 0.5 + (hash2(i, b, s.seed) - 0.5) * 1.3) / p.layers;
      let x = x0, y = box.y + box.h * (1 - v);
      const len = (8 + 34 * e * e) * p.length;
      g.strokeStyle = pal.at(v);
      g.globalAlpha = 0.25 + 0.5 * e;
      g.lineWidth = u * s.brush * (2 + 26 * e * e);
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < len; k++) {
        const a = fbm(x / (box.w * p.field), y / (box.w * p.field), s.seed % 1000) * TAU * p.curl;
        x += Math.cos(a) * u * 3.2; y += Math.sin(a) * u * 3.2;
        if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) break;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  },
};

const seismo = {
  id: 'seismo', name: 'Seismo', group: 'Sheet', kind: 'sheet', ticks: 3600,
  desc: 'Rows of seismograph trace, ticked on every kick',
  params: [{ id: 'rows', label: 'Rows', min: 8, max: 48, step: 1, def: 22 }, { id: 'gain', label: 'Gain', min: 0.3, max: 2, step: 0.05, def: 0.9 }, num('line', 'Line', 0.3, 3, 0.05, 0.9), flag('marks', 'Kick marks')],
  step(g, s, i, tick) {
    const { A, box, pal, u, p } = s;
    const perRow = A.n / p.rows;
    const row = Math.floor(i / perRow);
    if (row >= p.rows) return;
    const rh = box.h / p.rows;
    const y = box.y + rh * (row + 0.5);
    const x = (k) => box.x + ((k - row * perRow) / perRow) * box.w;
    let top = 0, bot = 0;
    for (let k = i; k < i + tick; k++) {
      const v = A.L[k * HOP] ?? 0, w = A.f.peak[k] ?? 0;
      top = Math.max(top, v > 0 ? w : w * 0.4); bot = Math.max(bot, v < 0 ? w : w * 0.4);
    }
    g.strokeStyle = pal.fg;
    g.lineWidth = u * p.line * s.brush;
    g.beginPath();
    g.moveTo(x(i), y - top * rh * p.gain);
    g.lineTo(x(i), y + bot * rh * p.gain);
    g.stroke();
    if (p.marks && A.f.kick[i] > 0.7 && A.f.kick[i] > (A.f.kick[i - tick] ?? 0)) {
      g.strokeStyle = pal.accent;
      g.lineWidth = u * 1.6;
      g.beginPath(); g.moveTo(x(i), y - rh * 0.5); g.lineTo(x(i), y + rh * 0.5); g.stroke();
    }
  },
};

const ridges = {
  id: 'ridges', name: 'Ridges', group: 'Sheet', kind: 'sheet', ticks: 4000,
  desc: 'One spectrum per line, stacked into a mountain range',
  params: [{ id: 'rows', label: 'Rows', min: 16, max: 90, step: 1, def: 40 }, { id: 'height', label: 'Height', min: 1, max: 16, step: 0.5, def: 9 }, num('contrast', 'Contrast', 1, 4, 0.1, 2.2), num('taper', 'Edge taper', 0, 1, 0.01, 1), num('line', 'Line', 0.5, 6, 0.1, 1.9)],
  step(g, s, i, tick) {
    const { A, box, pal, u, p } = s;
    const perRow = Math.ceil(A.n / p.rows);
    const row = Math.floor(i / perRow);
    if (row >= p.rows || row === s.mem.row) return;
    if (i + tick < (row + 1) * perRow - tick && row < p.rows - 1) return;
    s.mem.row = row;
    const NBX = 64;
    const y0 = box.y + box.h * 0.1 + (box.h * 0.88 * row) / p.rows;
    const rh = (box.h * 0.88) / p.rows;
    const pts = [];
    for (let k = 0; k <= NBX; k++) {
      const b = (k / NBX) * 47.99, c = Math.floor(b);
      let e = 0, count = 0;
      for (let f = row * perRow; f < (row + 1) * perRow && f < A.n; f += 3) {
        e = Math.max(e, A.f.bands[f * 48 + c] * 0.6 + A.f.bands[f * 48 + Math.min(47, c + 1)] * 0.4); count++;
      }
      const w = Math.sin((Math.PI * k) / NBX), fade = w * w * p.taper + 1 - p.taper;
      pts.push([box.x + (k / NBX) * box.w, y0 - Math.pow(e, p.contrast) * rh * p.height * fade]);
    }
    g.beginPath();
    g.moveTo(pts[0][0], y0);
    for (const [x, y] of pts) g.lineTo(x, y);
    g.lineTo(pts[NBX][0], y0);
    g.closePath();
    if (s.transparent) { g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.fill(); g.globalCompositeOperation = 'source-over'; }
    else { g.fillStyle = pal.bg; g.fill(); }
    g.beginPath();
    pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.strokeStyle = pal.at(row / p.rows);
    g.lineWidth = u * p.line * s.brush;
    g.lineJoin = 'round';
    g.stroke();
  },
};

const groove = {
  id: 'groove', name: 'Groove', group: 'Sheet', kind: 'sheet', ticks: 5000,
  desc: 'A single spiral cut from the centre out',
  params: [{ id: 'turns', label: 'Turns', min: 10, max: 90, step: 1, def: 42 }, { id: 'cut', label: 'Cut depth', min: 0.2, max: 2, step: 0.05, def: 0.8 }, num('core', 'Core', 0.02, 0.5, 0.01, 0.14), num('line', 'Line', 0.3, 4, 0.05, 1)],
  step(g, s, i, tick) {
    const { A, box, pal, u, p } = s;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const R = Math.min(box.w, box.h) * 0.49, pitch = (R * (1 - p.core)) / p.turns;
    const at = (f) => {
      const q = f / A.n, a = q * p.turns * TAU;
      const r = R * p.core + R * (1 - p.core) * q + (A.f.peak[f] ?? 0) * pitch * p.cut * Math.sin(f * 2.4);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    };
    const steps = 4;
    g.strokeStyle = pal.at(i / A.n);
    g.lineWidth = u * (1 + 3 * A.f.level[i]) * s.brush * p.line;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(...at(i));
    for (let k = 1; k <= steps; k++) g.lineTo(...at(i + (tick * k) / steps | 0));
    g.stroke();
  },
};

const sunburst = {
  id: 'sunburst', name: 'Sunburst', group: 'Sheet', kind: 'sheet', ticks: 1300,
  desc: 'The running time wound into a ring of rays',
  params: [{ id: 'inner', label: 'Core', min: 0.1, max: 0.7, step: 0.01, def: 0.32 }, num('reach', 'Ray length', 0.1, 0.7, 0.01, 0.34), num('rays', 'Bands', 2, 10, 1, 5), num('contrast', 'Contrast', 1, 4, 0.1, 2)],
  step(g, s, i, tick) {
    const { A, box, pal, u, p } = s;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const R = Math.min(box.w, box.h) * 0.49;
    const a = (i / A.n) * TAU - Math.PI / 2;
    const c = Math.cos(a), si = Math.sin(a);
    const r0 = R * p.inner;
    let r = r0;
    g.lineCap = 'butt';
    g.lineWidth = Math.max(u * 0.6, (TAU * R * 0.7) / (A.n / tick)) * s.brush;
    for (let b = 0; b < p.rays; b++) {
      const e = A.bandGroup(i, b, p.rays);
      const len = ((R - r0) * p.reach * 5 * Math.pow(e, p.contrast)) / p.rays;
      g.strokeStyle = pal.at(b / (p.rays - 1));
      g.beginPath();
      g.moveTo(cx + c * r, cy + si * r);
      r += len;
      g.lineTo(cx + c * r, cy + si * r);
      g.stroke();
      r += u * 1.5;
    }
  },
};

const lanes = {
  id: 'lanes', name: 'Lanes', group: 'Sheet', kind: 'sheet', ticks: 2600,
  desc: 'Lanes run top to bottom, like a gel',
  params: [{ id: 'count', label: 'Lanes', min: 3, max: 14, step: 1, def: 7 }, { id: 'edge', label: 'Threshold', min: 0.1, max: 0.8, step: 0.01, def: 0.42 }, num('gap', 'Gap', 0, 0.12, 0.005, 0.035), num('swell', 'Swell', 0.5, 4, 0.05, 1.6)],
  step(g, s, i, tick) {
    const { A, box, pal, p } = s;
    const gap = box.w * p.gap;
    const lw = (box.w - gap * (p.count - 1)) / p.count;
    const y = box.y + (i / A.n) * box.h, dy = (tick / A.n) * box.h + 0.5;
    for (let b = 0; b < p.count; b++) {
      const e = A.bandGroup(i, b, p.count);
      if (e < p.edge) continue;
      const q = (e - p.edge) / (1 - p.edge);
      g.fillStyle = pal.at(b / (p.count - 1));
      g.globalAlpha = 0.3 + 0.7 * q;
      const inset = lw * 0.5 * (1 - Math.min(1, q * p.swell * s.brush));
      g.fillRect(box.x + b * (lw + gap) + inset, y, lw - inset * 2, dy);
    }
    g.globalAlpha = 1;
  },
};

const ripples = {
  id: 'ripples', name: 'Ripples', group: 'Sheet', kind: 'sheet', ticks: 2400,
  desc: 'Every drum hit drops a circle on the axis of time',
  params: [{ id: 'size', label: 'Size', min: 0.3, max: 2.5, step: 0.05, def: 1 }, num('opacity', 'Opacity', 0.3, 2, 0.05, 1), flag('kick', 'Kicks'), flag('snare', 'Snares'), flag('hat', 'Hats')],
  step(g, s, i, tick) {
    const { A, box, pal, u, p } = s;
    const y = box.y + box.h / 2;
    const hits = A.hitsBetween(i / FR, (i + tick) / FR);
    const R = { kick: 150, snare: 90, hat: 26 }, C = { kick: 0.1, snare: 0.6, hat: 0.95 };
    // Keep the largest possible ring on the page, however wide or tall it is.
    const fit = Math.min(1, (box.h / 2) / (u * 210 * p.size));
    const inset = u * 210 * p.size * fit;
    for (const h of hits) {
      if (!p[h.type]) continue;
      const x = box.x + inset + (h.t / A.duration) * (box.w - 2 * inset);
      g.strokeStyle = pal.at(C[h.type]);
      g.globalAlpha = Math.min(1, (0.18 + 0.5 * h.strength) * p.opacity);
      g.lineWidth = u * 1.1 * s.brush;
      g.beginPath();
      g.arc(x, y, u * R[h.type] * p.size * fit * (0.4 + h.strength), 0, TAU);
      g.stroke();
    }
    g.globalAlpha = 1;
  },
};

const thread = {
  id: 'thread', name: 'Thread', group: 'Sheet', kind: 'sheet', ticks: 2200,
  desc: 'Drum hits are pins on the bar; one thread winds through them',
  params: [{ id: 'twist', label: 'Twist', min: 0, max: 1, step: 0.01, def: 0.35 }, num('pins', 'Pins', 0.3, 3, 0.05, 1), num('ink', 'Thread', 0.05, 1, 0.01, 0.34), flag('hats', 'Include hats', 0)],
  step(g, s, i, tick) {
    const { A, box, pal, u, p } = s;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const R = Math.min(box.w, box.h) * 0.48;
    for (const h of A.hitsBetween(i / FR, (i + tick) / FR)) {
      if (h.type === 'hat' && !p.hats) continue;
      const { phase, beat } = A.beatAt(h.t);
      const a = ((beat + phase) / 4) * TAU + (h.t / A.duration) * TAU * p.twist;
      const r = R * (h.type === 'kick' ? 0.92 : 0.45 + 0.4 * A.f.centroid[h.i]) * (0.55 + 0.45 * h.strength);
      const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (s.mem.x !== undefined) {
        g.strokeStyle = pal.fg;
        g.globalAlpha = p.ink;
        g.lineWidth = u * 0.8 * s.brush;
        g.beginPath();
        g.moveTo(s.mem.x, s.mem.y);
        g.quadraticCurveTo(cx + (s.mem.x - cx) * 0.2, cy + (y - cy) * 0.2, x, y);
        g.stroke();
      }
      g.globalAlpha = 1;
      g.fillStyle = h.type === 'kick' ? pal.accent : pal.at(0.2);
      g.beginPath(); g.arc(x, y, u * (1.2 + 2.6 * h.strength) * p.pins, 0, TAU); g.fill();
      s.mem.x = x; s.mem.y = y;
    }
  },
};

const portrait = {
  id: 'portrait', name: 'Portrait', group: 'Sheet', kind: 'sheet', ticks: 1600,
  desc: 'Repaints a picture of yours, loudest where the track is loudest',
  needsImage: true,
  params: [{ id: 'size', label: 'Stroke', min: 0.3, max: 3, step: 0.05, def: 1 }, num('rate', 'Paint rate', 0.3, 3, 0.05, 1), num('opacity', 'Opacity', 0.2, 1, 0.01, 0.85)],
  step(g, s, i, tick) {
    const { A, box, u, p, image, rng } = s;
    if (!image) return;
    const count = 4 + Math.floor((26 * A.f.level[i] + 22 * A.f.kick[i]) * p.rate);
    const iw = image?.w ?? 1, ih = image?.h ?? 1;
    const scale = Math.max(box.w / iw, box.h / ih);
    const px = (X, Y) => {
      const sx = Math.min(iw - 1, Math.max(0, Math.floor((X - box.x - (box.w - iw * scale) / 2) / scale)));
      const sy = Math.min(ih - 1, Math.max(0, Math.floor((Y - box.y - (box.h - ih * scale) / 2) / scale)));
      const o = (sy * iw + sx) * 4, d = image.data;
      return [d[o], d[o + 1], d[o + 2]];
    };
    g.lineCap = 'round';
    for (let k = 0; k < count; k++) {
      // Coarse strokes first, fine ones as the track goes on.
      const size = (u * p.size * s.brush * (46 * Math.pow(1 - i / A.n, 2) + 5)) * (0.6 + rng());
      const x = box.x + hash2(i, k, s.seed) * box.w, y = box.y + hash2(k, i, s.seed + 1) * box.h;
      const [r, gr, b] = px(x, y);
      const a = fbm(x * 0.004, y * 0.004, 3) * TAU * 2;
      g.strokeStyle = `rgb(${r},${gr},${b})`;
      g.globalAlpha = p.opacity;
      g.lineWidth = size * 0.5;
      g.beginPath();
      g.moveTo(x - Math.cos(a) * size, y - Math.sin(a) * size);
      g.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size);
      g.stroke();
    }
    g.globalAlpha = 1;
  },
};

export default [strokes, seismo, ridges, groove, sunburst, lanes, ripples, thread, portrait];
