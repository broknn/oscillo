// Advanced mode: looks placed freely on the page. Boxes are fractions of the page, so one
// arrangement carries across every shape and size. Pure, so it can be tested in Node.

// Puts a look where another one is. A look can only be on the page once, so if the new
// one is already there, the two trade places.
export function replaceItem(items, from, to) {
  const a = items.find((it) => it.id === from), b = items.find((it) => it.id === to);
  if (!a || from === to) return;
  a.id = to;
  if (b) b.id = from;
}

export function replaceCell(cells, opts, from, to) {
  const a = cells.indexOf(from), b = cells.indexOf(to);
  if (a < 0 || from === to) return;
  cells[a] = to;
  if (b >= 0) cells[b] = from;
  const [mine, theirs] = [opts[from], opts[to]];
  delete opts[from]; delete opts[to];
  if (mine) opts[to] = mine;
  if (theirs && b >= 0) opts[from] = theirs;
}

export const MIN_SIZE = 0.05;
const SNAP = 0.012;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const inPage = (box) => {
  const w = clamp(box.w, MIN_SIZE, 1), h = clamp(box.h, MIN_SIZE, 1);
  return { ...box, w, h, x: clamp(box.x, 0, 1 - w), y: clamp(box.y, 0, 1 - h) };
};

// Lines worth snapping to: the page edges and centre, then every other element's.
function linesOf(others, near, far) {
  const lines = [0, 0.5, 1];
  for (const o of others) lines.push(o[near], o[near] + o[far] / 2, o[near] + o[far]);
  return lines;
}

// The smallest shift bringing any of `points` onto a line, with the line it found.
function closest(points, lines, reach) {
  let best = null;
  for (const line of lines) for (const point of points) {
    const shift = line - point;
    if (Math.abs(shift) <= reach && (!best || Math.abs(shift) < Math.abs(best.shift))) best = { shift, line };
  }
  return best;
}

export function moveBox(box, dx, dy, others = [], snap = true) {
  const next = inPage({ ...box, x: box.x + dx, y: box.y + dy });
  const guides = [];
  if (!snap) return { box: next, guides };
  const sx = closest([next.x, next.x + next.w / 2, next.x + next.w], linesOf(others, 'x', 'w'), SNAP);
  const sy = closest([next.y, next.y + next.h / 2, next.y + next.h], linesOf(others, 'y', 'h'), SNAP);
  if (sx) { next.x += sx.shift; guides.push({ axis: 'x', at: sx.line }); }
  if (sy) { next.y += sy.shift; guides.push({ axis: 'y', at: sy.line }); }
  return { box: inPage(next), guides };
}

// handle is any of n, s, e, w, ne, nw, se, sw. Each edge moves on its own and the opposite
// edge stays put, even at the size limit.
export function resizeBox(box, handle, dx, dy, others = [], snap = true, aspect = 0) {
  let left = box.x, top = box.y, right = box.x + box.w, bottom = box.y + box.h;
  const guides = [];
  const edge = (value, lo, hi, axis, near, far) => {
    let at = clamp(value, lo, hi);
    if (snap) {
      const hit = closest([at], linesOf(others, near, far), SNAP);
      if (hit && hit.line >= lo && hit.line <= hi) { at = hit.line; guides.push({ axis, at }); }
    }
    return at;
  };
  if (handle.includes('w')) left = edge(left + dx, 0, right - MIN_SIZE, 'x', 'x', 'w');
  if (handle.includes('e')) right = edge(right + dx, left + MIN_SIZE, 1, 'x', 'x', 'w');
  if (handle.includes('n')) top = edge(top + dy, 0, bottom - MIN_SIZE, 'y', 'y', 'h');
  if (handle.includes('s')) bottom = edge(bottom + dy, top + MIN_SIZE, 1, 'y', 'y', 'h');

  // Keep the shape on a corner drag: height follows width, within the page.
  if (aspect && handle.length === 2) {
    const room = handle.includes('n') ? bottom : 1 - top;
    const w = Math.min(right - left, room * aspect), h = w / aspect;
    if (handle.includes('w')) left = right - w; else right = left + w;
    if (handle.includes('n')) top = bottom - h; else bottom = top + h;
    guides.length = 0;
  }
  return { box: { ...box, x: left, y: top, w: right - left, h: bottom - top }, guides };
}

export function dropIn(count) {
  const step = 0.04 * (count % 6);
  return { x: 0.3 + step, y: 0.3 + step, w: 0.4, h: 0.4 };
}
