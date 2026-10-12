// Procedural 16x16 pixel textures (no Mojang assets) + isometric block icons + skin helpers.

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function shade([r, g, b], k) { return [Math.max(0, Math.min(255, r * k)), Math.max(0, Math.min(255, g * k)), Math.max(0, Math.min(255, b * k))]; }

function makeTex(seed, painter) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(16, 16);
  const r = rng(seed);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const col = painter(x, y, r);
    const i = (y * 16 + x) * 4;
    img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = col[3] === undefined ? 255 : col[3];
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const noisy = (base, amt) => (x, y, r) => shade(hexToRgb(base), 1 - amt / 2 + r() * amt);

function ore(base, color, seed) {
  const spots = [];
  const r = rng(seed * 7 + 3);
  for (let i = 0; i < 5; i++) spots.push([2 + Math.floor(r() * 12), 2 + Math.floor(r() * 12)]);
  const oc = hexToRgb(color);
  return (x, y, rr) => {
    for (const [sx, sy] of spots) {
      const d = Math.abs(x - sx) + Math.abs(y - sy);
      if (d <= 1) return shade(oc, 0.8 + rr() * 0.45 + (d === 0 ? 0.2 : 0));
    }
    return shade(hexToRgb(base), 0.8 + rr() * 0.35);
  };
}

