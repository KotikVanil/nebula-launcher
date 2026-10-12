#!/usr/bin/env node
// Nebula CLI: the same launcher core as the MCP server, for AI agents that prefer shell commands.
// Every command prints JSON. Run without arguments for help.
const core = require('../src/core');

const HELP = `Nebula Launcher CLI (JSON output)

  nebula instances                              list instances
  nebula instance <id>                          details + mods + health check
  nebula create <name> <mc> <loader> [ramMB]    new instance (loader: vanilla|fabric|quilt|forge|neoforge)
  nebula search <query> [--instance id] [--type mod|modpack|resourcepack|shader]
  nebula add <id> <slug> [slug...]              install from Modrinth (+ required dependencies)
  nebula remove <id> <slug|file> [...]          remove content
  nebula check <id>                             health check (missing deps, wrong loader, conflicts)
  nebula fix <id>                               install missing dependencies
  nebula updates <id> [--apply]                 list / apply mod updates
  nebula preset <id> <preset>                   performance|shaders|qol|map|visual|adventure|tech|magic
  nebula spec <file.json> [--instance id]       build a pack from a JSON spec (see docs/AI_GUIDE.md)
  nebula logs <id> [lines]                      last launch log + crash analysis
  nebula read <id> <path>                       read a file inside .minecraft
  nebula write <id> <path> <text|@file>         write a config file inside .minecraft
  nebula export <id> <out.mrpack>               export to Modrinth format
  nebula versions [--snapshots]                 Minecraft versions
  nebula loaders <loader> <mc>                  loader versions for a Minecraft version
`;

const argv = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) { const k = argv[i].slice(2); flags[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } else pos.push(argv[i]);
}
const out = (d) => { process.stdout.write(JSON.stringify(d, null, 2) + '\n'); };
const act = (a, d) => core.activity('cli', a, d);

async function main() {
  const [cmd, ...a] = pos;
  const I = (x) => core.instances.get(x).id;
  switch (cmd) {
    case 'instances': return out(core.instances.list().map((i) => ({ id: i.id, name: i.name, mc: i.mc, loader: i.loader })));
    case 'instance': { const id = I(a[0]); return out({ ...core.instances.get(id), mods: core.content.list(id, 'mod').map((m) => ({ title: m.title, file: m.file, enabled: m.enabled })), check: core.content.check(id) }); }
    case 'create': { const i = core.instances.create({ name: a[0], mc: a[1], loader: a[2] || 'vanilla', memory: a[3] ? { min: 2048, max: Number(a[3]) } : null }); act('create', { instanceId: i.id, name: i.name }); return out(i); }
    case 'search': {
      let mc, loader;
      if (flags.instance) { const i = core.instances.get(flags.instance); mc = i.mc; loader = i.loader; }
      const r = await core.modrinth.search({ query: a.join(' '), type: flags.type || 'mod', mc, loader, limit: 15 });
      return out(r.hits.map((h) => ({ slug: h.slug, title: h.title, downloads: h.downloads, description: h.description })));
    }
    case 'add': { const id = I(a[0]); const r = await core.modrinth.installMany(id, a.slice(1)); act('install', { instanceId: id, installed: r.installed.map((x) => x.title) }); return out(r); }
    case 'remove': {
      const id = I(a[0]); const removed = [];
      for (const it of a.slice(1)) for (const t of ['mod', 'resourcepack', 'shader']) {
        const m = core.content.list(id, t).find((x) => x.slug === it || x.filename === it || x.file === it);
        if (m) { core.content.remove(id, m.file); removed.push(m.title); }
      }
      act('remove', { instanceId: id, removed });
      return out({ removed });
    }
    case 'check': return out(core.content.check(I(a[0])));
    case 'fix': { const id = I(a[0]); const r = await core.modpack.fixMissing(id); act('install', { instanceId: id, installed: r.installed.map((x) => x.title) }); return out(r); }
    case 'updates': {
      const id = I(a[0]); const ups = await core.modrinth.checkUpdates(id);
      if (flags.apply) for (const u of ups) await core.modrinth.install(id, u.projectId, { versionId: u.versionId, update: true });
      return out({ updates: ups, applied: !!flags.apply });
    }
    case 'preset': { const id = I(a[0]); const r = await core.modpack.applyPreset(id, a[1]); act('install', { instanceId: id, installed: r.installed.map((x) => x.title) }); return out(r); }
    case 'spec': {
      const spec = JSON.parse(require('fs').readFileSync(a[0], 'utf8'));
      const r = await core.modpack.applySpec(spec, { instanceId: flags.instance ? I(flags.instance) : undefined });
      act('spec', { instanceId: r.instance.id, name: r.instance.name });
      return out(r);
    }
    case 'logs': { const id = I(a[0]); const log = core.launch.getLog(id).split('\n'); return out({ analysis: core.crash.analyze(id, log), log: log.slice(-(Number(a[1]) || 120)).join('\n') }); }
    case 'read': return process.stdout.write(core.files.readText(I(a[0]), a[1]));
    case 'write': {
      const id = I(a[0]);
      const text = a[2] && a[2].startsWith('@') ? require('fs').readFileSync(a[2].slice(1), 'utf8') : a.slice(2).join(' ');
      const f = await core.files.writeText(id, a[1], text); act('config', { instanceId: id, file: a[1] }); return out({ written: f });
    }
    case 'export': return out(await core.modpack.exportMrpack(I(a[0]), a[1]));
    case 'versions': return out((await core.versions.list({ snapshots: !!flags.snapshots })).slice(0, 80).map((v) => v.id));
    case 'loaders': return out((await core.loaders.listVersions(a[0], a[1])).slice(0, 30));
    default: process.stdout.write(HELP);
  }
}

main().catch((e) => { out({ error: e.message }); process.exit(1); });
