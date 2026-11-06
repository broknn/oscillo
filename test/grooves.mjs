// Drum grooves that are harder on tempo detection than a kick on every beat. Steps are
// sixteenths: k kick, s snare, h hat. Each groove carries a bass line and a chord stab too.
const SR = 48000;

const GROOVES = {
  rock:     { k: [0, 6, 8], s: [4, 12], h: [0, 2, 4, 6, 8, 10, 12, 14] },
  halftime: { k: [0, 10], s: [8], h: [0, 2, 4, 6, 8, 10, 12, 14] },
  trap:     { k: [0, 3, 7, 10], s: [8], h: [0, 2, 4, 6, 7, 8, 10, 12, 13, 14, 15] },
  dembow:   { k: [0, 4, 8, 12], s: [3, 6, 11, 14], h: [] },
  tresillo: { k: [0, 3, 6, 8, 11, 14], s: [4, 12], h: [2, 6, 10, 14] },
  shuffle:  { k: [0, 7, 8], s: [4, 12], h: [0, 3, 4, 7, 8, 11, 12, 15] },
  poly:     { k: [0, 5, 10, 15], s: [4, 12], h: [0, 5, 10, 15] },
  nodrums:  { k: [], s: [], h: [] },
};

export function grooveTrack({ bpm = 150, groove = 'rock', bars = 40, seed = 3 } = {}) {
  const beat = 60 / bpm, step = beat / 4, G = GROOVES[groove];
  const n = Math.floor((bars * 4 * beat + 2) * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const add = (t, len, fn, g = 1) => {
    const a = Math.floor(t * SR), m = Math.floor(len * SR);
    for (let i = 0; i < m && a + i < n; i++) { const v = fn(i / SR) * g; L[a + i] += v; R[a + i] += v * 0.95; }
  };
  const roots = [45, 41, 48, 43];
  for (let bar = 0; bar < bars; bar++) {
    const t0 = 1 + bar * 4 * beat, hz = 440 * 2 ** ((roots[bar % 4] - 69) / 12);
    for (const st of [0, 3, 6, 10, 12]) add(t0 + st * step, step * 2.5, (x) => Math.exp(-x * 4) * 0.2 * Math.sin(2 * Math.PI * hz * x));
    for (const st of [0, 8]) for (const c of [4, 7, 12]) {
      const f = hz * 4 * 2 ** (c / 12);
      add(t0 + st * step, beat * 1.8, (x) => Math.min(1, x * 30) * Math.exp(-x * 2.5) * 0.04 * Math.sign(Math.sin(2 * Math.PI * f * x)));
    }
    for (const st of G.k) add(t0 + st * step, 0.25, (x) => Math.exp(-x * 12) * 0.7 * Math.sin(2 * Math.PI * (48 + 110 * Math.exp(-x * 40)) * x));
    for (const st of G.s) add(t0 + st * step, 0.2, (x) => Math.exp(-x * 20) * (0.34 * (rnd() * 2 - 1) + 0.16 * Math.sin(2 * Math.PI * 190 * x)));
    for (const st of G.h) add(t0 + st * step, 0.05, (x) => Math.exp(-x * 90) * 0.14 * (rnd() * 2 - 1));
  }
  let top = 0;
  for (let i = 0; i < n; i++) top = Math.max(top, Math.abs(L[i]), Math.abs(R[i]));
  for (let i = 0; i < n; i++) { L[i] *= 0.89 / top; R[i] *= 0.89 / top; }
  return { L, R };
}
