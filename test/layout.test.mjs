// Compose layout: the cases that decide where cells land.
import { composeLayout } from '../src/core/layout.js';

let fails = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`); if (!ok) fails++; };
const spots = (r) => r.items.map((i) => `${i.id}@${i.x},${i.y} ${i.w}x${i.h}`).join(' | ');
const five = ['a', 'b', 'c', 'd', 'e'];
const TALL = [1080, 1920], WIDE = [1920, 1080];

// The automatic grid has to stay what it was before cells could be resized.
for (const [n, size, cols, rows] of [[1, WIDE, 1, 1], [2, WIDE, 2, 1], [2, TALL, 1, 2], [4, WIDE, 2, 2], [6, WIDE, 3, 2], [6, TALL, 2, 3], [9, WIDE, 3, 3]]) {
  const r = composeLayout(Array.from({ length: n }, (_, i) => `c${i}`), {}, ...size);
  check(`auto grid, ${n} cells at ${size.join('x')}`, r.cols === cols && r.rows === rows, `${r.cols}x${r.rows}`);
}
check('no cells is safe', composeLayout([], {}, ...WIDE).rows === 1, 'one empty row');

const plain = composeLayout(five, {}, ...TALL);
check('five on a tall page leave one alone', plain.cols === 2 && plain.rows === 3 && plain.items[4].x === 0, spots(plain));

const middle = composeLayout(five, { c: { w: 2 } }, ...TALL);
check('wide cell fills its row', middle.rows === 3 && middle.items[2].x === 0 && middle.items[2].y === 1 && middle.items[2].w === 2, spots(middle));

const late = composeLayout(['a', 'b', 'c'], { b: { w: 2 } }, ...TALL);
check('later cell backfills the gap a wide cell skipped', late.items[2].x === 1 && late.items[2].y === 0, spots(late));

const lone = composeLayout(five, { e: { center: true } }, ...TALL);
check('lone cell centres in its row', lone.items[4].x === 0.5 && lone.items[4].room, spots(lone));

const three = composeLayout(['a', 'b', 'c', 'd', 'e'], { d: { center: true } }, 1000, 1000, 3);
check('neighbours centre together', three.items[3].x === 0.5 && three.items[4].x === 1.5, spots(three));

const full = composeLayout(five, { a: { center: true } }, ...TALL);
check('full row has nothing to centre in', full.items[0].x === 0 && !full.items[0].room, spots(full));

const narrow = composeLayout(five, { a: { w: 3 } }, 1080, 1920, 2);
check('fixed columns cap the width', narrow.cols === 2 && narrow.items[0].w === 2, spots(narrow));

const auto = composeLayout(['a', 'b'], { a: { w: 3 } }, ...TALL);
check('automatic columns grow to fit a wide cell', auto.cols === 3 && auto.items[0].w === 3, spots(auto));

const tall = composeLayout(five, { a: { h: 2 } }, ...TALL);
const seen = new Set();
let overlap = false;
for (const i of tall.items) for (let r = i.y; r < i.y + i.h; r++) for (let c = i.x; c < i.x + i.w; c++) {
  if (seen.has(`${r},${c}`)) overlap = true;
  seen.add(`${r},${c}`);
}
check('tall cell, nothing overlaps', !overlap && tall.items[0].h === 2, spots(tall));

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
