// Modpacks: .mrpack import/export, Modrinth modpacks, presets and declarative pack specs (for AI).
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const P = require('./paths');
const net = require('./net');
const instances = require('./instances');
const content = require('./content');
const modrinth = require('./modrinth');
const loaders = require('./loaders');
const { hashFile, safeJoin, exists } = require('./util');

// ---------- presets: one click groups of mods; slugs are tried in order, first available wins ----------
const PRESETS = [
  { id: 'performance', name: 'Оптимизация', icon: 'zap', desc: 'Больше FPS и меньше лагов',
    mods: [['sodium', 'embeddium'], 'lithium', 'ferrite-core', 'modernfix', 'entityculling', 'immediatelyfast', 'krypton', 'dynamic-fps'] },
  { id: 'shaders', name: 'Шейдеры', icon: 'sun', desc: 'Iris + красивые шейдеры',
    mods: [['sodium', 'embeddium'], ['iris', 'oculus']], shaders: ['complementary-reimagined', 'bsl-shaders'] },
  { id: 'qol', name: 'Удобства', icon: 'sparkles', desc: 'Подсказки, рецепты, мелкие улучшения',
    mods: [['modmenu'], ['jei', 'emi', 'rei'], 'jade', 'appleskin', 'mouse-tweaks', 'controlling', 'inventory-profiles-next'] },
  { id: 'map', name: 'Карты', icon: 'map', desc: 'Миникарта и карта мира',
    mods: ['xaeros-minimap', 'xaeros-world-map'] },
  { id: 'visual', name: 'Атмосфера', icon: 'cloud-sun', desc: 'Звуки, частицы, анимации',
    mods: ['sound-physics-remastered', 'ambientsounds', 'falling-leaves', 'notenoughanimations', 'visuality', 'continuity'] },
  { id: 'adventure', name: 'Приключения', icon: 'compass', desc: 'Новые структуры и мобы',
    mods: ['yungs-better-dungeons', 'yungs-better-mineshafts', 'towns-and-towers', 'when-dungeons-arise', 'explorify'] },
  { id: 'tech', name: 'Техника', icon: 'cog', desc: 'Механизмы и автоматизация',
    mods: ['create', 'create-fabric', 'applied-energistics-2', 'mekanism'] },
  { id: 'magic', name: 'Магия', icon: 'wand-2', desc: 'Заклинания и артефакты',
    mods: ['irons-spells-n-spellbooks', 'ars-nouveau', 'botania'] },
];

async function applyPreset(instanceId, presetId, opts = {}) {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) throw new Error('Нет такого пресета: ' + presetId);
  const inst = instances.get(instanceId);
  const ctx = { visited: new Set(), report: modrinth.newReport(), onProgress: opts.onProgress };
  for (const entry of preset.mods || []) {
    const options = Array.isArray(entry) ? entry : [entry];
    for (const slug of options) {
      const before = ctx.report.installed.length + ctx.report.skipped.length;
      const failedBefore = ctx.report.failed.length;
      await modrinth.install(inst.id, slug, {}, ctx);
      const ok = ctx.report.installed.length + ctx.report.skipped.length > before;
      if (ok) break;
      // drop the failure if a later alternative may work
      if (options.indexOf(slug) < options.length - 1) ctx.report.failed.splice(failedBefore);
    }
  }
  for (const slug of preset.shaders || []) await modrinth.install(inst.id, slug, {}, ctx);
  return ctx.report;
}

