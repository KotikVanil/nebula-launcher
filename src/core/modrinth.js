// Modrinth API v2 client + installing projects into instances with dependency resolution.
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const net = require('./net');
const instances = require('./instances');
const content = require('./content');

const API = 'https://api.modrinth.com/v2';
const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };

const projCache = new Map();

function modLoaders(inst) {
  switch (inst.loader) {
    case 'fabric': return ['fabric'];
    case 'quilt': return ['quilt', 'fabric'];
    case 'forge': return ['forge'];
    case 'neoforge': return inst.mc === '1.20.1' ? ['neoforge', 'forge'] : ['neoforge'];
    default: return [];
  }
}

async function search({ query = '', type = 'mod', loader, mc, categories = [], sort = 'relevance', offset = 0, limit = 20 } = {}) {
  const facets = [[`project_type:${type}`]];
  if (mc) facets.push([`versions:${mc}`]);
  if (type === 'mod' || type === 'modpack') {
    if (loader === 'quilt') facets.push(['categories:quilt', 'categories:fabric']);
    else if (loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  }
  for (const c of categories) facets.push([`categories:${c}`]);
  const q = new URLSearchParams({ query, facets: JSON.stringify(facets), index: sort, offset: String(offset), limit: String(limit) });
  const r = await net.getJSON(`${API}/search?${q}`);
  return {
    total: r.total_hits, offset: r.offset,
    hits: r.hits.map((h) => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description, author: h.author, icon: h.icon_url,
      downloads: h.downloads, follows: h.follows, categories: h.display_categories || h.categories, type: h.project_type,
      versions: h.versions, latest: h.latest_version, color: h.color, gallery: h.featured_gallery || h.gallery?.[0] || null,
      updated: h.date_modified, client: h.client_side, server: h.server_side,
    })),
  };
}

async function project(idOrSlug) {
  if (projCache.has(idOrSlug)) return projCache.get(idOrSlug);
  const p = await net.getJSON(`${API}/project/${encodeURIComponent(idOrSlug)}`);
  projCache.set(p.id, p); projCache.set(p.slug, p); projCache.set(idOrSlug, p);
  return p;
}