const T = {};
function defineTextures() {
  if (T.grass_top) return T;
  T.grass_top = makeTex(11, noisy('#5ca83a', 0.45));
  T.dirt = makeTex(12, noisy('#866043', 0.5));
  T.grass_side = makeTex(13, (x, y, r) => {
    const edge = 3 + ((x * 7) % 3 === 0 ? 1 : 0) + (x % 5 === 2 ? 1 : 0);
    return y < edge ? shade(hexToRgb('#5ca83a'), 0.75 + r() * 0.4) : shade(hexToRgb('#866043'), 0.75 + r() * 0.5);
  });
  T.stone = makeTex(14, noisy('#7d7d7d', 0.35));
  T.cobble = makeTex(15, (x, y, r) => shade(hexToRgb('#7a7a7a'), ((x * 3 + y * 5) % 7 === 0 ? 0.6 : 0.85) + r() * 0.35));
  T.diamond = makeTex(16, ore('#7d7d7d', '#5ef2e6', 1));
  T.emerald = makeTex(17, ore('#7d7d7d', '#2ee86f', 2));
  T.gold = makeTex(18, ore('#7d7d7d', '#f8d33a', 3));
  T.redstone = makeTex(19, ore('#7d7d7d', '#e8231d', 4));
  T.lapis = makeTex(20, ore('#7d7d7d', '#2753d8', 5));
  T.copper = makeTex(21, ore('#7d7d7d', '#e6824e', 6));
  T.log = makeTex(22, (x, y, r) => shade(hexToRgb('#6b5130'), (x % 4 === 0 ? 0.7 : 0.95) + r() * 0.25));
  T.log_top = makeTex(23, (x, y, r) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.5) return shade(hexToRgb('#6b5130'), 0.9 + r() * 0.2);
    return shade(hexToRgb('#b8945f'), (Math.floor(d) % 2 ? 0.85 : 1) + r() * 0.1);
  });
  T.planks = makeTex(24, (x, y, r) => shade(hexToRgb('#a8834f'), (y % 4 === 3 ? 0.65 : 0.92) + ((x + (y >> 2) * 5) % 8 === 0 ? -0.2 : 0) + r() * 0.15));
  T.leaves = makeTex(25, (x, y, r) => (r() < 0.12 ? [0, 0, 0, 0] : shade(hexToRgb('#3f8f2c'), 0.6 + r() * 0.6)));
  T.cherry = makeTex(26, (x, y, r) => (r() < 0.1 ? [0, 0, 0, 0] : shade(hexToRgb('#f4a6c6'), 0.75 + r() * 0.4)));
  T.sand = makeTex(27, noisy('#dbcf9a', 0.2));
  T.ice = makeTex(28, (x, y, r) => [...shade(hexToRgb('#8fb6f0'), 0.9 + r() * 0.2 + ((x + y) % 9 === 0 ? 0.25 : 0)), 230]);
  T.obsidian = makeTex(29, (x, y, r) => shade(hexToRgb(r() < 0.15 ? '#4b2b78' : '#14101f'), 0.8 + r() * 0.4));
  T.netherrack = makeTex(30, noisy('#7a2a2a', 0.5));
  T.endstone = makeTex(31, noisy('#e3e2a6', 0.25));
  T.tnt_side = makeTex(32, (x, y, r) => (y >= 5 && y <= 10 ? (y === 5 || y === 10 ? [40, 40, 40] : (x % 4 === 1 && y > 6 && y < 9 ? [30, 30, 30] : [235, 235, 235])) : shade(hexToRgb('#d63b2b'), 0.8 + r() * 0.3 - (x % 4 === 0 ? 0.2 : 0))));
  T.tnt_top = makeTex(33, (x, y, r) => (Math.abs(x - 7.5) < 2 && Math.abs(y - 7.5) < 2 ? [60, 60, 60] : shade(hexToRgb('#d63b2b'), 0.75 + r() * 0.3)));
  T.crafting_top = makeTex(34, (x, y, r) => (x === 0 || y === 0 || x === 15 || y === 15 || x === 7 || y === 7 ? shade(hexToRgb('#5a3f22'), 0.9) : shade(hexToRgb('#a8834f'), 0.85 + r() * 0.2)));
  T.crafting_side = makeTex(35, (x, y, r) => (y < 3 ? shade(hexToRgb('#7a5a32'), 0.9 + r() * 0.2) : (y > 5 && y < 11 && x > 3 && x < 12 && (x + y) % 3 === 0 ? [120, 120, 130] : shade(hexToRgb('#a8834f'), (y % 4 === 3 ? 0.7 : 0.9) + r() * 0.15))));
  T.bookshelf = makeTex(36, (x, y, r) => {
    if (y < 2 || y > 13 || y === 7 || y === 8) return shade(hexToRgb('#a8834f'), 0.85 + r() * 0.2);
    const books = ['#b33a3a', '#3a6db3', '#3ab35a', '#c9a93a', '#8a3ab3'];
    return shade(hexToRgb(books[(x >> 1) % books.length]), 0.75 + r() * 0.3 - (x % 2 ? 0.15 : 0));
  });
  T.pumpkin = makeTex(37, (x, y, r) => shade(hexToRgb('#e08a1e'), (x % 4 === 0 ? 0.75 : 0.95) + r() * 0.15));
  T.pumpkin_face = makeTex(38, (x, y, r) => {
    const eye = (y >= 4 && y <= 6) && ((x >= 3 && x <= 5) || (x >= 10 && x <= 12));
    const mouth = y >= 9 && y <= 11 && x >= 3 && x <= 12 && !(y === 9 && (x === 6 || x === 9));
    return eye || mouth ? [255, 210, 80] : shade(hexToRgb('#e08a1e'), (x % 4 === 0 ? 0.75 : 0.95) + r() * 0.15);
  });
  T.amethyst = makeTex(39, (x, y, r) => shade(hexToRgb((x + y) % 5 === 0 ? '#d8b4fe' : '#8b5cf6'), 0.75 + r() * 0.45));
  T.slime = makeTex(40, (x, y, r) => (x > 3 && x < 12 && y > 3 && y < 12 ? shade(hexToRgb('#4fb848'), 0.85 + r() * 0.2) : [...shade(hexToRgb('#7ed96f'), 0.9 + r() * 0.2), 220]));
  T.glowstone = makeTex(41, (x, y, r) => shade(hexToRgb(r() < 0.3 ? '#fff3a8' : '#d9a23e'), 0.8 + r() * 0.4));
  T.sculk = makeTex(42, (x, y, r) => (r() < 0.07 ? [60, 230, 230] : shade(hexToRgb('#0f2a33'), 0.7 + r() * 0.6)));
  T.magma = makeTex(43, (x, y, r) => ((x * 5 + y * 3) % 11 < 2 || r() < 0.08 ? [255, 140, 30] : shade(hexToRgb('#3a1a10'), 0.7 + r() * 0.5)));
  T.water = makeTex(44, (x, y, r) => [...shade(hexToRgb('#2f6fd6'), 0.8 + r() * 0.25 + ((x + y * 2) % 7 === 0 ? 0.2 : 0)), 200]);
  T.snow = makeTex(45, noisy('#f2f6ff', 0.1));
  T.flower_red = makeTex(46, (x, y) => (x === 7 && y > 7 ? [60, 140, 40] : (Math.abs(x - 7) + Math.abs(y - 5) < 3 ? [230, 50, 50] : [0, 0, 0, 0])));
  T.flower_yellow = makeTex(47, (x, y) => (x === 7 && y > 8 ? [60, 140, 40] : (Math.abs(x - 7) + Math.abs(y - 6) < 3 ? [250, 220, 60] : [0, 0, 0, 0])));
  T.grass_plant = makeTex(48, (x, y, r) => ((x * 3 + 1) % 5 === 0 && y > 4 + (x % 4) * 2 ? shade(hexToRgb('#5ca83a'), 0.8 + r() * 0.4) : [0, 0, 0, 0]));
  T.pumpkin_top = makeTex(49, (x, y, r) => (Math.abs(x - 7.5) < 1.5 && Math.abs(y - 7.5) < 1.5 ? [90, 70, 30] : shade(hexToRgb('#d9861c'), 0.8 + r() * 0.25)));
  T.crafting_side2 = T.crafting_side;
  T.diamond_block = makeTex(50, (x, y, r) => shade(hexToRgb('#62ede4'), (x === 0 || y === 0 ? 1.15 : x === 15 || y === 15 ? 0.7 : 0.9) + r() * 0.15));
  T.gold_block = makeTex(51, (x, y, r) => shade(hexToRgb('#f6d03d'), (x === 0 || y === 0 ? 1.15 : x === 15 || y === 15 ? 0.7 : 0.9) + r() * 0.15));
  T.emerald_block = makeTex(52, (x, y, r) => shade(hexToRgb('#41d36b'), (x === 0 || y === 0 ? 1.15 : x === 15 || y === 15 ? 0.7 : 0.9) + r() * 0.15));
  T.netherite = makeTex(53, noisy('#433d40', 0.3));
  T.hay_top = makeTex(54, (x, y, r) => shade(hexToRgb('#c4a32e'), (Math.abs(x - 7.5) + Math.abs(y - 7.5)) % 3 < 1 ? 0.7 : 0.95 + r() * 0.1));
  T.hay_side = makeTex(55, (x, y, r) => (y === 3 || y === 12 ? [150, 30, 20] : shade(hexToRgb('#c4a32e'), (x % 3 === 0 ? 0.75 : 0.95) + r() * 0.1)));
  T.melon_top = makeTex(56, noisy('#7c9b2a', 0.25));
  T.melon_side = makeTex(57, (x, y, r) => shade(hexToRgb(x % 4 < 2 ? '#93b732' : '#5c7d1d'), 0.85 + r() * 0.2));
  T.furnace_top = makeTex(58, noisy('#6e6e6e', 0.3));
  T.furnace_side = makeTex(59, noisy('#7a7a7a', 0.3));
  T.furnace_front = makeTex(60, (x, y, r) => (x > 3 && x < 12 && y > 8 && y < 14 ? [40, 30, 30] : shade(hexToRgb('#7a7a7a'), 0.8 + r() * 0.3)));
  T.jukebox_top = makeTex(61, (x, y, r) => (Math.abs(x - 7.5) < 3 && Math.abs(y - 7.5) < 1 ? [20, 20, 20] : shade(hexToRgb('#7b5238'), 0.85 + r() * 0.2)));
  T.jukebox_side = makeTex(62, (x, y, r) => shade(hexToRgb('#7b5238'), (y % 4 === 0 ? 0.7 : 0.9) + r() * 0.2));
  T.cherry_log = makeTex(63, (x, y, r) => shade(hexToRgb('#3a2232'), (x % 4 === 0 ? 0.7 : 0.95) + r() * 0.25));
  T.cherry_log_top = makeTex(64, (x, y, r) => shade(hexToRgb('#e2a0a8'), 0.85 + r() * 0.2));
  T.beacon = makeTex(65, (x, y, r) => (x > 3 && x < 12 && y > 3 && y < 12 ? [180, 250, 245] : [...shade(hexToRgb('#9be8f0'), 0.8 + r() * 0.3), 200]));
  T.sea_lantern = makeTex(66, (x, y, r) => shade(hexToRgb('#cfe8e0'), 0.85 + r() * 0.25));
  T.prismarine = makeTex(67, (x, y, r) => shade(hexToRgb('#5fa898'), (y % 8 === 0 || (x + (y >> 3) * 4) % 8 === 0 ? 0.65 : 0.95) + r() * 0.1));
  T.quartz = makeTex(68, noisy('#ece6df', 0.08));
  T.bricks = makeTex(69, (x, y, r) => (y % 4 === 3 || (x + (y >> 2) % 2 * 4) % 8 === 0 ? [160, 155, 150] : shade(hexToRgb('#965a49'), 0.85 + r() * 0.2)));
  return T;
}