// ---------- Modrinth .mrpack ----------
async function importMrpack(file, { name, onProgress, icon } = {}) {
  const zip = new AdmZip(file);
  const idxEntry = zip.getEntry('modrinth.index.json');
  if (!idxEntry) throw new Error('Это не .mrpack (нет modrinth.index.json)');
  const index = JSON.parse(idxEntry.getData().toString('utf8'));
  const deps = index.dependencies || {};
  const mc = deps.minecraft;
  let loader = 'vanilla', loaderVersion = null;
  for (const [k, l] of [['fabric-loader', 'fabric'], ['quilt-loader', 'quilt'], ['forge', 'forge'], ['neoforge', 'neoforge']]) {
    if (deps[k]) { loader = l; loaderVersion = deps[k]; }
  }
  const inst = instances.create({ name: name || index.name || 'Сборка', mc, loader, loaderVersion, icon, notes: index.summary || '' });
  const gd = P.gameDir(inst.id);
  const jobs = [];
  const entries = [];
  for (const f of index.files || []) {
    if (f.env && f.env.client === 'unsupported') continue;
    const dest = safeJoin(gd, f.path);
    jobs.push({ url: f.downloads[0], dest, sha1: f.hashes.sha1, size: f.fileSize });
    entries.push(f);
  }
  onProgress && onProgress({ stage: 'Файлы сборки', done: 0, total: jobs.length });
  await net.downloadAll(jobs, { concurrency: 12, onProgress: (p) => onProgress && onProgress({ stage: 'Файлы сборки', ...p }) });
  // overrides
  onProgress && onProgress({ stage: 'Распаковка настроек' });
  for (const e of zip.getEntries()) {
    if (e.isDirectory) continue;
    const m = /^(client-overrides|overrides)\/(.+)$/.exec(e.entryName);
    if (!m) continue;
    const dest = safeJoin(gd, m[2]);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, e.getData());
  }
  // track files in index + identify on Modrinth
  const idx = content.loadIndex(inst.id);
  for (const f of entries) {
    const type = f.path.startsWith('mods/') ? 'mod' : f.path.startsWith('resourcepacks/') ? 'resourcepack' : f.path.startsWith('shaderpacks/') ? 'shader' : null;
    if (!type) continue;
    idx.files[f.path] = { source: 'mrpack', type, sha1: f.hashes.sha1, sha512: f.hashes.sha512, url: f.downloads[0], size: f.fileSize };
  }
  content.saveIndex(inst.id, idx);
  try { await enrichIndex(inst.id); } catch {}
  return instances.get(inst.id);
}

// Fill titles/icons for mrpack entries using hash lookup
async function enrichIndex(instanceId) {
  const idx = content.loadIndex(instanceId);
  const need = Object.entries(idx.files).filter(([, m]) => !m.projectId && m.sha1);
  if (!need.length) return;
  const found = await modrinth.byHashes(need.map(([, m]) => m.sha1));
  const projs = new Map((await modrinth.projects([...new Set(Object.values(found).map((v) => v.project_id))])).map((p) => [p.id, p]));
  for (const [rel, m] of need) {
    const v = found[m.sha1];
    if (!v) continue;
    const pr = projs.get(v.project_id);
    Object.assign(m, { source: 'modrinth', projectId: v.project_id, versionId: v.id, slug: pr && pr.slug, title: pr && pr.title, icon: pr && pr.icon_url, versionNumber: v.version_number, clientSide: pr && pr.client_side, serverSide: pr && pr.server_side });
    idx.files[rel] = m;
  }
  content.saveIndex(instanceId, idx);
}

async function installModrinthPack(projectRef, { versionId, onProgress, name } = {}) {
  const proj = await modrinth.project(projectRef);
  if (proj.project_type !== 'modpack') throw new Error(`${proj.title} — это не сборка`);
  const ver = versionId ? await modrinth.version(versionId) : (await modrinth.versions(proj.id))[0];
  const file = ver.files.find((f) => f.primary) || ver.files[0];
  const tmp = path.join(P.tmp, file.filename);
  onProgress && onProgress({ stage: `Скачивание ${proj.title}` });
  await net.download(file.url, tmp, { sha1: file.hashes.sha1, size: file.size });
  const inst = await importMrpack(tmp, { name: name || proj.title, onProgress });
  instances.update(inst.id, { notes: proj.description, modpack: { projectId: proj.id, versionId: ver.id, icon: proj.icon_url, title: proj.title } });
  try { fs.unlinkSync(tmp); } catch {}
  return instances.get(inst.id);
}

async function exportMrpack(instanceId, outFile, { includeConfigs = true, version = '1.0.0', summary } = {}) {
  const inst = instances.get(instanceId);
  const gd = P.gameDir(inst.id);
  await content.identify(inst.id).catch(() => {});
  const idx = content.loadIndex(inst.id);
  const zip = new AdmZip();
  const files = [];
  for (const type of Object.keys(content.TYPES)) {
    for (const item of content.list(inst.id, type)) {
      if (!item.enabled || item.folder) continue;
      const m = idx.files[item.file];
      const abs = path.join(gd, item.file);
      if (m && m.url && m.sha1) {
        const sha512 = m.sha512 || await hashFile(abs, 'sha512');
        files.push({
          path: item.file, hashes: { sha1: m.sha1, sha512 },
          env: { client: 'required', server: m.serverSide === 'unsupported' ? 'unsupported' : 'required' },
          downloads: [m.url], fileSize: m.size || fs.statSync(abs).size,
        });
      } else {
        zip.addLocalFile(abs, path.posix.join('overrides', path.posix.dirname(item.file)));
      }
    }
  }
  if (includeConfigs) {
    for (const d of ['config', 'defaultconfigs', 'kubejs']) if (exists(path.join(gd, d))) zip.addLocalFolder(path.join(gd, d), `overrides/${d}`);
    if (exists(path.join(gd, 'options.txt'))) zip.addLocalFile(path.join(gd, 'options.txt'), 'overrides');
  }
  const deps = { minecraft: inst.mc };
  const key = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' }[inst.loader];
  if (key) {
    let lv = inst.loaderVersion;
    if (!lv && inst.versionId) lv = inst.versionId.replace(/^.*?(?:fabric-loader-|quilt-loader-|forge-|neoforge-)/, '').replace(new RegExp('-' + inst.mc.replace(/\./g, '\\.') + '$'), '');
    // "Auto" loader and never launched: resolve the version the launcher would install,
    // other launchers (Prism, Modrinth App) reject a pack without a string version here
    if (!lv) lv = await loaders.pickVersion(inst.loader, inst.mc);
    // NeoForge for 1.20.1 is listed as "1.20.1-47.1.x"; the mrpack format wants "47.1.x"
    deps[key] = String(lv).replace(new RegExp('^' + inst.mc.replace(/\./g, '\\.') + '-'), '');
  }
  const index = { formatVersion: 1, game: 'minecraft', versionId: version, name: inst.name, summary: summary || inst.notes || undefined, files, dependencies: deps };
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)));
  zip.writeZip(outFile);
  return { file: outFile, mods: files.length };
}

