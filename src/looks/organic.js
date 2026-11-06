// Organic and graphic looks: drawn things rather than instruments.
import { rgba, noise2, hash2, makeRng, num, flag } from '../core/style.js';
import { FR, NB } from '../core/analysis.js';

const TAU = Math.PI * 2;

const bloom = {
  id: 'bloom', name: 'Bloom', group: 'Organic', kind: 'instant',
  desc: 'Airbrushed clouds: bass low, mids in the middle, sparks above',
  params: [num('clouds', 'Clouds', 0.4, 3, 0.05, 1), num('size', 'Size', 0.4, 2.5, 0.05, 1), num('drift', 'Spread', 0.2, 2, 0.05, 0.9), num('glow', 'Glow', 0.3, 2, 0.05, 1), flag('threads', 'Stereo threads')],
  draw(g, s) {
    const { A, i, box, pal, u, p, clock, seed } = s;
    const cx = box.x + box.w / 2;
    const groups = [
      { y: 0.72, b: A.bandGroup(i, 0, 5), c: 0.0, n: 5 },
      { y: 0.5, b: A.bandGroup(i, 2, 5), c: 0.45, n: 7 },
      { y: 0.28, b: A.bandGroup(i, 4, 5), c: 0.85, n: 9 },
    ];
    const kick = A.f.kick[i];
    for (const G of groups) {
      for (let k = 0; k < Math.round(G.n * p.clouds); k++) {
        const a = hash2(k, Math.round(G.c * 10), seed);
        const x = cx + (noise2(a * 40, clock * 0.14, 3) - 0.5) * box.w * p.drift;
        const y = box.y + box.h * (G.y + (noise2(a * 40 + 7, clock * 0.11, 5) - 0.5) * 0.35);
        const r = Math.min(box.w, box.h) * (0.1 + 0.28 * G.b * G.b + (G.c === 0 ? 0.1 * kick : 0)) * p.size;
        const col = pal.at(G.c + a * 0.14);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, rgba(col, Math.min(1, 0.55 * G.b * p.glow)));
        grad.addColorStop(0.5, rgba(col, Math.min(1, 0.2 * G.b * p.glow)));
        grad.addColorStop(1, rgba(col, 0));
        g.fillStyle = grad;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    // Left and right as two fine threads down the sheet.
    if (!p.threads) return;
    const { l, r } = A.wave(s.t, 1200);
    [[l, 0.26], [r, 0.74]].forEach(([d, xq]) => {
      g.strokeStyle = rgba(pal.fg, 0.8); g.lineWidth = u * 1.1;
      g.beginPath();
      for (let k = 0; k < d.length; k += 8) {
        const y = box.y + (k / d.length) * box.h, x = box.x + box.w * xq + d[k] * box.w * 0.12;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    });
  },
};

const roots = {
  id: 'roots', name: 'Roots', group: 'Organic', kind: 'instant',
  desc: 'A branching figure that grows for the length of the track',
  params: [{ id: 'depth', label: 'Depth', min: 4, max: 9, step: 1, def: 8 }, num('spread', 'Spread', 0.3, 2.5, 0.05, 1), num('length', 'Branch length', 0.6, 0.9, 0.01, 0.76), num('sway', 'Sway', 0, 1.2, 0.01, 0.3), flag('tips', 'Growing tips', 0)],
  draw(g, s) {
    const { A, i, box, pal, u, p, seed, prog, clock } = s;
    const grown = Number.isFinite(A.duration) ? 0.2 + 0.8 * prog : 0.2 + ((clock * 0.02) % 0.8);
    const rng = makeRng(seed);
    const lv = A.f.level[i], kick = A.f.kick[i];
    const unit = box.h * 0.26;
    g.lineCap = 'round';
    const branch = (x, y, a, len, d, start) => {
      const span = 1 / p.depth;
      const q = (grown - start) / span;
      const spread = (0.26 + rng() * 0.3) * p.spread;
      const left = d < 3 || rng() > 0.1, right = d < 3 || rng() > 0.1, jig = rng() - 0.5;
      if (q <= 0) return;
      const f = Math.min(1, q);
      const sway = (noise2(d * 3.3 + a, clock * 0.2, 4) - 0.5) * p.sway * (1 + lv);
      const ang = a + sway;
      const nx = x + Math.cos(ang) * len * f, ny = y + Math.sin(ang) * len * f;
      g.strokeStyle = pal.at(1 - d / p.depth);
      g.lineWidth = u * ((p.depth - d) * 2.6 + 0.8 + 4 * kick * (d / p.depth)) * s.brush;
      g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      if (d + 1 >= p.depth || q < 1) {
        if (p.tips) {
          g.fillStyle = pal.accent;
          g.beginPath(); g.arc(nx, ny, u * (2 + 8 * A.bandGroup(i, d % 6, 6)), 0, TAU); g.fill();
        }
        return;
      }
      if (left) branch(nx, ny, ang - spread + jig * 0.3, len * p.length, d + 1, start + span);
      if (right) branch(nx, ny, ang + spread + jig * 0.3, len * p.length, d + 1, start + span);
    };
    branch(box.x + box.w / 2, box.y + box.h, -Math.PI / 2, unit, 0, 0);
  },
};

const beads = {
  id: 'beads', name: 'Beads', group: 'Organic', kind: 'instant',
  desc: 'Strings of beads; each string is a band over the last moments',
  params: [{ id: 'strings', label: 'Strings', min: 6, max: 24, step: 1, def: 14 }, num('cols', 'Beads', 10, 80, 1, 40), num('history', 'History', 1, 12, 1, 3), num('size', 'Size', 0.3, 2, 0.05, 1), flag('line', 'String lines')],
  draw(g, s) {
    const { A, i, box, pal, u, p } = s;
    const cols = p.cols, cw = box.w / cols, rh = box.h / p.strings;
    for (let r = 0; r < p.strings; r++) {
      const y = box.y + rh * (r + 0.5);
      if (p.line) {
        g.strokeStyle = rgba(pal.dim, 0.35);
        g.lineWidth = Math.max(1, u * 0.7);
        g.beginPath(); g.moveTo(box.x, y); g.lineTo(box.x + box.w, y); g.stroke();
      }
      g.fillStyle = pal.at(1 - r / (p.strings - 1));
      for (let c = 0; c < cols; c++) {
        const f = i - (cols - 1 - c) * p.history;
        if (f < 0) continue;
        const e = A.bandGroup(f, p.strings - 1 - r, p.strings);
        const rad = Math.min(cw * 0.5, rh * 0.5) * e * e * s.brush * p.size;
        if (rad < u * 0.5) continue;
        g.beginPath(); g.arc(box.x + cw * (c + 0.5), y, rad, 0, TAU); g.fill();
      }
    }
  },
};

const swiss = {
  id: 'swiss', name: 'Swiss', group: 'Organic', kind: 'instant',
  desc: 'A hard poster grid that recuts itself on every kick',
  params: [{ id: 'cols', label: 'Columns', min: 3, max: 10, step: 1, def: 5 }, num('recut', 'Kicks per cut', 1, 16, 1, 2), num('pulse', 'Kick pulse', 0, 0.5, 0.01, 0.2), num('accent', 'Accent', 0, 1, 0.01, 0.28)],
  draw(g, s) {
    const { A, t, box, pal, p, seed, i } = s;
    const cols = p.cols, cw = box.w / cols, rows = Math.max(2, Math.round(box.h / cw)), ch = box.h / rows;
    const count = A.hitsBetween(0, t, 'kick').length, snares = A.hitsBetween(0, t, 'snare').length;
    const kick = A.f.kick[i], snare = A.f.snare[i];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const r = hash2(x, y, seed + Math.floor(count / p.recut)), c = hash2(x, y, seed + 5 + snares);
      const kind = Math.floor(r * 5);
      const X = box.x + x * cw, Y = box.y + y * ch;
      g.fillStyle = c > 1 - p.accent ? pal.accent : pal.at(c * 1.2);
      if (kind === 0) g.fillRect(X, Y, cw, ch);
      else if (kind === 1) { g.beginPath(); g.arc(X + cw / 2, Y + ch / 2, Math.min(cw, ch) * (0.3 + p.pulse * kick), 0, TAU); g.fill(); }
      else if (kind === 2) { const q = Math.floor(c * 4) * (Math.PI / 2); g.beginPath(); g.moveTo(X + cw / 2, Y + ch / 2); g.arc(X + cw / 2, Y + ch / 2, Math.min(cw, ch) * 0.5, q, q + Math.PI); g.closePath(); g.fill(); }
      else if (kind === 3) { const m = 6; for (let k = 0; k < m; k++) g.fillRect(X, Y + (ch * k) / m, cw, (ch / m) * (0.25 + 0.5 * snare)); }
    }
  },
};

const rorschach = {
  id: 'rorschach', name: 'Rorschach', group: 'Organic', kind: 'instant',
  desc: 'A mirrored ink blot that breathes with the bass',
  params: [{ id: 'detail', label: 'Detail', min: 1, max: 6, step: 0.1, def: 2.6 }, num('size', 'Size', 0.4, 1.4, 0.01, 1), num('stretch', 'Stretch', 0.6, 2, 0.01, 1.2), num('react', 'Bass reaction', 0, 2, 0.01, 0.75), num('drift', 'Drift', 0, 0.6, 0.01, 0.17)],
  draw(g, s) {
    const { A, i, box, pal, p, clock, seed } = s;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.min(box.w, box.h) * 0.46 * p.size;
    const layers = [{ q: 1, c: 0.15, b: 0 }, { q: 0.68, c: 0.55, b: 2 }, { q: 0.36, c: 0.9, b: 4 }];
    for (const L of layers) {
      const e = A.bandGroup(i, L.b, 5);
      g.fillStyle = pal.at(L.c);
      g.beginPath();
      const seg = 160;
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI - Math.PI / 2;
        const n = noise2(Math.cos(a) * p.detail + 5, Math.sin(a) * p.detail + clock * p.drift + L.c * 9, seed % 61);
        const r = R * L.q * (0.32 + 0.72 * n * (0.55 + p.react * e));
        const x = Math.cos(a) * r, y = Math.sin(a) * r * p.stretch;
        k ? g.lineTo(cx + x, cy + y) : g.moveTo(cx + x, cy + y);
      }
      for (let k = seg; k >= 0; k--) {
        const a = (k / seg) * Math.PI - Math.PI / 2;
        const n = noise2(Math.cos(a) * p.detail + 5, Math.sin(a) * p.detail + clock * p.drift + L.c * 9, seed % 61);
        const r = R * L.q * (0.32 + 0.72 * n * (0.55 + p.react * e));
        g.lineTo(cx - Math.cos(a) * r, cy + Math.sin(a) * r * p.stretch);
      }
      g.closePath(); g.fill();
    }
  },
};

