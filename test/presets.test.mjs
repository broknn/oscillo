// Presets: what they keep, what they leave alone, and files from other versions.
import { capturePreset, applyPreset, putPreset } from '../src/core/presets.js';
import { PAGES } from '../src/core/pages.js';
import { encodeShare, decodeShare, cleanShared } from '../src/core/sharecode.js';
import { LOOKS } from '../src/looks/index.js';
import { defaultScene } from '../src/core/stage.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`); if (!ok) fails++; };

const defaults = { mode: 'single', look: 'scope', cells: [], cellOpts: {}, columns: 0, free: [], autoList: [], autoBars: 4,
  palette: 'carbon', font: '', mono: '', brush: 1, motion: 1, density: 1, seed: 0, params: {}, chrome: true, transparent: false };
const known = { scope: {}, video: {}, spectrum: {} };
const mine = { bg: '#000000', fg: '#ffffff', accent: '#ff0000', colors: ['#111111', '#222222', '#333333', '#444444', '#555555'] };
const scene = {
  ...defaults, mode: 'free', palette: mine, font: 'Impact', params: { video: { chop: 1 } },
  free: [{ id: 'video', x: 0.1, y: 0.2, w: 0.3, h: 0.4, palette: 'ember' }],
  video: { name: 'clip' }, image: { id: 1 }, title: 'My song',
};

for (const page of PAGES) {
  const { free } = page.scene, ids = free.map((it) => it.id);
  check(`page ${page.name} uses real looks`, ids.every((id) => id in LOOKS), ids.join());
  check(`page ${page.name} has each look once`, new Set(ids).size === ids.length);
  check(`page ${page.name} fits`, ids.length <= 9 && free.every((it) => it.x >= 0 && it.y >= 0 && it.x + it.w <= 1.0001 && it.y + it.h <= 1.0001));
}
const shaped = capturePreset('Wide', scene, 'custom', [2560, 1080]);
check('keeps custom pixels', String(shaped.size) === '2560,1080');
check('other shapes carry no pixels', !('size' in capturePreset('Tall', scene, '9:16')));

// Share codes
{
  const defaults = defaultScene();
  const good = { ...scene, mode: 'free', free: [{ id: 'clock', x: 0.1, y: 0.2, w: 0.5, h: 0.4, outline: true, opacity: 0.5 }], params: { clock: {} } };
  const made = capturePreset('Mine', good, 'custom', [2560, 1080]);
  const code = await encodeShare(made);
  const back = await decodeShare(code, LOOKS, defaults);
  check('code keeps name, shape and layout', back.name === 'Mine' && back.aspect === 'custom' && String(back.size) === '2560,1080' && back.scene.free[0].opacity === 0.5);
  check('code survives line breaks', (await decodeShare(`${code.slice(0, 20)}\n ${code.slice(20)}`, LOOKS, defaults)).name === 'Mine');
  console.log(`  share code: ${code.length} characters`);
  const rejected = async (c) => { try { await decodeShare(c, LOOKS, defaults); return false; } catch { return true; } };
  check('rejects non-codes', await rejected('hello') && await rejected('OSC1-AAAA') && await rejected(`${code.slice(0, -12)}`));
  const hostile = cleanShared({
    name: 'x'.repeat(500), aspect: 'huge',
    scene: {
      mode: 'evil', look: 'constructor', cells: ['__proto__', 'scope', 7], autoList: 'no', palette: { bg: 'url(x)', fg: '#000000', accent: '#000000', colors: [] },
      brush: 1e9, motion: -5, density: NaN, seed: 'x', font: 5, footer: { colour: 'red', name: false },
      params: { burst: { count: 1e12, life: 'long', unknown: 1 }, constructor: { a: 1 } },
      free: [{ id: 'clock', x: -3, y: 9, w: 40, h: 'tall', evil: true }, { id: 'nope' }, ...Array(100).fill({ id: 'dots' })],
    },
  }, LOOKS, defaults).scene;
  check('hostile looks dropped', hostile.look === defaults.look && String(hostile.cells) === 'scope' && hostile.mode === defaults.mode);
  check('hostile numbers held in range', hostile.brush === 3 && hostile.motion === 0.2 && hostile.density === 1 && hostile.params.burst.count === 2000 && !('life' in hostile.params.burst) && !('unknown' in hostile.params.burst));
  check('hostile items rebuilt', hostile.free.length === 39 && hostile.free[0].x === 0 && hostile.free[0].w === 1 && !('evil' in hostile.free[0]) && !Object.hasOwn(hostile.params, 'constructor'));
  check('hostile colours refused', hostile.palette === defaults.palette && hostile.footer.colour === '' && hostile.footer.name === false);
  const bomb = await encodeShare({ name: 'x', scene: { pad: 'x'.repeat(3 << 20) } });
  check('huge codes refused', await rejected(bomb));
}

const saved = JSON.parse(JSON.stringify(capturePreset('Night', scene, '9:16')));
check('leaves the project out', !('video' in saved.scene) && !('image' in saved.scene) && !('title' in saved.scene));
check('keeps the aspect', saved.aspect === '9:16');

scene.params.video.chop = 0;
check('is a copy', capturePreset('x', { ...defaults, params: { a: 1 } }, '1:1').scene.params.a === 1 && saved.scene.params.video.chop === 1);

const target = { ...defaults, video: 'keep me', image: 'keep me too', title: 'Other song' };
applyPreset(target, saved, defaults, known);
check('restores the setup', target.mode === 'free' && target.font === 'Impact' && target.palette.bg === '#000000' && target.free[0].palette === 'ember' && target.params.video.chop === 1);
check('leaves project items alone', target.video === 'keep me' && target.image === 'keep me too' && target.title === 'Other song');
target.params.video.chop = 5;
check('loading twice starts clean', saved.scene.params.video.chop === 1);

const old = applyPreset({ ...defaults }, { name: 'old', scene: { mode: 'compose', cells: ['scope', 'gone'], cellOpts: { gone: { w: 2 } }, look: 'gone', free: [{ id: 'gone' }] } }, defaults, known);
check('drops looks it does not know', old.cells.length === 1 && !old.cellOpts.gone && old.look === 'scope' && old.free.length === 0);
check('fills in missing keys', old.palette === 'carbon' && old.brush === 1);

const a = { name: 'A', v: 1 }, b = { name: 'B', v: 2 };
check('adds a new name', putPreset([a], b).length === 2);
const replaced = putPreset([a, b], { name: 'A', v: 3 });
check('replaces in place', replaced.length === 2 && replaced[0].v === 3);

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
