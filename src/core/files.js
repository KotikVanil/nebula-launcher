// Worlds, screenshots, servers and backups of an instance.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const P = require('./paths');
const instances = require('./instances');
const { dirSize, safeJoin } = require('./util');

async function worlds(instanceId) {
  const inst = instances.get(instanceId);
  const dir = path.join(P.gameDir(inst.id), 'saves');
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
  const out = [];
  for (const n of names) {
    const wd = path.join(dir, n);
    const icon = path.join(wd, 'icon.png');
    let mtime = 0;
    try { mtime = fs.statSync(path.join(wd, 'level.dat')).mtimeMs; } catch { continue; }
    out.push({ name: n, path: wd, icon: fs.existsSync(icon) ? icon : null, lastPlayed: mtime, size: await dirSize(wd) });
  }
  return out.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

async function backupWorld(instanceId, world) {
  const inst = instances.get(instanceId);
  const wd = safeJoin(path.join(P.gameDir(inst.id), 'saves'), world);
  const outDir = path.join(P.instanceDir(inst.id), 'backups');
  await fsp.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const file = path.join(outDir, `${world}-${stamp}.zip`);
  const zip = new AdmZip();
  zip.addLocalFolder(wd, world);
  await zip.writeZipPromise(file);
  return file;
}

function screenshots(instanceId) {
  const inst = instances.get(instanceId);
  const dir = path.join(P.gameDir(inst.id), 'screenshots');
  try {
    return fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).map((f) => ({ name: f, path: path.join(dir, f), time: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.time - a.time);
  } catch { return []; }
}

function readText(instanceId, rel, max = 200000) {
  const inst = instances.get(instanceId);
  const f = safeJoin(P.gameDir(inst.id), rel);
  const buf = fs.readFileSync(f);
  return buf.slice(0, max).toString('utf8');
}

async function writeText(instanceId, rel, text) {
  const inst = instances.get(instanceId);
  const f = safeJoin(P.gameDir(inst.id), rel);
  await fsp.mkdir(path.dirname(f), { recursive: true });
  await fsp.writeFile(f, text);
  return f;
}

function tree(instanceId, rel = '', depth = 2) {
  const inst = instances.get(instanceId);
  const base = safeJoin(P.gameDir(inst.id), rel || '.');
  const walk = (d, lvl) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return []; }
    return ents.slice(0, 300).map((e) => {
      const p = path.join(d, e.name);
      const relp = path.relative(P.gameDir(inst.id), p).replace(/\\/g, '/');
      if (e.isDirectory()) return { path: relp + '/', children: lvl < depth ? walk(p, lvl + 1) : undefined };
      return { path: relp, size: fs.statSync(p).size };
    });
  };
  return walk(base, 1);
}

module.exports = { worlds, backupWorld, screenshots, readText, writeText, tree };
