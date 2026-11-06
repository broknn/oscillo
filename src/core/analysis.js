// The analysis pass. A whole track is worked through once, and every picture is
// then a pure function of what comes out of here: same track, same picture.
import { FFT, hann, KWeight, hzToMidi, clamp, percentile } from './dsp.js';

export const SR = 48000;      // fixed, so BS.1770 coefficients are exact
export const HOP = 512;
export const WIN = 2048;
export const LONG = 8192;
export const FR = SR / HOP;   // analysis frames per second
export const NB = 48;         // log-spaced spectrum bands
export const NV = 4;          // melodic voices tracked above the bass
const LONG_EVERY = 4;
const ONSET_LAG = 2;

export const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const FIELDS = ['rms', 'peak', 'rmsL', 'rmsR', 'corr', 'centroid', 'flux', 'fluxK', 'fluxS', 'fluxH', 'fluxM', 'bass', 'bassAmp', 'loudM', 'loudS', 'kick', 'snare', 'hat', 'level'];

export function allocFrames(cap) {
  const f = {};
  for (const k of FIELDS) f[k] = new Float32Array(cap);
  f.bands = new Float32Array(cap * NB);
  f.chroma = new Float32Array(cap * 12);
  f.voices = new Float32Array(cap * NV * 2);
  f.cum = new Float64Array(cap);
  return f;
}

// Per-frame feature extraction. Causal, so offline and live share it exactly.
export class Extractor {
  constructor() {
    this.fft = new FFT(WIN);
    this.fftLong = new FFT(LONG);
    this.win = hann(WIN);
    this.winLong = hann(LONG);
    this.mid = new Float64Array(WIN);
    this.midLong = new Float64Array(LONG);
    this.mag = new Float64Array(WIN / 2);
    this.magLong = new Float64Array(LONG / 2);
    this.log = [];
    for (let i = 0; i <= ONSET_LAG; i++) this.log.push(new Float32Array(WIN / 2));
    const binHz = SR / WIN;
    this.edges = [];
    const lo = 30, hi = 18000;
    for (let b = 0; b < NB; b++) {
      const a = lo * Math.pow(hi / lo, b / NB), c = lo * Math.pow(hi / lo, (b + 1) / NB);
      const i0 = Math.max(1, Math.floor(a / binHz));
      this.edges.push([i0, Math.max(i0 + 1, Math.ceil(c / binHz))]);
    }
    this.kBins = [Math.round(30 / binHz), Math.round(130 / binHz)];
    this.mBins = [Math.round(140 / binHz), Math.round(600 / binHz)];
    this.sBins = [Math.round(1500 / binHz), Math.round(6000 / binHz)];
    this.hBins = [Math.round(8000 / binHz), Math.round(18000 / binHz)];
    this.slots = new Float32Array(NV * 2);
    this.heldChroma = new Float32Array(12);
    this.heldBass = 0; this.heldBassAmp = 0;
    this.count = 0;
    this.pcBin = new Int8Array(LONG / 2).fill(-1);
    for (let i = 1; i < LONG / 2; i++) {
      const hz = (i * SR) / LONG;
      if (hz >= 80 && hz <= 4000) this.pcBin[i] = ((Math.round(hzToMidi(hz)) % 12) + 12) % 12;
    }
  }

