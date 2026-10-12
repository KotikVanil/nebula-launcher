// Electron main process: window, IPC API, Microsoft login window, tasks, game process events.
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, nativeImage, session } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const core = require('../core');
const tasks = require('./tasks');
const ai = require('./ai');
const mctextures = require('../core/mctextures');

const DEV = process.argv.includes('--dev');
const SHOTS = process.argv.some((a) => a.startsWith('--shots'));
let win = null;

if (!SHOTS && !app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---------- secrets ----------
core.accounts.setSecretBox({
  encrypt: (s) => (s && safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(s).toString('base64') : s),
  decrypt: (s) => (s && s.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')) : s),
});

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

tasks.bus.on('update', (t) => send('task', t));

// game log batching
let logBatch = [];
setInterval(() => { if (logBatch.length) { send('game:log', logBatch); logBatch = []; } }, 150);
core.launch.bus.on('log', (e) => logBatch.push(e));
core.launch.bus.on('start', (e) => send('game:start', e));
core.launch.bus.on('exit', (e) => {
  send('game:exit', e);
  if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); if (e.code !== 0) win.focus(); }
  core.activity('launcher', 'exit', { instanceId: e.instanceId, code: e.code });
});

// ---------- Microsoft login ----------
function microsoftLogin() {
  const clientId = core.settings.get().msClientId || undefined;
  const { url, redirect } = core.msauth.authUrl(clientId);
  return new Promise((resolve, reject) => {
    const part = 'mslogin-' + Date.now();
    const w = new BrowserWindow({
      width: 520, height: 680, parent: win, modal: true, title: 'Вход через Microsoft', backgroundColor: '#ffffff', autoHideMenuBar: true,
      webPreferences: { partition: part, contextIsolation: true, nodeIntegration: false },
    });
    let finished = false;
    const check = (u) => {
      if (finished || !u.startsWith(redirect)) return;
      finished = true;
      const q = new URL(u).searchParams;
      w.close();
      if (q.get('error')) return reject(new Error(q.get('error_description') || q.get('error')));
      const code = q.get('code');
      if (!code) return reject(new Error('Вход отменён'));
      core.accounts.addMicrosoft(code, clientId).then(resolve, reject);
    };
    w.webContents.on('will-redirect', (e, u) => check(u));
    w.webContents.on('will-navigate', (e, u) => check(u));
    w.webContents.on('did-navigate', (e, u) => check(u));
    w.on('closed', () => { if (!finished) reject(new Error('Окно входа закрыто')); session.fromPartition(part).clearStorageData().catch(() => {}); });
    w.loadURL(url);
  });
}

// ---------- launching ----------
async function play(instanceId, opts = {}) {
  const inst = core.instances.get(instanceId);
  if (core.launch.runningList().some((r) => r.instanceId === inst.id)) throw new Error('Уже запущено');
  return tasks.run(`Запуск «${inst.name}»`, { kind: 'launch', instanceId: inst.id }, async (task) => {
    const r = await core.launch.launch(inst.id, { accountId: opts.accountId, quickPlay: opts.quickPlay, signal: task.signal, onProgress: (p) => task.progress(p) });
    core.activity(opts.source || 'launcher', 'launch', { instanceId: inst.id, name: inst.name });
    const after = core.settings.get().afterLaunch;
    if (win && !win.isDestroyed() && !SHOTS) setTimeout(() => { if (after === 'minimize') win.minimize(); else if (after === 'hide') win.hide(); }, 2500);
    return r;
  });
}

// ---------- API exposed to renderer ----------
const fileUrl = (p) => (p ? pathToFileURL(p).href : null);

