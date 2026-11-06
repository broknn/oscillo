// Panels: small instruments that read well side by side on a page of parts.
import { rgba, mixHex, hash2, num, flag } from '../core/style.js';
import { FR } from '../core/analysis.js';
import { barAt } from '../core/chop.js';

const TAU = Math.PI * 2, UP = -Math.PI / 2;

function arc(g, cx, cy, r, from, to, colour, width) {
  g.strokeStyle = colour; g.lineWidth = width;
  g.beginPath(); g.arc(cx, cy, r, from, to); g.stroke();
}

const clock = {
  id: 'clock', name: 'Beat Clock', group: 'Panels', kind: 'instant', offline: true,
  desc: 'Bar count inside rings that fill and tick with the beat',
  params: [
    num('cycle', 'Bars per turn', 1, 16, 1, 4), num('rings', 'Rings', 1, 4, 1, 3), num('ticks', 'Ticks', 12, 96, 4, 48),
    num('pulse', 'Pulse', 0, 2, 0.05, 1), flag('hand', 'Hand'), flag('digits', 'Bar number'),
  ],
  draw(g, s) {
    const { A, t, i, box, pal, u, p } = s;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.min(box.w, box.h) * 0.46;
    const bar = barAt(A, t), pos = Math.max(0, Math.min(0.999, (t - bar.start) / bar.len));
    const turn = (((bar.index % p.cycle) + p.cycle) % p.cycle + pos) / p.cycle;
    const beat = Math.floor(pos * 4), kick = A.f.kick[i], line = Math.max(1, u * 1.2);

    for (let k = 0; k < p.ticks; k++) {
      const a = UP + (k / p.ticks) * TAU, lit = k / p.ticks <= turn, long = k % (p.ticks / 4) === 0 ? 0.92 : 0.95;
      g.strokeStyle = lit ? pal.accent : rgba(pal.dim, 0.6); g.lineWidth = line;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * R * long, cy + Math.sin(a) * R * long);
      g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); g.stroke();
    }
    const r0 = R * 0.84, thick = u * (6 + 14 * kick * p.pulse);
    arc(g, cx, cy, r0, 0, TAU, rgba(pal.dim, 0.3), line);
    arc(g, cx, cy, r0, UP, UP + turn * TAU, pal.accent, thick);
    if (p.rings > 1) {
      const r = R * 0.72;
      arc(g, cx, cy, r, 0, TAU, rgba(pal.dim, 0.3), line);
      arc(g, cx, cy, r, UP, UP + pos * TAU, pal.at(0.35), u * 5);
    }
    if (p.rings > 2) for (let k = 0; k < 4; k++) {
      const from = UP + (k / 4) * TAU + 0.06;
      arc(g, cx, cy, R * 0.62, from, from + TAU / 4 - 0.12, k === beat ? pal.fg : rgba(pal.dim, 0.35), u * 5);
    }
    if (p.rings > 3) arc(g, cx, cy, R * 0.53, UP, UP + A.f.level[i] * TAU, pal.at(0.7), u * 4);
    if (p.hand) {
      const a = UP + turn * TAU;
      g.strokeStyle = pal.fg; g.lineWidth = line;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.4, cy + Math.sin(a) * R * 0.4);
      g.lineTo(cx + Math.cos(a) * R * 1.04, cy + Math.sin(a) * R * 1.04); g.stroke();
    }
    if (!p.digits) return;
    const size = R * 0.3;
    g.fillStyle = pal.fg; g.font = `600 ${size}px ${s.mono}`; g.textAlign = 'center';
    g.fillText(String(Math.max(1, bar.index + 1)), cx, cy + size * 0.35);
    g.textAlign = 'left';
  },
};

