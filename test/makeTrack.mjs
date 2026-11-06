import { writeFileSync } from 'node:fs';
import { makeTrack } from '../src/core/demo.js';

export { makeTrack };
const SR = 48000;

export function writeWav(path, L, R) {
  const n = L.length, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  const c = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) { b.writeInt16LE(c(L[i]), 44 + i * 4); b.writeInt16LE(c(R[i]), 46 + i * 4); }
  writeFileSync(path, b);
}

if (process.argv[2]) {
  const { L, R, truth } = makeTrack();
  writeWav(process.argv[2], L, R);
  console.log(JSON.stringify({ bpm: truth.bpm, kicks: truth.kick.length }));
}
