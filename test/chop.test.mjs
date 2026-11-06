// Beat Chop: bars, time patterns, gates and the frames a Video look asks for.
import { barAt, chopAt, footagePlan, TIME_PATTERNS, GATE_PATTERNS } from '../src/core/chop.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`); if (!ok) fails++; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) < e;
const index = (list, label) => list.findIndex((x) => x.label === label);
const T = (label) => index(TIME_PATTERNS, label), G = (label) => index(GATE_PATTERNS, label);

// 120 BPM: a bar every 2 seconds, with the first downbeat at 0.5.
const A = { bpm: 120, downbeats: Array.from({ length: 40 }, (_, k) => 0.5 + k * 2) };
const video = { duration: 10, frames: 300, fps: 30 };
const base = { chop: 1, time: 0, gate: 0, every: 2, soft: 0, dissolve: 0, blend: 0, offset: 0, speed: 1 };

check('bar found', barAt(A, 3.1).index === 1 && near(barAt(A, 3.1).start, 2.5));
check('before the first downbeat', barAt(A, 0.1).index === -1 && near(barAt(A, 0.1).start, -1.5));
check('after the last downbeat', barAt(A, 90).start > 78.5 && barAt(A, 90).start <= 90);
check('no beat grid still works', Number.isFinite(barAt({ bpm: 0 }, 5).start));

const drift = { bpm: 120, downbeats: [0, 2, 5] };
check('bars follow tempo drift', near(barAt(drift, 3).len, 3));

check('straight is untouched', near(chopAt(A, 3.33, { time: T('Straight') }).time, 3.33));
check('half time', near(chopAt(A, 1.5, { time: T('Half time') }).time, 1));
check('hold beat repeats the beat', near(chopAt(A, 1.1, { time: T('Hold beat') }).time, chopAt(A, 0.6, { time: T('Hold beat') }).time));
check('reverse runs backwards', chopAt(A, 1.0, { time: T('Reverse') }).time > chopAt(A, 1.2, { time: T('Reverse') }).time);
check('freeze holds', near(chopAt(A, 2.0, { time: T('Freeze') }).time, chopAt(A, 2.3, { time: T('Freeze') }).time));
check('last bar echo reads the bar before', chopAt(A, 4.0, { time: T('Last bar echo') }).time < 2.5);

let bad = 0;
for (let p = 0; p < TIME_PATTERNS.length; p++) for (let g = 0; g < GATE_PATTERNS.length; g++) for (let t = -1; t < 30; t += 0.137) {
  const r = chopAt(A, t, { time: p, gate: g, soft: 0.1 });
  if (!Number.isFinite(r.time) || !(r.gate >= 0 && r.gate <= 1)) bad++;
}
check('every pattern stays finite, gate in range', bad === 0, `${bad} bad`);

const mix = { time: T('Mix'), every: 2, seed: 4 };
const sameBars = [2.6, 3.4, 4.2, 4.4].map((t) => chopAt(A, t, { ...mix }).time);
check('mix is repeatable', chopAt(A, 3.4, mix).time === chopAt(A, 3.4, mix).time, sameBars.map((x) => x.toFixed(2)).join(' '));
const seen = new Set();
for (let bar = 0; bar < 40; bar++) seen.add(chopAt(A, 0.5 + bar * 2 + 1.13, mix).time.toFixed(3));
check('mix moves through several patterns', seen.size > 8, `${seen.size} results`);

const only = { ...mix, mix: [T('Freeze'), T('Reverse')] };
let strays = 0;
for (let t = 0.5; t < 40; t += 0.17) {
  const got = chopAt(A, t, only).time;
  if (got !== chopAt(A, t, { time: T('Freeze') }).time && got !== chopAt(A, t, { time: T('Reverse') }).time) strays++;
}
check('mix only uses the chosen patterns', strays === 0, `${strays} strays`);
const usedBoth = new Set();
for (let bar = 0; bar < 40; bar += 2) usedBoth.add(chopAt(A, 0.5 + bar * 2 + 0.3, only).time === chopAt(A, 0.5 + bar * 2 + 0.3, { time: T('Freeze') }).time);
check('mix moves between the chosen patterns', usedBoth.size === 2);
check('one chosen pattern is just that pattern', chopAt(A, 3.3, { ...mix, mix: [T('Half time')] }).time === chopAt(A, 3.3, { time: T('Half time') }).time);
check('nothing chosen plays straight', chopAt(A, 3.3, { ...mix, mix: [] }).time === 3.3);
const allPatterns = TIME_PATTERNS.map((_, k) => k).slice(1, -1);
check('every pattern chosen matches the default', chopAt(A, 3.3, { ...mix, mix: allPatterns }).time === chopAt(A, 3.3, mix).time);

const eighths = { gate: G('Eighths') };
check('gate on the beat', chopAt(A, 0.5, eighths).gate === 1);
check('gate off the eighth', chopAt(A, 0.8, eighths).gate === 0);
check('softness ramps the gate', chopAt(A, 0.76, { ...eighths, soft: 0.2 }).gate > 0 && chopAt(A, 0.76, { ...eighths, soft: 0.2 }).gate < 1);
check('gate off stays open', chopAt(A, 0.8, { gate: 0 }).gate === 1);

const plain = footagePlan(A, 3, { ...base, chop: 0 }, 0, video);
check('plain footage plays straight', plain.layers[0].frame === 90 && plain.gate === 1, JSON.stringify(plain.layers));
check('footage loops', footagePlan(A, 13, { ...base, chop: 0 }, 0, video).layers[0].frame === 90);
check('start offset and speed', footagePlan(A, 2, { ...base, chop: 0, offset: 1, speed: 2 }, 0, video).layers[0].frame === 150);
check('negative song time wraps', footagePlan(A, 0.6, { ...base, time: T('Last bar echo') }, 0, video).layers[0].frame >= 0);
check('blend adds the next frame', footagePlan(A, 3.01, { ...base, chop: 0, blend: 1 }, 0, video).layers.length === 2);

const jump = 0.5 + 1 / 4 + 0.03;   // just after a stutter jumps back
const fade = footagePlan(A, jump, { ...base, time: T('Eighth stutter'), dissolve: 0.3 }, 0, video);
check('dissolve crossfades a jump', fade.layers.length === 2 && fade.layers[1].alpha > 0 && fade.layers[1].alpha < 1, JSON.stringify(fade.layers));
const smooth = footagePlan(A, 1.1, { ...base, dissolve: 0.3 }, 0, video);
check('no jump, no dissolve', smooth.layers.length === 1);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
