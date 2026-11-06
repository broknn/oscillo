// The Listen window's analysis: the same feature extractor and the same read API as
// a track, fed chunk by chunk, with no knowledge of what comes next.
import { Analysis, Extractor, allocFrames, SR, HOP, WIN, FR, NB, KEY_NAMES } from './analysis.js';
import { KWeight, clamp } from './dsp.js';

const CAP = Math.round(FR * 40);
const PCM = SR * 8;
const toLufs = (e) => (e > 1e-12 ? -0.691 + 10 * Math.log10(e) : -120);

export class LiveAnalysis extends Analysis {
  constructor() {
    const f = allocFrames(CAP);
    super({ n: 1, duration: Infinity, f, hits: [], notes: [], beats: [], downbeats: [], seed: 20481, name: 'Listening', bpm: 0, key: null, lufs: NaN }, new Float32Array(PCM), new Float32Array(PCM));
    this.ex = new Extractor();
    this.total = 0;       // frames ever seen
    this.write = 0;       // samples written into L/R
    this.next = WIN;      // sample end of the next analysis window
    this.kwL = new KWeight(); this.kwR = new KWeight();
    this.energy = new Float32Array(Math.ceil(FR * 3));
    this.topRms = 0.05; this.topBand = 0.5;
    this.det = { kick: { x: 'fluxK', tau: 0.13 }, snare: { x: 'fluxS', tau: 0.16 }, hat: { x: 'fluxH', tau: 0.05 } };
    for (const d of Object.values(this.det)) Object.assign(d, { avg: 0, top: 1e-3, env: 0, last: -1e9, decay: Math.exp(-1 / (FR * d.tau)) });
    this.chromaAvg = new Float64Array(12);
    this.cumNow = 0;
  }

  get time() { return this.total / FR; }

  push(l, r) {
    // Keep the newest audio: slide the buffer before it overflows.
    if (this.write + l.length > PCM) {
      const drop = this.write + l.length - PCM + SR;
      this.L.copyWithin(0, drop, this.write); this.R.copyWithin(0, drop, this.write);
      this.write -= drop; this.next -= drop; this.pcmBase += drop;
    }
    this.L.set(l, this.write); this.R.set(r, this.write);
    this.write += l.length;
    while (this.next <= this.write) {
      this.step(this.next);
      this.next += HOP;
    }
  }

  step(end) {
    if (this.n >= CAP) this.shift();
    const f = this.f, i = this.total === 0 ? 0 : this.n;
    this.ex.frame(f, i, this.L, this.R, end);

    // Slow auto-gain, so a quiet browser tab still moves the picture.
    this.topRms = Math.max(f.rms[i], this.topRms * 0.9997, 0.01);
    f.level[i] = clamp(f.rms[i] / this.topRms);
    let top = 0;
    for (let b = 0; b < NB; b++) top = Math.max(top, f.bands[i * NB + b]);
    this.topBand = Math.max(top, this.topBand * 0.9997, 0.25);
    for (let b = 0; b < NB; b++) f.bands[i * NB + b] = clamp(f.bands[i * NB + b] / this.topBand);

    const t = this.total / FR;
    for (const [type, d] of Object.entries(this.det)) {
      const x = f[d.x][i];
      const fire = x > d.avg * 2.2 && x > d.top * 0.3 && this.total - d.last > 8;
      d.avg = d.avg * 0.97 + x * 0.03;
      d.top = Math.max(x, d.top * 0.9995);
      d.env *= d.decay;
      if (fire) {
        const h = { t, i, type, strength: clamp(x / d.top) };
        d.env = Math.max(d.env, h.strength);
        d.last = this.total;
        this.hits.push(h);
        this.byType[type].push(h);
      }
      f[type][i] = d.env;
    }

    // K-weighted energy of this hop, then 400 ms and 3 s windows over it.
    const a = end - HOP;
    const kl = this.kwL.process(this.L.subarray(a, end)), kr = this.kwR.process(this.R.subarray(a, end));
    let e = 0;
    for (let k = 0; k < HOP; k++) e += kl[k] * kl[k] + kr[k] * kr[k];
    this.energy[this.total % this.energy.length] = e / HOP;
    const mean = (frames) => {
      let s = 0;
      const c = Math.min(frames, this.total + 1, this.energy.length);
      for (let k = 0; k < c; k++) s += this.energy[(this.total - k + this.energy.length * 2) % this.energy.length];
      return s / (c || 1);
    };
    f.loudM[i] = toLufs(mean(Math.round(FR * 0.4)));
    f.loudS[i] = toLufs(mean(this.energy.length));

    this.cumNow += (0.2 + 1.4 * f.level[i] + 1.8 * f.kick[i]) / FR;
    f.cum[i] = this.cumNow;

    for (let p = 0; p < 12; p++) this.chromaAvg[p] = this.chromaAvg[p] * 0.9995 + f.chroma[i * 12 + p] * f.rms[i];
    if (this.total % 94 === 0) this.estimate();

    this.total++;
    this.n = i + 1;
  }

  estimate() {
    const kicks = this.byType.kick.slice(-24);
    if (kicks.length > 4) {
      const gaps = kicks.slice(1).map((h, k) => h.t - kicks[k].t).sort((a, b) => a - b);
      let bpm = 60 / (gaps[gaps.length >> 1] || 0.5);
      while (bpm < 75) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      this.bpm = Math.round(bpm);
    }
    const top = this.chromaAvg.indexOf(Math.max(...this.chromaAvg));
    this.key = { tonic: top, mode: '', name: `${KEY_NAMES[top]}` };
  }

  shift() {
    const keep = Math.floor(CAP / 2), drop = this.n - keep, f = this.f;
    for (const [name, arr] of Object.entries(f)) {
      const w = name === 'bands' ? NB : name === 'chroma' ? 12 : name === 'voices' ? 8 : 1;
      arr.copyWithin(0, drop * w, this.n * w);
    }
    this.n = keep;
    this.base += drop;
    const old = this.total / FR - 30;
    this.hits = this.hits.filter((h) => h.t > old);
    for (const k of Object.keys(this.byType)) this.byType[k] = this.byType[k].filter((h) => h.t > old);
  }
}
