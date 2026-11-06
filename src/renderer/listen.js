import { LiveAnalysis } from '../core/live.js';
import { Stage, defaultScene } from '../core/stage.js';
import { LOOK_LIST } from '../looks/index.js';
import { PALETTES } from '../core/style.js';
import { SR } from '../core/analysis.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c'), g = canvas.getContext('2d');
const A = new LiveAnalysis();
const stage = new Stage();
const scene = { ...defaultScene(), look: 'spectrum', chrome: false, title: 'Listening' };

// Sheet pens need a known length and note looks need the whole file.
const usable = LOOK_LIST.filter((l) => l.kind === 'instant' && l.group !== 'MIDI' && !l.offline);
for (const l of usable) $('look').add(new Option(l.name, l.id));
for (const p of Object.values(PALETTES)) $('palette').add(new Option(p.label, p.id));
try {
  const saved = JSON.parse(localStorage.getItem('listen') ?? '{}');
  if (saved.look && usable.some((l) => l.id === saved.look)) scene.look = saved.look;
  if (saved.palette && PALETTES[saved.palette]) scene.palette = saved.palette;
} catch { /* the defaults are fine */ }
$('look').value = scene.look;
$('palette').value = scene.palette;
const remember = () => { try { localStorage.setItem('listen', JSON.stringify({ look: scene.look, palette: scene.palette })); } catch {} };
$('look').onchange = (e) => { scene.look = e.target.value; remember(); };
$('palette').onchange = (e) => { scene.palette = e.target.value; remember(); };
$('close').onclick = () => window.sp.closeListen();

let heard = 0;

async function start() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  const tracks = stream.getAudioTracks();
  if (!tracks.length) throw new Error('No system audio was offered');
  const ctx = new AudioContext({ sampleRate: SR });
  const src = ctx.createMediaStreamSource(new MediaStream(tracks));
  const proc = ctx.createScriptProcessor(1024, 2, 2);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
  proc.onaudioprocess = (e) => {
    const l = e.inputBuffer.getChannelData(0), r = e.inputBuffer.getChannelData(1);
    for (let i = 0; i < l.length; i += 16) if (Math.abs(l[i]) > 1e-4) { heard = performance.now(); break; }
    A.push(l, r);
  };
  await ctx.resume();
  window.__listen = { A, ctx, heardAt: () => heard };
}

function frame() {
  requestAnimationFrame(frame);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  stage.render(g, w, h, A, A.time, scene);
  $('msg').style.display = performance.now() - heard < 3000 ? 'none' : 'flex';
  const m = A.f.loudM[A.n - 1];
  $('readout').textContent = `${A.bpm ? `${A.bpm} BPM  ` : ''}${A.key ? `${A.key.name}  ` : ''}${m > -70 ? `${m.toFixed(1)} LUFS` : ''}`;
}

start().catch((e) => { $('msg').textContent = `Could not capture sound: ${e.message}`; heard = -1e9; window.__listenError = e.message; });
requestAnimationFrame(frame);
