// Text: the track title as an element of its own, so it can be placed, sized and layered.
import { num, choice } from '../core/style.js';

const title = {
  id: 'title', name: 'Title', group: 'Text', kind: 'instant',
  desc: 'Your title as an element to place anywhere',
  params: [
    choice('align', 'Align', ['Left', 'Centre', 'Right'], 0),
    num('size', 'Size', 0.3, 1.25, 0.01, 1),
  ],
  draw(g, s) {
    const { box, pal, p } = s;
    g.font = `700 100px ${s.font}`;
    const wide = Math.max(1, g.measureText(s.title).width);
    // The text follows the box, leaving room for Size to go larger and Align to show.
    const size = Math.min(box.h * 0.7, (box.w * 0.75 * 100) / wide) * p.size;
    g.font = `700 ${size}px ${s.font}`;
    g.fillStyle = pal.fg;
    g.textAlign = ['left', 'center', 'right'][p.align];
    g.fillText(s.title, box.x + (box.w * p.align) / 2, box.y + box.h / 2 + size * 0.35);
    g.textAlign = 'left';
  },
};

export default [title];
