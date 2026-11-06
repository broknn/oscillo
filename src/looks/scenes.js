// Scenes move with the music. Nothing is simulated: every position is computed from
// s.clock, the music-driven time, so any frame can be reached directly.
import { rgba, noise2, fbm, hash2, num } from '../core/style.js';
import { FR, NB } from '../core/analysis.js';

const TAU = Math.PI * 2;
const fract = (x) => x - Math.floor(x);

const web = {
  id: 'web', name: 'Web', group: 'Scenes', kind: 'instant',
  desc: 'Drifting nodes join up when the track pushes',
  params: [{ id: 'nodes', label: 'Nodes', min: 30, max: 220, step: 5, def: 110 }, { id: 'reach', label: 'Reach', min: 0.05, max: 0.3, step: 0.005, def: 0.14 }, num('dots', 'Dot size', 0, 3, 0.05, 1), num('wander', 'Wander', 0.02, 0.5, 0.01, 0.11), num('line', 'Line', 0.2, 4, 0.05, 1.6)],
  draw(g, s) {
    const { A, i, box, pal, u, p, clock, seed } = s;
    const kick = A.f.kick[i], hat = A.f.hat[i], lv = A.f.level[i];
    const N = Math.round(p.nodes * s.density), R = Math.max(box.w, box.h) * p.reach * (1 + 0.6 * lv);
    const pts = [];
    for (let k = 0; k < N; k++) {
      const a = hash2(k, 1, seed), b = hash2(k, 2, seed);
      const nx = noise2(a * 30, clock * p.wander, seed % 97), ny = noise2(b * 30, clock * p.wander + 9, seed % 89);
      pts.push([box.x + box.w * (nx * 2.2 - 0.6), box.y + box.h * (ny * 2.2 - 0.6), hash2(k, 3, seed)]);
    }
    g.lineWidth = u * p.line * s.brush;
    for (let a = 0; a < N; a++) for (let b = a + 1; b < N; b++) {
      const d = Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]);
      if (d > R) continue;
      g.strokeStyle = rgba(pal.at(pts[a][2]), Math.min(1, (1 - d / R) * (0.7 + 0.8 * lv)));
      g.beginPath(); g.moveTo(pts[a][0], pts[a][1]); g.lineTo(pts[b][0], pts[b][1]); g.stroke();
    }
    for (const [x, y, c] of pts) {
      g.fillStyle = c > 0.82 ? pal.accent : pal.fg;
      g.beginPath();
      g.arc(x, y, u * (3 + (c > 0.82 ? 14 * kick : 4 * hat)) * s.brush * p.dots, 0, TAU);
      g.fill();
    }
  },
};

