// Java runtimes from Mojang's own runtime manifest, so users never install Java by hand.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile } = require('child_process');
const P = require('./paths');
const net = require('./net');
const { exists, readJSON, writeJSON } = require('./util');

const RUNTIME_INDEX = 'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const PLATFORM = process.arch === 'arm64' ? 'windows-arm64' : 'windows-x64';

function componentFor(versionJson) {
  return (versionJson.javaVersion && versionJson.javaVersion.component) || 'jre-legacy';
}

function runtimeDir(component) { return path.join(P.runtimes, component); }
function javaExe(component) { return path.join(runtimeDir(component), 'bin', 'java.exe'); }
function javawExe(component) { return path.join(runtimeDir(component), 'bin', 'javaw.exe'); }

async function ensure(component, { onProgress, signal, threads = 16 } = {}) {
  const dir = runtimeDir(component);
  const marker = path.join(dir, '.nebula-runtime.json');
  const mark = readJSON(marker);
  if (mark && exists(javaExe(component))) return javaExe(component);

  const index = await net.cachedJSON(RUNTIME_INDEX, 'java-runtimes.json', 24 * 3600 * 1000);
  const entries = (index[PLATFORM] || {})[component];
  if (!entries || !entries.length) throw new Error(`Java ${component} недоступна для ${PLATFORM}`);
  const entry = entries[0];
  const man = await net.getJSON(entry.manifest.url);
  const jobs = [];
  for (const [rel, f] of Object.entries(man.files)) {
    const dest = path.join(dir, rel);
    if (f.type === 'directory') { await fsp.mkdir(dest, { recursive: true }); continue; }
    if (f.type !== 'file' || !f.downloads || !f.downloads.raw) continue;
    jobs.push({ url: f.downloads.raw.url, dest, sha1: f.downloads.raw.sha1, size: f.downloads.raw.size });
  }
  await net.downloadAll(jobs, { concurrency: threads, signal, onProgress: (p) => onProgress && onProgress({ stage: 'Java ' + entry.version.name, ...p }) });
  writeJSON(marker, { component, version: entry.version.name, installed: Date.now() });
  return javaExe(component);
}

function installedRuntimes() {
  try {
    return fs.readdirSync(P.runtimes).map((c) => ({ component: c, ...(readJSON(path.join(P.runtimes, c, '.nebula-runtime.json')) || {}) }))
      .filter((r) => r.version);
  } catch { return []; }
}

function probe(javaPath) {
  return new Promise((resolve) => {
    execFile(javaPath, ['-version'], { windowsHide: true, timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const m = /version "([^"]+)"/.exec(stderr || stdout);
      resolve(m ? m[1] : 'unknown');
    });
  });
}

module.exports = { componentFor, ensure, javaExe, javawExe, installedRuntimes, probe };