// ---------- real Minecraft textures (from the user's own client jar) ----------
let realLoaded = false;
const TINT = { grass_top: '#91bd59', leaves: '#8cc240', grass_plant: '#91bd59', water: '#3f76e4', grass_overlay: '#91bd59' };

function imgFrom(url) {
  return new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
}

function toTex(img, tint) {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const w = img.width;
  ctx.drawImage(img, 0, 0, w, w, 0, 0, 16, 16); // animated strips: first frame
  if (tint) {
    const d = ctx.getImageData(0, 0, 16, 16);
    const [R, G, B] = hexToRgb(tint);
    for (let i = 0; i < d.data.length; i += 4) { d.data[i] = d.data[i] * R / 255; d.data[i + 1] = d.data[i + 1] * G / 255; d.data[i + 2] = d.data[i + 2] * B / 255; }
    ctx.putImageData(d, 0, 0);
  }
  return c;
}

async function applyRealTextures(blocks) {
  if (!blocks) return false;
  defineTextures();
  const loaded = {};
  await Promise.all(Object.entries(blocks).map(async ([k, url]) => { if (url) { const i = await imgFrom(url); if (i) loaded[k] = i; } }));
  for (const [k, img] of Object.entries(loaded)) {
    if (k === 'grass_overlay') continue;
    T[k] = toTex(img, TINT[k]);
  }
  // grass side = dirt-like base + biome-tinted overlay, as the game renders it
  if (loaded.grass_side && loaded.grass_overlay) T.grass_side.getContext('2d').drawImage(toTex(loaded.grass_overlay, TINT.grass_overlay), 0, 0);
  realLoaded = Object.keys(loaded).length > 10;
  iconCache.clear();
  return realLoaded;
}
function hasRealTextures() { return realLoaded; }