// ---------- missing dependency fixer ----------
async function fixMissing(instanceId, opts = {}) {
  const chk = content.check(instanceId);
  const ctx = { visited: new Set(), report: modrinth.newReport(), onProgress: opts.onProgress };
  for (const dep of chk.missing) {
    const candidates = [dep, dep.replace(/_/g, '-'), dep.replace(/-/g, '')];
    let ok = false;
    for (const c of candidates) {
      try { await modrinth.project(c); } catch { continue; }
      const n = ctx.report.installed.length;
      await modrinth.install(instanceId, c, { asDependency: true }, ctx);
      if (ctx.report.installed.length > n) { ok = true; break; }
    }
    if (!ok) {
      const inst = instances.get(instanceId);
      const s = await modrinth.search({ query: dep, type: 'mod', loader: inst.loader, mc: inst.mc, limit: 1 });
      if (s.hits[0]) await modrinth.install(instanceId, s.hits[0].id, { asDependency: true }, ctx);
      else ctx.report.failed.push({ ref: dep, reason: 'не найден на Modrinth' });
    }
  }
  return { ...ctx.report, after: content.check(instanceId) };
}

// ---------- declarative spec (used by AI) ----------
// spec: { name, mc, loader, loaderVersion?, memory?, presets?: [], mods?: [slug|{slug,versionId}], resourcepacks?: [], shaders?: [], files?: {relPath: text}, notes? }
async function applySpec(spec, { instanceId, onProgress } = {}) {
  let inst;
  if (instanceId) {
    inst = instances.get(instanceId);
    const patch = {};
    for (const k of ['name', 'mc', 'loader', 'loaderVersion', 'notes', 'icon']) if (spec[k] !== undefined) patch[k] = spec[k];
    if (spec.memory) patch.memory = { min: Math.min(2048, spec.memory), max: spec.memory };
    inst = instances.update(inst.id, patch);
  } else {
    inst = instances.create({ name: spec.name, mc: spec.mc, loader: spec.loader || 'vanilla', loaderVersion: spec.loaderVersion, notes: spec.notes || '', icon: spec.icon, memory: spec.memory ? { min: Math.min(2048, spec.memory), max: spec.memory } : null });
  }
  const ctx = { visited: new Set(), report: modrinth.newReport(), onProgress };
  const refs = [...(spec.mods || []), ...(spec.resourcepacks || []), ...(spec.shaders || [])];
  let i = 0;
  for (const ref of refs) {
    i++;
    onProgress && onProgress({ stage: `Проект ${i}/${refs.length}`, done: i - 1, total: refs.length });
    const r = typeof ref === 'string' ? { slug: ref } : ref;
    await modrinth.install(inst.id, r.slug || r.id, { versionId: r.versionId }, ctx);
  }
  for (const p of spec.presets || []) {
    const rep = await applyPreset(inst.id, p, { onProgress });
    for (const k of Object.keys(ctx.report)) ctx.report[k].push(...rep[k]);
  }
  for (const [rel, text] of Object.entries(spec.files || {})) {
    const dest = safeJoin(P.gameDir(inst.id), rel);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, text);
  }
  return { instance: instances.get(inst.id), report: ctx.report, check: content.check(inst.id) };
}

module.exports = { PRESETS, applyPreset, importMrpack, installModrinthPack, exportMrpack, fixMissing, applySpec, enrichIndex };
