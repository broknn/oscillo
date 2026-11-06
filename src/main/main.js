const { app, BrowserWindow, clipboard, ipcMain, dialog, session, desktopCapturer, shell } = require('electron');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const smoke = process.argv.includes('--smoke');
const smokeOut = (process.argv.find((a) => a.startsWith('--out=')) ?? '').slice(6) || path.join(os.tmpdir(), 'oscillo-smoke');

function ffmpegPath() {
  try {
    const p = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(p)) return p;
  } catch { /* fall through to PATH */ }
  return 'ffmpeg';
}
const FFMPEG = ffmpegPath();

let mainWindow = null, listenWindow = null, demoFile = null;
const renderer = (file) => path.join(__dirname, '..', 'renderer', file);

function createMain() {
  mainWindow = new BrowserWindow({
    width: 1500, height: 920, minWidth: 1080, minHeight: 680,
    backgroundColor: '#0b0c0e',
    title: 'Oscillo',
    autoHideMenuBar: true,
    show: !smoke || process.argv.includes('--show'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  mainWindow.setMenu(null);
  mainWindow.loadFile(renderer('index.html'), { query: smoke ? { smoke: '1' } : {} });
  mainWindow.on('closed', () => { mainWindow = null; listenWindow?.close(); });
}

function openListen() {
  if (listenWindow) { listenWindow.focus(); return; }
  listenWindow = new BrowserWindow({
    width: 460, height: 300, minWidth: 220, minHeight: 140,
    frame: false, alwaysOnTop: true, backgroundColor: '#0e0f11',
    title: 'Oscillo Listen',
    show: !smoke || process.argv.includes('--show'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  listenWindow.setAlwaysOnTop(true, 'floating');
  listenWindow.loadFile(renderer('listen.html'), { query: smoke ? { smoke: '1' } : {} });
  listenWindow.on('closed', () => { listenWindow = null; });
}

// --- decoding -----------------------------------------------------------------

function decode(file) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, ['-v', 'error', '-i', file, '-vn', '-f', 'f32le', '-ac', '2', '-ar', '48000', 'pipe:1']);
    const chunks = [];
    let size = 0, err = '';
    ff.stdout.on('data', (c) => { chunks.push(c); size += c.length; });
    ff.stderr.on('data', (c) => { err += c; });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0 || !size) return reject(new Error(err.trim() || `Could not read ${path.basename(file)}`));
      const whole = Buffer.concat(chunks, size);
      resolve(whole.buffer.slice(whole.byteOffset, whole.byteOffset + size));
    });
  });
}

function siblingMidi(file) {
  const base = file.slice(0, file.length - path.extname(file).length);
  for (const ext of ['.mid', '.midi', '.MID']) {
    if (fs.existsSync(base + ext)) return fs.readFileSync(base + ext);
  }
  return null;
}

ipcMain.handle('audio:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Add tracks',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'aiff', 'aif', 'flac', 'm4a', 'ogg', 'opus', 'aac'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('audio:decode', async (_e, file) => ({
  pcm: await decode(file),
  midi: siblingMidi(file),
  name: path.basename(file, path.extname(file)),
}));

ipcMain.handle('images:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Add pictures',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
  });
  if (r.canceled) return [];
  return r.filePaths.map((f) => ({ name: path.basename(f), bytes: fs.readFileSync(f) }));
});

ipcMain.handle('image:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Pick a picture',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
  });
  if (r.canceled) return null;
  const f = r.filePaths[0];
  return { name: path.basename(f), bytes: fs.readFileSync(f), ext: path.extname(f).slice(1) };
});

// --- video: footage becomes a folder of frames, for instant exact access at any time -----

const VIDEO_FPS = 30;
const videoDirs = new Set();
let videoCount = 0;

const dropVideoDir = (dir) => { videoDirs.delete(dir); fs.rmSync(dir, { recursive: true, force: true }); };

