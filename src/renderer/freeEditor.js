// Advanced mode's on-picture editor: outlines over the canvas that drag, size and snap.
import { LOOKS } from '../looks/index.js';
import { moveBox, resizeBox } from '../core/freeform.js';

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export class FreeEditor {
  constructor({ layer, canvas, scene, onChange, onSelect }) {
    Object.assign(this, { layer, canvas, scene, onChange, onSelect });
    this.selected = null;
    layer.onpointerdown = (e) => { if (e.target === layer) this.select(null); };
  }

  get items() { return this.scene().free; }
  get item() { return this.items.find((o) => o.id === this.selected) ?? null; }

  select(id) {
    this.selected = id;
    this.draw();
    this.onSelect();
  }

  // Sits exactly over the canvas, whatever size the window has made it.
  fit() {
    const c = this.canvas, s = this.layer.style;
    const place = `${c.offsetLeft}px ${c.offsetTop}px ${c.offsetWidth}px ${c.offsetHeight}px`;
    if (this.placed === place) return;
    this.placed = place;
    s.left = `${c.offsetLeft}px`; s.top = `${c.offsetTop}px`;
    s.width = `${c.offsetWidth}px`; s.height = `${c.offsetHeight}px`;
  }

  draw(guides = []) {
    this.fit();
    const nodes = this.items.map((it) => this.boxNode(it));
    for (const g of guides) {
      const line = document.createElement('i');
      line.className = `guide ${g.axis}`;
      line.style[g.axis === 'x' ? 'left' : 'top'] = `${g.at * 100}%`;
      nodes.push(line);
    }
    this.layer.replaceChildren(...nodes);
  }

  boxNode(it) {
    const node = document.createElement('div');
    node.className = `freebox${it.id === this.selected ? ' on' : ''}`;
    node.dataset.id = it.id;
    this.position(node, it);
    const label = document.createElement('span');
    label.textContent = LOOKS[it.id]?.name ?? it.id;
    node.append(label);
    node.onpointerdown = (e) => this.drag(e, it, null);
    if (it.id === this.selected) {
      for (const h of HANDLES) {
        const grip = document.createElement('b');
        grip.className = `grip ${h}`;
        grip.dataset.handle = h;
        grip.onpointerdown = (e) => { e.stopPropagation(); this.drag(e, it, h); };
        node.append(grip);
      }
    }
    return node;
  }

  position(node, b) {
    Object.assign(node.style, { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
  }

  drag(down, it, handle) {
    down.preventDefault();
    if (this.selected !== it.id) this.select(it.id);
    const node = this.layer.querySelector(`.freebox[data-id="${it.id}"]`);
    const others = this.items.filter((o) => o !== it);
    const rect = this.layer.getBoundingClientRect(), start = { x: it.x, y: it.y, w: it.w, h: it.h };
    const lazy = LOOKS[it.id]?.kind === 'sheet';
    let moved = false, latest = start, guides = [];

    const move = (e) => {
      const dx = (e.clientX - down.clientX) / rect.width, dy = (e.clientY - down.clientY) / rect.height;
      moved ||= Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) > 2;
      if (!moved) return;
      const snap = !e.altKey;
      const shape = e.shiftKey ? start.w / start.h : 0;
      const r = handle ? resizeBox(start, handle, dx, dy, others, snap, shape) : moveBox(start, dx, dy, others, snap);
      latest = r.box; guides = r.guides;
      this.position(node, latest);
      this.layer.querySelectorAll('.guide').forEach((g) => g.remove());
      for (const g of guides) {
        const line = document.createElement('i');
        line.className = `guide ${g.axis}`;
        line.style[g.axis === 'x' ? 'left' : 'top'] = `${g.at * 100}%`;
        this.layer.append(line);
      }
      // A sheet look redraws from the start of the track at each new size, so it waits for the drop.
      if (!lazy) Object.assign(it, latest);
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      Object.assign(it, latest);
      this.draw();
      if (moved) this.onChange();
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }
}