const api = {
  // app
  'app.info': () => ({ version: app.getVersion(), root: core.paths.root, dev: DEV, totalMem: core.util.totalMemMB(), electron: process.versions.electron }),
  'app.minimize': () => win.minimize(),
  'app.maximize': () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  'app.close': () => win.close(),
  'app.openPath': (p) => shell.openPath(p),
  'app.openExternal': (u) => (/^https?:\/\//.test(u) ? shell.openExternal(u) : null),
  'app.fileUrl': (p) => fileUrl(p),
  'app.openGuide': () => shell.openPath(path.join(__dirname, '..', '..', 'docs', 'AI_GUIDE.md')),
  'app.pickFile': async (filters, title) => {
    const r = await dialog.showOpenDialog(win, { title, properties: ['openFile'], filters });
    return r.canceled ? null : r.filePaths[0];
  },
  'app.saveFile': async (defaultPath, filters) => {
    const r = await dialog.showSaveDialog(win, { defaultPath, filters });
    return r.canceled ? null : r.filePath;
  },
  'app.readFileBase64': (p) => fs.readFileSync(p).toString('base64'),
  'app.fetchDataUrl': async (url) => {
    if (!/^https:\/\/(textures\.minecraft\.net|[\w.-]*mojang\.com|[\w.-]*minecraft\.net)\//.test(url)) throw new Error('URL не разрешён');
    const res = await core.net.request(url);
    const buf = Buffer.from(await res.arrayBuffer());
    return 'data:image/png;base64,' + buf.toString('base64');
  },

  // settings
  'settings.get': () => core.settings.get(),
  'settings.set': (patch) => core.settings.set(patch),

  // versions / loaders
  'versions.list': (o) => core.versions.list(o),
  'versions.latest': () => core.versions.latest(),
  'loaders.list': (loader, mc) => core.loaders.listVersions(loader, mc),
  'loaders.gameVersions': (loader) => core.loaders.supportedGameVersions(loader),
  'java.runtimes': () => core.java.installedRuntimes(),
  'java.probe': (p) => core.java.probe(p),

  // instances
  'instances.list': () => core.instances.list(),
  'instances.get': (id) => core.instances.get(id),
  'instances.create': (o) => { const i = core.instances.create(o); core.activity('launcher', 'create', { instanceId: i.id, name: i.name }); return i; },
  'instances.update': (id, p) => core.instances.update(id, p),
  'instances.remove': (id) => core.instances.remove(id),
  'instances.duplicate': (id, n) => core.instances.duplicate(id, n),
  'instances.stats': (id) => core.instances.stats(id),
  'instances.dir': (id) => core.paths.gameDir(core.instances.get(id).id),
  'instances.openDir': (id, sub) => shell.openPath(path.join(core.paths.gameDir(core.instances.get(id).id), sub || '')),
  'instances.reinstall': async (id) => {
    const inst = core.instances.update(id, { versionId: null });
    return tasks.run(`Переустановка «${inst.name}»`, { instanceId: inst.id }, (t) => core.launch.ensureInstalled(inst, { onProgress: (p) => t.progress(p), signal: t.signal }).then(() => true));
  },
  'instances.icons': () => core.instances.ICONS,

  // play
  'game.play': (id, opts) => play(id, opts),
  'game.kill': (id) => core.launch.kill(id),
  'game.running': () => core.launch.runningList(),
  'game.log': (id) => core.launch.getLog(id),
  'game.crash': (id) => core.crash.analyze(id, core.launch.getLog(id).split('\n')),

  // accounts
  'accounts.list': () => core.accounts.list(),
  'accounts.addOffline': (n) => core.accounts.addOffline(n),
  'accounts.addMicrosoft': () => microsoftLogin(),
  'accounts.setActive': (id) => core.accounts.setActive(id),
  'accounts.remove': (id) => core.accounts.remove(id),
  'accounts.refresh': (id) => core.accounts.refreshProfile(id),

  // skins
  // data URLs: WebGL (3D viewer) refuses file:// textures as cross-origin
  'skins.list': () => core.skins.list().map((s) => {
    let url = null;
    try { url = 'data:image/png;base64,' + fs.readFileSync(s.path).toString('base64'); } catch {}
    return { ...s, url };
  }).filter((s) => s.url),
  'skins.addFile': (p, o) => core.skins.addFile(p, o),
  'skins.addBase64': (b64, o) => core.skins.add(Buffer.from(b64, 'base64'), o),
  'skins.fromNickname': (n) => core.skins.fromNickname(n),
  'skins.fromUrl': (u) => core.skins.fromUrl(u),
  'skins.update': (id, p) => core.skins.update(id, p),
  'skins.remove': (id) => core.skins.remove(id),
  'skins.apply': (acc, id, v) => core.skins.apply(acc, id, v),
  'skins.setCape': (acc, cape) => core.skins.setCape(acc, cape),
  'skins.export': async (id) => {
    const s = core.skins.get(id);
    const out = await dialog.showSaveDialog(win, { defaultPath: s.name + '.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (!out.canceled) fs.copyFileSync(s.path, out.filePath);
    return !out.canceled;
  },

  // real Minecraft textures + default skins read from the local client jar
  'textures.get': async () => {
    const r = await mctextures.ensure();
    if (!r) return null;
    const durl = (p) => { try { return 'data:image/png;base64,' + fs.readFileSync(p).toString('base64'); } catch { return null; } };
    return {
      jar: r.jar,
      blocks: Object.fromEntries(Object.entries(r.blocks).map(([k, p]) => [k, durl(p)])),
      skins: r.skins.map((s) => ({ id: s.id, name: s.name, variant: s.variant, url: durl(s.path) })),
    };
  },
  'skins.addDefault': (id) => {
    const r = require('../core/mctextures');
    return r.ensure().then((t) => {
      const s = t.skins.find((x) => x.id === id);
      if (!s) throw new Error('Скин не найден');
      return core.skins.add(fs.readFileSync(s.path), { name: s.name, variant: s.variant, source: 'default' });
    });
  },

  // modrinth
  'modrinth.search': (o) => core.modrinth.search(o),
  'modrinth.project': (id) => core.modrinth.project(id),
  'modrinth.versions': (id, o) => core.modrinth.versions(id, o),
  'modrinth.categories': () => core.modrinth.categories(),
  'modrinth.install': (instanceId, ref, opts = {}) => {
    const inst = core.instances.get(instanceId);
    return tasks.run(`Установка в «${inst.name}»`, { instanceId: inst.id }, async (t) => {
      const r = await core.modrinth.install(inst.id, ref, { ...opts, onProgress: (p) => t.progress(p) });
      core.activity('launcher', 'install', { instanceId: inst.id, installed: r.installed.map((x) => x.title) });
      return r;
    });
  },
  'modrinth.checkUpdates': (id) => core.modrinth.checkUpdates(id),
  'modrinth.installPack': (ref, opts = {}) => tasks.run('Установка сборки', { kind: 'modpack' }, (t) => core.modpack.installModrinthPack(ref, { ...opts, onProgress: (p) => t.progress(p) })),

  // content
  'content.list': (id, type) => core.content.list(id, type),
  'content.toggle': (id, rel, en) => core.content.toggle(id, rel, en),
  'content.remove': (id, rel) => core.content.remove(id, rel),
  'content.identify': (id) => core.content.identify(id),
  'content.check': (id) => core.content.check(id),
  'content.jarIcon': (id, rel) => {
    const inst = core.instances.get(id);
    const abs = path.join(core.paths.gameDir(inst.id), rel);
    const real = fs.existsSync(abs) ? abs : abs + '.disabled';
    const m = core.content.jarMeta(real);
    return m && m.icon ? core.content.jarIcon(real, m.icon) : null;
  },
  'content.addFiles': async (id, type) => {
    const inst = core.instances.get(id);
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: type === 'mod' ? [{ name: 'Моды', extensions: ['jar'] }] : [{ name: 'Архивы', extensions: ['zip'] }] });
    if (r.canceled) return 0;
    const dir = path.join(core.paths.gameDir(inst.id), core.content.TYPES[type]);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of r.filePaths) fs.copyFileSync(f, path.join(dir, path.basename(f)));
    return r.filePaths.length;
  },
  'content.dropFiles': (id, files) => {
    const inst = core.instances.get(id);
    let n = 0;
    for (const f of files) {
      const type = /\.jar$/i.test(f) ? 'mod' : /\.zip$/i.test(f) ? (/shader/i.test(f) ? 'shader' : 'resourcepack') : null;
      if (!type) continue;
      const dir = path.join(core.paths.gameDir(inst.id), core.content.TYPES[type]);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(f, path.join(dir, path.basename(f)));
      n++;
    }
    return n;
  },

  // modpacks
  'modpack.presets': () => core.modpack.PRESETS,
  'modpack.applyPreset': (id, preset) => {
    const inst = core.instances.get(id);
    return tasks.run(`Пресет в «${inst.name}»`, { instanceId: inst.id }, (t) => core.modpack.applyPreset(inst.id, preset, { onProgress: (p) => t.progress(p) }));
  },
  'modpack.importFile': async (file) => {
    const f = file || (await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Modrinth pack', extensions: ['mrpack'] }] })).filePaths[0];
    if (!f) return null;
    return tasks.run('Импорт сборки', { kind: 'modpack' }, (t) => core.modpack.importMrpack(f, { onProgress: (p) => t.progress(p) }));
  },
  'modpack.export': async (id) => {
    const inst = core.instances.get(id);
    const out = await dialog.showSaveDialog(win, { defaultPath: inst.name + '.mrpack', filters: [{ name: 'Modrinth pack', extensions: ['mrpack'] }] });
    if (out.canceled) return null;
    return tasks.run(`Экспорт «${inst.name}»`, { instanceId: inst.id }, () => core.modpack.exportMrpack(inst.id, out.filePath));
  },
  'modpack.fixMissing': (id) => {
    const inst = core.instances.get(id);
    return tasks.run(`Починка «${inst.name}»`, { instanceId: inst.id }, (t) => core.modpack.fixMissing(inst.id, { onProgress: (p) => t.progress(p) }));
  },

  // files
  'files.worlds': (id) => core.files.worlds(id).then((l) => l.map((w) => ({ ...w, iconUrl: fileUrl(w.icon) }))),
  'files.backupWorld': (id, w) => core.files.backupWorld(id, w),
  'files.screenshots': (id) => core.files.screenshots(id).map((s) => ({ ...s, url: fileUrl(s.path) })),
  'files.showItem': (p) => shell.showItemInFolder(p),

  // tasks
  'tasks.list': () => tasks.list(),
  'tasks.cancel': (id) => tasks.cancel(id),

  // news
  'news.get': async () => {
    const d = await core.net.cachedJSON('https://launchercontent.mojang.com/v2/javaPatchNotes.json', 'patchnotes.json', 3600e3);
    return d.entries.slice(0, 12).map((e) => ({ title: e.title, version: e.version, type: e.type, date: e.date, image: e.image ? 'https://launchercontent.mojang.com' + e.image.url : null, short: e.shortText }));
  },

  // AI
  'ai.status': () => ai.status(),
  'ai.linkClaude': () => ai.linkClaude(),
  'ai.linkCodex': () => ai.linkCodex(),
  'ai.chat': (o) => ai.chat(o, (ev) => send('ai:event', ev)),
  'ai.stop': (id) => ai.stopChat(id),
  'ai.activity': (n = 40) => {
    try { return fs.readFileSync(core.paths.activity, 'utf8').trim().split('\n').slice(-n).map((l) => JSON.parse(l)).reverse(); } catch { return []; }
  },
};

ipcMain.handle('call', async (e, method, args) => {
  const fn = api[method];
  if (!fn) throw new Error('Unknown method ' + method);
  try { return await fn(...(args || [])); } catch (err) {
    if (DEV) console.error(method, err);
    throw new Error(err && err.message ? err.message : String(err));
  }
});

// ---------- watchers: AI/MCP changes appear live ----------
function watch() {
  let t1 = null;
  try {
    fs.watch(core.paths.instances, { recursive: true }, (ev, f) => {
      if (!f || !/instance\.json|nebula-content\.json|[\\/]mods[\\/]|resourcepacks|shaderpacks/.test(f)) return;
      clearTimeout(t1);
      t1 = setTimeout(() => send('instances:changed', {}), 400);
    });
  } catch {}
  let size = 0;
  try { size = fs.statSync(core.paths.activity).size; } catch {}
  fs.watchFile(core.paths.activity, { interval: 700 }, (cur) => {
    if (cur.size <= size) { size = cur.size; return; }
    try {
      const fd = fs.openSync(core.paths.activity, 'r');
      const buf = Buffer.alloc(cur.size - size);
      fs.readSync(fd, buf, 0, buf.length, size);
      fs.closeSync(fd);
      size = cur.size;
      for (const l of buf.toString().trim().split('\n')) { try { const ev = JSON.parse(l); if (ev.source !== 'launcher') send('activity', ev); } catch {} }
    } catch {}
  });
}

function handleArgs(argv) {
  const i = argv.indexOf('--launch');
  if (i >= 0 && argv[i + 1]) play(argv[i + 1], { source: 'ai' }).catch((e) => send('toast', { type: 'error', text: e.message }));
}

function createWindow() {
  const icon = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  win = new BrowserWindow({
    width: 1320, height: 840, minWidth: 1060, minHeight: 680, frame: false, show: false, backgroundColor: '#07060f',
    icon: fs.existsSync(icon) ? nativeImage.createFromPath(icon) : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', process.env.NEBULA_PAGE || 'index.html'));
  win.once('ready-to-show', () => { if (!SHOTS) win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); } });
  win.on('maximize', () => send('window:state', { maximized: true }));
  win.on('unmaximize', () => send('window:state', { maximized: false }));
  win.on('blur', () => send('window:focus', false));
  win.on('focus', () => send('window:focus', true));
  if (DEV) win.webContents.openDevTools({ mode: 'detach' });
  if (DEV || SHOTS) {
    win.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 'warning' || SHOTS) console.log('[renderer]', e.level, e.message, e.sourceId ? e.sourceId.split('/').pop() + ':' + e.lineNumber : ''); });
    win.webContents.on('did-fail-load', (e, code, desc, url) => console.log('[load-fail]', code, desc, url));
    win.webContents.on('render-process-gone', (e, d) => console.log('[gone]', d.reason));
  }
  if (SHOTS) require('./shots').run(win);
}

app.on('second-instance', (e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  handleArgs(argv);
});

app.whenReady().then(() => {
  core.util.writeJSON(core.paths.launcherInfo, {
    exe: process.execPath, args: app.isPackaged ? [] : [path.join(__dirname, '..', '..')], pid: process.pid, version: app.getVersion(), started: Date.now(),
  });
  createWindow();
  watch();
  handleArgs(process.argv);
});

app.on('window-all-closed', () => { core.yggdrasil.stop(); app.quit(); });
