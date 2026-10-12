// Builds the Java command line and runs the game for an instance.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const P = require('./paths');
const settings = require('./settings');
const instances = require('./instances');
const install = require('./install');
const loaders = require('./loaders');
const java = require('./java');
const accounts = require('./accounts');
const yggdrasil = require('./yggdrasil');
const crash = require('./crash');
const { rulesAllow, exists, cmpVersionTuple } = require('./util');

const LAUNCHER_NAME = 'nebula-launcher';
const LAUNCHER_VERSION = '1.0.0';

const running = new Map(); // instanceId -> {proc, started, log[]}
const bus = new EventEmitter();

function flattenArgs(list, features) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') { out.push(a); continue; }
    if (!rulesAllow(a.rules, features)) continue;
    if (Array.isArray(a.value)) out.push(...a.value); else out.push(a.value);
  }
  return out;
}

function substitute(args, vars) {
  return args.map((a) => a.replace(/\$\{([a-zA-Z_]+)\}/g, (m, k) => (k in vars ? vars[k] : m)));
}

// Ensure loader + version installed. Returns versionId (and stores it on the instance).
async function ensureInstalled(inst, { onProgress, signal } = {}) {
  const threads = settings.get().downloadThreads;
  let versionId = inst.versionId;
  if (!versionId || !exists(P.versionJson(versionId))) {
    versionId = await loaders.installLoader(inst.loader, inst.mc, inst.loaderVersion, { onProgress, signal, threads });
    instances.update(inst.id, { versionId });
  }
  const prep = await install.prepare(versionId, { onProgress, signal, threads });
  const component = java.componentFor(prep.version);
  const s = settings.get();
  const javaPath = inst.javaPath || s.javaPath || await java.ensure(component, { onProgress, signal, threads });
  return { versionId, prep, javaPath };
}

async function buildCommand(inst, account, { onProgress, signal, quickPlay } = {}) {
  const { versionId, prep, javaPath } = await ensureInstalled(inst, { onProgress, signal });
  const v = prep.version;
  const s = settings.get();
  const gameDir = P.gameDir(inst.id);
  await fsp.mkdir(gameDir, { recursive: true });

  onProgress && onProgress({ stage: 'Подготовка запуска' });
  const legacyAssets = await install.prepareLegacyAssets(v, prep.assetIndex, gameDir);
  const res = inst.resolution || s.resolution || {};
  const mem = instances.effectiveMemory(inst);

  const features = {
    has_custom_resolution: !!(res.width && res.height) && !res.fullscreen,
    is_demo_user: false,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: !!(quickPlay && quickPlay.world),
    is_quick_play_multiplayer: !!(quickPlay && quickPlay.server),
  };
  const vars = {
    auth_player_name: account.name,
    version_name: versionId,
    game_directory: gameDir,
    assets_root: path.join(P.assets),
    game_assets: legacyAssets || path.join(P.assets),
    assets_index_name: v.assetIndex ? v.assetIndex.id : v.assets,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    auth_session: account.type === 'msa' ? `token:${account.accessToken}:${account.uuid}` : account.accessToken,
    clientid: '',
    auth_xuid: account.xuid || '0',
    user_type: account.type === 'msa' ? 'msa' : 'legacy',
    version_type: 'Nebula',
    user_properties: '{}',
    natives_directory: prep.nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath: prep.classpath.join(';'),
    classpath_separator: ';',
    library_directory: P.libraries,
    resolution_width: String(res.width || 1280),
    resolution_height: String(res.height || 720),
    quickPlaySingleplayer: quickPlay && quickPlay.world ? quickPlay.world : '',
    quickPlayMultiplayer: quickPlay && quickPlay.server ? quickPlay.server : '',
    quickPlayPath: path.join(gameDir, 'quickPlay.json'),
  };

  const jvm = [`-Xms${mem.min}M`, `-Xmx${mem.max}M`];
  if (s.useMojangJvmFlags) {
    const def = v.arguments && v.arguments['default-user-jvm'];
    if (def) jvm.push(...flattenArgs(def, features).filter((a) => !/^-Xm[sx]/.test(a) && a !== '-XX:+AlwaysPreTouch'));
    else jvm.push('-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M');
  }
  const extra = `${s.jvmArgs || ''} ${inst.jvmArgs || ''}`.trim();
  if (extra) jvm.push(...extra.split(/\s+/));
  if (prep.logConfig && exists(prep.logConfig.file)) jvm.push(prep.logConfig.argument.replace('${path}', prep.logConfig.file));

  // Offline skins via local Yggdrasil + authlib-injector (MC 1.7.10+ only)
  let skinServer = false;
  const mcOk = /^1\.(\d+)/.test(inst.mc) ? cmpVersionTuple(inst.mc, '1.7.10') >= 0 : true;
  if (account.type === 'offline' && account.skinId && s.offlineSkins && inst.offlineSkins !== false && mcOk) {
    try { jvm.push(...await yggdrasil.jvmArgs()); skinServer = true; } catch (e) { onProgress && onProgress({ stage: 'Скины оффлайн недоступны: ' + e.message }); }
  }

  if (v.arguments && v.arguments.jvm) jvm.push(...flattenArgs(v.arguments.jvm, features));
  else jvm.push('-Djava.library.path=${natives_directory}', '-Dminecraft.launcher.brand=${launcher_name}', '-Dminecraft.launcher.version=${launcher_version}', '-cp', '${classpath}');

  let game;
  if (v.arguments && v.arguments.game) game = flattenArgs(v.arguments.game, features);
  else {
    game = (v.minecraftArguments || '').split(' ').filter(Boolean);
    if (features.has_custom_resolution) game.push('--width', '${resolution_width}', '--height', '${resolution_height}');
  }
  if (res.fullscreen) game.push('--fullscreen');
  if (quickPlay && quickPlay.server && !(v.arguments && v.arguments.game)) {
    const [host, port] = quickPlay.server.split(':');
    game.push('--server', host, '--port', port || '25565');
  }

  const args = [...substitute(jvm, vars), v.mainClass, ...substitute(game, vars)];
  return { javaPath, args, gameDir, versionId, skinServer };
}

