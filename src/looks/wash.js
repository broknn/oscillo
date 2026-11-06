// Soft matter: ink, smoke and sparks. Ink and smoke are worked out on a small field of
// pixels and scaled up, so their cost doesn't grow with the export size.
import { fbm, noise2, hash2, rgba, num } from '../core/style.js';

const TAU = Math.PI * 2;
const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const x = clamp((v - a) / (b - a)); return x * x * (3 - 2 * x); };

const pads = new Map();
function field(key, w, h) {
  let c = pads.get(key);
  if (!c || c.width !== w || c.height !== h) { c = new OffscreenCanvas(w, h); pads.set(key, c); }
  return c;
}

const rampOf = (pal) => (pal.rgb ??= pal.ramp.map((c) => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }));

function paint(g, c, img, box) {
  c.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, box.x, box.y, box.w, box.h);
}

const ink = {
  id: 'ink', name: 'Ink Wash', group: 'Organic', kind: 'instant', svg: false,
  desc: 'A watercolour blot that blooms and creeps with the sound',
  params: [
    num('size', 'Size', 0.3, 1.6, 0.02, 0.9), num('warp', 'Bleed', 0, 2, 0.02, 1), num('speed', 'Creep', 0.02, 0.4, 0.01, 0.1),
    num('edge', 'Hard edge', 0, 1, 0.02, 0.6), num('blots', 'Blots', 1, 4, 1, 2),
  ],
  draw(g, s) {
    const { A, i, box, pal, p, clock, seed } = s;
    const w = 150, h = Math.max(30, Math.round((w * box.h) / box.w)), aspect = box.h / box.w;
    const c = field('ink', w, h), img = c.getContext('2d').createImageData(w, h), d = img.data, ramp = rampOf(pal);
    const time = clock * p.speed, level = clamp((A.f.loudS[i] + 38) / 30), kick = A.f.kick[i], sd = seed % 41;
    const blots = [];
    for (let b = 0; b < p.blots; b++) {
      blots.push({
        x: 0.2 + 0.6 * noise2(b * 3.7, time * 0.5, sd),
        y: (0.2 + 0.6 * noise2(b * 5.3 + 8, time * 0.5, sd)) * aspect,
        r: (0.1 + 0.3 * level) * p.size * (1 + 0.12 * kick) * Math.max(0.6, Math.min(1, aspect)) / Math.sqrt(p.blots) * 1.4,
      });
    }
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const nx = px / w, ny = (py / h) * aspect;
      const qx = nx + (fbm(nx * 3 + time, ny * 3, sd) - 0.5) * p.warp * 0.5;
      const qy = ny + (fbm(nx * 3 + 7, ny * 3 - time, sd + 1) - 0.5) * p.warp * 0.5;
      let v = -1;
      for (const b of blots) v = Math.max(v, 1 - Math.hypot(qx - b.x, qy - b.y) / b.r);
      if (v < -0.4) continue;
      v += (fbm(qx * 9, qy * 9, sd + 2) - 0.5) * 0.7;
      const alpha = smooth(0, 0.14, v) * (1 - p.edge * 0.8 * smooth(0.03, 0.45, v));
      if (alpha <= 0) continue;
      const o = (py * w + px) * 4, col = ramp[Math.round(255 * (0.35 + 0.55 * clamp(v)))];
      d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = alpha * 235;
    }
    paint(g, c, img, box);
  },
};

