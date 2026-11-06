import sheet from './sheet.js';
import meters from './meters.js';
import scenes from './scenes.js';
import organic from './organic.js';
import midi from './midi.js';
import footage from './footage.js';
import text from './text.js';
import panels from './panels.js';
import wash from './wash.js';

export const LOOK_LIST = [...footage, ...text, ...panels, ...sheet, ...meters, ...scenes, ...organic, ...wash, ...midi];
export const LOOKS = Object.fromEntries(LOOK_LIST.map((l) => [l.id, l]));
export const GROUPS = ['Footage', 'Text', 'Panels', 'Sheet', 'Meters', 'Scenes', 'Organic', 'MIDI'];
