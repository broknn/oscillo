// Records the small subset of canvas calls the looks use and writes it out as SVG,
// so a printed page stays vector at poster size. Looks flagged svg:false use pixels.

const n = (v) => +v.toFixed(2);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export class SvgContext {
  constructor(w, h, background) {
    this.w = w; this.h = h;
    this.parts = [];
    this.defs = [];
    this.gid = 0;
    this.m = [1, 0, 0, 1, 0, 0];
    this.stack = [];
    this.open = 0;
    this.state = { strokeStyle: '#000', fillStyle: '#000', lineWidth: 1, globalAlpha: 1, lineCap: 'butt', lineJoin: 'miter', font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', globalCompositeOperation: 'source-over' };
    Object.assign(this, this.state);
    this.d = '';
    if (background) this.parts.push(`<rect width="${w}" height="${h}" fill="${background}"/>`);
    this.canvas = { width: w, height: h };
  }

  pt(x, y) {
    const m = this.m;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  save() {
    const copy = {};
    for (const k of Object.keys(this.state)) copy[k] = this[k];
    this.stack.push({ copy, m: this.m.slice(), open: this.open });
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    Object.assign(this, s.copy);
    this.m = s.m;
    for (; this.open > s.open; this.open--) this.parts.push('</g>');
  }
  translate(x, y) { const m = this.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; }
  scale(x, y) { const m = this.m; m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; }
  rotate(a) {
    const m = this.m, c = Math.cos(a), s = Math.sin(a);
    const [a0, b0, c0, d0] = m;
    m[0] = a0 * c + c0 * s; m[1] = b0 * c + d0 * s;
    m[2] = c0 * c - a0 * s; m[3] = d0 * c - b0 * s;
  }

  beginPath() { this.d = ''; }
  moveTo(x, y) { const [a, b] = this.pt(x, y); this.d += `M${n(a)} ${n(b)}`; }
  lineTo(x, y) { const [a, b] = this.pt(x, y); this.d += `L${n(a)} ${n(b)}`; }
  quadraticCurveTo(cx, cy, x, y) {
    const [a, b] = this.pt(cx, cy), [c, d] = this.pt(x, y);
    this.d += `Q${n(a)} ${n(b)} ${n(c)} ${n(d)}`;
  }
  closePath() { this.d += 'Z'; }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  arc(cx, cy, r, a0, a1, ccw) {
    let span = a1 - a0;
    if (ccw) span = -Math.abs(span);
    const steps = Math.max(8, Math.ceil(Math.abs(span) / 0.2));
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps, x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      if (i || this.d) this.lineTo(x, y); else this.moveTo(x, y);
    }
  }
  ellipse(cx, cy, rx, ry, rot, a0, a1) {
    for (let i = 0; i <= 40; i++) {
      const a = a0 + ((a1 - a0) * i) / 40;
      const x = rx * Math.cos(a), y = ry * Math.sin(a);
      const X = cx + x * Math.cos(rot) - y * Math.sin(rot), Y = cy + x * Math.sin(rot) + y * Math.cos(rot);
      if (i) this.lineTo(X, Y); else this.moveTo(X, Y);
    }
  }
  clip() {
    const id = `c${this.gid++}`, d = this.d;
    this.defs.push({ emit: () => `<clipPath id="${id}"><path d="${d}"/></clipPath>` });
    this.parts.push(`<g clip-path="url(#${id})">`);
    this.open++;
  }
  clearRect() {}

  paint(kind) {
    if (!this.d) return;
    const attr = kind === 'fill'
      ? `fill="${this.colour(this.fillStyle)}"`
      : `fill="none" stroke="${this.colour(this.strokeStyle)}" stroke-width="${n(this.lineWidth)}"${this.lineCap !== 'butt' ? ` stroke-linecap="${this.lineCap}"` : ''}${this.lineJoin !== 'miter' ? ` stroke-linejoin="${this.lineJoin}"` : ''}`;
    const op = this.globalAlpha < 1 ? ` opacity="${n(this.globalAlpha)}"` : '';
    this.parts.push(`<path d="${this.d}" ${attr}${op}/>`);
  }
  stroke() { this.paint('stroke'); }
  fill() { this.paint('fill'); }
  fillRect(x, y, w, h) { const d = this.d; this.d = ''; this.rect(x, y, w, h); this.paint('fill'); this.d = d; }
  strokeRect(x, y, w, h) { const d = this.d; this.d = ''; this.rect(x, y, w, h); this.paint('stroke'); this.d = d; }

  colour(c) { return typeof c === 'string' ? c : `url(#${c.id})`; }
  gradient(tag, attrs) {
    const id = `g${this.gid++}`, stops = [];
    const def = { id, addColorStop: (o, c) => stops.push(`<stop offset="${n(o)}" stop-color="${c}"/>`) };
    def.emit = () => `<${tag} id="${id}" gradientUnits="userSpaceOnUse" ${attrs}>${stops.join('')}</${tag}>`;
    this.defs.push(def);
    return def;
  }
  createLinearGradient(x0, y0, x1, y1) { return this.gradient('linearGradient', `x1="${n(x0)}" y1="${n(y0)}" x2="${n(x1)}" y2="${n(y1)}"`); }
  createRadialGradient(x0, y0, r0, x1, y1, r1) { return this.gradient('radialGradient', `cx="${n(x1)}" cy="${n(y1)}" r="${n(r1)}"`); }

  measureText(t) { return { width: String(t).length * parseFloat(/([\d.]+)px/.exec(this.font)?.[1] ?? 10) * 0.55 }; }
  fillText(t, x, y) {
    const [a, b] = this.pt(x, y);
    const size = parseFloat(/([\d.]+)px/.exec(this.font)?.[1] ?? 10);
    const family = this.font.slice(this.font.indexOf('px') + 2).trim().replace(/"/g, "'");
    const weight = /^(\d{3})/.exec(this.font)?.[1] ?? 400;
    const anchor = { left: 'start', center: 'middle', right: 'end' }[this.textAlign] ?? 'start';
    this.parts.push(`<text x="${n(a)}" y="${n(b)}" font-size="${n(size)}" font-weight="${weight}" font-family="${family}" fill="${this.colour(this.fillStyle)}" text-anchor="${anchor}" xml:space="preserve">${esc(t)}</text>`);
  }

  toString() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}"><defs>${this.defs.map((d) => d.emit()).join('')}</defs>${this.parts.join('')}${'</g>'.repeat(this.open)}</svg>`;
  }
}
