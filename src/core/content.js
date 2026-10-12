// Instance content: mods / resource packs / shaders listing, jar metadata, toggling and health checks.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const P = require('./paths');
const instances = require('./instances');
const { readJSON, writeJSON, hashFile, cmpVersionTuple } = require('./util');

const TYPES = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };

function indexFile(id) { return path.join(P.instanceDir(id), 'nebula-content.json'); }
function loadIndex(id) { return readJSON(indexFile(id), { files: {} }); }
function saveIndex(id, d) { writeJSON(indexFile(id), d); }

function setEntry(id, rel, meta, replaceRel = null) {
  const idx = loadIndex(id);
  if (replaceRel && replaceRel !== rel) delete idx.files[replaceRel];
  idx.files[rel] = meta;
  saveIndex(id, idx);
}

function removeEntry(id, rel) {
  const idx = loadIndex(id);
  delete idx.files[rel];
  saveIndex(id, idx);
}

// ---------- jar metadata ----------
function lenientJSON(text) {
  try { return JSON.parse(text); } catch {}
  try { return JSON.parse(text.replace(/[\u0000-\u001f]+/g, ' ')); } catch {}
  return null;
}

function tomlBlocks(text) {
  // very small TOML subset: [[mods]] / [[dependencies.x]] tables with key = value
  const blocks = [];
  let cur = { name: '_root', data: {} };
  blocks.push(cur);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const t = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (t) { cur = { name: t[1], data: {} }; blocks.push(cur); continue; }
    const kv = /^([\w.-]+)\s*=\s*(.+)$/.exec(line);
    if (kv) {
      let v = kv[2].trim();
      const s = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(v);
      if (s) v = s[1] !== undefined ? s[1] : s[2];
      else if (v === 'true' || v === 'false') v = v === 'true';
      cur.data[kv[1]] = v;
    }
  }
  return blocks;
}

// ---------- version ranges (Fabric predicates and Maven ranges) ----------
function numVer(v) { const m = /(\d+(?:\.\d+)*)/.exec(String(v || '')); return m ? m[1] : null; }
function cmpV(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
function fabricMatch(ver, pred) {
  pred = String(pred).trim();
  if (!pred || pred === '*') return true;
  return pred.split(/\s+/).every((part) => {
    const m = /^(>=|<=|>|<|=|\^|~)?(.+)$/.exec(part);
    const op = m[1] || '=', raw = m[2];
    if (/[xX*]/.test(raw)) { const pre = numVer(raw.replace(/\.?[xX*].*$/, '')); return !pre || ver === pre || ver.startsWith(pre + '.'); }
    const target = numVer(raw);
    if (!target) return true;
    const c = cmpV(ver, target);
    if (op === '>=') return c >= 0; if (op === '<=') return c <= 0; if (op === '>') return c > 0; if (op === '<') return c < 0;
    if (op === '^') return c >= 0 && ver.split('.')[0] === target.split('.')[0];
    if (op === '~') return c >= 0 && ver.split('.').slice(0, 2).join('.') === target.split('.').slice(0, 2).join('.');
    return c === 0;
  });
}
function mavenMatch(ver, range) {
  range = String(range || '').trim();
  if (!range || range === '*') return true;
  return range.split(/(?<=[\])]),/).some((r) => {
    const m = /^([\[(])\s*([^,]*?)\s*(?:,\s*([^\])]*?)\s*)?([\])])$/.exec(r.trim());
    if (!m) { const t = numVer(r); return !t || cmpV(ver, t) >= 0; }
    const [, lo, a, b, hi] = m;
    const single = r.indexOf(',') < 0;
    const na = numVer(a), nb = single ? na : numVer(b);
    if (na && (lo === '[' ? cmpV(ver, na) < 0 : cmpV(ver, na) <= 0)) return false;
    if (nb && (hi === ']' ? cmpV(ver, nb) > 0 : cmpV(ver, nb) >= 0)) return false;
    return true;
  });
}
// true when the installed version falls inside the declared conflict range
function rangeHits(installed, range, maven) {
  const v = numVer(installed);
  if (!v || range === undefined || range === null) return true;
  const preds = Array.isArray(range) ? range : [range];
  return preds.some((p) => (maven ? mavenMatch(v, p) : fabricMatch(v, p)));
}
function versionOf(mod) { return mod.version; }

