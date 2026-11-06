// Palettes from pictures: readable on any picture, and the same every time.
import { paletteFromPixels } from '../src/core/imagepalette.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`); if (!ok) fails++; };

const picture = (w, h, colour) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a = 255] = colour(x / w, y / h, x, y);
    d.set([r, g, b, a], (y * w + x) * 4);
  }
  return d;
};

const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (p, q) => { const [a, b] = [luminance(p), luminance(q)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
const noise = (x, y) => Math.abs(Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1;

const pictures = {
  sunset: (x, y) => [255 - y * 120, 60 + (1 - y) * 170, 40 + y * 130],
  night: (x, y) => (noise(x, y) > 0.97 ? [255, 240, 200] : [8, 10 + y * 20, 30 + y * 30]),
  pastel: (x, y) => [230 + x * 25, 220 + y * 30, 235 - x * 20],
  forest: (x, y) => { const n = noise(x, y); return n > 0.8 ? [190, 170, 60] : n > 0.4 ? [40, 110, 50] : [15, 40, 25]; },
  blocks: (x) => (x < 0.25 ? [230, 30, 40] : x < 0.5 ? [30, 80, 230] : x < 0.75 ? [250, 210, 30] : [15, 15, 15]),
  grey: (x) => [x * 255, x * 255, x * 255],
  black: () => [0, 0, 0],
  white: () => [255, 255, 255],
  red: () => [220, 20, 30],
  midgrey: () => [128, 128, 128],
};

const HEX = /^#[0-9a-f]{6}$/;
for (const [name, colour] of Object.entries(pictures)) {
  const data = picture(160, 90, colour), pal = paletteFromPixels(data);
  const all = [pal.bg, pal.fg, pal.accent, ...pal.colors];
  check(`${name}: real colours`, pal.colors.length === 5 && all.every((c) => HEX.test(c)), all.join(' '));
  check(`${name}: text reads`, contrast(pal.bg, pal.fg) >= 7, contrast(pal.bg, pal.fg).toFixed(1));
  check(`${name}: accent reads`, contrast(pal.bg, pal.accent) >= 2.4, contrast(pal.bg, pal.accent).toFixed(1));
  check(`${name}: ramp shows`, pal.colors.every((c) => contrast(pal.bg, c) >= 1.5), pal.colors.map((c) => contrast(pal.bg, c).toFixed(1)).join(' '));
  check(`${name}: same every time`, JSON.stringify(paletteFromPixels(data)) === JSON.stringify(pal));
}

{
  const dark = paletteFromPixels(picture(100, 100, pictures.night));
  const light = paletteFromPixels(picture(100, 100, pictures.pastel));
  check('dark picture, dark page', luminance(dark.bg) < luminance(dark.fg));
  check('light picture, light page', luminance(light.bg) > luminance(light.fg));
  const blocks = paletteFromPixels(picture(100, 100, pictures.blocks));
  const reddish = blocks.colors.concat(blocks.accent).some((c) => { const [r, g, b] = rgb(c); return r > g * 2 && r > b * 2; });
  const bluish = blocks.colors.some((c) => { const [r, g, b] = rgb(c); return b > r * 1.5 && b > g * 1.2; });
  check('keeps the picture\'s colours', reddish && bluish, blocks.colors.join(' '));
  const paper = paletteFromPixels(picture(100, 100, (x) => (x < 0.7 ? [244, 233, 220] : x < 0.8 ? [232, 146, 124] : x < 0.9 ? [127, 183, 190] : [242, 193, 78])));
  check('no greys from the background', paper.colors.every((c) => { const [r, g, b] = rgb(c); return Math.max(r, g, b) - Math.min(r, g, b) > 24; }), paper.colors.join(' '));
  check('nothing visible gives nothing', paletteFromPixels(picture(10, 10, () => [9, 9, 9, 0])) === null);
  check('ignores transparent pixels', paletteFromPixels(picture(50, 50, (x) => (x < 0.5 ? [255, 0, 0, 0] : [10, 20, 200]))).colors.every((c) => { const [r, , b] = rgb(c); return r < b; }));
  const big = picture(4000, 3000, pictures.sunset), from = performance.now();
  paletteFromPixels(big);
  const ms = performance.now() - from;
  check('fast on a 12 megapixel picture', ms < 1500, `${ms.toFixed(0)} ms`);
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