const contours = {
  id: 'contours', name: 'Contours', group: 'Organic', kind: 'instant',
  desc: 'A topographic map whose hills rise with the track',
  params: [{ id: 'levels', label: 'Levels', min: 4, max: 18, step: 1, def: 10 }, { id: 'scale', label: 'Scale', min: 1, max: 7, step: 0.1, def: 3 }, num('lift', 'Lift', 0, 1.2, 0.01, 0.35), num('bold', 'Bold every', 2, 8, 1, 4), num('drift', 'Drift', 0, 4, 0.05, 1)],
  draw(g, s) {
    const { A, i, box, pal, u, p, clock, seed } = s;
    const nx = 96, ny = Math.round((nx * box.h) / box.w), cw = box.w / nx, ch = box.h / ny;
    const lift = 0.15 + 0.55 * A.f.level[i];
    const field = new Float32Array((nx + 1) * (ny + 1));
    for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
      const v = noise2((x / nx) * p.scale, (y / ny) * p.scale * (ny / nx) + clock * 0.03 * p.drift, seed % 53);
      field[y * (nx + 1) + x] = v + p.lift * noise2((x / nx) * p.scale * 2.3, (y / ny) * p.scale * 2.3 - clock * 0.05 * p.drift, seed % 59) * lift;
    }
    g.lineCap = 'round';
    for (let l = 0; l < p.levels; l++) {
      const iso = 0.18 + (l / p.levels) * 0.95;
      g.strokeStyle = pal.at(l / (p.levels - 1));
      g.lineWidth = u * (l % p.bold === 0 ? 3.2 : 1.7) * s.brush;
      g.beginPath();
      for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const o = y * (nx + 1) + x;
        const a = field[o], b = field[o + 1], c = field[o + nx + 2], d = field[o + nx + 1];
        const X = box.x + x * cw, Y = box.y + y * ch, pts = [];
        const cross = (v0, v1, f) => { if ((v0 < iso) !== (v1 < iso)) pts.push(f((iso - v0) / (v1 - v0))); };
        cross(a, b, (q) => [X + q * cw, Y]);
        cross(b, c, (q) => [X + cw, Y + q * ch]);
        cross(d, c, (q) => [X + q * cw, Y + ch]);
        cross(a, d, (q) => [X, Y + q * ch]);
        for (let k = 0; k + 1 < pts.length; k += 2) { g.moveTo(...pts[k]); g.lineTo(...pts[k + 1]); }
      }
      g.stroke();
    }
  },
};

