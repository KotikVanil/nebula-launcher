// Mojang version manifest, version JSON loading and inheritsFrom merging.
const fs = require('fs');
const P = require('./paths');
const net = require('./net');
const { readJSON, writeJSON, exists } = require('./util');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

async function manifest() {
  return net.cachedJSON(MANIFEST_URL, 'version_manifest_v2.json', 15 * 60 * 1000);
}

async function list({ snapshots = false, old = false } = {}) {
  const m = await manifest();
  return m.versions.filter((v) => v.type === 'release' || (snapshots && v.type === 'snapshot') || (old && v.type.startsWith('old')))
    .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
}

async function latest() { return (await manifest()).latest; }

// Load version JSON from disk, downloading vanilla ones from Mojang when missing.
async function loadJson(id) {
  const file = P.versionJson(id);
  const local = readJSON(file);
  if (local) return local;
  const m = await manifest();
  const entry = m.versions.find((v) => v.id === id);
  if (!entry) throw new Error(`Версия ${id} не найдена`);
  const data = await net.getJSON(entry.url);
  writeJSON(file, data);
  return data;
}

function libKey(lib) {
  const parts = lib.name.split(':');
  return parts[0] + ':' + parts[1] + (parts[3] ? ':' + parts[3] : '');
}

function merge(parent, child) {
  const out = { ...parent, ...child };
  const seen = new Set();
  out.libraries = [];
  for (const l of [...(child.libraries || []), ...(parent.libraries || [])]) {
    const k = libKey(l) + (l.natives ? ':nat' : '');
    if (seen.has(k)) continue;
    seen.add(k);
    out.libraries.push(l);
  }
  if (parent.arguments || child.arguments) {
    const pa = parent.arguments || {}, ca = child.arguments || {};
    out.arguments = {
      game: [...(pa.game || []), ...(ca.game || [])],
      jvm: [...(pa.jvm || []), ...(ca.jvm || [])],
      'default-user-jvm': ca['default-user-jvm'] || pa['default-user-jvm'],
    };
  }
  out.minecraftArguments = child.minecraftArguments || parent.minecraftArguments;
  for (const k of ['assetIndex', 'assets', 'downloads', 'javaVersion', 'logging']) out[k] = child[k] || parent[k];
  out.mainClass = child.mainClass || parent.mainClass;
  out.id = child.id;
  out.jarId = parent.jarId || parent.id;
  return out;
}

// Fully resolved version (inheritsFrom chain merged). jarId = vanilla jar to use.
async function resolve(id) {
  const json = await loadJson(id);
  if (json.inheritsFrom) {
    const parent = await resolve(json.inheritsFrom);
    const m = merge(parent, json);
    m.mcVersion = parent.mcVersion || parent.id;
    return m;
  }
  return { ...json, jarId: json.jar || json.id, mcVersion: json.id };
}

function installedVersions() {
  try { return fs.readdirSync(P.versions).filter((d) => exists(P.versionJson(d))); } catch { return []; }
}

module.exports = { manifest, list, latest, loadJson, resolve, installedVersions };
