// Downloads everything a resolved version needs: client jar, libraries, natives, assets, log config.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const P = require('./paths');
const net = require('./net');
const versions = require('./versions');
const { mavenPath, rulesAllow, exists, readJSON } = require('./util');

const LIB_BASE = 'https://libraries.minecraft.net/';
const RES_BASE = 'https://resources.download.minecraft.net/';

function nativeClassifier(lib) {
  if (!lib.natives || !lib.natives.windows) return null;
  return lib.natives.windows.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
}

// Returns {classpath: [abs paths], natives: [{file, exclude}], jobs: [download jobs]}
function collectLibraries(v) {
  const classpath = [], natives = [], jobs = [];
  for (const lib of v.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    const cls = nativeClassifier(lib);
    if (cls) {
      const art = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[cls];
      const rel = art ? art.path : mavenPath(lib.name + ':' + cls);
      const file = path.join(P.libraries, rel);
      if (art && art.url) jobs.push({ url: art.url, dest: file, sha1: art.sha1, size: art.size });
      natives.push({ file, exclude: (lib.extract && lib.extract.exclude) || ['META-INF/'] });
      // Old LWJGL natives entries can also carry a main artifact
      if (!(lib.downloads && lib.downloads.artifact)) continue;
    }
    let rel, url, sha1, size;
    if (lib.downloads && lib.downloads.artifact) {
      const a = lib.downloads.artifact;
      rel = a.path || mavenPath(lib.name);
      url = a.url; sha1 = a.sha1; size = a.size;
    } else if (lib.downloads && !lib.downloads.artifact && cls) {
      continue;
    } else {
      rel = mavenPath(lib.name);
      url = (lib.url || LIB_BASE).replace(/\/?$/, '/') + rel;
      sha1 = lib.sha1; size = lib.size;
    }
    const file = path.join(P.libraries, rel);
    if (url) jobs.push({ url, dest: file, sha1, size });
    if (!classpath.includes(file)) classpath.push(file);
  }
  return { classpath, natives, jobs };
}

async function assetJobs(v) {
  if (!v.assetIndex) return { jobs: [], index: null };
  const idxFile = path.join(P.assets, 'indexes', v.assetIndex.id + '.json');
  await net.download(v.assetIndex.url, idxFile, { sha1: v.assetIndex.sha1, size: v.assetIndex.size });
  const index = readJSON(idxFile);
  const jobs = [];
  const seen = new Set();
  for (const o of Object.values(index.objects || {})) {
    if (seen.has(o.hash)) continue;
    seen.add(o.hash);
    const sub = o.hash.slice(0, 2) + '/' + o.hash;
    jobs.push({ url: RES_BASE + sub, dest: path.join(P.assets, 'objects', sub), sha1: o.hash, size: o.size });
  }
  return { jobs, index };
}

async function extractNatives(natives, dir) {
  const marker = path.join(dir, '.extracted');
  const sig = natives.map((n) => path.basename(n.file)).join('|');
  if (exists(marker) && fs.readFileSync(marker, 'utf8') === sig) return;
  await fsp.mkdir(dir, { recursive: true });
  for (const n of natives) {
    if (!exists(n.file)) continue;
    const zip = new AdmZip(n.file);
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      if ((n.exclude || []).some((x) => e.entryName.startsWith(x))) continue;
      const out = path.join(dir, e.entryName);
      await fsp.mkdir(path.dirname(out), { recursive: true });
      try { await fsp.writeFile(out, e.getData()); } catch {}
    }
  }
  fs.writeFileSync(marker, sig);
}

// Main entry: make sure version `id` is fully on disk. Returns launch data.
async function prepare(id, { onProgress, signal, threads = 16 } = {}) {
  const progress = (stage, p = {}) => onProgress && onProgress({ stage, ...p });
  progress('Чтение версии');
  const v = await versions.resolve(id);

  const jobs = [];
  // client jar (vanilla) + copy for the child version id, like the official launcher does
  const jarId = v.jarId;
  const vanillaJar = P.versionJar(jarId);
  if (v.downloads && v.downloads.client) {
    const c = v.downloads.client;
    jobs.push({ url: c.url, dest: vanillaJar, sha1: c.sha1, size: c.size });
  }
  const libs = collectLibraries(v);
  jobs.push(...libs.jobs);

  let logConfig = null;
  if (v.logging && v.logging.client && v.logging.client.file) {
    const f = v.logging.client.file;
    logConfig = { file: path.join(P.assets, 'log_configs', f.id), argument: v.logging.client.argument };
    jobs.push({ url: f.url, dest: logConfig.file, sha1: f.sha1, size: f.size });
  }

  progress('Индекс ассетов');
  const assets = await assetJobs(v);

  const all = [...jobs, ...assets.jobs];
  await net.downloadAll(all, {
    concurrency: threads, signal,
    onProgress: (p) => progress(p.done < jobs.length ? 'Библиотеки' : 'Ассеты', p),
  });

  const jarFile = P.versionJar(v.id);
  if (v.id !== jarId && exists(vanillaJar) && !exists(jarFile)) {
    await fsp.mkdir(path.dirname(jarFile), { recursive: true });
    await fsp.copyFile(vanillaJar, jarFile);
  }

  const nativesDir = path.join(P.versionDir(v.id), 'natives');
  progress('Распаковка natives');
  await extractNatives(libs.natives, nativesDir);

  return { version: v, classpath: [...libs.classpath, exists(jarFile) ? jarFile : vanillaJar], nativesDir, assetIndex: assets.index, logConfig };
}

// Old versions read assets from a "virtual" folder or from <gameDir>/resources
async function prepareLegacyAssets(v, index, gameDir) {
  if (!index) return null;
  let target = null;
  if (index.virtual) target = path.join(P.assets, 'virtual', v.assetIndex.id);
  else if (index.map_to_resources) target = path.join(gameDir, 'resources');
  if (!target) return null;
  for (const [name, o] of Object.entries(index.objects)) {
    const dst = path.join(target, name);
    if (exists(dst)) continue;
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    try { await fsp.copyFile(path.join(P.assets, 'objects', o.hash.slice(0, 2), o.hash), dst); } catch {}
  }
  return target;
}

module.exports = { prepare, prepareLegacyAssets, collectLibraries };