function clearOldVideoDirs() {
  const week = Date.now() - 7 * 24 * 3600 * 1000;
  for (const name of fs.readdirSync(os.tmpdir())) {
    if (!name.startsWith('oscillo-video-')) continue;
    const dir = path.join(os.tmpdir(), name);
    try { if (fs.statSync(dir).mtimeMs < week) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* in use */ }
  }
}

function prepareVideo(file, sender) {
  const dir = path.join(os.tmpdir(), `oscillo-video-${process.pid}-${++videoCount}`);
  fs.mkdirSync(dir);
  videoDirs.add(dir);
  const fit = "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))'";
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG, ['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', '-i', file, '-an',
      '-vf', `fps=${VIDEO_FPS},${fit}`, '-pix_fmt', 'yuvj420p', '-q:v', '3', path.join(dir, '%06d.jpg')]);
    let err = '';
    ff.stdout.on('data', (c) => {
      const m = /frame=\s*(\d+)/.exec(String(c));
      if (m && !sender.isDestroyed()) sender.send('video:progress', Number(m[1]));
    });
    ff.stderr.on('data', (c) => { err += c; });
    ff.on('error', reject);
    ff.on('close', (code) => {
      const frames = fs.readdirSync(dir).length;
      if (code !== 0 || !frames) {
        dropVideoDir(dir);
        return reject(new Error(err.trim() || `Could not read ${path.basename(file)}`));
      }
      resolve({ name: path.basename(file), dir, base: `${pathToFileURL(dir).href}/`, frames, fps: VIDEO_FPS });
    });
  });
}

ipcMain.handle('video:pick', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a video',
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('video:prepare', (e, file) => prepareVideo(file, e.sender));
ipcMain.handle('video:drop', (_e, dir) => { if (videoDirs.has(dir)) dropVideoDir(dir); });

// --- presets --------------------------------------------------------------------

// Tests must not replace whatever is on the user's clipboard.
ipcMain.handle('clipboard:write', (_e, text) => { if (!smoke) clipboard.writeText(String(text)); });

const presetFile = () => path.join(smoke ? smokeOut : app.getPath('userData'), 'presets.json');

// This app used to be called Soundprint, and Electron names its data folder after the app.
function bringOldPresets(file) {
  const old = path.join(app.getPath('appData'), 'Soundprint', 'presets.json');
  if (smoke || fs.existsSync(file) || !fs.existsSync(old)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(old, file);
}

ipcMain.handle('presets:read', () => {
  const file = presetFile();
  bringOldPresets(file);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    // Keep an unreadable file aside rather than saving over it.
    fs.renameSync(file, `${file}.bad`);
    console.error(e);
    return [];
  }
});
ipcMain.handle('presets:write', (_e, list) => {
  const file = presetFile(), tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, file);
});

// --- files --------------------------------------------------------------------

ipcMain.handle('file:save', async (_e, { name, filters }) => {
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath: name, filters });
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('file:write', (_e, file, data) => { fs.writeFileSync(file, typeof data === 'string' ? data : Buffer.from(data)); return file; });
ipcMain.handle('file:reveal', (_e, file) => shell.showItemInFolder(file));
ipcMain.handle('tmp:track', (_e, data) => {
  demoFile = path.join(os.tmpdir(), `oscillo-demo-${process.pid}.wav`);
  fs.writeFileSync(demoFile, Buffer.from(data));
  return demoFile;
});

// --- video export: every frame is rendered, then piped as raw pixels to FFmpeg ----

let job = null;