const pillars = {
  id: 'pillars', name: 'Pillars', group: 'Organic', kind: 'instant',
  desc: 'Rounded columns stacked from recent history',
  params: [{ id: 'columns', label: 'Columns', min: 6, max: 32, step: 1, def: 16 }, num('gap', 'Gap', 0, 24, 0.5, 8), num('stack', 'Stack', 1, 8, 1, 5), num('height', 'Height', 0.08, 0.5, 0.01, 0.23), num('lag', 'Lag', 0.03, 0.4, 0.01, 0.11)],
  draw(g, s) {
    const { A, i, box, pal, u, p } = s;
    const gap = u * p.gap, w = (box.w - gap * (p.columns - 1)) / p.columns;
    for (let c = 0; c < p.columns; c++) {
      const x = box.x + c * (w + gap), bandIndex = Math.abs(c - (p.columns - 1) / 2) / (p.columns / 2);
      const b = Math.min(NB - 1, Math.floor(bandIndex * NB));
      let y = box.y + box.h;
      for (let lag = 0; lag < p.stack; lag++) {
        const f = i - Math.round(lag * FR * p.lag);
        if (f < 0) break;
        const e = A.f.bands[f * NB + b];
        const h = box.h * p.height * e * e * e;
        if (h < u) continue;
        g.fillStyle = pal.at(lag / Math.max(1, p.stack - 1));
        y -= h;
        g.beginPath();
        g.moveTo(x, y + h); g.lineTo(x, y + w / 2);
        g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
        g.lineTo(x + w, y + h); g.closePath(); g.fill();
        y -= u * 5;
      }
    }
  },
};

export default [bloom, roots, beads, swiss, rorschach, contours, pillars];