const warp = {
  id: 'warp', name: 'Warp', group: 'Scenes', kind: 'instant',
  desc: 'A starfield that lurches on the kick',
  params: [{ id: 'stars', label: 'Stars', min: 200, max: 2000, step: 50, def: 800 }, num('speed', 'Speed', 0.05, 0.8, 0.01, 0.22), num('tail', 'Tail', 0.2, 0.98, 0.01, 0.82), num('lurch', 'Kick lurch', 0, 0.8, 0.01, 0.5), num('colour', 'Colour', 0, 1, 0.01, 0.2)],
  draw(g, s) {
    const { A, i, box, pal, u, p, clock, seed } = s;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.hypot(box.w, box.h) * 0.56;
    const kick = A.f.kick[i], N = Math.round(p.stars * s.density);
    g.lineCap = 'round';
    for (let k = 0; k < N; k++) {
      const a = hash2(k, 1, seed) * TAU, off = hash2(k, 2, seed);
      const z = fract(off + clock * p.speed), q = z * z * z;
      const tail = q * (p.tail - p.lurch * kick);
      const r0 = R * (0.015 + q), r1 = R * (0.015 + tail);
      g.strokeStyle = rgba(hash2(k, 3, seed) > 1 - p.colour ? pal.at(hash2(k, 4, seed)) : pal.fg, Math.min(1, z * 1.6));
      g.lineWidth = u * (0.6 + 3.4 * z) * s.brush;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
  },
};

const currents = {
  id: 'currents', name: 'Currents', group: 'Scenes', kind: 'instant',
  desc: 'Short-lived traces riding a flow field',
  params: [{ id: 'traces', label: 'Traces', min: 100, max: 900, step: 20, def: 420 }, { id: 'scale', label: 'Scale', min: 0.5, max: 4, step: 0.1, def: 1.6 }, num('length', 'Length', 6, 60, 1, 20), num('speed', 'Speed', 0.03, 0.5, 0.01, 0.14), num('curl', 'Curl', 1, 8, 0.1, 3)],
  draw(g, s) {
    const { A, i, box, pal, u, p, clock, seed } = s;
    const N = Math.round(p.traces * s.density), lv = A.f.level[i];
    const sc = p.scale / box.w, sp = u * (5 + 12 * lv);
    g.lineCap = 'round';
    for (let k = 0; k < N; k++) {
      const life = fract(hash2(k, 5, seed) + clock * p.speed);
      const gen = Math.floor(hash2(k, 5, seed) + clock * p.speed);
      let x = box.x + hash2(k, gen, seed) * box.w, y = box.y + hash2(gen, k, seed + 1) * box.h;
      const steps = 4 + Math.floor(life * p.length);
      g.strokeStyle = pal.at(y > box.y ? (y - box.y) / box.h : 0);
      g.globalAlpha = Math.sin(life * Math.PI) * 0.85;
      g.lineWidth = u * (1 + 2.5 * A.f.bassAmp[i]) * s.brush;
      g.beginPath(); g.moveTo(x, y);
      for (let q = 0; q < steps; q++) {
        const a = fbm(x * sc, y * sc + clock * 0.03, seed % 113) * TAU * p.curl;
        x += Math.cos(a) * sp; y += Math.sin(a) * sp;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
  },
};

let blobBuffer = null;
const blobs = {
  id: 'blobs', name: 'Blobs', group: 'Scenes', kind: 'instant', svg: false,
  desc: 'Six bands as merging liquid masses',
  params: [{ id: 'merge', label: 'Merge', min: 0.5, max: 2, step: 0.02, def: 1 }, num('count', 'Blobs', 2, 10, 1, 6), num('speed', 'Speed', 0.02, 0.5, 0.01, 0.13), num('size', 'Size', 0.03, 0.3, 0.005, 0.12)],
  draw(g, s) {
    const { A, i, box, pal, p, clock, seed } = s;
    const w = 220, h = Math.max(40, Math.round((w * box.h) / box.w));
    if (!blobBuffer || blobBuffer.height !== h) blobBuffer = new OffscreenCanvas(w, h);
    const x = blobBuffer.getContext('2d'), img = x.createImageData(w, h), d = img.data;
    const balls = [];
    for (let b = 0; b < p.count; b++) {
      const e = A.bandGroup(i, b, p.count);
      balls.push({
        x: w * (noise2(b * 3.1, clock * p.speed, seed % 71) * 1.1 - 0.05),
        y: h * (noise2(b * 3.1 + 9, clock * p.speed, seed % 73) * 1.1 - 0.05),
        r2: Math.pow(w * (0.05 + p.size * e * e) * p.merge, 2), c: b / (p.count - 1),
      });
    }
    const rgb = pal.ramp.map((c) => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; });
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      let f = 0, c = 0;
      for (const B of balls) {
        const dx = px - B.x, dy = py - B.y, v = B.r2 / (dx * dx + dy * dy + 1);
        f += v; c += v * B.c;
      }
      const o = (py * w + px) * 4, col = rgb[Math.min(255, Math.round((c / f) * 255))];
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2];
      d[o + 3] = Math.max(0, Math.min(255, (f - 1) * 900));
    }
    x.putImageData(img, 0, 0);
    g.imageSmoothingQuality = 'high';
    g.drawImage(blobBuffer, box.x, box.y, box.w, box.h);
  },
};

