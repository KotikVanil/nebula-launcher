// Mod loaders: Fabric, Quilt (meta profile JSON), Forge and NeoForge (official installers).
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const P = require('./paths');
const net = require('./net');
const versions = require('./versions');
const install = require('./install');
const java = require('./java');
const { writeJSON, exists, cmpVersionTuple } = require('./util');

const LOADERS = {
  vanilla: { name: 'Vanilla', color: '#5ec269' },
  fabric: { name: 'Fabric', color: '#dbb68f' },
  quilt: { name: 'Quilt', color: '#a77bf3' },
  forge: { name: 'Forge', color: '#e0703a' },
  neoforge: { name: 'NeoForge', color: '#f48a3a' },
};

// MC version -> NeoForge version prefix ("1.21.1" -> "21.1.", "26.3" -> "26.3.0.")
function neoPrefix(mc) {
  const p = mc.split('.');
  if (p[0] === '1') return `${p[1]}.${p[2] || 0}.`;
  return `${p[0]}.${p[1] || 0}.${p[2] || 0}.`;
}

async function listVersions(loader, mc) {
  if (loader === 'fabric') {
    const d = await net.cachedJSON(`https://meta.fabricmc.net/v2/versions/loader/${mc}`, `fabric-${mc}.json`, 3600e3);
    return d.map((x) => ({ version: x.loader.version, stable: x.loader.stable }));
  }
  if (loader === 'quilt') {
    const d = await net.cachedJSON(`https://meta.quiltmc.org/v3/versions/loader/${mc}`, `quilt-${mc}.json`, 3600e3);
    return d.map((x) => ({ version: x.loader.version, stable: !/beta|pre|rc/.test(x.loader.version) }));
  }
  if (loader === 'forge') {
    const xml = await net.getText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml');
    const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]).filter((v) => v.startsWith(mc + '-'));
    let promos = {};
    try { promos = (await net.cachedJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json', 'forge-promos.json', 3600e3)).promos; } catch {}
    const rec = promos[mc + '-recommended'];
    return all.map((full) => {
      const v = full.slice(mc.length + 1);
      return { version: v, full, stable: v === rec, recommended: v === rec };
    }).reverse();
  }
  if (loader === 'neoforge') {
    if (mc === '1.20.1') {
      const d = await net.getJSON('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge');
      return d.versions.filter((v) => v.startsWith('1.20.1-')).map((v) => ({ version: v, stable: !/beta/.test(v), legacy: true })).reverse();
    }
    const d = await net.getJSON('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    const pre = neoPrefix(mc);
    return d.versions.filter((v) => v.startsWith(pre)).map((v) => ({ version: v, stable: !/beta|alpha/.test(v) })).reverse();
  }
  return [];
}

async function supportedGameVersions(loader) {
  if (loader === 'fabric') return (await net.cachedJSON('https://meta.fabricmc.net/v2/versions/game', 'fabric-game.json', 3600e3)).map((g) => g.version);
  if (loader === 'quilt') return (await net.cachedJSON('https://meta.quiltmc.org/v3/versions/game', 'quilt-game.json', 3600e3)).map((g) => g.version);
  return null;
}

async function pickVersion(loader, mc) {
  const list = await listVersions(loader, mc);
  if (!list.length) throw new Error(`${LOADERS[loader].name} не поддерживает Minecraft ${mc}`);
  return (list.find((x) => x.recommended) || list.find((x) => x.stable) || list[0]).version;
}

function runInstaller(javaPath, jar, args, onLine) {
  return new Promise((resolve) => {
    const cp = spawn(javaPath, ['-jar', jar, ...args], { cwd: P.tmp, windowsHide: true });
    let out = '';
    const onData = (d) => {
      const s = d.toString();
      out += s;
      for (const line of s.split(/\r?\n/)) if (line.trim()) onLine && onLine(line.trim());
    };
    cp.stdout.on('data', onData);
    cp.stderr.on('data', onData);
    cp.on('close', (code) => resolve({ code, out }));
    cp.on('error', (e) => resolve({ code: -1, out: out + e.message }));
  });
}

// Installs the loader and returns the version id to launch.
async function installLoader(loader, mc, loaderVersion, { onProgress, signal, threads } = {}) {
  const progress = (stage, extra = {}) => onProgress && onProgress({ stage, ...extra });
  if (!loader || loader === 'vanilla') return mc;
  if (!loaderVersion) loaderVersion = await pickVersion(loader, mc);

  if (loader === 'fabric' || loader === 'quilt') {
    const url = loader === 'fabric'
      ? `https://meta.fabricmc.net/v2/versions/loader/${mc}/${loaderVersion}/profile/json`
      : `https://meta.quiltmc.org/v3/versions/loader/${mc}/${loaderVersion}/profile/json`;
    progress(`Установка ${LOADERS[loader].name} ${loaderVersion}`);
    const prof = await net.getJSON(url);
    if (!exists(P.versionJson(prof.id))) writeJSON(P.versionJson(prof.id), prof);
    return prof.id;
  }

  // Forge / NeoForge via installer jar
  let expected, installerUrl;
  if (loader === 'forge') {
    const full = `${mc}-${loaderVersion}`;
    expected = `${mc}-forge-${loaderVersion}`;
    installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
  } else if (/^1\.20\.1-/.test(loaderVersion)) {
    expected = `${mc}-forge-${loaderVersion.slice(7)}`;
    installerUrl = `https://maven.neoforged.net/releases/net/neoforged/forge/${loaderVersion}/forge-${loaderVersion}-installer.jar`;
  } else {
    expected = `neoforge-${loaderVersion}`;
    installerUrl = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${loaderVersion}/neoforge-${loaderVersion}-installer.jar`;
  }
  if (exists(P.versionJson(expected))) return expected;

  // vanilla first so the installer reuses our jar, and Java for this MC version
  const vanilla = await install.prepare(mc, { onProgress, signal, threads });
  const javaPath = await java.ensure(java.componentFor(vanilla.version), { onProgress, signal, threads });

  progress(`Скачивание установщика ${LOADERS[loader].name}`);
  const jar = path.join(P.cache, 'installers', path.basename(installerUrl));
  await net.download(installerUrl, jar);
  const profiles = path.join(P.root, 'launcher_profiles.json');
  if (!exists(profiles)) writeJSON(profiles, { profiles: {}, selectedProfile: '', clientToken: '' });

  const before = new Set(versions.installedVersions());
  progress(`Установка ${LOADERS[loader].name} ${loaderVersion} (это может занять пару минут)`);
  let res = await runInstaller(javaPath, jar, ['--installClient', P.root], (l) => progress(`${LOADERS[loader].name}: ${l.slice(0, 90)}`));
  if (res.code !== 0 && /not a recognized option|UnrecognizedOption/i.test(res.out)) {
    res = await runInstaller(javaPath, jar, ['--install-client', P.root], (l) => progress(`${LOADERS[loader].name}: ${l.slice(0, 90)}`));
  }
  const after = versions.installedVersions().filter((v) => !before.has(v));
  const id = exists(P.versionJson(expected)) ? expected : after.find((v) => v.includes(loaderVersion.replace(/^1\.20\.1-/, ''))) || after[0];
  if (!id) {
    const log = path.join(P.root, 'loader-install.log');
    fs.writeFileSync(log, res.out);
    throw new Error(`Установщик ${LOADERS[loader].name} завершился с кодом ${res.code}. Лог: ${log}`);
  }
  return id;
}

module.exports = { LOADERS, listVersions, supportedGameVersions, pickVersion, installLoader, neoPrefix };