  // Analyses the window ending at sample `end` of L/R into frame i of f.
  frame(f, i, L, R, end) {
    const { mid, win, mag, fft } = this;
    const gain = 4 / WIN;
    let sumL = 0, sumR = 0, sumLR = 0, pk = 0;
    for (let k = 0; k < WIN; k++) {
      const p = end - WIN + k;
      const l = p >= 0 && p < L.length ? L[p] : 0;
      const r = p >= 0 && p < R.length ? R[p] : 0;
      mid[k] = 0.5 * (l + r) * win[k];
      if (k >= WIN - HOP) {
        sumL += l * l; sumR += r * r; sumLR += l * r;
        const a = Math.abs(l) > Math.abs(r) ? Math.abs(l) : Math.abs(r);
        if (a > pk) pk = a;
      }
    }
    fft.magnitude(mid, mag);

    f.rmsL[i] = Math.sqrt(sumL / HOP);
    f.rmsR[i] = Math.sqrt(sumR / HOP);
    f.rms[i] = Math.sqrt((sumL + sumR) / (2 * HOP));
    f.peak[i] = pk;
    f.corr[i] = sumL > 1e-9 && sumR > 1e-9 ? sumLR / Math.sqrt(sumL * sumR) : 0;

    let cn = 0, cd = 0;
    const log = this.log.pop();
    const old = this.log[this.log.length - 1 - (ONSET_LAG - 1)] ?? this.log[0];
    let all = 0, fk = 0, fs = 0, fh = 0, fm = 0;
    const [k0, k1] = this.kBins, [m0, m1] = this.mBins, [s0, s1] = this.sBins, [h0, h1] = this.hBins;
    for (let b = 0; b < WIN / 2; b++) {
      const m = mag[b] * gain;
      const lv = Math.log1p(m * 300);
      log[b] = lv;
      const d = lv - old[b];
      if (d > 0) {
        all += d;
        if (b >= k0 && b < k1) fk += d;
        else if (b >= m0 && b < m1) fm += d;
        else if (b >= s0 && b < s1) fs += d;
        else if (b >= h0 && b < h1) fh += d;
      }
      cn += m * Math.log2(1 + b); cd += m;
    }
    this.log.unshift(log);
    f.flux[i] = all;
    f.fluxK[i] = fk / (k1 - k0);
    f.fluxM[i] = fm / (m1 - m0);
    f.fluxS[i] = fs / (s1 - s0);
    f.fluxH[i] = fh / (h1 - h0);
    f.centroid[i] = cd > 1e-6 ? clamp((cn / cd) / 10) : 0;

    const bi = i * NB;
    for (let b = 0; b < NB; b++) {
      const [e0, e1] = this.edges[b];
      let s = 0;
      for (let k = e0; k < e1 && k < WIN / 2; k++) s += mag[k] * mag[k];
      const db = 10 * Math.log10(s * gain * gain + 1e-12);
      f.bands[bi + b] = clamp((db + 70) / 70);
    }

    if (this.count % LONG_EVERY === 0) this.longFrame(L, R, end);
    this.count++;
    f.chroma.set(this.heldChroma, i * 12);
    f.voices.set(this.slots, i * NV * 2);
    f.bass[i] = this.heldBass;
    f.bassAmp[i] = this.heldBassAmp;
  }