function logFile(id) { return path.join(P.instanceDir(id), 'nebula-launch.log'); }

async function launch(instanceId, { accountId, onProgress, signal, quickPlay } = {}) {
  const inst = instances.get(instanceId);
  if (running.has(inst.id)) throw new Error('Эта сборка уже запущена');
  const account = await accounts.ensureFresh(accountId);
  const cmd = await buildCommand(inst, account, { onProgress, signal, quickPlay });
  onProgress && onProgress({ stage: 'Запуск игры' });

  const javaPath = cmd.javaPath.replace(/javaw\.exe$/i, 'java.exe');
  const out = fs.createWriteStream(logFile(inst.id));
  out.write(`# Nebula Launcher ${new Date().toISOString()}\n# ${javaPath}\n# ${cmd.args.map((a) => (/accessToken|token:/.test(a) ? '***' : a)).join(' ').replace(account.accessToken, '***')}\n\n`);
  const proc = spawn(javaPath, cmd.args, { cwd: cmd.gameDir, windowsHide: true, env: { ...process.env, _JAVA_OPTIONS: undefined } });
  const entry = { proc, started: Date.now(), log: [], instanceId: inst.id };
  running.set(inst.id, entry);
  instances.update(inst.id, { lastPlayed: Date.now() });
  bus.emit('start', { instanceId: inst.id, pid: proc.pid });

  const push = (line) => {
    out.write(line + '\n');
    entry.log.push(line);
    if (entry.log.length > 5000) entry.log.shift();
    bus.emit('log', { instanceId: inst.id, line });
  };
  // Mojang's log config prints XML events (<log4j:Event>); turn them into readable lines.
  let xml = '';
  const onData = (d) => {
    xml += d.toString();
    for (;;) {
      const start = xml.indexOf('<log4j:Event');
      if (start < 0) {
        const cut = xml.lastIndexOf('\n');
        if (cut < 0) break;
        xml.slice(0, cut).split(/\r?\n/).forEach((l) => l.trim() && push(l));
        xml = xml.slice(cut + 1);
        break;
      }
      if (start > 0) { xml.slice(0, start).split(/\r?\n/).forEach((l) => l.trim() && push(l)); xml = xml.slice(start); continue; }
      const end = xml.indexOf('</log4j:Event>');
      if (end < 0) break;
      const ev = xml.slice(0, end);
      xml = xml.slice(end + '</log4j:Event>'.length);
      const attr = (n) => { const m = new RegExp(n + '="([^"]*)"').exec(ev); return m ? m[1] : ''; };
      const msg = /<log4j:Message><!\[CDATA\[([\s\S]*?)\]\]>/.exec(ev);
      const thr = /<log4j:Throwable><!\[CDATA\[([\s\S]*?)\]\]>/.exec(ev);
      const time = new Date(Number(attr('timestamp')) || Date.now()).toTimeString().slice(0, 8);
      const head = `[${time}] [${attr('thread')}/${attr('level')}]: `;
      (head + (msg ? msg[1] : '')).split(/\r?\n/).forEach((l) => push(l));
      if (thr) thr[1].split(/\r?\n/).forEach((l) => l.trim() && push(l));
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  return new Promise((resolve) => {
    let resolved = false;
    const done = (code) => {
      if (resolved) return;
      resolved = true;
      running.delete(inst.id);
      if (xml.trim()) xml.split(/\r?\n/).forEach((l) => l.trim() && !l.startsWith('<') && push(l));
      out.end();
      const secs = Math.round((Date.now() - entry.started) / 1000);
      try { instances.update(inst.id, { playtime: (instances.get(inst.id).playtime || 0) + secs }); } catch {}
      const report = code !== 0 ? crash.analyze(inst.id, entry.log) : null;
      bus.emit('exit', { instanceId: inst.id, code, seconds: secs, crash: entry.killed ? null : report, killed: !!entry.killed });
    };
    proc.on('exit', done);
    proc.on('error', (e) => { onData(Buffer.from('Ошибка запуска Java: ' + e.message + '\n')); done(-1); });
    resolve({ pid: proc.pid, instanceId: inst.id });
  });
}

function kill(instanceId) {
  const r = running.get(instanceId);
  if (!r) return false;
  r.killed = true;
  try { process.kill(r.proc.pid); } catch {}
  spawn('taskkill', ['/pid', String(r.proc.pid), '/T', '/F'], { windowsHide: true });
  return true;
}

function runningList() {
  return [...running.values()].map((r) => ({ instanceId: r.instanceId, pid: r.proc.pid, started: r.started }));
}

function getLog(instanceId) {
  const r = running.get(instanceId);
  if (r) return r.log.join('\n');
  try { return fs.readFileSync(logFile(instanceId), 'utf8'); } catch { return ''; }
}

module.exports = { launch, kill, runningList, getLog, ensureInstalled, buildCommand, bus, logFile };