const dots = {
  id: 'dots', name: 'Dot Matrix', group: 'Panels', kind: 'instant', offline: true,
  desc: 'Twelve rows of circles, one per pitch, stepping with the beat',
  params: [
    num('cols', 'Columns', 8, 64, 1, 32), num('size', 'Dot size', 0.3, 1.2, 0.02, 0.85), num('contrast', 'Contrast', 1, 4, 0.1, 2),
    flag('sweep', 'Page turns', 0), flag('empty', 'Empty dots'),
  ],
  draw(g, s) {
    const { A, i, box, pal, u, p } = s;
    const step = Math.max(1, Math.round((FR * 15) / (A.bpm || 120)));
    const cell = Math.min(box.w / p.cols, box.h / 12);
    const x0 = box.x + (box.w - cell * p.cols) / 2, y0 = box.y + (box.h - cell * 12) / 2;
    const page = Math.floor(i / (p.cols * step)) * p.cols * step;
    for (let c = 0; c < p.cols; c++) {
      const f = p.sweep ? page + c * step : i - (p.cols - 1 - c) * step;
      const live = f >= 0 && f <= i, chroma = live ? A.chromaAt(f) : null;
      const top = chroma ? Math.max(0.001, ...chroma) : 1, level = live ? Math.min(1, A.f.level[f] * 2) : 0;
      for (let r = 0; r < 12; r++) {
        const x = x0 + (c + 0.5) * cell, y = y0 + (11.5 - r) * cell;
        const e = chroma ? Math.pow(chroma[r] / top, p.contrast) * level : 0, size = (cell / 2) * p.size * e;
        if (p.empty) {
          g.strokeStyle = rgba(pal.dim, 0.35); g.lineWidth = Math.max(0.5, u * 0.7);
          g.beginPath(); g.arc(x, y, cell * 0.2, 0, TAU); g.stroke();
        }
        if (size < 0.4) continue;
        g.fillStyle = pal.at(r / 11);
        g.beginPath(); g.arc(x, y, size, 0, TAU); g.fill();
      }
    }
  },
};

const glowgrid = {
  id: 'glowgrid', name: 'Glow Grid', group: 'Panels', kind: 'instant', svg: false,
  desc: 'Soft dots on a grid that swell with the frequencies under them',
  params: [
    num('cols', 'Columns', 4, 32, 1, 14), num('rows', 'Rows', 2, 16, 1, 6), num('size', 'Size', 0.4, 2.5, 0.02, 1),
    num('glow', 'Glow', 0.2, 1, 0.02, 0.6), num('contrast', 'Contrast', 1, 4, 0.1, 1.6), flag('core', 'Centre dots'),
  ],
  draw(g, s) {
    const { A, i, box, pal, u, p } = s;
    const cw = box.w / p.cols, ch = box.h / p.rows, kick = A.f.kick[i];
    for (let c = 0; c < p.cols; c++) {
      const e = Math.pow(A.bandGroup(i, c, p.cols), p.contrast), colour = pal.at(c / (p.cols - 1));
      for (let r = 0; r < p.rows; r++) {
        const off = Math.abs(r - (p.rows - 1) / 2) / (p.rows / 2);
        const v = Math.min(1, e * (0.4 + 0.9 * (1 - off) + kick * 0.3));
        const x = box.x + (c + 0.5) * cw, y = box.y + (r + 0.5) * ch, R = Math.min(cw, ch) * (0.35 + 1.4 * v) * p.size;
        const fog = g.createRadialGradient(x, y, 0, x, y, R);
        fog.addColorStop(0, rgba(colour, v * p.glow));
        fog.addColorStop(1, rgba(colour, 0));
        g.fillStyle = fog;
        g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
        if (!p.core) continue;
        g.fillStyle = rgba(colour, 0.3 + 0.7 * v);
        g.beginPath(); g.arc(x, y, Math.max(1, u * (1.5 + 4 * v)), 0, TAU); g.fill();
      }
    }
  },
};

