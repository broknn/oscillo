// Small DSP toolbox. No DOM, no Node: runs in the worker, the Listen window and tests.

export class FFT {
  constructor(size) {
    this.n = size;
    this.rev = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = Math.sin((2 * Math.PI * i) / size);
    }
    this.re = new Float64Array(size);
    this.im = new Float64Array(size);
  }

  // Magnitude spectrum of a real signal. `out` has n/2 bins.
  magnitude(input, out) {
    const { n, rev, cos, sin, re, im } = this;
    for (let i = 0; i < n; i++) { re[i] = input[rev[i]]; im[i] = 0; }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tr = re[b] * cos[k] + im[b] * sin[k];
          const ti = im[b] * cos[k] - re[b] * sin[k];
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
    for (let i = 0; i < n / 2; i++) out[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    return out;
  }
}

export function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

// BS.1770 K-weighting at 48 kHz: the two published biquads in series, with
// state kept between blocks so the Listen window can feed it chunk by chunk.
export class KWeight {
  constructor() { this.s = new Float64Array(8); }
  process(input, out = new Float32Array(input.length)) {
    const s = this.s;
    let [x1, x2, y1, y2, u1, u2, v1, v2] = s;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const y = 1.53512485958697 * x - 2.69169618940638 * x1 + 1.19839281085285 * x2
        + 1.69065929318241 * y1 - 0.73248077421585 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      const v = y - 2 * u1 + u2 + 1.99004745483398 * v1 - 0.99007225036621 * v2;
      u2 = u1; u1 = y; v2 = v1; v1 = v;
      out[i] = v;
    }
    s[0] = x1; s[1] = x2; s[2] = y1; s[3] = y2; s[4] = u1; s[5] = u2; s[6] = v1; s[7] = v2;
    return out;
  }
}

export const hzToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;

export function percentile(values, p) {
  const s = Float32Array.from(values).sort();
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
}