  longFrame(L, R, end) {
    const { midLong, winLong, magLong, fftLong, pcBin } = this;
    const gain = 4 / LONG;
    for (let k = 0; k < LONG; k++) {
      const p = end - LONG + k;
      const l = p >= 0 && p < L.length ? L[p] : 0;
      const r = p >= 0 && p < R.length ? R[p] : 0;
      midLong[k] = 0.5 * (l + r) * winLong[k];
    }
    fftLong.magnitude(midLong, magLong);
    const ch = this.heldChroma;
    ch.fill(0);
    let bestBass = 0, bestBin = 0;
    const peaks = [];
    const toBin = (hz) => Math.round((hz * LONG) / SR);
    const b0 = toBin(35), b1 = toBin(250), b2 = toBin(4000);
    for (let k = 2; k < b2; k++) {
      const m = magLong[k] * gain;
      if (pcBin[k] >= 0) ch[pcBin[k]] += m * m;
      if (m < 0.0025 || m < magLong[k - 1] * gain || m < magLong[k + 1] * gain) continue;
      if (k >= b0 && k < b1 && m > bestBass) { bestBass = m; bestBin = k; }
      if (k >= b1) peaks.push({ k, m });
    }
    let top = 0;
    for (let c = 0; c < 12; c++) { ch[c] = Math.sqrt(ch[c]); if (ch[c] > top) top = ch[c]; }
    if (top > 1e-5) for (let c = 0; c < 12; c++) ch[c] /= top;

    const refine = (k) => {
      const a = magLong[k - 1], b = magLong[k], c = magLong[k + 1];
      const d = a - 2 * b + c;
      return ((k + (d ? (0.5 * (a - c)) / d : 0)) * SR) / LONG;
    };
    if (bestBin) { this.heldBass = hzToMidi(refine(bestBin)); this.heldBassAmp = clamp(bestBass * 4); }
    else this.heldBassAmp = 0;

    peaks.sort((a, b) => b.m - a.m);
    const picked = [];
    for (const p of peaks.slice(0, 16)) {
      const hz = refine(p.k);
      // A quiet peak on a multiple of a louder one is an overtone, not a voice.
      const harmonic = picked.some((q) => {
        const r = hz / q.hz, n = Math.round(r);
        return n >= 2 && n <= 8 && Math.abs(r - n) < 0.03 * n && p.m < q.m * 0.7;
      });
      if (!harmonic) picked.push({ hz, m: p.m, midi: hzToMidi(hz) });
      if (picked.length === NV) break;
    }
    const s = this.slots, free = [];
    const used = new Set();
    for (let v = 0; v < NV; v++) {
      if (s[v * 2 + 1] <= 0) { free.push(v); continue; }
      let best = -1, dist = 1.5;
      picked.forEach((p, j) => {
        if (used.has(j)) return;
        const d = Math.abs(p.midi - s[v * 2]);
        if (d < dist) { dist = d; best = j; }
      });
      if (best >= 0) {
        used.add(best);
        s[v * 2] = picked[best].midi;
        s[v * 2 + 1] = clamp(picked[best].m * 6);
      } else { s[v * 2 + 1] = 0; free.push(v); }
    }
    picked.forEach((p, j) => {
      if (used.has(j) || !free.length) return;
      const v = free.shift();
      s[v * 2] = p.midi;
      s[v * 2 + 1] = clamp(p.m * 6);
    });
  }
}

function pickPeaks(x, n, { mult, floor, gap }) {
  const out = [];
  let last = -1e9;
  for (let i = 3; i < n - 3; i++) {
    const v = x[i];
    if (v < floor) continue;
    let isMax = true;
    for (let k = -3; k <= 3 && isMax; k++) if (x[i + k] > v) isMax = false;
    if (!isMax) continue;
    let sum = 0, c = 0;
    for (let k = Math.max(0, i - 28); k < Math.min(n, i + 8); k++) { sum += x[k]; c++; }
    if (v < (sum / c) * mult) continue;
    if (i - last < gap) continue;
    out.push(i);
    last = i;
  }
  return out;
}

const TEMPO_MIN = 58, TEMPO_MAX = 200;

function detectHits(f, n) {
  const hits = [];
  const specs = [
    { type: 'kick', x: f.fluxK, mult: 1.6, floorP: 0.25, gap: 8 },
    { type: 'snare', x: f.fluxS, mult: 1.7, floorP: 0.3, gap: 10 },
    { type: 'hat', x: f.fluxH, mult: 1.5, floorP: 0.25, gap: 6 },
  ];
  const tops = {};
  for (const s of specs) {
    const top = percentile(s.x.subarray(0, n), 0.995) || 1;
    tops[s.type] = top;
    for (const i of pickPeaks(s.x, n, { mult: s.mult, floor: top * s.floorP, gap: s.gap })) {
      hits.push({ t: i / FR, i, type: s.type, strength: clamp(s.x[i] / top) });
    }
  }
  hits.sort((a, b) => a.t - b.t);
  // A bass note and a kick both jump in the sub band, but a kick is a pitch sweep,
  // so it also lights up the low mids. Bass notes barely do.
  const punch = (h) => {
    let m = 0;
    for (let k = -3; k <= 3; k++) m = Math.max(m, f.fluxM[h.i + k] ?? 0);
    return m;
  };
  const lows = hits.filter((h) => h.type === 'kick').map(punch).sort((a, b) => a - b);
  const punchFloor = (lows[Math.floor(lows.length * 0.9)] ?? 0) * 0.45;
  // Broadband kicks spill into the snare band. Drop a snare that sits on a kick
  // unless it is strong for a snare.
  const kicks = hits.filter((h) => h.type === 'kick');
  let ki = 0;
  const kept = hits.filter((h) => {
    if (h.type === 'kick') return punch(h) >= punchFloor;
    if (h.type !== 'snare') return true;
    while (ki < kicks.length - 1 && kicks[ki].t < h.t - 0.03) ki++;
    const near = kicks[ki] && Math.abs(kicks[ki].t - h.t) < 0.03;
    return !near || h.strength > 0.55;
  });
  return kept;
}

