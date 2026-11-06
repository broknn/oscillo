// A preset is a saved way of working: layout, looks, their settings, colours and fonts.
// Tracks, video, pictures and the title belong to the project, so they stay out of it.

const KEPT = ['mode', 'look', 'cells', 'cellOpts', 'columns', 'free', 'autoList', 'autoBars', 'palette',
  'font', 'mono', 'brush', 'motion', 'density', 'seed', 'params', 'chrome', 'labels', 'footer', 'transparent'];

const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function capturePreset(name, scene, aspect, size) {
  const kept = {};
  for (const key of KEPT) kept[key] = copy(scene[key]);
  return { name, aspect, ...(size && { size }), scene: kept };
}

// Loads over `scene` in place. Anything the preset lacks falls back to `defaults`, and looks
// this version doesn't have are dropped, so older and newer presets both open cleanly.
export function applyPreset(scene, preset, defaults, known) {
  for (const key of KEPT) scene[key] = copy(preset.scene?.[key] ?? defaults[key]);
  const ok = (id) => Object.hasOwn(known, id);
  scene.cells = scene.cells.filter(ok);
  scene.autoList = scene.autoList.filter(ok);
  scene.free = scene.free.filter((it) => ok(it.id));
  if (!ok(scene.look)) scene.look = defaults.look;
  for (const id of Object.keys(scene.cellOpts)) if (!ok(id)) delete scene.cellOpts[id];
  return scene;
}

// Saving under a name that's taken replaces that preset, where it sits in the list.
export function putPreset(list, preset) {
  const at = list.findIndex((p) => p.name === preset.name);
  if (at < 0) return [...list, preset];
  return list.map((p, i) => (i === at ? preset : p));
}