const tape = {
  id: 'tape', name: 'Tape Strip', group: 'Panels', kind: 'instant', offline: true,
  desc: 'The track as a shaded waveform band with a moving playhead',
  params: [
    num('cols', 'Columns', 40, 800, 10, 320), num('gain', 'Gain', 0.5, 3, 0.05, 1.2), num('zoom', 'Zoom in', 1, 40, 0.5, 1),
    flag('mirror', 'Both sides'), flag('shade', 'Shading'), flag('marks', 'Section marks'),
  ],
  draw(g, s) {
    const { A, t, box, pal, u, p } = s;
    const o = A.overview;
    if (!o) return;
    const size = o.length / 2, at = t / A.duration, span = 1 / p.zoom;
    const from = Math.max(0, Math.min(1 - span, at - span / 2));
    const base = p.mirror ? box.y + box.h / 2 : box.y + box.h, reach = p.mirror ? box.h / 2 : box.h;
    const bw = box.w / p.cols, head = box.x + ((at - from) / span) * box.w;
    for (let k = 0; k < p.cols; k++) {
      const a = from + (k / p.cols) * span, b = from + ((k + 1) / p.cols) * span;
      let lo = 0, hi = 0;
      for (let c = Math.floor(a * size), end = Math.max(c + 1, Math.floor(b * size)); c < end && c < size; c++) {
        lo = Math.min(lo, o[c * 2]); hi = Math.max(hi, o[c * 2 + 1]);
      }
      const played = a <= at, x = box.x + k * bw, near = 1 - Math.min(1, Math.abs(a - at) / span);
      g.fillStyle = played ? pal.fg : pal.dim;
      g.globalAlpha = p.shade ? 0.2 + 0.8 * near * near : 0.8;
      const up = Math.min(1, hi * p.gain) * reach, down = Math.min(1, -lo * p.gain) * reach;
      if (p.mirror) g.fillRect(x, base - up, Math.max(1, bw * 0.8), up + down);
      else g.fillRect(x, base - Math.max(up, down), Math.max(1, bw * 0.8), Math.max(up, down));
    }
    g.globalAlpha = 1;
    if (p.marks) {
      g.fillStyle = rgba(pal.dim, 0.8);
      for (const m of A.sections ?? []) {
        const x = box.x + ((m / A.duration - from) / span) * box.w;
        if (x >= box.x && x <= box.x + box.w) g.fillRect(x, box.y, Math.max(1, u), box.h * 0.12);
      }
    }
    g.fillStyle = pal.accent;
    g.fillRect(head, box.y, Math.max(1, u * 2), box.h);
  },
};

const db = (v) => (v < -60 || !Number.isFinite(v) ? '-inf' : v.toFixed(1));

const levels = {
  id: 'levels', name: 'Level Numbers', group: 'Panels', kind: 'instant', offline: true,
  desc: 'Momentary, short-term and full-track loudness as clean figures',
  params: [
    num('size', 'Number size', 0.5, 1.6, 0.02, 1), flag('mom', 'Momentary'), flag('short', 'Short term'), flag('track', 'Whole track'),
    flag('peak', 'Peak'), flag('bars', 'Bars'),
  ],
  draw(g, s) {
    const { A, i, box, pal, u, p } = s;
    const rows = [
      p.mom && ['MOMENTARY', A.f.loudM[i]], p.short && ['SHORT', A.f.loudS[i]], p.track && ['TRACK', A.lufs],
      p.peak && ['PEAK', 20 * Math.log10(Math.max(1e-6, A.f.peak[i]))],
    ].filter(Boolean);
    if (!rows.length) return;
    const cw = box.w / rows.length, size = Math.min(cw * 0.27, box.h * 0.42) * p.size;
    const small = Math.max(7, size * 0.24), y = box.y + box.h / 2 + size * 0.3;
    rows.forEach(([name, value], k) => {
      const x = box.x + k * cw + cw * 0.06;
      g.fillStyle = pal.fg; g.font = `600 ${size}px ${s.mono}`;
      g.fillText(db(value), x, y);
      if (s.labels) {
        g.fillStyle = pal.dim; g.font = `${small}px ${s.mono}`;
        g.fillText(name, x, y - size - small * 0.4);
      }
      if (!p.bars) return;
      const w = cw * 0.84, level = Math.max(0, Math.min(1, ((Number.isFinite(value) ? value : -60) + 60) / 60));
      g.fillStyle = rgba(pal.dim, 0.3); g.fillRect(x, y + size * 0.3, w, Math.max(1, u * 3));
      g.fillStyle = pal.accent; g.fillRect(x, y + size * 0.3, w * level, Math.max(1, u * 3));
    });
  },
};