function fillEnvelopes(f, n, hits) {
  const taus = { kick: 0.13, snare: 0.16, hat: 0.05 };
  for (const type of Object.keys(taus)) {
    const env = f[type], decay = Math.exp(-1 / (FR * taus[type]));
    const list = hits.filter((h) => h.type === type);
    let e = 0, h = 0;
    for (let i = 0; i < n; i++) {
      e *= decay;
      while (h < list.length && list[h].i <= i) { e = Math.max(e, list[h].strength); h++; }
      env[i] = e;
    }
  }
}

// Onset strength as a z-score, softened so a peak falling between two frames still counts.
function onsetCurve(src, n) {
  const x = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    x[i] = 0.25 * (src[i - 1] ?? src[i]) + 0.5 * src[i] + 0.25 * (src[i + 1] ?? src[i]);
    mean += x[i];
  }
  mean /= n || 1;
  let sd = 0;
  for (let i = 0; i < n; i++) { x[i] -= mean; sd += x[i] * x[i]; }
  sd = Math.sqrt(sd / (n || 1)) || 1;
  for (let i = 0; i < n; i++) x[i] /= sd;
  return x;
}

// Beats and bars repeat, so score a tempo on every level of that pattern. Periods are
// fractional: at 150 BPM a beat is 37.5 frames, which whole-frame lags can't see.
function tempoComb(x, n) {
  const span = Math.min(n, Math.round(FR * 120));
  const offset = Math.max(0, Math.floor((n - span) / 2));
  const maxLag = Math.min(span - 1, Math.ceil(((FR * 60) / TEMPO_MIN) * 16) + 1);
  const ac = new Float32Array(maxLag + 2);
  for (let lag = 0; lag <= maxLag; lag++) {
    let s = 0;
    const stop = offset + span - lag;
    for (let i = offset; i < stop; i++) s += x[i] * x[i + lag];
    ac[lag] = s / Math.max(1, span - lag);
  }
  const at = (lag) => {
    if (lag > maxLag) return 0;
    const i = Math.floor(lag), mix = lag - i;
    return ac[i] * (1 - mix) + ac[i + 1] * mix;
  };
  let best = 120, top = -Infinity;
  for (let bpm = TEMPO_MIN; bpm <= TEMPO_MAX; bpm += 0.25) {
    const P = (FR * 60) / bpm;
    const s = at(P) + 0.8 * at(P * 2) + at(P * 4) + 0.8 * at(P * 8) + 0.5 * at(P * 16);
    if (s > top) { top = s; best = bpm; }
  }
  return best;
}