ipcMain.handle('export:start', (_e, o) => {
  if (job) throw new Error('An export is already running');
  const video = ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${o.w}x${o.h}`, '-r', String(o.fps), '-i', 'pipe:0'];
  const audio = o.audio ? ['-ss', String(o.start), '-t', String(o.dur), '-i', o.audio, '-map', '0:v', '-map', '1:a'] : [];
  const codec = o.alpha
    ? ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0', ...(o.audio ? ['-c:a', 'pcm_s16le'] : [])]
    : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
       ...(o.audio ? ['-c:a', 'aac', '-b:a', '256k'] : []), '-movflags', '+faststart'];
  const ff = spawn(FFMPEG, ['-y', '-v', 'error', ...video, ...audio, ...codec, '-shortest', o.out], { stdio: ['pipe', 'ignore', 'pipe'] });
  job = { ff, err: '', done: null };
  ff.stderr.on('data', (c) => { job.err += c; });
  job.done = new Promise((resolve) => ff.on('close', (code) => resolve(code)));
  ff.stdin.on('error', () => {});
});

ipcMain.handle('export:frame', (_e, px) => new Promise((resolve, reject) => {
  if (!job) return reject(new Error('No export running'));
  job.ff.stdin.write(Buffer.from(px.buffer, px.byteOffset, px.byteLength), (e) => (e ? reject(new Error(job?.err || e.message)) : resolve()));
}));

ipcMain.handle('export:finish', async () => {
  if (!job) return;
  const j = job;
  j.ff.stdin.end();
  const code = await j.done;
  job = null;
  if (code !== 0) throw new Error(j.err.trim() || `FFmpeg exited with ${code}`);
});

ipcMain.handle('export:cancel', async (_e, out) => {
  if (!job) return;
  job.ff.kill();
  await job.done;
  job = null;
  fs.rmSync(out, { force: true });
});

ipcMain.handle('export:probe', (_e, file) => spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr);

// Prints a page through a hidden window, which keeps SVG content vector in the PDF.
ipcMain.handle('pdf:write', async (_e, html, out) => {
  const tmp = path.join(os.tmpdir(), `oscillo-print-${process.pid}.html`);
  fs.writeFileSync(tmp, html);
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  try {
    await w.loadFile(tmp);
    const pdf = await w.webContents.printToPDF({ pageSize: 'A3', printBackground: true, margins: { marginType: 'none' }, preferCSSPageSize: true });
    fs.writeFileSync(out, pdf);
    return out;
  } finally {
    w.destroy();
    fs.rmSync(tmp, { force: true });
  }
});

// --- listen -------------------------------------------------------------------

ipcMain.handle('listen:open', () => openListen());
ipcMain.handle('listen:close', () => listenWindow?.close());

// --- smoke test support --------------------------------------------------------

ipcMain.handle('smoke:info', () => ({ out: smokeOut }));
ipcMain.handle('smoke:fonts', (e) => e.sender.executeJavaScript('document.getElementById("moreFonts").click()', true));
ipcMain.handle('smoke:video', () => {
  const out = path.join(smokeOut, 'test-footage.mp4');
  spawnSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=7', '-pix_fmt', 'yuv420p', out]);
  return out;
});
ipcMain.handle('smoke:capture', async (_e, name, which) => {
  const w = which === 'listen' ? listenWindow : mainWindow;
  const img = await w.webContents.capturePage();
  const f = path.join(smokeOut, name);
  fs.writeFileSync(f, img.toPNG());
  return f;
});
ipcMain.handle('smoke:done', (_e, report) => {
  fs.writeFileSync(path.join(smokeOut, 'report.json'), JSON.stringify(report, null, 2));
  if (demoFile) fs.rmSync(demoFile, { force: true });
  for (const dir of [...videoDirs]) dropVideoDir(dir);
  app.exit(report.ok ? 0 : 1);
});

app.whenReady().then(() => {
  if (smoke) fs.mkdirSync(smokeOut, { recursive: true });
  clearOldVideoDirs();
  // Listen captures what the computer plays. 'loopback' is the Windows system mix.
  session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((s) => cb({ video: s[0], audio: 'loopback' })).catch(() => cb({}));
  });
  createMain();
});
app.on('window-all-closed', () => app.quit());
app.on('quit', () => {
  if (demoFile) fs.rmSync(demoFile, { force: true });
  for (const dir of [...videoDirs]) dropVideoDir(dir);
});
