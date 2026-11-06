// Footage: a video of yours in the frame, with Beat Chop cutting it to the track and
// effects that hit with the drums.
import { num, flag, choice, picks, hash2 } from '../core/style.js';
import { footagePlan, TIME_PATTERNS, GATE_PATTERNS, GATE_TARGETS, MIX_AT } from '../core/chop.js';

const when = (param, key = 'chop', is) => ({ ...param, when: key, is });

// Reused canvases for the effects. Drawing is synchronous, so nothing else can be using them.
const pads = [];
function pad(k, w, h) {
  pads[k] ??= new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
  const x = pads[k];
  if (x.canvas.width !== w || x.canvas.height !== h) { x.canvas.width = w; x.canvas.height = h; }
  x.globalCompositeOperation = 'source-over';
  x.globalAlpha = 1;
  x.clearRect(0, 0, w, h);
  return x;
}

function paletteLut(pal) {
  if (!pal.lut) {
    pal.lut = new Uint8Array(768);
    pal.ramp.forEach((c, i) => {
      const n = parseInt(c.slice(1), 16);
      pal.lut.set([(n >> 16) & 255, (n >> 8) & 255, n & 255], i * 3);
    });
  }
  return pal.lut;
}

// Dark to light through the palette's ramp, so the footage sits in the page's colours.
function recolour(x, w, h, pal, amount) {
  const image = x.getImageData(0, 0, w, h), d = image.data, lut = paletteLut(pal);
  const mix = Math.round(amount * 256);
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const l = ((d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8) * 3;
    d[i] += ((lut[l] - d[i]) * mix) >> 8;
    d[i + 1] += ((lut[l + 1] - d[i + 1]) * mix) >> 8;
    d[i + 2] += ((lut[l + 2] - d[i + 2]) * mix) >> 8;
  }
  x.putImageData(image, 0, 0);
}

// One copy per colour channel, added back together slightly apart.
function splitChannels(src, w, h, by) {
  const channel = pad(1, w, h), out = pad(2, w, h);
  out.globalCompositeOperation = 'lighter';
  for (const [colour, dx] of [['#f00', -by], ['#0f0', 0], ['#00f', by]]) {
    channel.globalCompositeOperation = 'source-over';
    channel.clearRect(0, 0, w, h);
    channel.drawImage(src, 0, 0);
    channel.globalCompositeOperation = 'multiply';
    channel.fillStyle = colour;
    channel.fillRect(0, 0, w, h);
    channel.globalCompositeOperation = 'destination-in';
    channel.drawImage(src, 0, 0);
    out.drawImage(channel.canvas, dx, 0);
  }
  return out.canvas;
}

const patternNames = TIME_PATTERNS.filter((x) => !x.mix).map((x) => x.label);

const video = {
  id: 'video', name: 'Video', group: 'Footage', kind: 'instant', svg: false, needsVideo: true,
  desc: 'Your own clip, with Beat Chop to cut it to the track',
  params: [
    flag('cover', 'Fill the frame'),
    num('offset', 'Start at', 0, 120, 0.1, 0),
    num('speed', 'Speed', 0.25, 3, 0.05, 1),
    flag('chop', 'Beat Chop', 0),
    when(choice('time', 'Time pattern', TIME_PATTERNS.map((x) => x.label), MIX_AT)),
    when(picks('mix', 'Mix uses', patternNames, patternNames.map((_, k) => k).slice(1)), 'time', MIX_AT),
    when(num('every', 'Bars per mix', 1, 8, 1, 2), 'time', MIX_AT),
    when(choice('gate', 'Gate pattern', GATE_PATTERNS.map((x) => x.label), 0)),
    when(choice('target', 'Gate to', GATE_TARGETS, 1)),
    when(num('soft', 'Softness', 0, 0.5, 0.01, 0.05)),
    when(num('dissolve', 'Dissolve', 0, 0.5, 0.01, 0)),
    when(flag('blend', 'Frame blend', 0)),
    flag('zoom', 'Kick zoom', 0),
    when(num('zoomAmt', 'Zoom amount', 0.02, 0.6, 0.01, 0.18), 'zoom'),
    flag('rgb', 'Snare RGB split', 0),
    when(num('rgbAmt', 'Split amount', 4, 120, 1, 40), 'rgb'),
    flag('tint', 'Palette recolour', 0),
    when(num('tintMix', 'Recolour amount', 0.1, 1, 0.05, 1), 'tint'),
  ],
  draw(g, s) {
    const { A, t, box, pal, p, seed, u, video: v } = s;
    if (!v) return;
    const plan = footagePlan(A, t, p, seed, v);
    const zoom = p.zoom ? 1 + p.zoomAmt * A.val('kick', t) : 1;
    const fit = (p.cover ? Math.max(box.w / v.w, box.h / v.h) : Math.min(box.w / v.w, box.h / v.h)) * zoom;
    const w = v.w * fit, h = v.h * fit, x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
    const fadeOut = p.target === 0 ? plan.gate : 1;
    const split = p.rgb ? p.rgbAmt * u * A.val('snare', t) : 0;

    // Effects work on a copy of the frame the size of the box, so a small cell stays cheap.
    const effects = p.tint || split >= 0.5;
    const padW = Math.ceil(box.w), padH = Math.ceil(box.h);
    const out = effects ? pad(0, padW, padH) : g;
    const ox = effects ? x - box.x : x, oy = effects ? y - box.y : y;
    for (const layer of plan.layers) {
      const frame = v.frame(layer.frame);
      if (!frame) continue;
      out.globalAlpha = layer.alpha * (effects ? 1 : fadeOut);
      out.drawImage(frame, ox, oy, w, h);
    }
    out.globalAlpha = 1;
    if (effects) {
      if (p.tint) recolour(out, padW, padH, pal, p.tintMix);
      g.globalAlpha = fadeOut;
      g.drawImage(split >= 0.5 ? splitChannels(out.canvas, padW, padH, split) : out.canvas, box.x, box.y);
      g.globalAlpha = 1;
    }

    if (p.target > 0 && plan.gate < 1) {
      g.fillStyle = p.target === 1 ? '#000' : '#fff';
      g.globalAlpha = 1 - plan.gate;
      g.fillRect(box.x, box.y, box.w, box.h);
      g.globalAlpha = 1;
    }
  },
};

