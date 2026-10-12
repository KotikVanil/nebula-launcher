#!/usr/bin/env node
// Nebula Launcher MCP server: gives AI agents (Claude Code, Codex, any MCP client)
// high-level tools to build and fix Minecraft modpacks inside the launcher.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const require = createRequire(import.meta.url);
const core = require('../src/core/index.js');

const INSTRUCTIONS = `You control the Nebula Minecraft launcher. Typical modpack workflow:
1. list_instances (reuse an instance if the user means an existing one) or create_instance with mc version + loader.
   Pick a version where the requested mods exist: popular modded versions are 1.20.1 (Forge/Fabric) and 1.21.1 (NeoForge/Fabric).
2. search_mods with the instance id (results are already filtered to compatible versions), then add_mods with project slugs.
   Required dependencies are installed automatically. Prefer well-known mods with many downloads.
3. check_instance after changes; if it reports missing dependencies call fix_missing_dependencies; remove wrong-loader or conflicting mods.
4. Optional: write_file to tweak configs (config/*.toml|json, options.txt), apply_preset for quick groups (performance, shaders, qol, map...).
5. For crashes: get_logs (includes crash analysis), fix, then launch_instance to retest if the user wants.
apply_pack_spec does steps 1-3 in one call from a declarative JSON spec. Never mix loaders. Use Sodium on Fabric/NeoForge, Embeddium on Forge; Iris for shaders on Fabric/NeoForge, Oculus on Forge.
Answer the user in their language (usually Russian).`;

const server = new McpServer({ name: 'nebula-launcher', version: '1.0.0' }, { instructions: INSTRUCTIONS });

const ok = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }] });
const fail = (e) => ({ content: [{ type: 'text', text: 'Ошибка: ' + (e && e.message ? e.message : String(e)) }], isError: true });
const act = (action, details) => core.activity('mcp', action, details);

function tool(name, description, schema, fn) {
  server.registerTool(name, { description, inputSchema: schema }, async (args) => {
    try { return ok(await fn(args || {})); } catch (e) { return fail(e); }
  });
}

function instSummary(i) {
  return { id: i.id, name: i.name, mc: i.mc, loader: i.loader, loaderVersion: i.loaderVersion, memory: core.instances.effectiveMemory(i), group: i.group || undefined, playtimeMin: Math.round(i.playtime / 60), lastPlayed: i.lastPlayed ? new Date(i.lastPlayed).toISOString() : null };
}

