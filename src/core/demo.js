// Synthesises a short track with a known answer. The tests check the analysis
// against it, and the app offers it as a demo so there is always something to try.
const SR = 48000;
const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

export function makeTrack({ bpm = 128, bars = 32, tonic = 57, mode = 'minor', seed = 7, noDrums = false } = {}) {
  const beat = 60 / bpm;
  const dur = bars * 4 * beat + 2;
  const n = Math.floor(dur * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const add = (t, len, fn, pan = 0.5, g = 1) => {
    const a = Math.floor(t * SR), m = Math.floor(len * SR);
    const lg = Math.cos(pan * Math.PI * 0.5) * g, rg = Math.sin(pan * Math.PI * 0.5) * g;
    for (let i = 0; i < m && a + i < n; i++) {
      const v = fn(i / SR);
      L[a + i] += v * lg; R[a + i] += v * rg;
    }
  };
  const scale = mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const third = mode === 'minor' ? 3 : 4;
  const prog = mode === 'minor' ? [[0, 3, 7], [8, 12, 15], [3, 7, 10], [10, 14, 17]] : [[0, 4, 7], [9, 12, 16], [5, 9, 12], [7, 11, 14]];
  void third;
  const truth = { bpm, kick: [], snare: [], hat: [], tonic: tonic % 12, mode };

  for (let bar = 0; bar < bars; bar++) {
    const t0 = 1 + bar * 4 * beat;
    const chord = prog[bar % 4];
    for (const c of chord) {
      const hz = midiHz(tonic + c);
      add(t0, 4 * beat, (t) => {
        const e = Math.min(1, t * 8) * Math.min(1, (4 * beat - t) * 8);
        return e * 0.05 * (Math.sin(2 * Math.PI * hz * t) + 0.4 * Math.sin(4 * Math.PI * hz * t) + 0.2 * Math.sin(6 * Math.PI * hz * t));
      }, 0.3 + rnd() * 0.4);
    }
    for (let st = 0; st < 16; st += 2) {
      if (bar >= 4) {
        const root = tonic - 24 + chord[0];
        const hz = midiHz(root);
        add(t0 + (st * beat) / 4, beat / 2, (t) => Math.exp(-t * 6) * 0.22 * Math.sin(2 * Math.PI * hz * t), 0.5);
      }
    }
    for (let st = 0; st < 8; st++) {
      if (bar >= 8) {
        const deg = scale[Math.floor(rnd() * scale.length)];
        const hz = midiHz(tonic + 12 + deg);
        add(t0 + (st * beat) / 2, beat / 2, (t) => Math.exp(-t * 5) * 0.09 * Math.sin(2 * Math.PI * hz * t), rnd());
      }
    }
    if (noDrums) continue;
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * beat;
      truth.kick.push(t);
      add(t, 0.28, (x) => {
        const f = 48 + 110 * Math.exp(-x * 40);
        return Math.exp(-x * 11) * 0.7 * Math.sin(2 * Math.PI * f * x);
      });
      if (b % 2 === 1) {
        truth.snare.push(t);
        add(t, 0.2, (x) => Math.exp(-x * 22) * (0.32 * (rnd() * 2 - 1) + 0.16 * Math.sin(2 * Math.PI * 190 * x)));
      }
    }
    for (let st = 0; st < 8; st++) {
      const t = t0 + (st * beat) / 2;
      truth.hat.push(t);
      let prev = 0;
      add(t, 0.05, (x) => {
        const w = rnd() * 2 - 1, hp = w - prev; prev = w;
        return Math.exp(-x * 90) * 0.16 * hp;
      }, 0.65);
    }
  }
  // Leave headroom: the layers are written without regard for their sum.
  let top = 0;
  for (let i = 0; i < n; i++) top = Math.max(top, Math.abs(L[i]), Math.abs(R[i]));
  const gain = 0.89 / (top || 1);
  for (let i = 0; i < n; i++) { L[i] *= gain; R[i] *= gain; }
  return { L, R, truth };
}
