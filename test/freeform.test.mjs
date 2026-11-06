// Advanced mode: moving, sizing and snapping, all in fractions of the page.
import { moveBox, resizeBox, inPage, replaceItem, replaceCell, MIN_SIZE } from '../src/core/freeform.js';
import { History } from '../src/core/history.js';

let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}  ${detail}`); if (!ok) fails++; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const box = { id: 'a', x: 0.2, y: 0.2, w: 0.3, h: 0.3 };

const free = moveBox(box, 0.137, 0.111, [], false).box;
check('move without snapping', near(free.x, 0.337) && near(free.y, 0.311));
check('move stays in the page', moveBox(box, 2, -2, [], false).box.x === 0.7 && moveBox(box, 2, -2, [], false).box.y === 0);
check('keeps its id', moveBox(box, 0.1, 0.1).box.id === 'a');

const centred = moveBox(box, 0.145, 0, [], true);
check('snaps to the page centre', near(centred.box.x + centred.box.w / 2, 0.5) && centred.guides.some((g) => g.axis === 'x' && g.at === 0.5), JSON.stringify(centred.box));
const beside = moveBox(box, 0.203, 0.3, [{ x: 0.7, y: 0.1, w: 0.2, h: 0.2 }], true);
check('snaps to another element', near(beside.box.x + beside.box.w, 0.7), JSON.stringify(beside.box));

const se = resizeBox(box, 'se', 0.1, 0.05, [], false).box;
check('corner sizes both ways', near(se.w, 0.4) && near(se.h, 0.35) && se.x === 0.2 && se.y === 0.2);
const nw = resizeBox(box, 'nw', 0.1, 0.1, [], false).box;
check('far corner stays put', near(nw.x + nw.w, 0.5) && near(nw.y + nw.h, 0.5) && near(nw.w, 0.2));
const e = resizeBox(box, 'e', 0.1, 0.2, [], false).box;
check('side handle moves one edge', near(e.w, 0.4) && near(e.h, 0.3));
const tiny = resizeBox(box, 'w', 5, 0, [], false).box;
check('stops at the smallest size', near(tiny.w, MIN_SIZE) && near(tiny.x + tiny.w, 0.5));
const wide = resizeBox(box, 'e', 5, 0, [], false).box;
check('stops at the page edge', near(wide.x + wide.w, 1));
const toEdge = resizeBox(box, 'e', 0.492, 0, [], true);
check('edge snaps to the page', near(toEdge.box.x + toEdge.box.w, 1) && toEdge.guides.length === 1);

const kept = resizeBox(box, 'se', 0.3, 0.05, [], false, 1).box;
check('Shift keeps the shape', near(kept.w, kept.h) && near(kept.w, 0.6), JSON.stringify(kept));
const capped = resizeBox(box, 'ne', 0.6, 0, [], false, 1).box;
check('kept shape stays in the page', capped.y >= 0 && capped.x + capped.w <= 1 + 1e-9 && near(capped.y + capped.h, 0.5), JSON.stringify(capped));

check('inPage repairs a bad box', inPage({ x: -1, y: 2, w: 3, h: 0 }).w === 1 && inPage({ x: -1, y: 2, w: 3, h: 0 }).h === MIN_SIZE);

{
  const items = [{ id: 'a', x: 1 }, { id: 'b', x: 2 }];
  replaceItem(items, 'a', 'c');
  check('replace keeps the spot', items[0].id === 'c' && items[0].x === 1);
  replaceItem(items, 'c', 'b');
  check('replace with a placed look trades', items[0].id === 'b' && items[1].id === 'c' && items[0].x === 1);
  const cells = ['a', 'b'], opts = { a: { w: 2 }, b: { h: 3 } };
  replaceCell(cells, opts, 'a', 'c');
  check('cell replace keeps its size', cells[0] === 'c' && opts.c.w === 2 && !opts.a);
  replaceCell(cells, opts, 'c', 'b');
  check('cell replace trades sizes', String(cells) === 'b,c' && opts.b.w === 2 && opts.c.h === 3);

  const h = new History('1');
  check('same snapshot is no change', !h.note('1'));
  h.note('2'); h.note('3');
  check('undo steps back', h.undo() === '2' && h.undo() === '1' && h.undo() === null);
  check('redo steps forward', h.redo() === '2');
  h.note('9');
  check('a new change ends redo', h.redo() === null && h.undo() === '2');
  const short = new History(0, 2);
  for (let i = 1; i < 6; i++) short.note(i);
  check('history is limited', short.undo() === 4 && short.undo() === 3 && short.undo() === null);
}

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
