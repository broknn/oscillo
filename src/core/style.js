// Palettes, seeded randomness and smooth noise.

const hex = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
export const rgba = (c, a = 1) => { const [r, g, b] = hex(c); return `rgba(${r},${g},${b},${a})`; };
export const mixHex = (a, b, t) => {
  const x = hex(a), y = hex(b);
  const m = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

const defs = {
  carbon:   { label: 'Carbon',   bg: '#0e0f11', fg: '#ecebe4', dim: '#6c6e72', accent: '#d7ff3e', colors: ['#2f3fd6', '#8b47e6', '#f0508f', '#ff9a3c', '#d7ff3e'] },
  paper:    { label: 'Paper',    bg: '#f1f2f4', fg: '#20242c', dim: '#a3a8b4', accent: '#2547e6', colors: ['#c9d4f5', '#8fa4ee', '#5f7be6', '#2f50dd', '#1a2fa8'] },
  newsprint:{ label: 'Newsprint',bg: '#efece3', fg: '#17161a', dim: '#8d8a80', accent: '#e8391d', colors: ['#17308f', '#2f8f83', '#e3a81c', '#e8391d', '#17161a'] },
  riso:     { label: 'Riso',     bg: '#f6f1e7', fg: '#1d2b53', dim: '#a39e94', accent: '#ff4f79', colors: ['#1d4fd8', '#00a693', '#ffcf33', '#ff4f79', '#7a2fc4'] },
  cyanotype:{ label: 'Cyanotype',bg: '#0d2a55', fg: '#e8f0ff', dim: '#6d8bb8', accent: '#ffffff', colors: ['#2e6fc4', '#6fb2f0', '#b7dcff', '#e8f0ff', '#ffffff'] },
  ember:    { label: 'Ember',    bg: '#120a08', fg: '#f7e6d3', dim: '#7c6355', accent: '#ff6a1f', colors: ['#5a1020', '#b3261e', '#ff6a1f', '#ffb547', '#ffe9a8'] },
  moss:     { label: 'Moss',     bg: '#10150f', fg: '#e3e6d2', dim: '#6d7560', accent: '#b6e04a', colors: ['#1f4d3a', '#3d8a5f', '#8fc15c', '#d9d45b', '#f2e9b0'] },
  ultra:    { label: 'Ultra',    bg: '#1a12d8', fg: '#f4f2ff', dim: '#8a84ee', accent: '#ffe14d', colors: ['#6f66ff', '#b9b4ff', '#f4f2ff', '#ffe14d', '#ff7ab8'] },
  bone:     { label: 'Bone',     bg: '#e7e2d6', fg: '#1b1a18', dim: '#9d978a', accent: '#1b1a18', colors: ['#1b1a18', '#4a4741', '#7c776c', '#a8a294', '#1b1a18'] },
  plasma:   { label: 'Plasma',   bg: '#07060f', fg: '#f2eefc', dim: '#676280', accent: '#ff3df0', colors: ['#3b1fd1', '#8a2be2', '#ff3df0', '#ff8a3d', '#ffe66b'] },
  graphite: { label: 'Graphite', bg: '#121212', fg: '#e6e6e6', dim: '#6a6a6a', accent: '#e6e6e6', colors: ['#3d3d3d', '#6a6a6a', '#9a9a9a', '#c8c8c8', '#ffffff'] },
};

function build(id, d) {
  const ramp = [];
  const c = d.colors;
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (c.length - 1), k = Math.min(c.length - 2, Math.floor(x));
    ramp.push(mixHex(c[k], c[k + 1], x - k));
  }
  return { id, ...d, ramp, at: (x) => ramp[Math.max(0, Math.min(255, Math.round(x * 255)))] };
}

export const PALETTES = {};
for (const [id, d] of Object.entries(defs)) PALETTES[id] = build(id, d);

const customMade = new Map();

// A palette from its id, or from your own colours: { bg, fg, accent, colors: [five] }.
export function paletteOf(spec) {
  if (typeof spec !== 'object' || !spec) return PALETTES[spec] ?? PALETTES.carbon;
  const key = JSON.stringify([spec.bg, spec.fg, spec.accent, spec.colors]);
  if (!customMade.has(key)) {
    if (customMade.size > 60) customMade.clear();
    customMade.set(key, build(`custom:${key}`, { label: 'Custom', ...spec, dim: mixHex(spec.bg, spec.fg, 0.42) }));
  }
  return customMade.get(key);
}

// A starting point for your own colours.
export function copyColours(spec) {
  const { bg, fg, accent, colors } = paletteOf(spec);
  return { bg, fg, accent, colors: [...colors] };
}

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hash2 = (x, y, s = 0) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647 - 18);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const smooth = (t) => t * t * (3 - 2 * t);
export function noise2(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const u = smooth(x - xi), v = smooth(y - yi);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export const fbm = (x, y, s = 0) => 0.6 * noise2(x, y, s) + 0.28 * noise2(x * 2.1, y * 2.1, s + 1) + 0.12 * noise2(x * 4.3, y * 4.3, s + 2);

// Look parameters: a slider, or an on/off switch stored as 1 or 0.
export const num = (id, label, min, max, step, def) => ({ id, label, min, max, step, def });
export const flag = (id, label, def = 1) => ({ id, label, type: 'toggle', min: 0, max: 1, step: 1, def });

export const choice = (id, label, options, def = 0) => ({ id, label, type: 'choice', options, min: 0, max: options.length - 1, step: 1, def });

// A choice of several. Stored as a list of option numbers; the ends of the range are for testing.
export const picks = (id, label, options, def) => ({ id, label, type: 'picks', options, min: [def[0]], max: def, step: 1, def });

export const FONT = '"Segoe UI Variable Display", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
export const MONO = '"Cascadia Mono", Consolas, Menlo, monospace';

// An empty name means the default for that job. Sizes stay relative, so any font fits.
export const fontStack = (name, fallback) => (name ? `"${name.replace(/"/g, '')}", ${fallback}` : fallback);

export const FONT_CHOICES = ['Segoe UI', 'Bahnschrift', 'Arial', 'Arial Black', 'Impact', 'Verdana', 'Tahoma', 'Trebuchet MS',
  'Georgia', 'Times New Roman', 'Palatino Linotype', 'Garamond', 'Consolas', 'Cascadia Mono', 'Courier New', 'Lucida Console'];
