// A palette from a picture. Colours are grouped in OKLab, where distance follows what the
// eye sees, then given jobs: background, text, accent and a ramp running away from the
// background, as the built-in palettes do. Lightness is moved where needed so that text and
// marks stay readable whatever the picture was.
const GROUPS = 8, ROUNDS = 12, RAMP = 5;
const KEEP_APART = 0.07, RAMP_FROM_BACK = 0.22, ACCENT_FROM_BACK = 0.35;

const linear = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const gamma = (v) => {
  const x = Math.max(0, Math.min(1, v));
  return Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055));
};

function toLab(r8, g8, b8) {
  const r = linear(r8), g = linear(g8), b = linear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return { L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s };
}

function toHex({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return `#${rgb.map((v) => gamma(v).toString(16).padStart(2, '0')).join('')}`;
}

const gap = (p, q) => Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
const chroma = (c) => Math.hypot(c.a, c.b);
const mix = (p, q, x) => ({ L: p.L + (q.L - p.L) * x, a: p.a + (q.a - p.a) * x, b: p.b + (q.b - p.b) * x });
const tamed = (c, L, most) => { const k = Math.min(1, most / (chroma(c) || 1)); return { ...c, L, a: c.a * k, b: c.b * k }; };

// Near-identical pixels are counted together, so a large picture costs no more than a small one.
function colourCounts(data) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => ({ ...toLab(((key >> 10) & 31) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4), n }));
}

function groupColours(points) {
  const heaviest = points.reduce((p, q) => (q.n > p.n ? q : p));
  const centres = [{ ...heaviest }];
  while (centres.length < GROUPS) {
    let best = null, bestScore = 0;
    for (const p of points) {
      const near = Math.min(...centres.map((c) => gap(p, c)));
      const score = near * near * Math.sqrt(p.n);
      if (score > bestScore) { best = p; bestScore = score; }
    }
    if (!best) break;
    centres.push({ ...best });
  }
  for (let round = 0; round < ROUNDS; round++) {
    const sums = centres.map(() => ({ L: 0, a: 0, b: 0, n: 0 }));
    for (const p of points) {
      let at = 0, near = Infinity;
      centres.forEach((c, k) => { const d = gap(p, c); if (d < near) { near = d; at = k; } });
      const s = sums[at];
      s.L += p.L * p.n; s.a += p.a * p.n; s.b += p.b * p.n; s.n += p.n;
    }
    sums.forEach((s, k) => { if (s.n) centres[k] = { L: s.L / s.n, a: s.a / s.n, b: s.b / s.n, n: s.n }; else centres[k].n = 0; });
  }
  const total = points.reduce((sum, p) => sum + p.n, 0);
  return centres.filter((c) => c.n).map((c) => ({ ...c, share: c.n / total }));
}

function pickRamp(groups, back, ink) {
  const chosen = [];
  for (const c of [...groups].sort((p, q) => Math.sqrt(q.share) * (chroma(q) + 0.03) - Math.sqrt(p.share) * (chroma(p) + 0.03))) {
    if (chosen.length === RAMP) break;
    const far = Math.abs(c.L - back.L) >= RAMP_FROM_BACK;
    // The background's own dull colour, moved, would only be a grey.
    if (!far && chroma(c) < 0.05 && chosen.length) continue;
    const moved = far ? c : { ...c, L: back.L + Math.sign(ink.L - back.L) * RAMP_FROM_BACK };
    if (chosen.every((o) => gap(o, moved) >= KEEP_APART)) chosen.push(moved);
  }
  chosen.sort((p, q) => Math.abs(p.L - back.L) - Math.abs(q.L - back.L));
  if (chosen.length === 1) chosen.push(mix(chosen[0], ink, 0.6));
  while (chosen.length < RAMP) {
    let at = 0;
    for (let k = 1; k < chosen.length - 1; k++) if (gap(chosen[k], chosen[k + 1]) > gap(chosen[at], chosen[at + 1])) at = k;
    // A shade of the colour, not a blend: halfway between opposite hues is grey.
    const here = chosen[at], next = chosen[at + 1], step = (next.L - here.L) / 2;
    const away = Math.sign(ink.L - back.L) * 0.07;
    chosen.splice(at + 1, 0, { ...here, L: here.L + (Math.abs(step) < 0.07 ? away : step) });
  }
  return chosen;
}

function pickAccent(ramp, back, ink) {
  const vivid = ramp.reduce((p, q) => (chroma(q) > chroma(p) ? q : p));
  if (chroma(vivid) < 0.03) return ink;
  const up = ink.L > back.L ? 1 : -1;
  return Math.abs(vivid.L - back.L) >= ACCENT_FROM_BACK ? vivid : { ...vivid, L: back.L + up * ACCENT_FROM_BACK };
}

// `data` is RGBA pixels. Returns { bg, fg, accent, colors }, or null if nothing is visible.
export function paletteFromPixels(data) {
  const points = colourCounts(data);
  if (!points.length) return null;
  const groups = groupColours(points);
  const darkShare = groups.reduce((sum, c) => sum + (c.L < 0.6 ? c.share : 0), 0);
  const dark = darkShare >= 0.5;
  const side = groups.filter((c) => (c.L < 0.6) === dark);
  const base = (side.length ? side : groups).reduce((p, q) => (q.share > p.share ? q : p));
  const back = dark ? tamed(base, Math.min(base.L, 0.2), 0.05) : tamed(base, Math.max(base.L, 0.93), 0.03);
  const ink = tamed(back, dark ? 0.94 : 0.2, 0.015);
  const ramp = pickRamp(groups, back, ink);
  return { bg: toHex(back), fg: toHex(ink), accent: toHex(pickAccent(ramp, back, ink)), colors: ramp.map(toHex) };
}
