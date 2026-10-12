// Real Minecraft look without shipping Mojang assets: textures and default skins are read from the
// client jar the launcher downloads from Mojang anyway (on the user's own machine), then cached.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const P = require('./paths');
const net = require('./net');
const versions = require('./versions');
const { readJSON, writeJSON, exists, cmpVersionTuple } = require('./util');

const OUT = path.join(P.cache, 'mc-assets');
const MARK = path.join(OUT, 'index.json');

// our key -> candidate block texture names (first found wins)
const BLOCK_FILES = {
  grass_top: ['grass_block_top'], grass_side: ['grass_block_side'], grass_overlay: ['grass_block_side_overlay'],
  dirt: ['dirt'], stone: ['stone'], cobble: ['cobblestone'],
  diamond: ['diamond_ore'], emerald: ['emerald_ore'], gold: ['gold_ore'], redstone: ['redstone_ore'], lapis: ['lapis_ore'], copper: ['copper_ore'],
  log: ['oak_log'], log_top: ['oak_log_top'], planks: ['oak_planks'], leaves: ['oak_leaves'], cherry: ['cherry_leaves'],
  sand: ['sand'], ice: ['ice'], obsidian: ['obsidian'], netherrack: ['netherrack'], endstone: ['end_stone'],
  tnt_side: ['tnt_side'], tnt_top: ['tnt_top'], crafting_top: ['crafting_table_top'], crafting_side: ['crafting_table_front'], crafting_side2: ['crafting_table_side'],
  bookshelf: ['bookshelf'], pumpkin: ['pumpkin_side'], pumpkin_top: ['pumpkin_top'], pumpkin_face: ['carved_pumpkin'],
  amethyst: ['amethyst_block'], slime: ['slime_block'], glowstone: ['glowstone'], sculk: ['sculk'], magma: ['magma'],
  water: ['water_still'], snow: ['snow'], flower_red: ['poppy'], flower_yellow: ['dandelion'], grass_plant: ['short_grass', 'grass'],
  diamond_block: ['diamond_block'], gold_block: ['gold_block'], emerald_block: ['emerald_block'], netherite: ['netherite_block'],
  hay_top: ['hay_block_top'], hay_side: ['hay_block_side'], melon_top: ['melon_top'], melon_side: ['melon_side'],
  furnace_top: ['furnace_top'], furnace_front: ['furnace_front'], furnace_side: ['furnace_side'],
  jukebox_top: ['jukebox_top'], jukebox_side: ['jukebox_side'], cherry_log: ['cherry_log'], cherry_log_top: ['cherry_log_top'],
  beacon: ['beacon'], sea_lantern: ['sea_lantern'], prismarine: ['prismarine_bricks'], quartz: ['quartz_block_side'], bricks: ['bricks'],
};

const SKIN_NAMES = { steve: 'Стив', alex: 'Алекс', ari: 'Ари', efe: 'Эфе', kai: 'Кай', makena: 'Макена', noor: 'Нур', sunny: 'Санни', zuri: 'Зури' };

let pending = null;

function newestJar() {
  const list = versions.installedVersions()
    .filter((id) => /^(1\.\d+(\.\d+)?|\d{2}\.\d+(\.\d+)?)$/.test(id) && exists(P.versionJar(id)))
    .sort((a, b) => cmpVersionTuple(b, a));
  return list[0] || null;
}

async function downloadLatestJar() {
  const latest = await versions.latest();
  const v = await versions.loadJson(latest.release);
  const c = v.downloads.client;
  await net.download(c.url, P.versionJar(v.id), { sha1: c.sha1, size: c.size });
  return v.id;
}

function extract(jarId) {
  const zip = new AdmZip(P.versionJar(jarId));
  fs.mkdirSync(path.join(OUT, 'block'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'skins'), { recursive: true });
  const blocks = {};
  for (const [key, names] of Object.entries(BLOCK_FILES)) {
    for (const n of names) {
      const e = zip.getEntry(`assets/minecraft/textures/block/${n}.png`) || zip.getEntry(`assets/minecraft/textures/blocks/${n}.png`);
      if (!e) continue;
      fs.writeFileSync(path.join(OUT, 'block', key + '.png'), e.getData());
      blocks[key] = key + '.png';
      break;
    }
  }
  const skins = [];
  for (const e of zip.getEntries()) {
    const m = /^assets\/minecraft\/textures\/entity\/(?:player\/(wide|slim)\/)?(steve|alex|ari|efe|kai|makena|noor|sunny|zuri)\.png$/.exec(e.entryName);
    if (!m) continue;
    const variant = m[1] === 'slim' || (!m[1] && m[2] === 'alex') ? 'slim' : 'classic';
    const file = `${m[2]}-${variant}.png`;
    if (skins.some((s) => s.file === file)) continue;
    fs.writeFileSync(path.join(OUT, 'skins', file), e.getData());
    skins.push({ id: m[2] + '-' + variant, name: (SKIN_NAMES[m[2]] || m[2]) + (variant === 'slim' && m[2] !== 'alex' ? ' (тонкий)' : variant === 'classic' && m[2] === 'alex' ? ' (широкий)' : ''), variant, file });
  }
  const order = Object.keys(SKIN_NAMES);
  skins.sort((a, b) => order.indexOf(a.id.split('-')[0]) - order.indexOf(b.id.split('-')[0]) || (a.variant === 'classic' ? -1 : 1));
  const idx = { jar: jarId, blocks, skins, extracted: Date.now() };
  writeJSON(MARK, idx);
  return idx;
}

// Returns {blocks: {key: absPath}, skins: [{id,name,variant,path}]}; downloads one client jar if nothing is installed yet.
async function ensure({ allowDownload = true } = {}) {
  let idx = readJSON(MARK);
  const jar = newestJar();
  const stale = !idx || (jar && idx.jar !== jar && cmpVersionTuple(jar, idx.jar) > 0) || Object.keys(idx.blocks || {}).length < 10;
  if (stale) {
    if (!pending) {
      pending = (async () => {
        let id = jar;
        if (!id) { if (!allowDownload) return null; id = await downloadLatestJar(); }
        return extract(id);
      })().finally(() => { pending = null; });
    }
    idx = await pending;
    if (!idx) return null;
  }
  return {
    jar: idx.jar,
    blocks: Object.fromEntries(Object.entries(idx.blocks).map(([k, f]) => [k, path.join(OUT, 'block', f)])),
    skins: idx.skins.map((s) => ({ ...s, path: path.join(OUT, 'skins', s.file) })),
  };
}

module.exports = { ensure, BLOCK_FILES };