const luma = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.3 * (n >> 16) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255)) / 255;
};

const synth = {
  id: 'synth', name: 'Synth Panel', group: 'Panels', kind: 'instant', offline: true,
  desc: 'A drawn hardware unit: its screen and knobs play along',
  params: [
    num('knobs', 'Knobs', 3, 9, 1, 6), num('tone', 'Body shade', 0, 1, 0.02, 0.85), num('swing', 'Knob travel', 0.2, 1, 0.02, 0.8),
    flag('screen', 'Screen'), flag('keys', 'Step keys'),
  ],
  draw(g, s) {
    const { A, t, i, box, pal, u, p, clock: time, seed } = s;
    const w = Math.min(box.w * 0.96, box.h * 0.96 * 1.75), h = w / 1.75;
    const x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2, unit = w / 100;
    const body = mixHex(pal.bg, pal.fg, p.tone), ink = luma(body) > 0.5 ? '#15161a' : '#ecebe4';
    g.fillStyle = body; g.fillRect(x, y, w, h);
    g.strokeStyle = rgba(ink, 0.5); g.lineWidth = Math.max(1, u);
    g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    const sx = x + unit * 4, sy = y + unit * 4, sw = unit * 62, sh = unit * 26;
    if (p.screen) {
      g.fillStyle = '#0b0c10'; g.fillRect(sx, sy, sw, sh);
      const bw = sw / 32;
      for (let k = 0; k < 32; k++) {
        const e = A.bandGroup(i, k, 32), bh = e * e * sh * 0.8;
        g.fillStyle = pal.at(k / 31);
        g.fillRect(sx + k * bw, sy + sh - bh, bw * 0.7, bh);
      }
      for (let k = 0; k < 3; k++) {
        const e = A.bandGroup(i, k, 3);
        const ox = sx + sw * (0.2 + 0.6 * hash2(k, Math.floor(time * 0.2), seed)), oy = sy + sh * 0.4;
        const R = unit * (2 + 9 * e), fog = g.createRadialGradient(ox, oy, 0, ox, oy, R);
        fog.addColorStop(0, rgba(pal.at(k / 2), 0.9));
        fog.addColorStop(1, rgba(pal.at(k / 2), 0));
        g.fillStyle = fog; g.fillRect(ox - R, oy - R, R * 2, R * 2);
      }
    }
    if (p.keys) {
      const step = Math.floor(((t * (A.bpm || 120)) / 60) * 2) % 16;
      for (let k = 0; k < 16; k++) {
        const kx = x + unit * (70 + (k % 4) * 6.8), ky = y + unit * (5 + Math.floor(k / 4) * 6);
        g.fillStyle = k === step ? pal.accent : rgba(ink, 0.2);
        g.fillRect(kx, ky, unit * 5.4, unit * 4.4);
      }
    }
    const rowY = y + h - unit * 12;
    g.strokeStyle = rgba(ink, 0.4); g.lineWidth = Math.max(1, u);
    g.beginPath(); g.moveTo(x + unit * 4, rowY - unit * 8.5); g.lineTo(x + w - unit * 4, rowY - unit * 8.5); g.stroke();
    for (let k = 0; k < p.knobs; k++) {
      const big = k === Math.floor(p.knobs / 2), R = unit * (big ? 5.2 : 3.4);
      const kx = x + w * ((k + 0.5) / p.knobs), e = big ? A.f.level[i] : A.bandGroup(i, k, p.knobs);
      const a = UP + (e * 2 - 1) * 2.4 * p.swing;
      g.fillStyle = ink;
      g.beginPath(); g.arc(kx, rowY, R, 0, TAU); g.fill();
      g.strokeStyle = body; g.lineWidth = Math.max(1, unit * 0.5);
      g.beginPath(); g.moveTo(kx + Math.cos(a) * R * 0.3, rowY + Math.sin(a) * R * 0.3);
      g.lineTo(kx + Math.cos(a) * R * 0.92, rowY + Math.sin(a) * R * 0.92); g.stroke();
    }
  },
};

export default [clock, dots, glowgrid, tape, levels, synth];