// Mojang default skins (Steve, Alex, Ari…) from the same jar
let defaultSkins = [];
const defaultSkinImgs = new Map();
async function setDefaultSkins(list) {
  defaultSkins = list || [];
  await Promise.all(defaultSkins.map(async (s) => { const i = await imgFrom(s.url); if (i) defaultSkinImgs.set(s.id, i); }));
}
function getDefaultSkins() { return defaultSkins; }
function steveImage() { return defaultSkinImgs.get('steve-classic') || null; }

// block id -> [top, left, right] texture keys
const BLOCKS = {
  grass: ['grass_top', 'grass_side', 'grass_side'],
  stone: ['stone', 'stone', 'stone'],
  diamond: ['diamond', 'diamond', 'diamond'],
  emerald: ['emerald', 'emerald', 'emerald'],
  gold: ['gold', 'gold', 'gold'],
  redstone: ['redstone', 'redstone', 'redstone'],
  lapis: ['lapis', 'lapis', 'lapis'],
  copper: ['copper', 'copper', 'copper'],
  tnt: ['tnt_top', 'tnt_side', 'tnt_side'],
  crafting: ['crafting_top', 'crafting_side', 'crafting_side2'],
  bookshelf: ['planks', 'bookshelf', 'bookshelf'],
  obsidian: ['obsidian', 'obsidian', 'obsidian'],
  pumpkin: ['pumpkin_top', 'pumpkin_face', 'pumpkin'],
  ice: ['ice', 'ice', 'ice'],
  netherrack: ['netherrack', 'netherrack', 'netherrack'],
  endstone: ['endstone', 'endstone', 'endstone'],
  sand: ['sand', 'sand', 'sand'],
  log: ['log_top', 'log', 'log'],
  amethyst: ['amethyst', 'amethyst', 'amethyst'],
  slime: ['slime', 'slime', 'slime'],
  glowstone: ['glowstone', 'glowstone', 'glowstone'],
  sculk: ['sculk', 'sculk', 'sculk'],
  cherry: ['cherry', 'cherry', 'cherry'],
  magma: ['magma', 'magma', 'magma'],
  planks: ['planks', 'planks', 'planks'],
  leaves: ['leaves', 'leaves', 'leaves'],
  diamond_block: ['diamond_block', 'diamond_block', 'diamond_block'],
  gold_block: ['gold_block', 'gold_block', 'gold_block'],
  emerald_block: ['emerald_block', 'emerald_block', 'emerald_block'],
  netherite: ['netherite', 'netherite', 'netherite'],
  hay: ['hay_top', 'hay_side', 'hay_side'],
  melon: ['melon_top', 'melon_side', 'melon_side'],
  furnace: ['furnace_top', 'furnace_front', 'furnace_side'],
  jukebox: ['jukebox_top', 'jukebox_side', 'jukebox_side'],
  cherry_log: ['cherry_log_top', 'cherry_log', 'cherry_log'],
  beacon: ['beacon', 'beacon', 'beacon'],
  sea_lantern: ['sea_lantern', 'sea_lantern', 'sea_lantern'],
  prismarine: ['prismarine', 'prismarine', 'prismarine'],
  quartz: ['quartz', 'quartz', 'quartz'],
  bricks: ['bricks', 'bricks', 'bricks'],
};