// How much drum weight sits halfway between beats, against on them. Hats don't count:
// sixteenth hats over a slow groove don't make it fast, but a backbeat there does.
function offbeatRatio(y, n, bpm) {
  const P = (FR * 60) / bpm, bins = Math.max(8, Math.round(P)), fold = new Float32Array(bins);
  for (let i = 0; i < n; i++) if (y[i] > 0) fold[Math.floor(((i % P) / P) * bins) % bins] += y[i];
  const near = (k) => fold[(k + bins - 1) % bins] + fold[k % bins] + fold[(k + 1) % bins];
  let on = 0, at = 0;
  for (let k = 0; k < bins; k++) if (near(k) > on) { on = near(k); at = k; }
  return on > 0 ? near(at + (bins >> 1)) / on : 0;
}

function pickOctave(f, n, bpm) {
  let tempo = bpm;
  while (tempo >= 120) tempo /= 2;
  while (tempo < 60) tempo *= 2;
  const kick = onsetCurve(f.fluxK, n), snare = onsetCurve(f.fluxS, n);
  const y = kick.map((v, i) => Math.max(v, snare[i]));
  // Very slow readings are usually a half-time feel, so they need less proof to double.
  const faster = () => (tempo < 85
    ? Math.max(offbeatRatio(y, n, tempo), offbeatRatio(kick, n, tempo)) > 0.1
    : offbeatRatio(y, n, tempo) > 0.6);
  while (tempo * 2 <= TEMPO_MAX && faster()) tempo *= 2;
  return tempo;
}

function barPhase(f, frames) {
  let bestPhase = 0, top = -Infinity;
  for (let ph = 0; ph < 4; ph++) {
    let s = 0;
    frames.forEach((b, k) => { if (k % 4 === ph) s += f.kick[b] - f.snare[b]; });
    if (s > top) { top = s; bestPhase = ph; }
  }
  return bestPhase;
}

const gridFrom = (f, bpm, frames) => {
  const phase = barPhase(f, frames);
  return {
    bpm: Math.round(bpm * 10) / 10,
    beats: frames.map((b) => b / FR),
    downbeats: frames.filter((_, k) => k % 4 === phase).map((b) => b / FR),
  };
};

// Beats sit on whole frames, so their spacing can't give a precise tempo. A steady pulse laid
// across the whole track can: over minutes, even 0.1 BPM off slides out of line with the drums.
function steadyTempo(x, n, heard) {
  let best = heard, top = -Infinity;
  for (let bpm = heard * 0.985; bpm <= heard * 1.015; bpm += 0.02) {
    const P = (FR * 60) / bpm, bins = Math.ceil(P), fold = new Float32Array(bins);
    for (let i = 0; i < n; i++) fold[Math.floor(((i % P) / P) * bins)] += Math.max(0, x[i]);
    for (let k = 0; k < bins; k++) if (fold[k] > top) { top = fold[k]; best = bpm; }
  }
  return Math.abs(best - Math.round(best)) < 0.2 ? Math.round(best) : best;
}

function detectTempo(f, n) {
  const x = onsetCurve(f.flux, n);
  const heard = pickOctave(f, n, tempoComb(x, n));
  const P = (FR * 60) / heard;

  // Dynamic-programming beat tracker: prefers strong onsets at the right spacing,
  // and may lean a little with the band but can't skip a beat.
  const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
  const near = Math.round(P * 0.8), far = Math.round(P * 1.25), tight = 40;
  for (let i = 0; i < n; i++) {
    let top = 0, from = -1;
    for (let j = i - far; j <= i - near; j++) {
      if (j < 0) continue;
      const pen = Math.log((i - j) / P);
      const v = score[j] - tight * pen * pen;
      if (v > top) { top = v; from = j; }
    }
    score[i] = Math.max(0, x[i]) + top;
    back[i] = from;
  }
  let end = 0;
  for (let i = Math.max(0, Math.floor(n - P * 2)); i < n; i++) if (score[i] > score[end]) end = i;
  const beatFrames = [];
  for (let i = end; i >= 0; i = back[i]) beatFrames.push(i);
  beatFrames.reverse();

  const bpm = steadyTempo(x, n, heard);
  return gridFrom(f, bpm, beatFrames);
}

