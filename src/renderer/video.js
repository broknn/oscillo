// Footage held as a folder of frames, so any frame can be reached instantly and exactly.
// Pictures are decoded on demand and the most recently used ones are kept in memory.

const KEEP = 150, BUSY = 12;

export class VideoSource {
  constructor(info) {
    Object.assign(this, info);       // { name, base, frames, fps }
    this.duration = this.frames / this.fps;
    this.id = this.base;
    this.cache = new Map();
    this.pending = new Map();
  }

  async open() {
    const first = await this.load(0);
    this.w = first.width; this.h = first.height;
    return this;
  }

  url(i) { return `${this.base}${String(i + 1).padStart(6, '0')}.jpg`; }

  load(i) {
    if (this.cache.has(i)) return Promise.resolve(this.cache.get(i));
    if (this.pending.has(i)) return this.pending.get(i);
    const job = fetch(this.url(i)).then((r) => r.blob()).then((b) => createImageBitmap(b)).then((bmp) => {
      this.pending.delete(i);
      if (this.closed) { bmp.close(); throw new Error('Video was replaced'); }
      this.cache.set(i, bmp);
      for (const [old, picture] of this.cache) {
        if (this.cache.size <= KEEP) break;
        picture.close();
        this.cache.delete(old);
      }
      return bmp;
    });
    this.pending.set(i, job);
    return job;
  }

  // For a preview that can't wait: fetch ahead when there's capacity to.
  want(i) { if (this.pending.size < BUSY && !this.cache.has(i)) this.load(i).catch(() => {}); }

  ready(list) { return Promise.all(list.map((i) => this.load(i))); }

  // The exact frame, or for a preview still catching up, the closest one in memory.
  frame(i) {
    const exact = this.cache.get(i);
    if (exact) {
      this.cache.delete(i); this.cache.set(i, exact);
      return exact;
    }
    let best = null, gap = Infinity;
    for (const [k, picture] of this.cache) {
      const d = Math.abs(k - i);
      if (d < gap) { gap = d; best = picture; }
    }
    return best;
  }

  close() {
    this.closed = true;
    for (const picture of this.cache.values()) picture.close();
    this.cache.clear();
  }
}