const plume = {
  id: 'plume', name: 'Smoke Plume', group: 'Scenes', kind: 'instant', svg: false,
  desc: 'Bright curling filaments that swell with the bass; best on dark pages',
  params: [
    num('size', 'Size', 0.3, 1.6, 0.02, 1), num('warp', 'Curl', 0.2, 2.5, 0.02, 1.2), num('speed', 'Speed', 0.02, 0.4, 0.01, 0.12),
    num('thin', 'Fine lines', 1, 8, 0.1, 3.5), num('glow', 'Glow', 0.3, 2, 0.02, 1),
  ],
  draw(g, s) {
    const { A, i, box, pal, p, clock, seed } = s;
    const w = 170, h = Math.max(30, Math.round((w * box.h) / box.w)), aspect = box.h / box.w;
    const c = field('plume', w, h), img = c.getContext('2d').createImageData(w, h), d = img.data, ramp = rampOf(pal);
    const time = clock * p.speed, sd = seed % 43, kick = A.f.kick[i];
    const reach = (0.3 + 0.7 * clamp((A.f.loudS[i] + 34) / 26)) * p.size * (1 + 0.15 * kick);
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const nx = (px / w - 0.5) * 2, ny = (py / h - 0.5) * 2 * aspect, r = Math.hypot(nx, ny);
      const mask = 1 - r / reach;
      if (mask <= 0) continue;
      const a = Math.atan2(ny, nx) + time * 0.6 + r * 1.2;
      const qx = Math.cos(a) * r + (fbm(nx * 1.6 + time, ny * 1.6, sd) - 0.5) * p.warp;
      const qy = Math.sin(a) * r + (fbm(nx * 1.6, ny * 1.6 - time, sd + 1) - 0.5) * p.warp;
      const v = fbm(qx * 2.2, qy * 2.2, sd + 2);
      const ridge = Math.pow(1 - Math.abs(2 * v - 1), p.thin * 2);
      const bright = clamp((ridge * 1.3 + v * v * 0.35) * smooth(0, 0.45, mask) * (0.7 + 0.5 * kick) * p.glow);
      const o = (py * w + px) * 4, col = ramp[Math.round(255 * (0.3 + 0.7 * bright))], top = bright * bright;
      d[o] = col[0] + (255 - col[0]) * top; d[o + 1] = col[1] + (255 - col[1]) * top; d[o + 2] = col[2] + (255 - col[2]) * top;
      d[o + 3] = bright * 255;
    }
    paint(g, c, img, box);
  },
};

// Every spark has its own repeating life, so where it is comes straight from the time.
const burst = {
  id: 'burst', name: 'Star Burst', group: 'Scenes', kind: 'instant',
  desc: 'Sparks thrown from the centre, wider when the track is wide',
  params: [
    num('count', 'Sparks', 100, 2000, 10, 700), num('speed', 'Reach', 0.3, 3, 0.02, 1), num('life', 'Life', 0.4, 4, 0.05, 1.6),
    num('size', 'Size', 0.3, 3, 0.02, 1), num('streak', 'Streaks', 0, 1, 0.02, 0.4), num('spread', 'Stereo width', 0, 2, 0.02, 1),
  ],
  draw(g, s) {
    const { A, t, box, pal, u, p, seed } = s;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2, R = Math.max(box.w, box.h) * 0.6 * p.speed;
    g.lineCap = 'round';
    for (let k = 0; k < p.count; k++) {
      const life = p.life * (0.6 + 0.8 * hash2(k, 1, seed)), off = hash2(k, 2, seed) * life;
      const round = Math.floor((t + off) / life), born = Math.max(0, round * life - off), age = (t + off) / life - round;
      const energy = A.val('kick', born) + A.val('level', born) * 0.8;
      if (energy < 0.2) continue;
      const a = hash2(k, round, seed) * TAU, fly = 1 - (1 - age) * (1 - age);
      const dist = R * fly * Math.min(1.4, energy) * (0.25 + 0.75 * hash2(k, round + 1, seed));
      const wide = 1 + (1 - A.val('corr', born)) * 0.5 * p.spread;
      const x = cx + Math.cos(a) * dist * wide, y = cy + Math.sin(a) * dist;
      const colour = hash2(k, 3, seed) < 0.3 ? pal.fg : pal.at(hash2(k, 4, seed));
      const alpha = Math.min(1, (1 - age) * 1.8) * Math.min(1, 0.45 + energy);
      if (p.streak > 0.02) {
        const back = dist * p.streak * 0.25;
        g.strokeStyle = rgba(colour, alpha * 0.6); g.lineWidth = Math.max(0.5, u);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - Math.cos(a) * back * wide, y - Math.sin(a) * back); g.stroke();
      }
      const size = Math.max(0.8, u * (2.5 + 5 * hash2(k, 5, seed)) * p.size * s.brush * (1 - age * 0.6));
      g.fillStyle = rgba(colour, alpha);
      g.fillRect(x - size / 2, y - size / 2, size, size);
    }
    g.lineCap = 'butt';
  },
};

export default [ink, plume, burst];
