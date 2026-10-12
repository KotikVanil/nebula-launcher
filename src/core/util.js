const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

function fileSize(p) { try { return fs.statSync(p).size; } catch { return -1; } }

async function hashFile(file, algo = 'sha1') {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function hashBuffer(buf, algo = 'sha1') { return crypto.createHash(algo).update(buf).digest('hex'); }

// "group:artifact:version[:classifier][@ext]" -> relative maven path
function mavenPath(name) {
  let ext = 'jar';
  let n = name;
  const at = n.indexOf('@');
  if (at >= 0) { ext = n.slice(at + 1); n = n.slice(0, at); }
  const [group, artifact, version, classifier] = n.split(':');
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`;
  return [...group.split('.'), artifact, version, file].join('/');
}

function cmpVersionTuple(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Mojang rule evaluation (os / arch / features)
function rulesAllow(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let allow = false;
  const release = os.release();
  for (const r of rules) {
    let match = true;
    if (r.os) {
      if (r.os.name && r.os.name !== 'windows') match = false;
      if (r.os.arch && r.os.arch !== (process.arch === 'arm64' ? 'arm64' : 'x86_64') && r.os.arch !== 'x64') match = false;
      if (r.os.version) { try { if (!new RegExp(r.os.version).test(release)) match = false; } catch {} }
      if (r.os.versionRange) {
        if (r.os.versionRange.min && cmpVersionTuple(release, r.os.versionRange.min) < 0) match = false;
        if (r.os.versionRange.max && cmpVersionTuple(release, r.os.versionRange.max) >= 0) match = false;
      }
    }
    if (r.features) {
      for (const [k, v] of Object.entries(r.features)) if (!!features[k] !== v) match = false;
    }
    if (match) allow = r.action === 'allow';
  }
  return allow;
}

// Same as Java's UUID.nameUUIDFromBytes("OfflinePlayer:" + name)
function offlineUUID(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  return md5.toString('hex');
}

function dashUUID(u) {
  const s = u.replace(/-/g, '');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function slugify(s) {
  const map = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
  const out = String(s).toLowerCase().split('').map((c) => (map[c] !== undefined ? map[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return out || 'instance';
}

async function copyDir(src, dst) {
  if (!exists(src)) return;
  await fsp.mkdir(dst, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d); else await fsp.copyFile(s, d);
  }
}

async function dirSize(dir) {
  let total = 0;
  try {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) total += await dirSize(p); else total += (await fsp.stat(p)).size;
    }
  } catch {}
  return total;
}

// Keep paths given by AI/users inside a base directory
function safeJoin(base, rel) {
  const p = path.resolve(base, rel);
  const b = path.resolve(base);
  if (p !== b && !p.startsWith(b + path.sep)) throw new Error('Путь выходит за пределы папки: ' + rel);
  return p;
}

function totalMemMB() { return Math.floor(os.totalmem() / 1024 / 1024); }

module.exports = {
  readJSON, writeJSON, exists, fileSize, hashFile, hashBuffer, mavenPath, rulesAllow, cmpVersionTuple,
  offlineUUID, dashUUID, slugify, copyDir, dirSize, safeJoin, totalMemMB,
};
