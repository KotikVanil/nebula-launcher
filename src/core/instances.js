// Instances (Prism-style): each one has its own .minecraft with mods, saves, configs.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const P = require('./paths');
const settings = require('./settings');
const { readJSON, writeJSON, exists, slugify, copyDir, dirSize } = require('./util');

const ICONS = ['grass', 'stone', 'diamond', 'emerald', 'gold', 'redstone', 'tnt', 'crafting', 'bookshelf', 'obsidian', 'pumpkin', 'ice', 'netherrack', 'endstone', 'sand', 'log', 'amethyst', 'copper', 'slime', 'glowstone', 'sculk', 'cherry', 'lapis', 'magma',
  'diamond_block', 'gold_block', 'emerald_block', 'netherite', 'hay', 'melon', 'furnace', 'jukebox', 'cherry_log', 'beacon', 'sea_lantern', 'prismarine', 'quartz', 'bricks', 'leaves', 'planks'];

function file(id) { return path.join(P.instanceDir(id), 'instance.json'); }

function normalize(inst) {
  return {
    loader: 'vanilla', loaderVersion: null, versionId: null, icon: 'grass', group: '',
    memory: null, jvmArgs: '', javaPath: '', resolution: null, notes: '',
    playtime: 0, lastPlayed: 0, created: Date.now(), offlineSkins: true, ...inst,
  };
}

function list() {
  let ids = [];
  try { ids = fs.readdirSync(P.instances); } catch {}
  return ids.map((id) => {
    const d = readJSON(file(id));
    return d ? normalize({ ...d, id }) : null;
  }).filter(Boolean).sort((a, b) => (b.lastPlayed || b.created) - (a.lastPlayed || a.created));
}

function get(id) {
  const d = readJSON(file(id));
  if (!d) {
    // allow lookup by name for AI convenience
    const byName = list().find((i) => i.name.toLowerCase() === String(id).toLowerCase());
    if (byName) return byName;
    throw new Error(`Сборка «${id}» не найдена`);
  }
  return normalize({ ...d, id });
}

function uniqueId(name) {
  const base = slugify(name);
  let id = base, n = 2;
  while (exists(P.instanceDir(id))) id = `${base}-${n++}`;
  return id;
}

function create({ name, mc, loader = 'vanilla', loaderVersion = null, icon, group = '', memory = null, notes = '' }) {
  if (!name) throw new Error('Нужно имя сборки');
  if (!mc) throw new Error('Нужна версия Minecraft');
  const id = uniqueId(name);
  const inst = normalize({
    id, name, mc, loader, loaderVersion, group, memory, notes,
    icon: icon || ICONS[Math.floor(Math.random() * ICONS.length)], created: Date.now(),
  });
  fs.mkdirSync(path.join(P.gameDir(id), 'mods'), { recursive: true });
  for (const d of ['resourcepacks', 'shaderpacks', 'saves', 'config']) fs.mkdirSync(path.join(P.gameDir(id), d), { recursive: true });
  writeJSON(file(id), inst);
  return inst;
}

function update(id, patch) {
  const cur = get(id);
  const next = { ...cur, ...patch, id: cur.id };
  // changing version or loader invalidates the installed version id
  if ((patch.mc && patch.mc !== cur.mc) || (patch.loader && patch.loader !== cur.loader) || ('loaderVersion' in patch && patch.loaderVersion !== cur.loaderVersion)) {
    next.versionId = null;
  }
  writeJSON(file(cur.id), next);
  return normalize(next);
}

async function remove(id) {
  const inst = get(id);
  await fsp.mkdir(P.trash, { recursive: true });
  const dst = path.join(P.trash, `${inst.id}-${Date.now()}`);
  await fsp.rename(P.instanceDir(inst.id), dst);
  return { trashed: dst };
}

async function duplicate(id, newName) {
  const src = get(id);
  const name = newName || `${src.name} (копия)`;
  const nid = uniqueId(name);
  await copyDir(P.instanceDir(src.id), P.instanceDir(nid));
  const inst = { ...src, id: nid, name, created: Date.now(), playtime: 0, lastPlayed: 0 };
  writeJSON(file(nid), inst);
  return normalize(inst);
}

function effectiveMemory(inst) {
  const s = settings.get();
  return { min: (inst.memory && inst.memory.min) || s.memoryMin, max: (inst.memory && inst.memory.max) || s.memoryMax };
}

async function stats(id) {
  const inst = get(id);
  const gd = P.gameDir(inst.id);
  const count = (d, re) => { try { return fs.readdirSync(path.join(gd, d)).filter((f) => re.test(f)).length; } catch { return 0; } };
  return {
    mods: count('mods', /\.jar$/i),
    modsDisabled: count('mods', /\.jar\.disabled$/i),
    resourcepacks: count('resourcepacks', /\.(zip)$|^[^.]+$/i),
    shaderpacks: count('shaderpacks', /\.zip$/i),
    saves: count('saves', /.*/),
    screenshots: count('screenshots', /\.png$/i),
    size: await dirSize(P.instanceDir(inst.id)),
  };
}

module.exports = { ICONS, list, get, create, update, remove, duplicate, effectiveMemory, stats, file };
