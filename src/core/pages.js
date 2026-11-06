// Ready-made pages: Advanced layouts in the same form as a saved preset, for a tall format.
const part = (id, x, y, w, h, more = {}) => ({ id, x, y, w, h, ...more });
const ruled = { outline: true };
const page = (name, palette, free, params = {}) => ({ name, aspect: '9:16', scene: { mode: 'free', palette, chrome: false, free, params } });

export const PAGES = [
  page('Score sheet', 'paper', [
    part('title', 0.06, 0.03, 0.5, 0.07), part('comet', 0, 0.1, 1, 0.54),
    part('roll', 0.05, 0.66, 0.9, 0.23, ruled), part('tape', 0.05, 0.91, 0.9, 0.05),
  ], { roll: { page: 1 } }),
  page('Instrument board', 'paper', [
    part('title', 0.05, 0.025, 0.42, 0.05), part('clock', 0.56, 0.02, 0.39, 0.22),
    part('dots', 0.05, 0.09, 0.48, 0.15, ruled), part('roll', 0.05, 0.26, 0.9, 0.24, ruled),
    part('scope', 0.05, 0.52, 0.44, 0.16), part('levels', 0.51, 0.52, 0.44, 0.08),
    part('glowgrid', 0.51, 0.61, 0.44, 0.07), part('ink', 0.05, 0.7, 0.9, 0.21), part('tape', 0.05, 0.93, 0.9, 0.04),
  ], { roll: { page: 1 } }),
  page('Note stage', 'newsprint', [
    part('title', 0.05, 0.025, 0.5, 0.05), part('clock', 0.62, 0.02, 0.33, 0.19),
    part('glowgrid', 0.05, 0.09, 0.54, 0.11, ruled), part('notestage', 0.05, 0.23, 0.9, 0.42),
    part('scope', 0.05, 0.67, 0.44, 0.13), part('vector', 0.51, 0.67, 0.44, 0.13),
    part('levels', 0.05, 0.82, 0.9, 0.08), part('tape', 0.05, 0.92, 0.9, 0.05),
  ]),
  page('Picture board', 'paper', [
    part('cuts', 0.05, 0.03, 0.44, 0.45), part('clock', 0.53, 0.03, 0.42, 0.21),
    part('roll', 0.53, 0.26, 0.42, 0.22, ruled), part('dots', 0.05, 0.5, 0.9, 0.14, ruled),
    part('ink', 0.05, 0.66, 0.44, 0.24), part('spectrum', 0.51, 0.66, 0.44, 0.12),
    part('levels', 0.51, 0.8, 0.44, 0.1), part('tape', 0.05, 0.92, 0.9, 0.05),
  ], { roll: { page: 1 } }),
  page('Night unit', 'cyanotype', [
    part('title', 0.05, 0.03, 0.6, 0.06), part('plume', 0, 0.09, 1, 0.3), part('synth', 0.04, 0.4, 0.92, 0.28),
    part('burst', 0.05, 0.69, 0.44, 0.2, ruled), part('scope', 0.51, 0.69, 0.44, 0.09),
    part('levels', 0.51, 0.8, 0.44, 0.09), part('tape', 0.05, 0.92, 0.9, 0.05),
  ], { synth: { tone: 0.82 } }),
];
