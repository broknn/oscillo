// Measures picture-to-sound offset in a finished export, from the file itself.
// Takes the Spectrum look's bass bars as a brightness curve and the low end of the
// audio as a loudness curve, then finds the lag that lines their jumps up best.
// usage: node test/syncCheck.mjs clip.mp4
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static');
const file = process.argv[2];
const FPS = 60, RATE = 48000, perFrame = RATE / FPS;

const raw = (args) => spawnSync(ffmpeg, ['-v', 'error', '-i', file, ...args, 'pipe:1'], { maxBuffer: 1 << 30 }).stdout;

const v = raw(['-vf', 'crop=iw*0.14:ih:0:0,scale=1:1:flags=area,format=gray', '-f', 'rawvideo']);
const video = Float64Array.from(v);

const a = raw(['-af', 'lowpass=f=160,lowpass=f=160', '-ac', '1', '-ar', String(RATE), '-f', 'f32le']);
const pcm = new Float32Array(a.buffer, a.byteOffset, Math.floor(a.length / 4));
const audio = new Float64Array(video.length);
for (let f = 0; f < video.length; f++) {
  let s = 0;
  const from = Math.round(f * perFrame), to = Math.round((f + 1) * perFrame);
  for (let i = from; i < to && i < pcm.length; i++) s += pcm[i] * pcm[i];
  audio[f] = Math.sqrt(s / perFrame);
}

const rise = (x) => x.map((v2, i) => Math.max(0, i ? v2 - x[i - 1] : 0));
const rv = rise(video), ra = rise(audio);
let best = 0, top = -Infinity;
const scores = [];
for (let lag = -18; lag <= 18; lag++) {
  let s = 0;
  for (let i = 20; i < rv.length - 20; i++) s += rv[i + lag] * ra[i];
  scores.push([lag, s]);
  if (s > top) { top = s; best = lag; }
}
console.log(`frames ${video.length}, audio ${(pcm.length / RATE).toFixed(2)}s`);
console.log(`picture lags sound by ${best} frames (${((best / FPS) * 1000).toFixed(1)} ms)`);
console.log(scores.filter(([l]) => Math.abs(l - best) <= 3).map(([l, s]) => `${l}:${(s / top).toFixed(2)}`).join('  '));