const countUpTo = (list, t) => {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m] <= t) lo = m + 1; else hi = m; }
  return lo;
};

// A run of your pictures, cut to the beat grid or the snares.
const cuts = {
  id: 'cuts', name: 'Image Cuts', group: 'Footage', kind: 'instant', svg: false, needsImages: true, offline: true,
  desc: 'Your pictures, swapped on beats, bars or snares',
  params: [
    choice('cut', 'Cut on', ['Beats', 'Bars', 'Snares'], 1), num('every', 'Every', 1, 8, 1, 1), flag('shuffle', 'Shuffle', 0),
    flag('cover', 'Fill the frame'), num('zoom', 'Kick zoom', 0, 0.4, 0.01, 0.05), num('flash', 'Flash', 0, 1, 0.02, 0.3),
    num('stripes', 'Stripes', 0, 1, 0.02, 0), flag('tint', 'Palette recolour', 0),
  ],
  draw(g, s) {
    const { A, t, i, box, pal, p, seed, images } = s;
    const events = p.cut === 2 ? A.byType.snare.map((h) => h.t) : p.cut === 1 ? A.downbeats : A.beats;
    const round = Math.floor(countUpTo(events ?? [], t) / p.every);
    const picture = images[p.shuffle ? Math.floor(hash2(round, 7, seed) * images.length) : round % images.length];
    const kick = A.f.kick[i], zoom = 1 + p.zoom * kick;
    const fit = (p.cover ? Math.max(box.w / picture.w, box.h / picture.h) : Math.min(box.w / picture.w, box.h / picture.h)) * zoom;
    const w = picture.w * fit, h = picture.h * fit, x = (box.w - w) / 2, y = (box.h - h) / 2;
    const padW = Math.ceil(box.w), padH = Math.ceil(box.h), out = pad(3, padW, padH);
    out.drawImage(picture.bitmap, x, y, w, h);
    if (p.tint) recolour(out, padW, padH, pal, 1);
    if (p.stripes > 0) {
      const rows = 28, tall = padH / rows;
      for (let r = 0; r < rows; r++) {
        const dx = (hash2(r, round, seed) - 0.5) * p.stripes * box.w * (0.25 + kick);
        g.drawImage(out.canvas, 0, r * tall, padW, tall, box.x + dx, box.y + r * tall, padW, tall);
      }
    } else g.drawImage(out.canvas, box.x, box.y);
    const since = t - (events?.[round * p.every - 1] ?? -9);
    if (p.flash > 0 && since >= 0 && since < 0.2) {
      g.fillStyle = '#fff'; g.globalAlpha = p.flash * (1 - since / 0.2);
      g.fillRect(box.x, box.y, box.w, box.h);
      g.globalAlpha = 1;
    }
  },
};

export default [video, cuts];