const iconCache = new Map();

// Isometric block icon drawn with affine transforms
function blockIcon(id, size = 96) {
  const key = id + ':' + size;
  if (iconCache.has(key)) return iconCache.get(key);
  defineTextures();
  const faces = BLOCKS[id] || BLOCKS.grass;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const s = size / 2 / 16 * 0.9; // scale per texel
  const cx = size / 2, top = size * 0.05;
  const w = 16 * s * Math.cos(Math.PI / 6) * 1.0;
  const hgt = 16 * s * 0.5;
  const draw = (tex, a, b, c2, d, e, f, dark) => {
    ctx.save();
    ctx.setTransform(a, b, c2, d, e, f);
    ctx.drawImage(T[tex], 0, 0);
    if (dark) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, 16, 16); }
    ctx.restore();
  };
  const ux = w / 16, uy = hgt / 16;
  // top face: x axis goes right-down, y axis goes left-down
  draw(faces[0], ux, uy, -ux, uy, cx, top, 0);
  // left face
  draw(faces[1], ux, uy, 0, 16 * s / 16 * 1.0 * 1.0, cx - w, top + hgt, 0.18);
  // right face
  draw(faces[2], ux, -uy, 0, 16 * s / 16, cx, top + 2 * hgt, 0.36);
  iconCache.set(key, c);
  return c;
}

function iconCanvas(id, size = 96, cssSize) {
  const src = blockIcon(id, size * 2);
  const c = document.createElement('canvas');
  c.width = c.height = size * 2;
  c.getContext('2d').drawImage(src, 0, 0);
  c.className = 'pixel';
  if (cssSize) { c.style.width = cssSize + 'px'; c.style.height = cssSize + 'px'; }
  return c;
}

