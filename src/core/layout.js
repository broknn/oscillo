// Lays out Compose cells on a grid, in grid units. Each cell can be wider or taller
// than one slot and can sit centred in the free space of its row. Pure, so the renderer
// and the layout editor always agree on where things are.

export function composeLayout(cells, opts = {}, W = 1, H = 1, columns = 0) {
  const want = cells.map((id) => ({
    id,
    w: Math.max(1, opts[id]?.w ?? 1),
    h: Math.max(1, opts[id]?.h ?? 1),
    center: !!opts[id]?.center,
  }));

  let cols = columns;
  if (!cols) {
    const area = Math.max(1, want.reduce((sum, c) => sum + c.w * c.h, 0));
    const wide = Math.ceil(Math.sqrt(area)), tall = Math.ceil(area / wide);
    cols = Math.max(H > W ? tall : wide, ...want.map((c) => c.w));
  }

  // Each cell takes the first gap it fits, so a big cell never strands a hole above it.
  const taken = [];
  const isFree = (y, x) => !taken[y]?.[x];
  const fits = (x, y, w, h) => {
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) if (!isFree(r, c)) return false;
    return true;
  };
  const place = (cell) => {
    const w = Math.min(cell.w, cols);
    for (let y = 0; ; y++) {
      for (let x = 0; x + w <= cols; x++) {
        if (!fits(x, y, w, cell.h)) continue;
        for (let r = y; r < y + cell.h; r++) {
          taken[r] ??= [];
          for (let c = x; c < x + w; c++) taken[r][c] = true;
        }
        return { ...cell, w, x, y };
      }
    }
  };
  const items = want.map(place);
  const rows = Math.max(1, taken.length);

  // Cells side by side in a row move together, so centring keeps them touching.
  const groupOf = (item) => {
    const row = items.filter((o) => o.y === item.y && o.h === item.h);
    const group = [item];
    for (let edge = item.x + item.w, next; (next = row.find((o) => o.x === edge)); edge += next.w) group.push(next);
    for (let edge = item.x, prev; (prev = row.find((o) => o.x + o.w === edge)); edge -= prev.w) group.unshift(prev);
    return group;
  };
  const columnFree = (x, y, h) => {
    if (x < 0 || x >= cols) return false;
    for (let r = y; r < y + h; r++) if (!isFree(r, x)) return false;
    return true;
  };

  const shifts = new Map();
  for (const item of items) {
    const group = groupOf(item);
    const { y, h, x: start } = group[0];
    const end = group[group.length - 1].x + group[group.length - 1].w;
    let left = 0, right = 0;
    while (columnFree(start - left - 1, y, h)) left++;
    while (columnFree(end + right, y, h)) right++;
    item.room = left + right > 0;
    if (item.center) for (const member of group) shifts.set(member, (right - left) / 2);
  }
  for (const [member, shift] of shifts) member.x += shift;

  return { cols, rows, items };
}