const terrain = {
  id: 'terrain', name: 'Terrain', group: 'Scenes', kind: 'instant',
  desc: 'The last seconds of spectrum as a landscape in perspective',
  params: [{ id: 'relief', label: 'Relief', min: 0.1, max: 1.2, step: 0.02, def: 0.5 }, num('rows', 'Rows', 16, 70, 1, 44), num('width', 'Width', 1, 4, 0.05, 2.2), num('horizon', 'Horizon', 0.1, 0.6, 0.01, 0.3), num('history', 'History', 0.01, 0.2, 0.005, 0.05)],
  draw(g, s) {
    const { A, i, box, pal, u, p } = s;
    const rows = p.rows, cols = 72, hor = box.y + box.h * p.horizon, bottom = box.y + box.h * 1.04;
    const step = Math.max(1, Math.round(FR * p.history));
    // Back to front, so nearer ridges cover farther ones.
    for (let r = rows - 1; r >= 0; r--) {
      const z = r / (rows - 1), sc = 1 / (1 + z * 4);
      const ybase = hor + ((bottom - hor) * (sc - 0.2)) / 0.8;
      const pts = [];
      const f = i - r * step;
      for (let c = 0; c <= cols; c++) {
        const q = c / cols, at = Math.abs(q - 0.5) * 2 * (NB - 1.01), b = Math.floor(at), w = at - b;
        const e = f >= 0 ? A.f.bands[f * NB + b] * (1 - w) + A.f.bands[f * NB + b + 1] * w : 0;
        const x = box.x + box.w / 2 + (q - 0.5) * box.w * p.width * sc;
        pts.push([x, ybase - e * e * box.h * p.relief * sc * 0.6]);
      }
      g.beginPath();
      g.moveTo(pts[0][0], bottom);
      for (const [x, y] of pts) g.lineTo(x, y);
      g.lineTo(pts[cols][0], bottom);
      g.closePath();
      if (s.transparent) { g.globalCompositeOperation = 'destination-out'; g.fillStyle = '#000'; g.fill(); g.globalCompositeOperation = 'source-over'; }
      else { g.fillStyle = pal.bg; g.fill(); }
      g.beginPath();
      pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = rgba(pal.at(1 - z), 1 - z * 0.8);
      g.lineWidth = u * (0.8 + 2 * (1 - z)) * s.brush;
      g.lineJoin = 'round';
      g.stroke();
    }
  },
};

const tunnel = {
  id: 'tunnel', name: 'Tunnel', group: 'Scenes', kind: 'instant',
  desc: 'Rings of spectrum rushing past',
  params: [{ id: 'sides', label: 'Sides', min: 3, max: 48, step: 1, def: 6 }, num('rings', 'Rings', 8, 50, 1, 22), num('speed', 'Speed', 0.1, 1.5, 0.01, 0.45), num('spin', 'Spin', 0, 0.4, 0.005, 0.08), num('swell', 'Swell', 0, 0.5, 0.01, 0.1)],
  draw(g, s) {
    const { A, i, box, pal, u, p, clock } = s;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.hypot(box.w, box.h) * 0.62;
    const rings = p.rings, off = fract(clock * p.speed);
    for (let r = rings; r > 0; r--) {
      const z = (r - off) / rings, sc = 1 / (z * 9 + 0.5);
      const fIdx = Math.max(0, i - Math.round(z * 80));
      const rot = clock * p.spin * (r % 2 ? 1 : -1) + z * 1.4;
      g.strokeStyle = rgba(pal.at(1 - z), Math.min(1, (1 - z) * 1.5));
      g.lineWidth = u * (10 * sc + 0.8) * s.brush;
      g.lineJoin = 'miter';
      g.beginPath();
      const seg = p.sides * 10;
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * TAU + rot;
        const poly = Math.cos(Math.PI / p.sides) / Math.cos(((a - rot) % (TAU / p.sides)) - Math.PI / p.sides);
        const e = A.f.bands[fIdx * NB + Math.floor(Math.abs(k / seg - 0.5) * 2 * (NB - 1))];
        const rr = R * sc * poly * (1 + p.swell * e * e);
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath(); g.stroke();
    }
  },
};

const stipple = {
  id: 'stipple', name: 'Stipple', group: 'Scenes', kind: 'instant',
  desc: 'A seed-head of dots; each ring is one band',
  params: [{ id: 'dots', label: 'Dots', min: 300, max: 3000, step: 50, def: 1400 }, { id: 'turn', label: 'Spin', min: 0, max: 1, step: 0.01, def: 0.25 }, num('size', 'Dot size', 0.4, 2.5, 0.05, 1), num('push', 'Kick push', 0, 0.3, 0.005, 0.05)],
  draw(g, s) {
    const { A, i, box, pal, u, p, clock } = s;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.min(box.w, box.h) * 0.49;
    const N = Math.round(p.dots * s.density), bands = A.bandsAt(i), spin = clock * p.turn * 0.2;
    const unit = (R / Math.sqrt(N)) * 1.1;
    for (let k = 1; k < N; k++) {
      const q = Math.sqrt(k / N), a = k * 2.39996 + spin;
      const b = Math.min(NB - 1, Math.floor(q * NB));
      const e = bands[b], r = unit * (0.06 + 0.86 * e * e) * s.brush * p.size;
      if (r < u * 0.3) continue;
      const push = 1 + p.push * A.f.kick[i] * (1 - q);
      g.fillStyle = pal.at(q);
      g.beginPath();
      g.arc(cx + Math.cos(a) * R * q * push, cy + Math.sin(a) * R * q * push, r, 0, TAU);
      g.fill();
    }
  },
};

export default [web, warp, currents, blobs, terrain, tunnel, stipple];