// Nebula logo: gradient isometric cube with a star
function logoCanvas(size = 104) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cs = getComputedStyle(document.documentElement);
  const a1 = cs.getPropertyValue('--a1').trim() || '#8b5cf6';
  const a2 = cs.getPropertyValue('--a2').trim() || '#22d3ee';
  const cx = size / 2, h = size * 0.25, w = size * 0.43, top = size * 0.08;
  const face = (pts, fill) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); };
  const g1 = ctx.createLinearGradient(0, 0, size, size); g1.addColorStop(0, a1); g1.addColorStop(1, a2);
  face([[cx, top], [cx + w, top + h], [cx, top + 2 * h], [cx - w, top + h]], g1);
  const g2 = ctx.createLinearGradient(0, top + h, 0, size); g2.addColorStop(0, a1); g2.addColorStop(1, '#1b1240');
  face([[cx - w, top + h], [cx, top + 2 * h], [cx, size - top], [cx - w, size - top - h]], g2);
  const g3 = ctx.createLinearGradient(0, top + h, 0, size); g3.addColorStop(0, a2); g3.addColorStop(1, '#0b1a3a');
  face([[cx + w, top + h], [cx, top + 2 * h], [cx, size - top], [cx + w, size - top - h]], g3);
  // star on top face
  ctx.save(); ctx.translate(cx, top + h); ctx.scale(1, 0.58);
  ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = size * 0.12;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const r = i % 2 ? size * 0.05 : size * 0.17; const a = i * Math.PI / 4; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); ctx.fill(); ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = size / 60;
  ctx.beginPath(); ctx.moveTo(cx - w, top + h); ctx.lineTo(cx, top); ctx.lineTo(cx + w, top + h); ctx.stroke();
  return c;
}

// ---------- skin helpers ----------
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

// Face (with hat layer) from a skin image
function headCanvas(img, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (img) {
    const k = img.width / 64;
    ctx.drawImage(img, 8 * k, 8 * k, 8 * k, 8 * k, 0, 0, size, size);
    ctx.drawImage(img, 40 * k, 8 * k, 8 * k, 8 * k, 0, 0, size, size);
  } else {
    ctx.fillStyle = '#2a2550'; ctx.fillRect(0, 0, size, size);
  }
  return c;
}

// Flat front view of the whole body (for library thumbnails)
function bodyCanvas(img, slim = false) {
  const c = document.createElement('canvas');
  c.width = 16; c.height = 32;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const k = img.width / 64;
  const legacy = img.height * 2 === img.width;
  const d = (sx, sy, w, h, dx, dy, flip) => {
    if (flip) { ctx.save(); ctx.translate(dx + w, dy); ctx.scale(-1, 1); ctx.drawImage(img, sx * k, sy * k, w * k, h * k, 0, 0, w, h); ctx.restore(); } else ctx.drawImage(img, sx * k, sy * k, w * k, h * k, dx, dy, w, h);
  };
  const aw = slim ? 3 : 4;
  d(8, 8, 8, 8, 4, 0); d(40, 8, 8, 8, 4, 0);
  d(20, 20, 8, 12, 4, 8);
  d(44, 20, aw, 12, 4 - aw, 8);
  if (legacy) d(44, 20, aw, 12, 12, 8, true); else d(36, 52, aw, 12, 12, 8);
  d(4, 20, 4, 12, 4, 20);
  if (legacy) d(4, 20, 4, 12, 8, 20, true); else d(20, 52, 4, 12, 8, 20);
  if (!legacy) { d(20, 36, 8, 12, 4, 8); d(44, 36, aw, 12, 4 - aw, 8); d(52, 52, aw, 12, 12, 8); d(4, 36, 4, 12, 4, 20); d(4, 52, 4, 12, 8, 20); }
  return c;
}

// Procedural skin generator (64x64 layout). Used for the default "Nebula" skin and the dice button.
// Random skin: a Mojang default skin with recoloured clothes and hair (keeps the real shading)
function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
function generateSkin(seed = Date.now()) {
  const bases = [...defaultSkinImgs.entries()];
  if (!bases.length) return proceduralSkin(seed);
  const r = rng(seed);
  const [baseId, img] = bases[Math.floor(r() * bases.length)];
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, 64, 64);
  const d = ctx.getImageData(0, 0, 64, 64);
  const shirtHue = r() * 360, pantsHue = r() * 360, hairHue = [20, 30, 40, 0, 270, 200, 120][Math.floor(r() * 7)];
  const hairLight = 0.6 + r() * 0.9, satK = 0.8 + r() * 0.5;
  const isSkin = (h, s, l) => h >= 8 && h <= 42 && s > 0.15 && s < 0.75 && l > 0.32 && l < 0.85;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const i = (y * 64 + x) * 4;
    if (!d.data[i + 3]) continue;
    const [h, s, l] = rgb2hsl(d.data[i], d.data[i + 1], d.data[i + 2]);
    if (s < 0.12 || l > 0.9) continue; // whites, greys, eyes
    if (isSkin(h, s, l) && !(y < 16 && l < 0.3)) continue;
    let nh = h, ns = Math.min(1, s * satK), nl = l;
    if (y < 16) { nh = hairHue + (h - 25); nl = Math.max(0.03, Math.min(0.85, l * hairLight)); ns = hairHue === 0 ? s * 0.4 : ns; }
    else if ((y < 48 && x < 16) || (y >= 48 && x < 32)) nh = h + pantsHue;
    else nh = h + shirtHue;
    const [R, G, B] = hsl2rgb(nh, ns, nl);
    d.data[i] = R; d.data[i + 1] = G; d.data[i + 2] = B;
  }
  ctx.putImageData(d, 0, 0);
  c.dataset.variant = baseId.endsWith('slim') ? 'slim' : 'classic';
  return c;
}