async function projects(ids) {
  if (!ids.length) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    out.push(...await net.getJSON(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 100)))}`));
  }
  for (const p of out) { projCache.set(p.id, p); projCache.set(p.slug, p); }
  return out;
}

async function versions(idOrSlug, { loaders, gameVersions } = {}) {
  const q = new URLSearchParams();
  if (loaders && loaders.length) q.set('loaders', JSON.stringify(loaders));
  if (gameVersions && gameVersions.length) q.set('game_versions', JSON.stringify(gameVersions));
  return net.getJSON(`${API}/project/${encodeURIComponent(idOrSlug)}/version?${q}`);
}

async function version(id) { return net.getJSON(`${API}/version/${id}`); }

async function byHashes(hashes) {
  if (!hashes.length) return {};
  const res = await net.request(`${API}/version_files`, { method: 'POST', body: JSON.stringify({ hashes, algorithm: 'sha1' }), headers: { 'Content-Type': 'application/json' } });
  return res.ok ? res.json() : {};
}

async function latestByHashes(hashes, loaders, gameVersions) {
  if (!hashes.length) return {};
  const body = { hashes, algorithm: 'sha1', game_versions: gameVersions };
  if (loaders && loaders.length) body.loaders = loaders;
  const res = await net.request(`${API}/version_files/update`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
  return res.ok ? res.json() : {};
}

async function categories() {
  return net.cachedJSON(`${API}/tag/category`, 'modrinth-categories.json', 24 * 3600e3);
}

async function gameVersions() {
  return net.cachedJSON(`${API}/tag/game_version`, 'modrinth-game-versions.json', 6 * 3600e3);
}

function versionFilterFor(inst, type) {
  if (type === 'mod') return { loaders: modLoaders(inst), gameVersions: [inst.mc] };
  if (type === 'resourcepack') return { loaders: ['minecraft'], gameVersions: [inst.mc] };
  return { gameVersions: [inst.mc] };
}

async function bestVersion(inst, proj) {
  const list = await versions(proj.id, versionFilterFor(inst, proj.project_type));
  if (!list.length) return null;
  // prefer the instance's own loader over fabric fallbacks for quilt
  const own = list.filter((v) => !inst.loader || v.loaders.includes(inst.loader));
  const pool = own.length ? own : list;
  return pool.find((v) => v.version_type === 'release') || pool.find((v) => v.version_type === 'beta') || pool[0];
}

function newReport() { return { installed: [], updated: [], skipped: [], failed: [], conflicts: [] }; }

// Install a project (mod / resourcepack / shader) with required dependencies.
async function install(instanceId, ref, opts = {}, ctx = null) {
  const top = !ctx;
  ctx = ctx || { visited: new Set(), report: newReport(), onProgress: opts.onProgress };
  const report = ctx.report;
  const inst = instances.get(instanceId);
  let proj;
  try { proj = await project(ref); } catch (e) {
    report.failed.push({ ref, reason: 'проект не найден на Modrinth' });
    return report;
  }
  if (ctx.visited.has(proj.id)) return report;
  ctx.visited.add(proj.id);
  const type = proj.project_type;
  if (!FOLDERS[type]) { report.failed.push({ ref, title: proj.title, reason: `тип «${type}» ставится иначе (модпаки — через импорт сборки)` }); return report; }
  if (type === 'mod' && (!inst.loader || inst.loader === 'vanilla')) {
    report.failed.push({ ref, title: proj.title, reason: 'в ванильную сборку нельзя ставить моды — выберите загрузчик' });
    return report;
  }

  const idx = content.loadIndex(inst.id);
  const existing = Object.entries(idx.files).find(([, m]) => m.projectId === proj.id);
  if (existing && !opts.versionId && !opts.update) {
    report.skipped.push({ title: proj.title, slug: proj.slug, reason: 'уже установлен', asDependency: !!opts.asDependency });
    return report;
  }

  let ver;
  try { ver = opts.versionId ? await version(opts.versionId) : await bestVersion(inst, proj); } catch (e) { ver = null; }
  if (!ver) {
    report.failed.push({ title: proj.title, slug: proj.slug, reason: `нет версии для Minecraft ${inst.mc}${inst.loader !== 'vanilla' ? ' + ' + inst.loader : ''}`, asDependency: !!opts.asDependency });
    return report;
  }
  if (existing && existing[1].versionId === ver.id) { report.skipped.push({ title: proj.title, slug: proj.slug, reason: 'уже последняя версия' }); return report; }

  // incompatibilities with what is already installed
  const installedProjects = new Map(Object.values(idx.files).map((m) => [m.projectId, m.title]));
  for (const d of ver.dependencies || []) {
    if (d.dependency_type === 'incompatible' && d.project_id && installedProjects.has(d.project_id)) {
      report.conflicts.push({ title: proj.title, with: installedProjects.get(d.project_id) });
    }
  }

  const file = ver.files.find((f) => f.primary) || ver.files[0];
  const rel = `${FOLDERS[type]}/${file.filename}`;
  ctx.onProgress && ctx.onProgress({ stage: `Скачивание ${proj.title}` });
  await net.download(file.url, path.join(P.gameDir(inst.id), rel), { sha1: file.hashes.sha1, size: file.size });
  if (existing && existing[0] !== rel) {
    try { fs.unlinkSync(path.join(P.gameDir(inst.id), existing[0])); } catch {}
    try { fs.unlinkSync(path.join(P.gameDir(inst.id), existing[0] + '.disabled')); } catch {}
  }
  content.setEntry(inst.id, rel, {
    source: 'modrinth', projectId: proj.id, versionId: ver.id, slug: proj.slug, title: proj.title, icon: proj.icon_url,
    versionNumber: ver.version_number, type, sha1: file.hashes.sha1, sha512: file.hashes.sha512, url: file.url, size: file.size,
    clientSide: proj.client_side, serverSide: proj.server_side, dependency: !!opts.asDependency, installedAt: Date.now(),
  }, existing ? existing[0] : null);
  (existing ? report.updated : report.installed).push({ title: proj.title, slug: proj.slug, version: ver.version_number, file: rel, asDependency: !!opts.asDependency });

  if (opts.deps !== false) {
    for (const d of ver.dependencies || []) {
      if (d.dependency_type !== 'required') continue;
      if (d.project_id) await install(inst.id, d.project_id, { asDependency: true }, ctx);
      else if (d.version_id) {
        try { const dv = await version(d.version_id); await install(inst.id, dv.project_id, { asDependency: true }, ctx); } catch {}
      }
    }
  }
  return top ? report : report;
}

async function installMany(instanceId, refs, opts = {}) {
  const ctx = { visited: new Set(), report: newReport(), onProgress: opts.onProgress };
  let i = 0;
  for (const ref of refs) {
    i++;
    opts.onProgress && opts.onProgress({ stage: `Мод ${i}/${refs.length}`, done: i - 1, total: refs.length });
    const r = typeof ref === 'string' ? { slug: ref } : ref;
    await install(instanceId, r.slug || r.id, { versionId: r.versionId, deps: opts.deps }, ctx);
  }
  return ctx.report;
}

// Check updates for Modrinth-tracked content
async function checkUpdates(instanceId) {
  const inst = instances.get(instanceId);
  const idx = content.loadIndex(inst.id);
  const out = [];
  const byType = {};
  for (const [rel, m] of Object.entries(idx.files)) {
    if (!m.sha1) continue;
    (byType[m.type || 'mod'] = byType[m.type || 'mod'] || []).push([rel, m]);
  }
  for (const [type, entries] of Object.entries(byType)) {
    const f = versionFilterFor(inst, type);
    const latest = await latestByHashes(entries.map(([, m]) => m.sha1), f.loaders, f.gameVersions);
    for (const [rel, m] of entries) {
      const v = latest[m.sha1];
      if (v && v.id !== m.versionId) out.push({ file: rel, title: m.title, projectId: m.projectId, from: m.versionNumber, to: v.version_number, versionId: v.id });
    }
  }
  return out;
}

module.exports = { API, FOLDERS, modLoaders, search, project, projects, versions, version, byHashes, latestByHashes, categories, gameVersions, install, installMany, checkUpdates, newReport };
