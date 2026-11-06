// Standard MIDI File reader. Returns timed notes, honouring tempo changes.

export function parseMidi(buffer) {
  const d = new DataView(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength);
  let p = 0;
  const str = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(p++)); return s; };
  const u32 = () => { const v = d.getUint32(p); p += 4; return v; };
  const u16 = () => { const v = d.getUint16(p); p += 2; return v; };
  const vlq = () => { let v = 0, b; do { b = d.getUint8(p++); v = (v << 7) | (b & 127); } while (b & 128); return v; };

  if (str(4) !== 'MThd') throw new Error('Not a MIDI file');
  const hdr = u32();
  u16();
  const tracks = u16(), division = u16();
  p += hdr - 6;
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported');

  const events = [];
  const tempos = [{ tick: 0, us: 500000 }];
  for (let tr = 0; tr < tracks && p < d.byteLength; tr++) {
    if (str(4) !== 'MTrk') break;
    const len = u32(), end = Math.min(d.byteLength, p + len);
    let tick = 0, status = 0;
    while (p < end) {
      tick += vlq();
      let b = d.getUint8(p);
      if (b & 0x80) { status = b; p++; }
      const type = status & 0xf0;
      if (status === 0xff) {
        const meta = d.getUint8(p++), n = vlq();
        if (meta === 0x51 && n === 3) tempos.push({ tick, us: (d.getUint8(p) << 16) | (d.getUint8(p + 1) << 8) | d.getUint8(p + 2) });
        p += n;
      } else if (status === 0xf0 || status === 0xf7) {
        p += vlq();
      } else if (type === 0x80 || type === 0x90 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
        const a = d.getUint8(p++), v = d.getUint8(p++);
        if (type === 0x90 && v > 0) events.push({ tick, on: true, pitch: a, vel: v / 127, track: tr, ch: status & 15 });
        else if (type === 0x80 || type === 0x90) events.push({ tick, on: false, pitch: a, track: tr, ch: status & 15 });
      } else if (type === 0xc0 || type === 0xd0) p++;
    }
    p = end;
  }

  tempos.sort((a, b) => a.tick - b.tick);
  const seconds = (tick) => {
    let t = 0, last = 0, us = tempos[0].us;
    for (const e of tempos) {
      if (e.tick >= tick) break;
      t += ((e.tick - last) * us) / division / 1e6;
      last = e.tick; us = e.us;
    }
    return t + ((tick - last) * us) / division / 1e6;
  };

  events.sort((a, b) => a.tick - b.tick || (a.on ? 1 : -1));
  const open = new Map(), notes = [];
  for (const e of events) {
    const k = `${e.track}:${e.ch}:${e.pitch}`;
    if (e.on) {
      (open.get(k) ?? open.set(k, []).get(k)).push(e);
    } else {
      const s = open.get(k)?.shift();
      if (s) notes.push({ t: seconds(s.tick), dur: Math.max(0.02, seconds(e.tick) - seconds(s.tick)), pitch: e.pitch, vel: s.vel, track: e.track });
    }
  }
  return notes.sort((a, b) => a.t - b.t);
}