function proceduralSkin(seed = Date.now()) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const skinTone = pick(['#f1c7a5', '#e0ac85', '#c68e64', '#8d5a3c', '#f5d6c0', '#6b4630']);
  const hair = pick(['#2b1d14', '#5a3a22', '#d9b36c', '#1a1a1a', '#b84a2a', '#e8e1d0', '#6a3fc4', '#2a9ad8']);
  const shirt = pick(['#7c3aed', '#0ea5e9', '#16a34a', '#dc2626', '#f59e0b', '#0f766e', '#db2777', '#334155']);
  const pants = pick(['#1e293b', '#334155', '#3f2a1d', '#1e3a8a', '#111827', '#4c1d95']);
  const shoes = pick(['#111', '#3b2414', '#e5e7eb', '#7f1d1d']);
  const eyes = pick(['#3b82f6', '#16a34a', '#6b4630', '#8b5cf6', '#06b6d4']);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const fill = (x, y, w, h, col, noise = 0.08) => {
    const [R, G, B] = hexToRgb(col);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = 1 - noise / 2 + r() * noise;
      ctx.fillStyle = `rgb(${R * k | 0},${G * k | 0},${B * k | 0})`;
      ctx.fillRect(x + i, y + j, 1, 1);
    }
  };
  // head (all 6 faces area 0..32 x 0..16)
  fill(0, 0, 32, 16, skinTone, 0.06);
  fill(8, 0, 8, 8, hair); fill(16, 0, 8, 8, skinTone);
  fill(0, 8, 8, 3, hair); fill(16, 8, 8, 3, hair); fill(24, 8, 8, 8, hair); fill(8, 8, 8, 2, hair);
  fill(0, 11, 2, 5, hair); fill(22, 11, 2, 5, hair);
  // face details
  ctx.fillStyle = '#fff'; ctx.fillRect(9, 12, 2, 1); ctx.fillRect(13, 12, 2, 1);
  ctx.fillStyle = eyes; ctx.fillRect(10, 12, 1, 1); ctx.fillRect(13, 12, 1, 1);
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(11, 14, 2, 1);
  // body 16..40 x 16..32
  fill(16, 16, 24, 16, shirt);
  fill(20, 20, 8, 1, '#ffffff', 0.02);
  // logo star on chest
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(23, 23, 2, 2); ctx.fillRect(22, 24, 4, 0.5);
  // right arm 40..56 x 16..32, left arm 32..48 x 48..64
  fill(40, 16, 16, 16, shirt); fill(40, 26, 16, 6, skinTone);
  fill(32, 48, 16, 16, shirt); fill(32, 58, 16, 6, skinTone);
  // legs 0..16 x 16..32 and 16..32 x 48..64
  fill(0, 16, 16, 16, pants); fill(0, 29, 16, 3, shoes);
  fill(16, 48, 16, 16, pants); fill(16, 61, 16, 3, shoes);
  // hat layer: some hair volume
  if (r() < 0.6) { fill(40, 0, 8, 8, hair); fill(32, 8, 8, 2, hair); fill(40, 8, 8, 1, hair); fill(48, 8, 16, 2, hair); }
  return c;
}

export { applyRealTextures, hasRealTextures, setDefaultSkins, getDefaultSkins, steveImage, defineTextures, blockIcon, iconCanvas, logoCanvas, loadImage, headCanvas, bodyCanvas, generateSkin, BLOCKS, T as TEXTURES };