const BUILTIN = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt_base', 'forge', 'neoforge', 'fml', 'javafml', 'mixinextras', 'lowcodefml', 'mcp']);

function parseZip(zip, depth = 0) {
  const meta = { kinds: [], ids: [], name: null, version: null, deps: [], icon: null, description: null, authors: [] };
  const read = (n) => { const e = zip.getEntry(n); return e ? e.getData().toString('utf8') : null; };
  const fmj = read('fabric.mod.json');
  if (fmj) {
    const j = lenientJSON(fmj);
    if (j) {
      meta.kinds.push('fabric');
      meta.ids.push(j.id, ...(j.provides || []));
      meta.name = meta.name || j.name || j.id;
      meta.version = meta.version || j.version;
      meta.description = j.description || null;
      meta.icon = typeof j.icon === 'string' ? j.icon : (j.icon && Object.values(j.icon).pop()) || null;
      meta.authors = (j.authors || []).map((a) => (typeof a === 'string' ? a : a.name));
      for (const [id] of Object.entries(j.depends || {})) meta.deps.push({ id, required: true });
      for (const [id, range] of Object.entries(j.breaks || {})) meta.deps.push({ id, breaks: true, range });
    }
  }
  const qmj = read('quilt.mod.json');
  if (qmj) {
    const j = lenientJSON(qmj);
    const ql = j && j.quilt_loader;
    if (ql) {
      meta.kinds.push('quilt');
      meta.ids.push(ql.id, ...((ql.provides || []).map((p) => (typeof p === 'string' ? p : p.id))));
      meta.name = meta.name || (ql.metadata && ql.metadata.name) || ql.id;
      meta.version = meta.version || ql.version;
      for (const d of ql.depends || []) {
        const id = typeof d === 'string' ? d : d.id;
        if (id && !(d && d.optional)) meta.deps.push({ id, required: true });
      }
    }
  }
  for (const [file, kind] of [['META-INF/mods.toml', 'forge'], ['META-INF/neoforge.mods.toml', 'neoforge']]) {
    const t = read(file);
    if (!t) continue;
    meta.kinds.push(kind);
    for (const b of tomlBlocks(t)) {
      if (b.name === 'mods') {
        meta.ids.push(b.data.modId);
        meta.name = meta.name || b.data.displayName || b.data.modId;
        if (!meta.version || meta.version === '${file.jarVersion}') meta.version = b.data.version;
        meta.description = meta.description || b.data.description || null;
        if (b.data.logoFile) meta.icon = meta.icon || b.data.logoFile;
      } else if (/^dependencies\./.test(b.name)) {
        const required = b.data.mandatory === true || b.data.type === 'required' || b.data.type === '"required"';
        if (b.data.modId) meta.deps.push({ id: b.data.modId, required, breaks: b.data.type === 'incompatible', range: b.data.versionRange, maven: true });
      }
    }
  }
  const mcmod = read('mcmod.info');
  if (mcmod && !meta.kinds.length) {
    const j = lenientJSON(mcmod);
    const list = Array.isArray(j) ? j : (j && j.modList) || [];
    if (list.length) {
      meta.kinds.push('forge');
      for (const m of list) meta.ids.push(m.modid);
      meta.name = list[0].name; meta.version = list[0].version;
    }
  }
  if (depth < 2) {
    for (const e of zip.getEntries()) {
      if (e.isDirectory || !/^META-INF\/(jars|jarjar)\/.+\.jar$/.test(e.entryName)) continue;
      try {
        const sub = parseZip(new AdmZip(e.getData()), depth + 1);
        meta.ids.push(...sub.ids);
      } catch {}
    }
  }
  meta.ids = [...new Set(meta.ids.filter(Boolean))];
  return meta;
}

