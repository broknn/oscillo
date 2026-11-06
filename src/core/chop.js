// Beat Chop: maps song time to footage time and a gate level, locked to the track's bars.
// Every moment is worked out on its own, so scrubbing and export can't drift.
import { hash2 } from './style.js';

const TAU = Math.PI * 2;
const repeat = (pos, len) => pos - Math.floor(pos / len) * len;

// src(pos, rnd): where in the bar to read from, in beats, for a position of 0 to 4 beats.
// A negative result reads from the bar before. The first entry is off, the last picks for you.
export const TIME_PATTERNS = [
  { label: 'Straight', src: (pos) => pos },
  { label: 'Half time', src: (pos) => pos / 2 },
  { label: 'Double back', src: (pos) => (pos < 2 ? pos : 4 - pos) },
  { label: 'Tape stop', src: (pos) => { if (pos < 2) return pos; const x = (pos - 2) / 2; return 2 + 2 * (x - (x * x) / 2); } },
  { label: 'Tape start', src: (pos) => (pos * pos) / 4 },
  { label: 'Hold beat', src: (pos) => repeat(pos, 1) },
  { label: 'Hold two beats', src: (pos) => repeat(pos, 2) },
  { label: 'Eighth stutter', src: (pos) => Math.floor(pos) + repeat(pos, 0.5) },
  { label: 'Sixteenth stutter', src: (pos) => Math.floor(pos * 2) / 2 + repeat(pos, 0.25) },
  { label: 'Triplet stutter', src: (pos) => Math.floor(pos) + repeat(pos, 1 / 3) },
  { label: 'Stutter build', src: (pos) => (pos < 2 ? pos : pos < 3 ? 2 + repeat(pos, 0.5) : 3 + repeat(pos, 0.25)) },
  { label: 'Reverse', src: (pos) => 4 - pos },
  { label: 'End rewind', src: (pos) => (pos < 3 ? pos : 3 - (pos - 3) * 3) },
  { label: 'Scratch', src: (pos) => pos + 0.6 * Math.sin(pos * TAU * 2) },
  { label: 'Stop motion', src: (pos) => Math.floor(pos * 3) / 3 },
  { label: 'Freeze', src: (pos) => Math.min(pos, 2) },
  { label: 'Shuffle', src: (pos, rnd) => Math.floor(rnd(Math.floor(pos * 2)) * 8) / 2 + repeat(pos, 0.5) },
  { label: 'Last bar echo', src: (pos) => (pos < 2 ? pos : pos - 6) },
  { label: 'Mix', mix: true },
];

// steps: on/off across the bar. curve: a level from 0 to 1 instead.
export const GATE_PATTERNS = [
  { label: 'Off' },
  { label: 'Eighths', steps: '1100110011001100' },
  { label: 'Sixteenths', steps: '1010101010101010' },
  { label: 'Offbeats', steps: '0011001100110011' },
  { label: 'Three and one', steps: '1110111011101110' },
  { label: 'Tresillo', steps: '1101101101101101' },
  { label: 'Strobe', steps: '10'.repeat(16) },
  { label: 'Second half', steps: '0000000011111111' },
  { label: 'Last beat out', steps: '1111111111110000' },
  { label: 'Pump', curve: (pos) => Math.min(1, repeat(pos, 1) * 1.6) },
  { label: 'Bar fade', curve: (pos) => 1 - pos / 4 },
];

export const MIX_AT = TIME_PATTERNS.findIndex((x) => x.mix);

export const GATE_TARGETS = ['Fade', 'Black', 'White'];

// The bar holding time t, following the track's own downbeats so tempo drift is honoured.
export function barAt(A, t) {
  const d = A.downbeats ?? [], beat = 60 / (A.bpm || 120), span = beat * 4;
  if (!d.length) { const k = Math.floor(t / span); return { index: k, start: k * span, len: span }; }
  if (t < d[0]) { const k = Math.floor((t - d[0]) / span); return { index: k, start: d[0] + k * span, len: span }; }
  const lastAt = d.length - 1;
  if (t >= d[lastAt]) {
    const len = lastAt ? d[lastAt] - d[lastAt - 1] : span, k = Math.floor((t - d[lastAt]) / len);
    return { index: lastAt + k, start: d[lastAt] + k * len, len };
  }
  let lo = 0, hi = lastAt;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (d[m] <= t) lo = m; else hi = m - 1; }
  return { index: lo, start: d[lo], len: d[lo + 1] - d[lo] };
}

function gateLevel(gate, pos, soft) {
  if (gate.curve) return gate.curve(pos);
  if (!gate.steps) return 1;
  const n = gate.steps.length, at = (pos / 4) * n, step = Math.min(n - 1, Math.floor(at));
  const on = gate.steps[step] === '1', was = gate.steps[(step + n - 1) % n] === '1';
  const ramp = (soft * n) / 4;
  if (on === was || ramp <= 0) return on ? 1 : 0;
  const q = Math.min(1, (at - step) / ramp);
  return on ? q : 1 - q;
}

const EVERY_PATTERN = TIME_PATTERNS.map((_, k) => k).slice(1, MIX_AT);

export function chopAt(A, t, { time = 0, gate = 0, every = 2, soft = 0, seed = 0, mix = EVERY_PATTERN } = {}) {
  const bar = barAt(A, t), pos = ((t - bar.start) / bar.len) * 4;
  let pattern = TIME_PATTERNS[time] ?? TIME_PATTERNS[0];
  if (pattern.mix) {
    // An empty list is a Mix with nothing in it, so the footage just plays.
    const pick = Math.floor(hash2(Math.floor(bar.index / every), 3, seed) * mix.length);
    pattern = TIME_PATTERNS[mix[pick] ?? 0];
  }
  const rnd = (k) => hash2(bar.index, k, seed);
  return {
    time: bar.start + (pattern.src(pos, rnd) / 4) * bar.len,
    gate: gateLevel(GATE_PATTERNS[gate] ?? GATE_PATTERNS[0], pos, soft),
  };
}

const wrap = (v, len) => v - Math.floor(v / len) * len;

// What a Video look shows at time t: footage frames to stack in order, plus the gate.
export function footagePlan(A, t, p, seed, video) {
  const opts = { time: p.time, gate: p.gate, every: p.every, soft: p.soft, seed, mix: p.mix };
  const read = (at) => (p.chop ? chopAt(A, at, opts) : { time: at, gate: 1 });
  const now = read(t), spots = [{ time: now.time, alpha: 1 }];

  // Dissolve: look back for the latest jump and let the old shot run on under the new one.
  if (p.chop && p.dissolve > 0) {
    const fade = (p.dissolve * barAt(A, t).len) / 4, N = 10, step = fade / N;
    for (let k = 0; k < N; k++) {
      const after = read(t - k * step), before = read(t - (k + 1) * step);
      if (Math.abs(after.time - before.time) <= step * 4 + 0.03) continue;
      const age = k * step;
      spots[0] = { time: before.time + age + step, alpha: 1 };
      spots.push({ time: now.time, alpha: age / fade });
      break;
    }
  }

  const layers = [];
  for (const spot of spots) {
    const at = wrap(spot.time * p.speed + p.offset, video.duration) * video.fps;
    const frame = Math.floor(at) % video.frames, mix = at - Math.floor(at);
    layers.push({ frame, alpha: spot.alpha });
    if (p.blend && mix > 0.02) layers.push({ frame: (frame + 1) % video.frames, alpha: spot.alpha * mix });
  }
  return { layers, gate: now.gate };
}