const LOADER = z.enum(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']);
const INST = z.string().describe('Instance id or exact name');

tool('launcher_info', 'Overview of the launcher: data folder, latest Minecraft versions, instances, accounts, presets, running games.', {}, async () => {
  const latest = await core.versions.latest().catch(() => null);
  return {
    dataDir: core.paths.root, latestMinecraft: latest,
    instances: core.instances.list().map(instSummary),
    accounts: core.accounts.list().list.map((a) => ({ name: a.name, type: a.type })),
    presets: core.modpack.PRESETS.map((p) => ({ id: p.id, name: p.name, desc: p.desc })),
    loaders: Object.keys(core.loaders.LOADERS),
  };
});

tool('list_minecraft_versions', 'List Minecraft versions (newest first).', { snapshots: z.boolean().optional(), limit: z.number().int().optional() }, async ({ snapshots, limit = 60 }) =>
  (await core.versions.list({ snapshots })).slice(0, limit).map((v) => v.id));

tool('list_loader_versions', 'List versions of a mod loader for a Minecraft version (empty = loader not available for it).', { loader: LOADER, mc: z.string() }, async ({ loader, mc }) =>
  (await core.loaders.listVersions(loader, mc)).slice(0, 25));

tool('list_instances', 'List all instances (modpacks) in the launcher.', {}, async () => core.instances.list().map(instSummary));

tool('get_instance', 'Instance details with installed mods, resource packs, shaders and a health check.', { instance: INST }, async ({ instance }) => {
  const i = core.instances.get(instance);
  const brief = (m) => ({ title: m.title, file: m.file, version: m.version || undefined, slug: m.slug || undefined, enabled: m.enabled, dependency: m.dependency || undefined });
  return {
    ...instSummary(i), notes: i.notes || undefined,
    mods: core.content.list(i.id, 'mod').map(brief),
    resourcepacks: core.content.list(i.id, 'resourcepack').map(brief),
    shaders: core.content.list(i.id, 'shader').map(brief),
    check: core.content.check(i.id),
  };
});

tool('create_instance', 'Create a new instance. Game files are downloaded on first launch.', {
  name: z.string(), mc: z.string().describe('Minecraft version, e.g. 1.20.1'), loader: LOADER, loaderVersion: z.string().optional(),
  memoryMB: z.number().int().optional().describe('Max RAM in MB, e.g. 6144'), notes: z.string().optional(),
  icon: z.string().optional().describe('grass, stone, diamond, emerald, gold, redstone, tnt, crafting, bookshelf, obsidian, pumpkin, ice, netherrack, endstone, sand, log, amethyst, copper, slime, glowstone, sculk, cherry, lapis, magma'),
}, async ({ name, mc, loader, loaderVersion, memoryMB, notes, icon }) => {
  if (loader !== 'vanilla') {
    const vers = await core.loaders.listVersions(loader, mc);
    if (!vers.length) throw new Error(`${loader} недоступен для Minecraft ${mc}`);
  }
  const i = core.instances.create({ name, mc, loader, loaderVersion, notes, icon, memory: memoryMB ? { min: Math.min(2048, memoryMB), max: memoryMB } : null });
  act('create', { instanceId: i.id, name: i.name });
  return instSummary(i);
});

tool('update_instance', 'Change instance settings (name, version, loader, RAM, JVM args, notes, group, icon). Changing mc/loader re-installs the game files on next launch.', {
  instance: INST, name: z.string().optional(), mc: z.string().optional(), loader: LOADER.optional(), loaderVersion: z.string().nullable().optional(),
  memoryMB: z.number().int().optional(), jvmArgs: z.string().optional(), notes: z.string().optional(), group: z.string().optional(), icon: z.string().optional(),
}, async ({ instance, memoryMB, ...patch }) => {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  if (memoryMB) clean.memory = { min: Math.min(2048, memoryMB), max: memoryMB };
  const i = core.instances.update(core.instances.get(instance).id, clean);
  act('update', { instanceId: i.id });
  return instSummary(i);
});

tool('search_mods', 'Search Modrinth. With `instance` the results are filtered to its Minecraft version and loader. type: mod | modpack | resourcepack | shader.', {
  query: z.string(), instance: INST.optional(), type: z.enum(['mod', 'modpack', 'resourcepack', 'shader']).optional(),
  mc: z.string().optional(), loader: LOADER.optional(), categories: z.array(z.string()).optional().describe('e.g. optimization, technology, magic, adventure, worldgen, utility, decoration, storage, mobs'),
  sort: z.enum(['relevance', 'downloads', 'follows', 'newest', 'updated']).optional(), limit: z.number().int().max(50).optional(),
}, async ({ query, instance, type = 'mod', mc, loader, categories, sort, limit = 12 }) => {
  if (instance) { const i = core.instances.get(instance); mc = mc || i.mc; if (type === 'mod') loader = loader || i.loader; }
  const r = await core.modrinth.search({ query, type, mc, loader: type === 'mod' ? loader : undefined, categories, sort, limit });
  return { total: r.total, filteredFor: { mc, loader }, hits: r.hits.map((h) => ({ slug: h.slug, title: h.title, description: h.description, downloads: h.downloads, categories: h.categories, client: h.client, server: h.server })) };
});

tool('mod_info', 'Details of a Modrinth project: description, supported loaders and versions, and the best version for an instance.', { project: z.string().describe('slug or id'), instance: INST.optional() }, async ({ project, instance }) => {
  const p = await core.modrinth.project(project);
  const out = {
    slug: p.slug, title: p.title, type: p.project_type, description: p.description, categories: p.categories, client: p.client_side, server: p.server_side,
    loaders: p.loaders, gameVersions: p.game_versions.slice(-30), downloads: p.downloads, body: (p.body || '').slice(0, 1500),
  };
  if (instance) {
    const i = core.instances.get(instance);
    const loaders = p.project_type === 'mod' ? core.modrinth.modLoaders(i) : undefined;
    const vers = await core.modrinth.versions(p.id, { loaders, gameVersions: [i.mc] });
    out.compatibleWithInstance = vers.length > 0;
    out.versionsForInstance = vers.slice(0, 5).map((v) => ({ id: v.id, number: v.version_number, type: v.version_type, deps: v.dependencies.filter((d) => d.dependency_type !== 'optional').length }));
  }
  return out;
});

tool('add_mods', 'Install Modrinth projects (mods, resource packs, shaders) into an instance. Picks the best compatible version and installs required dependencies.', {
  instance: INST, projects: z.array(z.string()).describe('Modrinth slugs or ids'), includeDependencies: z.boolean().optional(),
}, async ({ instance, projects, includeDependencies = true }) => {
  const i = core.instances.get(instance);
  const r = await core.modrinth.installMany(i.id, projects, { deps: includeDependencies });
  act('install', { instanceId: i.id, installed: r.installed.map((x) => x.title) });
  return { installed: r.installed, updated: r.updated, skipped: r.skipped, failed: r.failed, conflicts: r.conflicts, hint: 'Run check_instance to verify.' };
});

tool('remove_mods', 'Remove content from an instance by Modrinth slug, title or file name.', { instance: INST, items: z.array(z.string()) }, async ({ instance, items }) => {
  const i = core.instances.get(instance);
  const removed = [], notFound = [];
  for (const it of items) {
    const low = it.toLowerCase();
    let hit = null;
    for (const t of ['mod', 'resourcepack', 'shader']) {
      hit = core.content.list(i.id, t).find((m) => m.slug === it || m.title.toLowerCase() === low || m.filename.toLowerCase() === low || m.file.toLowerCase() === low || m.modIds.includes(it));
      if (hit) break;
    }
    if (hit) { core.content.remove(i.id, hit.file); removed.push(hit.title); } else notFound.push(it);
  }
  act('remove', { instanceId: i.id, removed });
  return { removed, notFound };
});

tool('toggle_mod', 'Enable or disable a mod without deleting it.', { instance: INST, item: z.string().describe('slug, title or file'), enabled: z.boolean() }, async ({ instance, item, enabled }) => {
  const i = core.instances.get(instance);
  const low = item.toLowerCase();
  const m = core.content.list(i.id, 'mod').find((x) => x.slug === item || x.title.toLowerCase() === low || x.filename.toLowerCase() === low || x.file === item);
  if (!m) throw new Error('Мод не найден: ' + item);
  core.content.toggle(i.id, m.file, enabled);
  act('update', { instanceId: i.id });
  return { file: m.file, enabled };
});

tool('list_content', 'List installed mods / resourcepacks / shaders with mod ids and versions.', { instance: INST, type: z.enum(['mod', 'resourcepack', 'shader']).optional() }, async ({ instance, type = 'mod' }) =>
  core.content.list(core.instances.get(instance).id, type).map((m) => ({ title: m.title, file: m.file, version: m.version, enabled: m.enabled, slug: m.slug, modIds: m.modIds.slice(0, 5), loaders: m.kinds })));

tool('check_instance', 'Static health check of the mods folder: wrong loader, missing required dependencies, duplicates, declared incompatibilities.', { instance: INST }, async ({ instance }) =>
  core.content.check(core.instances.get(instance).id));

tool('fix_missing_dependencies', 'Find and install missing required dependencies reported by check_instance.', { instance: INST }, async ({ instance }) => {
  const i = core.instances.get(instance);
  const r = await core.modpack.fixMissing(i.id);
  act('install', { instanceId: i.id, installed: r.installed.map((x) => x.title) });
  return r;
});

tool('check_updates', 'List mod updates for an instance; with apply=true installs them.', { instance: INST, apply: z.boolean().optional() }, async ({ instance, apply }) => {
  const i = core.instances.get(instance);
  const ups = await core.modrinth.checkUpdates(i.id);
  if (apply) {
    for (const u of ups) await core.modrinth.install(i.id, u.projectId, { versionId: u.versionId, update: true });
    act('install', { instanceId: i.id, installed: ups.map((u) => u.title) });
  }
  return { updates: ups, applied: !!apply };
});

tool('list_presets', 'One-click mod groups available for apply_preset.', {}, async () => core.modpack.PRESETS);

tool('apply_preset', 'Install a preset group of mods (performance, shaders, qol, map, visual, adventure, tech, magic).', { instance: INST, preset: z.string() }, async ({ instance, preset }) => {
  const i = core.instances.get(instance);
  const r = await core.modpack.applyPreset(i.id, preset);
  act('install', { instanceId: i.id, installed: r.installed.map((x) => x.title) });
  return r;
});

tool('apply_pack_spec', 'Build a whole modpack from a declarative spec in one call. Creates a new instance (or updates `instance`). Returns the install report and a health check.', {
  spec: z.object({
    name: z.string().optional(), mc: z.string().optional(), loader: LOADER.optional(), loaderVersion: z.string().optional(), memory: z.number().int().optional().describe('max RAM MB'),
    presets: z.array(z.string()).optional(), mods: z.array(z.string()).optional(), resourcepacks: z.array(z.string()).optional(), shaders: z.array(z.string()).optional(),
    files: z.record(z.string(), z.string()).optional().describe('relative path inside .minecraft -> text content (configs, options.txt)'), notes: z.string().optional(), icon: z.string().optional(),
  }),
  instance: INST.optional(),
}, async ({ spec, instance }) => {
  if (!instance && (!spec.name || !spec.mc)) throw new Error('Для новой сборки нужны spec.name и spec.mc');
  const r = await core.modpack.applySpec(spec, { instanceId: instance ? core.instances.get(instance).id : undefined });
  act('spec', { instanceId: r.instance.id, name: r.instance.name, installed: r.report.installed.map((x) => x.title) });
  return { instance: instSummary(r.instance), report: r.report, check: r.check };
});

tool('install_modpack', 'Install a ready Modrinth modpack (project type modpack) as a new instance.', { project: z.string(), versionId: z.string().optional(), name: z.string().optional() }, async ({ project, versionId, name }) => {
  const i = await core.modpack.installModrinthPack(project, { versionId, name });
  act('create', { instanceId: i.id, name: i.name });
  return instSummary(i);
});

tool('list_files', 'List files inside the instance game folder (.minecraft).', { instance: INST, path: z.string().optional(), depth: z.number().int().max(4).optional() }, async ({ instance, path: rel = '', depth = 2 }) =>
  core.files.tree(core.instances.get(instance).id, rel, depth));

tool('read_file', 'Read a text file inside the instance game folder (configs, options.txt, logs/latest.log).', { instance: INST, path: z.string() }, async ({ instance, path: rel }) =>
  core.files.readText(core.instances.get(instance).id, rel, 60000));

tool('write_file', 'Write a text file inside the instance game folder (e.g. config/sodium-options.json, options.txt). Paths outside the instance are rejected.', { instance: INST, path: z.string(), content: z.string() }, async ({ instance, path: rel, content }) => {
  const i = core.instances.get(instance);
  if (/\.(jar|exe|dll|bat|cmd|ps1)$/i.test(rel)) throw new Error('Можно писать только текстовые конфиги');
  const f = await core.files.writeText(i.id, rel, content);
  act('config', { instanceId: i.id, file: rel });
  return { written: f };
});

tool('get_logs', 'Last launch log of an instance with automatic crash analysis (and the newest crash report excerpt).', { instance: INST, lines: z.number().int().optional(), errorsOnly: z.boolean().optional() }, async ({ instance, lines = 150, errorsOnly }) => {
  const i = core.instances.get(instance);
  let log = core.launch.getLog(i.id).split('\n');
  const analysis = core.crash.analyze(i.id, log);
  if (errorsOnly) log = log.filter((l) => /ERROR|Exception|FATAL|Caused by|WARN.*(mod|mixin)/i.test(l));
  const report = core.crash.latestCrashReport(i.id);
  return { analysis, crashReportExcerpt: report ? report.text.slice(0, 6000) : null, log: log.slice(-lines).join('\n') };
});

tool('launch_instance', 'Start the game for an instance through the Nebula window (opens the launcher if needed). Uses the active account.', { instance: INST }, async ({ instance }) => {
  const i = core.instances.get(instance);
  const info = core.util.readJSON(core.paths.launcherInfo);
  if (!info || !info.exe || !fs.existsSync(info.exe)) throw new Error('Лаунчер ещё ни разу не запускался — откройте Nebula Launcher.');
  const child = spawn(info.exe, [...(info.args || []), '--launch', i.id], { detached: true, stdio: 'ignore', windowsHide: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } });
  child.unref();
  act('launch', { instanceId: i.id, name: i.name });
  return { launching: i.name, hint: 'Через 20-60 с вызовите get_logs, чтобы проверить запуск.' };
});

tool('export_mrpack', 'Export an instance to a .mrpack file (Modrinth format) to share it.', { instance: INST, outFile: z.string().optional() }, async ({ instance, outFile }) => {
  const i = core.instances.get(instance);
  const out = outFile || path.join(require('os').homedir(), 'Desktop', core.util.slugify(i.name) + '.mrpack');
  return core.modpack.exportMrpack(i.id, out);
});

const transport = new StdioServerTransport();
await server.connect(transport);