const metaCache = new Map();
function jarMeta(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const key = file + '|' + st.size + '|' + st.mtimeMs;
  if (metaCache.has(key)) return metaCache.get(key);
  let meta;
  try { meta = parseZip(new AdmZip(file)); } catch { meta = { kinds: [], ids: [], deps: [], name: null }; }
  metaCache.set(key, meta);
  return meta;
}

function jarIcon(file, iconPath) {
  try {
    const zip = new AdmZip(file);
    const e = zip.getEntry(iconPath.replace(/^\//, ''));
    if (!e) return null;
    return 'data:image/png;base64,' + e.getData().toString('base64');
  } catch { return null; }
}

// ---------- listing ----------
function list(instanceId, type = 'mod') {
  const inst = instances.get(instanceId);
  const folder = TYPES[type];
  const dir = path.join(P.gameDir(inst.id), folder);
  const idx = loadIndex(inst.id);
  let files = [];
  try { files = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
  const out = [];
  for (const e of files) {
    const name = e.name;
    const enabled = !name.endsWith('.disabled');
    const base = enabled ? name : name.slice(0, -'.disabled'.length);
    if (type === 'mod' && !/\.jar$/i.test(base)) continue;
    if (type !== 'mod' && e.isFile() && !/\.zip$/i.test(base)) continue;
    const rel = `${folder}/${base}`;
    const m = idx.files[rel] || {};
    const abs = path.join(dir, name);
    let jm = null;
    if (type === 'mod') jm = jarMeta(abs);
    out.push({
      file: rel, filename: base, enabled, size: e.isFile() ? fs.statSync(abs).size : 0, folder: e.isDirectory(),
      title: m.title || (jm && jm.name) || base.replace(/\.(jar|zip)$/i, ''),
      version: m.versionNumber || (jm && jm.version) || '',
      icon: m.icon || null, projectId: m.projectId || null, slug: m.slug || null, source: m.source || 'local',
      description: (jm && jm.description) || '', modIds: jm ? jm.ids : [], kinds: jm ? jm.kinds : [], dependency: !!m.dependency,
      hasJarIcon: !!(jm && jm.icon),
    });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function toggle(instanceId, rel, enable) {
  const inst = instances.get(instanceId);
  const abs = path.join(P.gameDir(inst.id), rel);
  const dis = abs + '.disabled';
  if (enable === undefined) enable = fs.existsSync(dis);
  if (enable && fs.existsSync(dis)) fs.renameSync(dis, abs);
  if (!enable && fs.existsSync(abs)) fs.renameSync(abs, dis);
  return enable;
}

function remove(instanceId, rel) {
  const inst = instances.get(instanceId);
  const abs = path.join(P.gameDir(inst.id), rel);
  for (const f of [abs, abs + '.disabled']) {
    try { fs.rmSync(f, { recursive: true, force: true }); } catch {}
  }
  removeEntry(inst.id, rel);
}

// Identify local jars on Modrinth by sha1 and fill the index (titles, icons, ids)
async function identify(instanceId) {
  const modrinth = require('./modrinth');
  const inst = instances.get(instanceId);
  const idx = loadIndex(inst.id);
  const pending = [];
  for (const type of Object.keys(TYPES)) {
    for (const item of list(inst.id, type)) {
      if (idx.files[item.file] || item.folder) continue;
      const abs = path.join(P.gameDir(inst.id), item.file + (item.enabled ? '' : '.disabled'));
      pending.push({ rel: item.file, type, sha1: await hashFile(abs) });
    }
  }
  if (!pending.length) return 0;
  const found = await modrinth.byHashes(pending.map((p) => p.sha1));
  const projIds = [...new Set(Object.values(found).map((v) => v.project_id))];
  const projs = new Map((await modrinth.projects(projIds)).map((p) => [p.id, p]));
  let n = 0;
  for (const p of pending) {
    const v = found[p.sha1];
    if (!v) continue;
    const pr = projs.get(v.project_id);
    const f = v.files.find((x) => x.hashes.sha1 === p.sha1) || v.files[0];
    idx.files[p.rel] = {
      source: 'modrinth', projectId: v.project_id, versionId: v.id, slug: pr && pr.slug, title: pr ? pr.title : p.rel,
      icon: pr && pr.icon_url, versionNumber: v.version_number, type: p.type, sha1: p.sha1, sha512: f.hashes.sha512,
      url: f.url, size: f.size, clientSide: pr && pr.client_side, serverSide: pr && pr.server_side, installedAt: Date.now(),
    };
    n++;
  }
  saveIndex(inst.id, idx);
  return n;
}

// Static health check of the mods folder: wrong loader, missing deps, duplicates, declared conflicts
function check(instanceId) {
  const inst = instances.get(instanceId);
  const mods = list(inst.id, 'mod').filter((m) => m.enabled);
  const issues = [];
  const provided = new Map();
  for (const m of mods) for (const id of m.modIds) {
    if (!provided.has(id)) provided.set(id, []);
    provided.get(id).push(m);
  }
  const accept = {
    fabric: ['fabric'], quilt: ['quilt', 'fabric'], forge: ['forge'],
    neoforge: cmpVersionTuple(inst.mc, '1.20.5') >= 0 || !/^1\./.test(inst.mc) ? ['neoforge'] : ['neoforge', 'forge'],
  }[inst.loader] || [];
  if (inst.loader === 'vanilla' && mods.length) issues.push({ level: 'error', type: 'vanilla', text: `В ванильной сборке лежат моды (${mods.length}). Они не загрузятся — смените загрузчик.` });

  for (const m of mods) {
    if (accept.length && m.kinds.length && !m.kinds.some((k) => accept.includes(k))) {
      issues.push({ level: 'error', type: 'wrong-loader', file: m.file, text: `«${m.title}» сделан для ${m.kinds.join('/')}, а сборка на ${inst.loader}` });
    }
    const jm = jarMeta(path.join(P.gameDir(inst.id), m.file));
    for (const d of (jm && jm.deps) || []) {
      if (d.breaks && provided.has(d.id) && !m.modIds.includes(d.id) && rangeHits(versionOf(provided.get(d.id)[0], d.id), d.range, d.maven)) {
        issues.push({ level: 'error', type: 'conflict', file: m.file, text: `«${m.title}» несовместим с «${provided.get(d.id)[0].title}»` });
      } else if (d.required && !BUILTIN.has(d.id) && !provided.has(d.id)) {
        const fapi = d.id === 'fabric' || d.id === 'fabric-api' || /^fabric-api-|^fabric-.*-v\d+$/.test(d.id);
        if (fapi && provided.has('fabric-api')) continue;
        if (fapi) issues.push({ level: 'error', type: 'missing', file: m.file, dep: 'fabric-api', text: `«${m.title}» требует Fabric API` });
        else issues.push({ level: 'error', type: 'missing', file: m.file, dep: d.id, text: `«${m.title}» требует мод «${d.id}», его нет` });
      }
    }
  }
  for (const [id, list2] of provided) {
    const files = [...new Set(list2.map((m) => m.file))];
    const own = list2.filter((m) => m.modIds[0] === id);
    if (own.length > 1) issues.push({ level: 'warn', type: 'duplicate', dep: id, files, text: `Мод «${id}» лежит несколько раз: ${files.map((f) => path.basename(f)).join(', ')}` });
  }
  // de-duplicate issue texts
  const seen = new Set();
  const uniq = issues.filter((i) => (seen.has(i.text) ? false : seen.add(i.text)));
  const missing = [...new Set(uniq.filter((i) => i.type === 'missing').map((i) => i.dep))];
  return { ok: !uniq.some((i) => i.level === 'error'), modCount: mods.length, issues: uniq, missing };
}

module.exports = { TYPES, loadIndex, saveIndex, setEntry, removeEntry, jarMeta, jarIcon, list, toggle, remove, identify, check };
