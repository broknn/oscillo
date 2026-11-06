// Note looks. They use a MIDI file when one is attached and otherwise the notes the
// analysis pulled out of the audio.
import { rgba, num, flag, hash2 } from '../core/style.js';
import { KEY_NAMES } from '../core/analysis.js';

const TAU = Math.PI * 2;

function firstNoteAfter(notes, t) {
  let lo = 0, hi = notes.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].t < t) lo = m + 1; else hi = m; }
  return lo;
}

const roll = {
  id: 'roll', name: 'Roll', group: 'MIDI', kind: 'instant',
  desc: 'Scrolling piano roll; sounding notes light up',
  params: [{ id: 'span', label: 'Seconds shown', min: 2, max: 20, step: 0.5, def: 7 }, num('head', 'Playhead', 0.05, 0.8, 0.01, 0.22), num('note', 'Note height', 0.3, 1, 0.01, 0.8), flag('label', 'Source label'), flag('page', 'Page turns', 0)],
  draw(g, s) {
    const { A, t, box, pal, u, p } = s;
    const notes = A.notes ?? [];
    if (!notes.length) return;
    const lo = (A.noteLo ??= Math.min(...notes.map((n) => n.pitch))), hi = (A.noteHi ??= Math.max(...notes.map((n) => n.pitch)));
    const range = Math.max(12, hi - lo + 1), rh = box.h / range;
    const pps = box.w / p.span;
    // Scrolling keeps the playhead still; page turns keep the notes still and sweep it across.
    const zero = p.page ? box.x - Math.floor(t / p.span) * p.span * pps : box.x + box.w * p.head - t * pps;
    const head = zero + t * pps;
    g.strokeStyle = rgba(pal.dim, 0.18); g.lineWidth = Math.max(1, u * 0.7);
    for (let m = lo; m <= hi; m++) if (m % 12 === 0) {
      const y = box.y + box.h - (m - lo + 1) * rh;
      g.beginPath(); g.moveTo(box.x, y); g.lineTo(box.x + box.w, y); g.stroke();
    }
    const from = (box.x - zero) / pps - 8;
    for (let k = firstNoteAfter(notes, from); k < notes.length; k++) {
      const n = notes[k];
      const x = zero + n.t * pps;
      if (x > box.x + box.w) break;
      const w = Math.max(u * 3, n.dur * pps);
      if (x + w < box.x) continue;
      const on = n.t <= t && t < n.t + n.dur;
      const y = box.y + box.h - (n.pitch - lo + 1) * rh;
      g.fillStyle = on ? pal.accent : pal.at((n.pitch - lo) / range);
      g.globalAlpha = on ? 1 : 0.35 + 0.5 * n.vel;
      const h = Math.max(u * 3, rh * p.note), r = Math.min(h / 2, w / 2);
      g.beginPath();
      g.moveTo(x + r, y);
      g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
      g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
      g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
      g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = pal.fg;
    g.fillRect(head, box.y, Math.max(1, u * 1.5), box.h);
    if (!p.label || !s.labels) return;
    g.fillStyle = pal.dim;
    g.font = `${u * 16}px ${s.mono}`;
    g.fillText(A.hasMidi ? 'MIDI FILE' : 'NOTES HEARD IN AUDIO', box.x + u * 10, box.y + u * 24);
  },
};

const orbit = {
  id: 'orbit', name: 'Orbit', group: 'MIDI', kind: 'instant',
  desc: 'Each pitch class holds an angle, each octave an orbit',
  params: [{ id: 'trail', label: 'Trail', min: 0.2, max: 4, step: 0.1, def: 1.4 }, num('spin', 'Spin', 0, 0.3, 0.005, 0.04), num('size', 'Note size', 0.3, 3, 0.05, 1), flag('links', 'Links'), flag('rings', 'Orbits')],
  draw(g, s) {
    const { A, t, box, pal, u, p, clock } = s;
    const notes = A.notes ?? [];
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.min(box.w, box.h) * 0.48;
    for (let o = 1; o <= 7 && p.rings; o++) {
      g.strokeStyle = rgba(pal.dim, 0.26); g.lineWidth = Math.max(1, u * 0.7);
      g.beginPath(); g.arc(cx, cy, (R * o) / 7, 0, TAU); g.stroke();
    }
    const spin = clock * p.spin;
    const pos = (n) => {
      const octave = Math.max(1, Math.min(7, Math.floor(n.pitch / 12) - 1));
      const a = ((n.pitch % 12) / 12) * TAU - Math.PI / 2 + spin * (octave % 2 ? 1 : -1);
      return [cx + (Math.cos(a) * R * octave) / 7, cy + (Math.sin(a) * R * octave) / 7];
    };
    const start = firstNoteAfter(notes, t - p.trail - 8);
    let prev = null;
    for (let k = start; k < notes.length && notes[k].t <= t; k++) {
      const n = notes[k], age = t - (n.t + n.dur);
      if (age > p.trail) continue;
      const [x, y] = pos(n);
      const on = age < 0, fade = on ? 1 : 1 - age / p.trail;
      if (prev && p.links) {
        g.strokeStyle = rgba(pal.at((n.pitch % 12) / 12), 0.35 * fade);
        g.lineWidth = u * 1.2 * s.brush;
        g.beginPath(); g.moveTo(prev[0], prev[1]); g.lineTo(x, y); g.stroke();
      }
      g.fillStyle = on ? pal.accent : rgba(pal.at((n.pitch % 12) / 12), fade);
      g.beginPath(); g.arc(x, y, u * (on ? 8 + 16 * n.vel : 4 * fade + 2) * s.brush * p.size, 0, TAU); g.fill();
      prev = [x, y];
    }
  },
};

// A trail of notes through space. Where a note sits depends only on when and what it was,
// so any moment can be drawn directly: the camera turns, the past stays where it fell.
const comet = {
  id: 'comet', name: 'Comet', group: 'MIDI', kind: 'instant',
  desc: 'Notes hang in space as a long trail that the camera circles',
  params: [
    { id: 'trail', label: 'Trail', min: 2, max: 24, step: 0.5, def: 10 },
    num('bend', 'Bend', 0.2, 3, 0.05, 1), num('scatter', 'Scatter', 0, 1.5, 0.01, 0.3),
    num('spin', 'Spin', 0, 0.2, 0.002, 0.03), num('zoom', 'Zoom', 0.4, 2.5, 0.01, 1),
    num('size', 'Note size', 0.2, 3, 0.05, 1), num('dust', 'Dust', 0, 8, 1, 3),
    flag('links', 'Links'), flag('tags', 'Note names'), flag('hue', 'Colour by pitch', 0),
  ],
  draw(g, s) {
    const { A, t, box, pal, u, p, clock, seed } = s;
    const notes = A.notes ?? [];
    if (!notes.length) return;
    const lo = (A.noteLo ??= Math.min(...notes.map((n) => n.pitch))), hi = (A.noteHi ??= Math.max(...notes.map((n) => n.pitch)));
    const range = Math.max(12, hi - lo + 1);
    const path = (at) => {
      const a = at * 0.31 * p.bend + seed % 7;
      return [Math.sin(a) + 0.5 * Math.sin(a * 2.3 + 1), Math.sin(a * 0.7 + 2) + 0.4 * Math.cos(a * 1.9), Math.cos(a * 1.2) + 0.5 * Math.sin(a * 0.5)];
    };
    const centre = path(t - p.trail * 0.4);
    const yaw = clock * p.spin + seed % 5, cy = Math.cos(yaw), sy = Math.sin(yaw), cx = Math.cos(0.5), sx = Math.sin(0.5);
    const R = Math.min(box.w, box.h) * 0.42 * p.zoom;
    const project = (x, y, z) => {
      const dx = x - centre[0], dy = y - centre[1], dz = z - centre[2];
      const rx = dx * cy + dz * sy, rz = dz * cy - dx * sy;
      const ry = dy * cx - rz * sx, depth = dy * sx + rz * cx, near = 1 / (1 + depth * 0.25);
      return [box.x + box.w / 2 + rx * near * R, box.y + box.h / 2 + ry * near * R, near];
    };
    const place = (n, k) => {
      const [x, y, z] = path(n.t);
      const a = (n.pitch % 12) / 12 * Math.PI * 2 + k * 2.4, r = p.scatter * (0.15 + 0.85 * hash2(k, 1, seed)) * (0.4 + (n.pitch - lo) / range);
      return project(x + Math.cos(a) * r, y + Math.sin(a) * r, z + (hash2(k, 2, seed) - 0.5) * r);
    };

    const start = firstNoteAfter(notes, t - p.trail);
    const seen = [];
    for (let k = start; k < notes.length && notes[k].t <= t; k++) seen.push({ n: notes[k], k, at: place(notes[k], k) });

    if (p.links) {
      g.lineWidth = Math.max(0.5, u * 0.8 * s.brush);
      seen.forEach((a, i) => {
        const fade = 1 - (t - a.n.t) / p.trail;
        g.strokeStyle = rgba(pal.dim, 0.5 * fade);
        for (const back of [1, 3, 7]) {
          const b = seen[i - back];
          if (!b) continue;
          g.beginPath(); g.moveTo(b.at[0], b.at[1]); g.lineTo(a.at[0], a.at[1]); g.stroke();
        }
      });
    }

    g.font = `${Math.max(7, u * 13)}px ${s.mono}`;
    g.textAlign = 'left';
    for (const { n, k, at } of seen) {
      const age = t - n.t, fade = 1 - age / p.trail, on = t < n.t + n.dur;
      const colour = p.hue ? pal.at((n.pitch - lo) / range) : pal.accent;
      const size = u * (2 + 22 * n.vel * n.vel) * p.size * s.brush * at[2] * (on ? 1.5 : 1);
      g.fillStyle = rgba(colour, 0.1 * fade);
      for (const halo of [3.2, 2]) { g.beginPath(); g.arc(at[0], at[1], size * halo, 0, Math.PI * 2); g.fill(); }
      for (let d = 0; d < p.dust; d++) {
        const a = hash2(k, d + 10, seed) * Math.PI * 2, far = (size + u * 8) * (1 + 3 * hash2(k, d + 30, seed)) * (1 + age * 0.15);
        g.fillStyle = rgba(colour, 0.6 * fade);
        g.fillRect(at[0] + Math.cos(a) * far, at[1] + Math.sin(a) * far, Math.max(1, u * 1.6), Math.max(1, u * 1.6));
      }
      g.fillStyle = rgba(colour, on ? 1 : 0.25 + 0.65 * fade);
      g.beginPath(); g.arc(at[0], at[1], size, 0, Math.PI * 2); g.fill();
      if (p.tags && s.labels && hash2(k, 5, seed) < 0.3) {
        g.fillStyle = rgba(pal.fg, 0.75 * fade);
        const sec = Math.floor(n.t);
        g.fillText(`${KEY_NAMES[n.pitch % 12]}${Math.floor(n.pitch / 12) - 1} ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, at[0] + size + u * 5, at[1] + u * 4);
      }
    }
  },
};

// Upcoming notes come down a lane that recedes to a point, and land on a row of pads.
const notestage = {
  id: 'notestage', name: 'Note Stage', group: 'MIDI', kind: 'instant',
  desc: 'Notes fall down a receding stage onto a row of lit pads',
  params: [
    num('span', 'Seconds ahead', 1, 12, 0.5, 4), num('depth', 'Depth', 1, 10, 0.1, 4), num('width', 'Note width', 0.3, 1.5, 0.02, 0.8),
    num('turn', 'Turn', -1, 1, 0.02, 0), num('horizon', 'Horizon', -0.4, 0.7, 0.01, 0.04), num('roll', 'Roll', -45, 45, 1, 0),
    flag('lanes', 'Lanes'), flag('pads', 'Pads'),
  ],
  draw(g, s) {
    const { A, t, box, pal, u, p } = s;
    const notes = A.notes ?? [];
    if (!notes.length) return;
    const lo = (A.noteLo ??= Math.min(...notes.map((n) => n.pitch))), hi = (A.noteHi ??= Math.max(...notes.map((n) => n.pitch)));
    const range = Math.max(12, hi - lo + 1);
    const padH = p.pads ? box.h * 0.1 : 0, top = box.y + box.h * p.horizon, floor = box.y + box.h - padH - u * 8;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, vx = cx + (box.w / 2) * p.turn;
    g.save();
    g.translate(cx, cy); g.rotate((p.roll * Math.PI) / 180); g.translate(-cx, -cy);
    const near = (d) => 1 / (1 + Math.max(0, d) * p.depth);
    const X = (x, d) => vx + (box.x + box.w * x - vx) * near(d), Y = (d) => top + (floor - top) * near(d);
    if (p.lanes) {
      g.strokeStyle = rgba(pal.dim, 0.3); g.lineWidth = Math.max(0.5, u * 0.7);
      for (let m = lo; m <= hi + 1; m++) if (m % 12 === 0) {
        const x = (m - lo) / range;
        g.beginPath(); g.moveTo(X(x, 0), Y(0)); g.lineTo(X(x, 40), Y(40)); g.stroke();
      }
      const beat = 60 / (A.bpm || 120);
      for (let b = Math.ceil(t / beat); b * beat < t + p.span; b++) {
        const d = (b * beat - t) / p.span;
        g.beginPath(); g.moveTo(X(0, d), Y(d)); g.lineTo(X(1, d), Y(d)); g.stroke();
      }
    }
    const lit = new Array(12).fill(0);
    for (let k = firstNoteAfter(notes, t - 8); k < notes.length && notes[k].t < t + p.span; k++) {
      const n = notes[k], d0 = (n.t - t) / p.span, d1 = (n.t + n.dur - t) / p.span;
      if (n.t <= t) lit[n.pitch % 12] = Math.max(lit[n.pitch % 12], Math.max(0, 1 - (t - (n.t + n.dur)) / 0.3));
      if (d1 < 0) continue;
      const x = (n.pitch - lo + 0.5) / range, half = (0.5 / range) * p.width;
      g.fillStyle = n.t <= t ? pal.accent : pal.at((n.pitch - lo) / range);
      g.globalAlpha = 0.35 + 0.65 * near(d0);
      g.beginPath();
      g.moveTo(X(x - half, d0), Y(d0)); g.lineTo(X(x + half, d0), Y(d0));
      g.lineTo(X(x + half, d1), Y(d1)); g.lineTo(X(x - half, d1), Y(d1));
      g.fill();
    }
    g.globalAlpha = 1;
    if (!p.pads) { g.restore(); return; }
    const pw = box.w / 12, py = box.y + box.h - padH;
    for (let k = 0; k < 12; k++) {
      g.strokeStyle = rgba(pal.dim, 0.6); g.lineWidth = Math.max(0.5, u * 0.8);
      g.strokeRect(box.x + k * pw + u * 2, py, pw - u * 4, padH - u * 2);
      if (lit[k] <= 0) continue;
      g.fillStyle = rgba(pal.at(k / 11), lit[k]);
      g.fillRect(box.x + k * pw + u * 2, py, pw - u * 4, padH - u * 2);
    }
    g.restore();
  },
};

export default [roll, orbit, comet, notestage];
