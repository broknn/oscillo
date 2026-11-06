import { analyse, transferList } from '../core/analysis.js';

self.onmessage = ({ data: { L, R } }) => {
  const result = analyse(L, R, (p) => self.postMessage({ progress: p }));
  self.postMessage({ result, L, R }, [...transferList(result), L.buffer, R.buffer]);
};
