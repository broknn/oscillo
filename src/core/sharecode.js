// Share codes: a preset as text, small enough to paste into a chat. A code comes from
// someone else, so nothing in it is trusted: it is size limited, and rebuilt field by field
// with every number held to the range the app itself allows.
import { PALETTES } from './style.js';

const PREFIX = 'OSC1-';
const MAX_CODE = 200_000, MAX_JSON = 1 << 20;
const MODES = ['single', 'compose', 'auto', 'free'];
const ASPECTS = ['16:9', '9:16', '1:1', '4:5', 'custom'];
const FOOTER_PARTS = ['bpm', 'key', 'lufs', 'name', 'time', 'length'];
const HEX = /^#[0-9a-f]{6}$/i;

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const text = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

async function collect(stream) {
  const parts = [];
  let size = 0;
  for (const reader = stream.getReader(); ;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_JSON) { await reader.cancel(); throw new Error('too large'); }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const through = (bytes, transform) => collect(new Blob([bytes]).stream().pipeThrough(transform));

function toText(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromText(s) {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function encodeShare(preset) {
  const json = new TextEncoder().encode(JSON.stringify(preset));
  return PREFIX + toText(await through(json, new CompressionStream('deflate-raw')));
}

function cleanPalette(v, fallback) {
  if (typeof v === 'string') return Object.hasOwn(PALETTES, v) ? v : fallback;
  if (!isObject(v) || ![v.bg, v.fg, v.accent].every((c) => HEX.test(c)) || !Array.isArray(v.colors)) return fallback;
  const colors = v.colors.filter((c) => HEX.test(c)).slice(0, 16);
  return colors.length ? { bg: v.bg, fg: v.fg, accent: v.accent, colors } : fallback;
}

function cleanItem(it, known) {
  if (!isObject(it) || !Object.hasOwn(known, it.id)) return null;
  const out = {
    id: it.id, x: clamp(it.x, 0, 1, 0), y: clamp(it.y, 0, 1, 0),
    w: clamp(it.w, 0.01, 1, 0.3), h: clamp(it.h, 0.01, 1, 0.3),
  };
  const palette = cleanPalette(it.palette);
  if (palette) out.palette = palette;
  if (it.fill !== undefined) out.fill = it.fill ? 1 : 0;
  if (it.outline) out.outline = true;
  if (it.mono) out.mono = text(it.mono);
  if (Number.isFinite(it.opacity)) out.opacity = clamp(it.opacity, 0, 1);
  return out;
}

function cleanCellOpts(v, known) {
  const out = {};
  if (!isObject(v)) return out;
  for (const id of Object.keys(v)) {
    const o = v[id];
    if (!Object.hasOwn(known, id) || !isObject(o)) continue;
    out[id] = {};
    if (Number.isFinite(o.w)) out[id].w = clamp(o.w, 1, 12);
    if (Number.isFinite(o.h)) out[id].h = clamp(o.h, 1, 12);
    if (o.center) out[id].center = true;
    if (Number.isFinite(o.opacity)) out[id].opacity = clamp(o.opacity, 0, 1);
    const palette = cleanPalette(o.palette);
    if (palette) out[id].palette = palette;
    if (o.fill !== undefined) out[id].fill = o.fill ? 1 : 0;
    if (o.mono) out[id].mono = text(o.mono);
  }
  return out;
}

function cleanParam(def, v) {
  if (def.type === 'picks') {
    if (!Array.isArray(v)) return undefined;
    const list = [...new Set(v.filter((n) => Number.isInteger(n) && n >= 0 && n < def.options.length))];
    return list.length ? list : undefined;
  }
  if (!Number.isFinite(v)) return undefined;
  const n = clamp(v, def.min, def.max);
  return def.type ? Math.round(n) : n;
}

function cleanParams(v, known) {
  const out = {};
  if (!isObject(v)) return out;
  for (const id of Object.keys(v)) {
    if (!Object.hasOwn(known, id) || !isObject(v[id])) continue;
    const mine = {};
    for (const def of known[id].params ?? []) {
      if (!Object.hasOwn(v[id], def.id)) continue;
      const value = cleanParam(def, v[id][def.id]);
      if (value !== undefined) mine[def.id] = value;
    }
    out[id] = mine;
  }
  return out;
}

function cleanFooter(v, fallback) {
  if (!isObject(v)) return { ...fallback };
  const out = { font: text(v.font), colour: HEX.test(v.colour) ? v.colour : '' };
  for (const part of FOOTER_PARTS) out[part] = v[part] !== false;
  return out;
}

const looksIn = (v, known, fallback) => (Array.isArray(v) ? v.filter((id) => Object.hasOwn(known, id)).slice(0, 16) : fallback);

// Rebuilds a preset from a code's contents; anything unrecognised takes its default.
export function cleanShared(raw, known, defaults) {
  if (!isObject(raw) || !isObject(raw.scene)) throw new Error('no setup in this code');
  const s = raw.scene;
  const aspect = ASPECTS.includes(raw.aspect) ? raw.aspect : '16:9';
  const hasSize = aspect === 'custom' && Array.isArray(raw.size) && raw.size.every(Number.isFinite);
  return {
    name: text(raw.name, 60).trim() || 'Shared setup',
    aspect,
    ...(hasSize && { size: raw.size.slice(0, 2) }),
    scene: {
      mode: MODES.includes(s.mode) ? s.mode : defaults.mode,
      look: Object.hasOwn(known, s.look) ? s.look : defaults.look,
      cells: looksIn(s.cells, known, defaults.cells),
      cellOpts: cleanCellOpts(s.cellOpts, known),
      columns: Math.round(clamp(s.columns, 0, 8, 0)),
      free: Array.isArray(s.free) ? s.free.slice(0, 40).map((it) => cleanItem(it, known)).filter(Boolean) : [],
      autoList: looksIn(s.autoList, known, defaults.autoList),
      autoBars: Math.round(clamp(s.autoBars, 1, 64, defaults.autoBars)),
      palette: cleanPalette(s.palette, defaults.palette),
      font: text(s.font), mono: text(s.mono),
      brush: clamp(s.brush, 0.3, 3, 1), motion: clamp(s.motion, 0.2, 3, 1), density: clamp(s.density, 0.3, 2, 1),
      seed: Math.round(clamp(s.seed, 0, 1e9, 0)),
      params: cleanParams(s.params, known),
      chrome: s.chrome !== false, labels: s.labels !== false, transparent: s.transparent === true,
      footer: cleanFooter(s.footer, defaults.footer),
    },
  };
}

export async function decodeShare(code, known, defaults) {
  const body = String(code).replace(/\s+/g, '');
  if (!body.startsWith(PREFIX) || body.length > MAX_CODE) throw new Error('not a share code');
  const json = await through(fromText(body.slice(PREFIX.length)), new DecompressionStream('deflate-raw'));
  return cleanShared(JSON.parse(new TextDecoder().decode(json)), known, defaults);
}