// A steady grid at a tempo the user gave, lined up with the strongest run of onsets.
export function gridAt(f, n, bpm) {
  const x = onsetCurve(f.flux, n), P = (FR * 60) / bpm;
  let best = 0, top = -Infinity;
  for (let start = 0; start < P; start++) {
    let s = 0;
    for (let at = start; at < n; at += P) s += x[Math.round(at)] ?? 0;
    if (s > top) { top = s; best = start; }
  }
  const frames = [];
  for (let at = best; at < n; at += P) frames.push(Math.round(at));
  return gridFrom(f, bpm, frames);
}

function detectKey(f, n) {
  const c = new Float64Array(12);
  for (let i = 0; i < n; i += 4) {
    const w = f.rms[i];
    for (let p = 0; p < 12; p++) c[p] += f.chroma[i * 12 + p] * w;
  }
  const pearson = (a, prof, rot) => {
    let ma = 0, mb = 0;
    for (let i = 0; i < 12; i++) { ma += a[i]; mb += prof[i]; }
    ma /= 12; mb /= 12;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < 12; i++) {
      const x = a[(i + rot) % 12] - ma, y = prof[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    return num / (Math.sqrt(da * db) || 1);
  };
  let best = -2, tonic = 0, mode = 'major';
  for (let r = 0; r < 12; r++) {
    const a = pearson(c, MAJOR, r), b = pearson(c, MINOR, r);
    if (a > best) { best = a; tonic = r; mode = 'major'; }
    if (b > best) { best = b; tonic = r; mode = 'minor'; }
  }
  // A key and its relative share all their notes, so their scores are nearly equal
  // on many progressions. Settle a close call on where the track's harmony opens.
  const rel = mode === 'major' ? (tonic + 9) % 12 : (tonic + 3) % 12;
  const relMode = mode === 'major' ? 'minor' : 'major';
  const relScore = pearson(c, relMode === 'major' ? MAJOR : MINOR, rel);
  if (best - relScore < 0.2) {
    const open = new Float64Array(12);
    let heard = 0;
    for (let i = 0; i < n && heard < FR * 2; i++) {
      if (f.rms[i] < 0.01) continue;
      heard++;
      for (let p = 0; p < 12; p++) open[p] += f.chroma[i * 12 + p];
    }
    const a = open[tonic] + open[(tonic + 7) % 12];
    const b = open[rel] + open[(rel + 7) % 12];
    if (b > a) { tonic = rel; mode = relMode; best = relScore; }
  }
  return { tonic, mode, name: `${KEY_NAMES[tonic]} ${mode}`, strength: best };
}

function loudness(L, R, f, n) {
  const kl = new KWeight().process(L), kr = new KWeight().process(R);
  const pre = new Float64Array(L.length + 1);
  for (let i = 0; i < L.length; i++) pre[i + 1] = pre[i] + kl[i] * kl[i] + kr[i] * kr[i];
  const toLufs = (e) => (e > 1e-12 ? -0.691 + 10 * Math.log10(e) : -120);
  const win = (a, b) => (pre[Math.min(L.length, b)] - pre[Math.max(0, a)]) / Math.max(1, b - a);
  const m = Math.round(SR * 0.4), s = Math.round(SR * 3);
  for (let i = 0; i < n; i++) {
    const end = i * HOP;
    f.loudM[i] = toLufs(win(end - m, end));
    f.loudS[i] = toLufs(win(end - s, end));
  }
  const blocks = [];
  for (let p = 0; p + m <= L.length; p += Math.round(SR * 0.1)) {
    const e = win(p, p + m);
    if (toLufs(e) > -70) blocks.push(e);
  }
  if (!blocks.length) return -120;
  const avg = blocks.reduce((a, b) => a + b, 0) / blocks.length;
  const gate = toLufs(avg) - 10;
  const kept = blocks.filter((e) => toLufs(e) > gate);
  return Math.round(toLufs(kept.reduce((a, b) => a + b, 0) / (kept.length || 1)) * 10) / 10;
}

function findSections(f, downbeats, duration) {
  if (downbeats.length < 8) return [0];
  const bars = [];
  for (let d = 0; d < downbeats.length; d++) {
    const a = Math.round(downbeats[d] * FR), b = Math.round((downbeats[d + 1] ?? duration) * FR);
    const v = new Float32Array(8);
    for (let i = a; i < b; i += 4) for (let k = 0; k < NB; k++) v[k >> 3] += f.bands[i * NB + k] ?? 0;
    const norm = Math.hypot(...v) || 1;
    bars.push(v.map((x) => x / norm));
  }
  const dist = bars.map((v, i) => (i ? v.reduce((s, x, k) => s + Math.abs(x - bars[i - 1][k]), 0) : 0));
  const avg = dist.reduce((a, b) => a + b, 0) / dist.length;
  const sd = Math.sqrt(dist.reduce((a, b) => a + (b - avg) ** 2, 0) / dist.length);
  const out = [0];
  let last = 0;
  dist.forEach((d, i) => { if (d > avg + 1.2 * sd && i - last >= 4) { out.push(downbeats[i]); last = i; } });
  return out;
}

function overview(L, R, cols = 1600) {
  const o = new Float32Array(cols * 2);
  const step = L.length / cols;
  for (let c = 0; c < cols; c++) {
    let lo = 0, hi = 0;
    const a = Math.floor(c * step), b = Math.min(L.length, Math.floor((c + 1) * step));
    for (let i = a; i < b; i += 7) {
      const v = 0.5 * (L[i] + R[i]);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    o[c * 2] = lo; o[c * 2 + 1] = hi;
  }
  return o;
}

export function notesFromVoices(f, n) {
  const notes = [];
  const track = (pitchAt, ampAt) => {
    let cur = null;
    const flush = (end) => {
      if (cur && end - cur.t > 0.06) notes.push({ t: cur.t, dur: end - cur.t, pitch: cur.pitch, vel: clamp(cur.vel), track: 0 });
      cur = null;
    };
    for (let i = 0; i < n; i += 2) {
      const a = ampAt(i), p = Math.round(pitchAt(i)), t = i / FR;
      if (a < 0.06) { flush(t); continue; }
      if (cur && Math.abs(cur.pitch - p) >= 1) flush(t);
      if (!cur) cur = { t, pitch: p, vel: a };
      cur.vel = Math.max(cur.vel, a);
    }
    flush(n / FR);
  };
  track((i) => f.bass[i], (i) => f.bassAmp[i]);
  for (let v = 0; v < NV; v++) track((i) => f.voices[i * NV * 2 + v * 2], (i) => f.voices[i * NV * 2 + v * 2 + 1]);
  return notes.sort((a, b) => a.t - b.t);
}

export function analyse(L, R, onProgress) {
  const n = Math.max(1, Math.ceil(L.length / HOP));
  const f = allocFrames(n);
  const ex = new Extractor();
  for (let i = 0; i < n; i++) {
    ex.frame(f, i, L, R, i * HOP + WIN / 2);
    if (onProgress && i % 2000 === 0) onProgress((0.8 * i) / n);
  }
  const duration = L.length / SR;

  const hits = detectHits(f, n);
  fillEnvelopes(f, n, hits);
  onProgress?.(0.85);
  const { bpm, beats, downbeats } = detectTempo(f, n);
  onProgress?.(0.92);
  const key = detectKey(f, n);
  const lufs = loudness(L, R, f, n);

  let pk = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.abs(L[i]), b = Math.abs(R[i]);
    if (a > pk) pk = a;
    if (b > pk) pk = b;
  }
  const peakDb = pk > 0 ? Math.round(20 * Math.log10(pk) * 10) / 10 : -120;

  // Normalise the display curves to the track, so a quiet master still fills a page.
  const topRms = percentile(f.rms.subarray(0, n), 0.99) || 1;
  const topBand = percentile(f.bands.subarray(0, n * NB), 0.995) || 1;
  for (let i = 0; i < n; i++) f.level[i] = clamp(f.rms[i] / topRms);
  for (let i = 0; i < n * NB; i++) f.bands[i] = clamp(f.bands[i] / topBand);

  // Everything that moves uses this clock: it runs faster when the track is loud
  // and jumps on the kick, and any moment on it can be reached without simulation.
  let c = 0;
  for (let i = 0; i < n; i++) {
    c += (0.2 + 1.4 * f.level[i] + 1.8 * f.kick[i]) / FR;
    f.cum[i] = c;
  }

  let hash = 2166136261;
  for (let i = 0; i < n; i += 37) hash = Math.imul(hash ^ Math.round(f.bands[i * NB + 12] * 4095), 16777619);

  return {
    n, duration, sr: SR, f, hits, bpm, beats, downbeats, key, lufs, peakDb,
    sections: findSections(f, downbeats, duration),
    overview: overview(L, R),
    seed: hash >>> 0,
  };
}

export function transferList(result) {
  const buffers = [];
  for (const v of Object.values(result.f)) buffers.push(v.buffer);
  buffers.push(result.overview.buffer);
  return buffers;
}

// The read side every look uses. Offline tracks and the Listen window both are one.
export class Analysis {
  constructor(data, L, R) {
    Object.assign(this, data);
    this.L = L; this.R = R;
    this.base = 0;
    this.pcmBase = 0;
    this.byType = { kick: [], snare: [], hat: [] };
    for (const h of this.hits ?? []) this.byType[h.type].push(h);
    this.notes ??= notesFromVoices(this.f, this.n);
    this.hasMidi ??= false;
  }

  // The track's tempo as the user knows it. Only the beat grid changes.
  setTempo(bpm) { Object.assign(this, gridAt(this.f, this.n, bpm)); }

  idx(t) {
    const i = Math.round(t * FR) - this.base;
    return i < 0 ? 0 : i >= this.n ? this.n - 1 : i;
  }

  val(name, t) { return this.f[name][this.idx(t)]; }
  bandsAt(i) { return this.f.bands.subarray(i * NB, (i + 1) * NB); }
  chromaAt(i) { return this.f.chroma.subarray(i * 12, (i + 1) * 12); }

  // Average band value over a coarse group, for looks that want fewer lanes.
  bandGroup(i, g, groups) {
    const a = Math.floor((g * NB) / groups), b = Math.floor(((g + 1) * NB) / groups);
    let s = 0;
    for (let k = a; k < b; k++) s += this.f.bands[i * NB + k];
    return s / (b - a);
  }

  wave(t, len) {
    const end = Math.round(t * SR) - this.pcmBase;
    const a = Math.max(0, end - len), b = Math.max(a, Math.min(this.L.length, end));
    return { l: this.L.subarray(a, b), r: this.R.subarray(a, b) };
  }

  // Steady on-beat position: phase in [0,1) and which beat of the bar it is.
  beatAt(t) {
    const b = this.beats ?? [];
    if (b.length < 2) return { phase: (t * 2) % 1, beat: Math.floor(t * 2) % 4 };
    let lo = 0, hi = b.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (b[m] <= t) lo = m; else hi = m - 1; }
    const next = b[lo + 1] ?? b[lo] + (b[lo] - b[lo - 1]);
    return { phase: clamp((t - b[lo]) / (next - b[lo] || 1), 0, 0.9999), beat: lo % 4 };
  }

  hitsBetween(a, b, type) {
    const list = type ? this.byType[type] : this.hits;
    const out = [];
    let lo = 0, hi = list.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].t < a) lo = m + 1; else hi = m; }
    for (let i = lo; i < list.length && list[i].t <= b; i++) out.push(list[i]);
    return out;
  }
}
