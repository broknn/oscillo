// Checks the analysis against tracks with a known answer. LUFS is checked against
// FFmpeg's ebur128 meter as an independent reference.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { analyse, Analysis, KEY_NAMES } from '../src/core/analysis.js';
import { LiveAnalysis } from '../src/core/live.js';
import { parseMidi } from '../src/core/midi.js';
import { makeTrack, writeWav } from './makeTrack.mjs';
import { grooveTrack } from './grooves.mjs';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`); if (!ok) fails++; };

function score(found, truth, tol = 0.04) {
  const used = new Set();
  const errs = [];
  for (const t of truth) {
    let best = -1, d = tol;
    found.forEach((h, i) => { const e = Math.abs(h.t - t); if (e < d && !used.has(i)) { d = e; best = i; } });
    if (best >= 0) { used.add(best); errs.push(found[best].t - t); }
  }
  const recall = used.size / truth.length, precision = used.size / (found.length || 1);
  errs.sort((a, b) => a - b);
  return { recall, precision, medErrMs: (errs[errs.length >> 1] ?? 0) * 1000 };
}

const cases = [
  { bpm: 128, tonic: 57, mode: 'minor' },
  { bpm: 174, tonic: 50, mode: 'major' },
  { bpm: 92, tonic: 55, mode: 'minor' },
  { bpm: 140, tonic: 60, mode: 'major' },
];

const dir = mkdtempSync(join(tmpdir(), 'oscillo-'));
for (const c of cases) {
  const { L, R, truth } = makeTrack(c);
  const t0 = performance.now();
  const r = analyse(L, R);
  const ms = performance.now() - t0;
  const A = new Analysis(r, L, R);
  const label = `${c.bpm} ${KEY_NAMES[c.tonic % 12]} ${c.mode}`;
  console.log(`\n# ${label}: ${r.duration.toFixed(1)}s analysed in ${ms.toFixed(0)}ms`);

  check('tempo', Math.abs(r.bpm - c.bpm) < 0.6, `got ${r.bpm}`);
  check('key', r.key.tonic === c.tonic % 12 && r.key.mode === c.mode, `got ${r.key.name}`);
  for (const type of ['kick', 'snare', 'hat']) {
    const s = score(A.byType[type], truth[type]);
    check(type, s.recall > 0.9 && s.precision > 0.8,
      `recall ${s.recall.toFixed(2)} precision ${s.precision.toFixed(2)} median error ${s.medErrMs.toFixed(1)}ms`);
  }

  const wav = join(dir, 'x.wav');
  writeWav(wav, L, R);
  const out = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', wav, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const ref = parseFloat(/I:\s+(-?[\d.]+) LUFS/.exec(out.slice(out.lastIndexOf('Summary')))[1]);
  check('LUFS vs ffmpeg', Math.abs(r.lufs - ref) < 0.5, `got ${r.lufs}, ffmpeg ${ref}`);
}
void execFileSync;

// Grooves with no kick on the beat. 150 is the hard one: its beat is 37.5 frames long.
console.log('\n# Tempo over harder grooves');
for (const bpm of [150, 145, 155, 165, 110]) for (const groove of ['rock', 'halftime', 'trap', 'dembow', 'tresillo', 'shuffle', 'poly']) {
  const { L, R } = grooveTrack({ bpm, groove });
  const got = analyse(L, R).bpm;
  check(`${groove} at ${bpm}`, Math.abs(got - bpm) < 0.6, `got ${got}`);
}
{
  const { L, R } = grooveTrack({ bpm: 150, groove: 'trap' });
  const A = new Analysis(analyse(L, R), L, R);
  A.setTempo(75);
  const gaps = A.beats.slice(1, 9).map((b, k) => b - A.beats[k]);
  check('typed tempo sets the grid', A.bpm === 75 && gaps.every((g) => Math.abs(g - 0.8) < 0.012) && A.downbeats.length === Math.ceil(A.beats.length / 4) || A.downbeats.length === Math.floor(A.beats.length / 4), `${A.beats.length} beats`);
  const phase = A.beats.reduce((sum, b) => sum + Math.abs(((b - 1 + 0.4) % 0.4) - 0.2), 0) / A.beats.length;
  check('typed tempo lands on the drums', phase > 0.17, `${phase.toFixed(3)}`);
}

// The Listen path: no look-ahead, chunks of audio, run long enough to wrap its buffers.
{
  const { L, R } = makeTrack({ bpm: 128, bars: 44 });
  const live = new LiveAnalysis();
  const seen = { nan: 0, shortWave: 0 };
  for (let p = 0; p + 1024 <= L.length; p += 1024) {
    live.push(L.subarray(p, p + 1024), R.subarray(p, p + 1024));
    const i = live.idx(live.time);
    if (!Number.isFinite(live.f.loudM[i]) || !Number.isFinite(live.f.cum[i]) || Number.isNaN(live.f.bands[i * 48])) seen.nan++;
    if (live.time > 1 && live.wave(live.time, 2048).l.length < 2048) seen.shortWave++;
  }
  console.log(`\n# live: ${live.time.toFixed(1)}s, base ${live.base}, ${live.byType.kick.length} recent kicks`);
  check('live ran past its buffers', live.base > 0 && live.pcmBase > 0, `frame base ${live.base}, sample base ${live.pcmBase}`);
  check('live values stay finite', seen.nan === 0, `${seen.nan} bad frames`);
  check('live scope always has audio', seen.shortWave === 0, `${seen.shortWave} short reads`);
  check('live tempo', Math.abs(live.bpm - 128) <= 3, `got ${live.bpm}`);
}

// MIDI: a hand-built file with a tempo change mid-way, in running status.
{
  const bytes = Uint8Array.from([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0, 96,
    0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 33,
    0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20,   // 120 BPM
    0, 0x90, 60, 100,
    96, 60, 0,                            // running status, note-off as velocity 0
    0, 0xff, 0x51, 3, 0x0f, 0x42, 0x40,   // 60 BPM
    0, 0x90, 64, 80,
    96, 0x80, 64, 0,
    0, 0xff, 0x2f, 0,
  ]);
  const n = parseMidi(bytes);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  console.log('');
  check('MIDI notes and tempo change', n.length === 2 && n[0].pitch === 60 && near(n[0].dur, 0.5) && n[1].pitch === 64 && near(n[1].t, 0.5) && near(n[1].dur, 1), JSON.stringify(n.map((x) => [x.pitch, x.t, x.dur])));
}

rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
