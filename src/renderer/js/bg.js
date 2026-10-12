// Living background: a procedural floating voxel island with day/night cycle, stars, nebula, clouds, fireflies.
import * as THREE from '../../../node_modules/three/build/three.module.js';
import { defineTextures, TEXTURES } from './blocks.js';

// ---------- noise ----------
function makeNoise(seed) {
  const perm = new Uint8Array(512);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const p = Array.from({ length: 256 }, (_, i) => i).sort(() => rnd() - 0.5);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  const n2 = (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    return lerp(lerp(grad(perm[a], x, y), grad(perm[b], x - 1, y), u), lerp(grad(perm[a + 1], x, y - 1), grad(perm[b + 1], x - 1, y - 1), u), v);
  };
  return (x, y, oct = 4) => { let f = 1, a = 1, t = 0, n = 0; for (let i = 0; i < oct; i++) { t += n2(x * f, y * f) * a; n += a; f *= 2; a *= 0.5; } return t / n; };
}

// ---------- atlas ----------
// One texture per block face (no atlas: no bleeding at distance). 16px art is upscaled x8 with
// nearest filtering so mipmaps + anisotropic filtering keep it crisp up close and calm far away.
function buildTextures(renderer) {
  defineTextures();
  const cache = new Map();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const S = 16, K = 8, N = S * K;
  return (key) => {
    if (cache.has(key)) return cache.get(key);
    const ctx = TEXTURES[key].getContext('2d', { willReadFrequently: true });
    const src = ctx.getImageData(0, 0, S, S).data;
    // colour bleeding: transparent pixels take the colour of opaque neighbours, so mipmaps
    // and filtering never pull black into leaf / grass edges (alpha stays 0)
    const px = new Uint8ClampedArray(src);
    for (let pass = 0; pass < 4; pass++) {
      const prev = new Uint8ClampedArray(px);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        if (src[i + 3] > 0 || prev[i] + prev[i + 1] + prev[i + 2] > 0) continue;
        let r = 0, g = 0, bl = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
          const j = (yy * S + xx) * 4;
          if (prev[j] + prev[j + 1] + prev[j + 2] === 0) continue;
          r += prev[j]; g += prev[j + 1]; bl += prev[j + 2]; n++;
        }
        if (n) { px[i] = r / n; px[i + 1] = g / n; px[i + 2] = bl / n; }
      }
    }
    // leaves: "fast graphics" style — holes filled with a darker leaf colour (no see-through speckle)
    if (key === 'leaves' || key === 'cherry') {
      for (let i = 0; i < px.length; i += 4) if (src[i + 3] < 128) { px[i] *= 0.72; px[i + 1] *= 0.72; px[i + 2] *= 0.72; px[i + 3] = 255; }
    }
    // nearest upscale x8 into raw data (DataTexture keeps RGB of transparent pixels; canvas would not)
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const si = (((S - 1 - Math.floor(y / K)) * S) + Math.floor(x / K)) * 4; // flip Y for GL
      const di = (y * N + x) * 4;
      data[di] = px[si]; data[di + 1] = px[si + 1]; data[di + 2] = px[si + 2]; data[di + 3] = px[si + 3];
    }
    const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = aniso;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    cache.set(key, t);
    return t;
  };
}

// block types
const B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, LOG: 4, LEAVES: 5, CHERRY: 6, SAND: 7, WATER: 8, DIAMOND: 9, GOLD: 10, EMERALD: 11, REDSTONE: 12, LAPIS: 13, COPPER: 14, AMETHYST: 15, GLOW: 16 };
const FACES = {
  [B.GRASS]: ['grass_top', 'grass_side', 'dirt'], [B.DIRT]: ['dirt', 'dirt', 'dirt'], [B.STONE]: ['stone', 'stone', 'stone'],
  [B.LOG]: ['log_top', 'log', 'log_top'], [B.LEAVES]: ['leaves', 'leaves', 'leaves'], [B.CHERRY]: ['cherry', 'cherry', 'cherry'],
  [B.SAND]: ['sand', 'sand', 'sand'], [B.WATER]: ['water', 'water', 'water'], [B.DIAMOND]: ['diamond', 'diamond', 'diamond'],
  [B.GOLD]: ['gold', 'gold', 'gold'], [B.EMERALD]: ['emerald', 'emerald', 'emerald'], [B.REDSTONE]: ['redstone', 'redstone', 'redstone'],
  [B.LAPIS]: ['lapis', 'lapis', 'lapis'], [B.COPPER]: ['copper', 'copper', 'copper'], [B.AMETHYST]: ['amethyst', 'amethyst', 'amethyst'], [B.GLOW]: ['glowstone', 'glowstone', 'glowstone'],
};
const SEE_THROUGH = new Set([B.AIR, B.LEAVES, B.CHERRY, B.WATER]);

class Voxels {
  constructor() { this.map = new Map(); this.min = [0, 0, 0]; this.max = [0, 0, 0]; }
  k(x, y, z) { return x + ',' + y + ',' + z; }
  set(x, y, z, b) { this.map.set(this.k(x, y, z), b); }
  get(x, y, z) { return this.map.get(this.k(x, y, z)) || 0; }
}

function generateIsland(seed, R, opts = {}) {
  const noise = makeNoise(seed);
  const v = new Voxels();
  const plants = [];
  let rs = seed * 7 + 1;
  const rnd = () => ((rs = (rs * 1103515245 + 12345) >>> 0) / 4294967296);
  const tops = [];
  for (let x = -R; x <= R; x++) for (let z = -R; z <= R; z++) {
    const d = Math.sqrt(x * x + z * z) / R + noise(x * 0.18 + 50, z * 0.18) * 0.35;
    if (d > 1) continue;
    const h = Math.round(2 + noise(x * 0.09, z * 0.09) * 6 + (1 - d) * 3 * (opts.hilly || 1));
    const depth = Math.round(Math.pow(1 - d, 0.75) * (opts.depth || 14) + noise(x * 0.3, z * 0.3) * 2);
    for (let y = h - depth; y <= h; y++) {
      let b = B.STONE;
      if (y === h) b = B.GRASS;
      else if (y > h - 3) b = B.DIRT;
      else if (rnd() < 0.045) b = [B.DIAMOND, B.GOLD, B.EMERALD, B.REDSTONE, B.LAPIS, B.COPPER, B.AMETHYST][Math.floor(rnd() * 7)];
      v.set(x, y, z, b);
    }
    tops.push([x, h, z, d]);
  }
  // pond
  if (opts.pond) {
    const [px, pz] = [Math.round(R * 0.25), Math.round(-R * 0.2)];
    let wl = 99;
    for (const [x, h, z] of tops) if (Math.hypot(x - px, z - pz) < 3.6) wl = Math.min(wl, h);
    for (const t of tops) {
      const [x, h, z] = t;
      const dd = Math.hypot(x - px, z - pz);
      if (dd < 3.6) { for (let y = wl; y <= h; y++) v.set(x, y, z, B.AIR); v.set(x, wl - 1, z, B.WATER); v.set(x, wl - 2, z, B.SAND); t[1] = -999; }
      else if (dd < 5 && v.get(x, h, z) === B.GRASS) v.set(x, h, z, B.SAND);
    }
  }
  // trees
  const treeCount = opts.trees || 0;
  const cand = tops.filter((t) => t[3] < 0.7 && t[1] > -999 && v.get(t[0], t[1], t[2]) === B.GRASS);
  const placed = [];
  for (let i = 0; i < treeCount * 6 && placed.length < treeCount; i++) {
    const t = cand[Math.floor(rnd() * cand.length)];
    if (!t || placed.some((p) => Math.hypot(p[0] - t[0], p[2] - t[2]) < 5)) continue;
    placed.push(t);
    const [x, h, z] = t;
    const leaf = placed.length === 2 && opts.cherry ? B.CHERRY : B.LEAVES;
    const th = 4 + Math.floor(rnd() * 2);
    for (let y = 1; y <= th; y++) v.set(x, h + y, z, B.LOG);
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = th - 2; dy <= th + 1; dy++) {
      const r2 = dx * dx + dz * dz + (dy - th + 0.5) * (dy - th + 0.5) * 1.3;
      if (r2 > 5.6 || (dx === 0 && dz === 0 && dy <= th)) continue;
      if (rnd() < 0.08) continue;
      if (!v.get(x + dx, h + dy, z + dz)) v.set(x + dx, h + dy, z + dz, leaf);
    }
  }
  // plants
  for (const [x, h, z] of tops) {
    if (h < -100 || v.get(x, h, z) !== B.GRASS || v.get(x, h + 1, z)) continue;
    const r = rnd();
    if (r < 0.06) plants.push([x, h + 1, z, 'flower_red']);
    else if (r < 0.11) plants.push([x, h + 1, z, 'flower_yellow']);
    else if (r < 0.32) plants.push([x, h + 1, z, 'grass_plant']);
  }
  // glowstone lantern under the island
  if (opts.glow) { let minY = 0; for (const k of v.map.keys()) { const [x, y, z] = k.split(',').map(Number); if (x === 0 && z === 0) minY = Math.min(minY, y); } v.set(0, minY - 1, 0, B.GLOW); }
  return { v, plants };
}

// face definitions: normal, corners (CCW), texture slot (0 top, 1 side, 2 bottom), base shade like MC (top 1, sides .8/.6, bottom .5)
const DIRS = [
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], f: 0, s: 1.0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], f: 2, s: 0.5 },
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], f: 1, s: 0.6 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], f: 1, s: 0.6 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], f: 1, s: 0.8 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], f: 1, s: 0.8 },
];
const AO_CURVE = [1, 0.8, 0.65, 0.5];

function buildMesh({ v, plants }, getTex) {
  const groups = new Map(); // texture key + kind -> buffers
  const grp = (tex, kind) => {
    const k = tex + '|' + kind;
    if (!groups.has(k)) groups.set(k, { tex, kind, p: [], n: [], u: [], c: [], i: [] });
    return groups.get(k);
  };
  const opaque = (x, y, z) => { const b = v.get(x, y, z); return b && !SEE_THROUGH.has(b) ? 1 : 0; };
  const quad = (g, corners, n, shades) => {
    const base = g.p.length / 3;
    corners.forEach((c, i) => { g.p.push(...c); g.n.push(...n); g.c.push(shades[i], shades[i], shades[i]); });
    g.u.push(0, 0, 1, 0, 1, 1, 0, 1);
    // flip the diagonal when AO is anisotropic (avoids the classic voxel AO artefact)
    if (shades[0] + shades[2] < shades[1] + shades[3]) g.i.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const [key, b] of v.map) {
    if (!b) continue;
    const [x, y, z] = key.split(',').map(Number);
    const kind = b === B.WATER ? 'water' : (b === B.LEAVES || b === B.CHERRY) ? 'leaves' : 'solid';
    for (const d of DIRS) {
      const nb = v.get(x + d.n[0], y + d.n[1], z + d.n[2]);
      if (b === B.WATER) { if (nb) continue; }
      else if (!SEE_THROUGH.has(nb) || nb === b) continue;
      const tex = FACES[b][d.f];
      const yTop = b === B.WATER && d.n[1] === 1 ? 0.85 : 1;
      const axis = d.n[0] ? 0 : d.n[1] ? 1 : 2;
      const shades = d.c.map((c) => {
        if (kind !== 'solid') return d.s;
        // smooth-lighting style vertex AO: two side neighbours + corner in front of the face
        const o = [x + d.n[0], y + d.n[1], z + d.n[2]];
        const off = [0, 1, 2].filter((a) => a !== axis).map((a) => { const s2 = [0, 0, 0]; s2[a] = c[a] ? 1 : -1; return s2; });
        const s1 = opaque(o[0] + off[0][0], o[1] + off[0][1], o[2] + off[0][2]);
        const s2 = opaque(o[0] + off[1][0], o[1] + off[1][1], o[2] + off[1][2]);
        const cr = opaque(o[0] + off[0][0] + off[1][0], o[1] + off[0][1] + off[1][1], o[2] + off[0][2] + off[1][2]);
        const level = s1 && s2 ? 3 : s1 + s2 + cr;
        return d.s * AO_CURVE[level];
      });
      const corners = d.c.map(([cx, cy, cz]) => [x + cx, y + (cy ? yTop : 0), z + cz]);
      quad(grp(tex, kind), corners, d.n, shades);
    }
  }
  for (const [x, y, z, tex] of plants) {
    // crossed planes; both windings as separate front faces with an upward normal, so the
    // back side is lit like the front (DoubleSide would flip the normal and turn grass black)
    const g = grp(tex, 'plant');
    const planes = [
      [[x + 0.15, y, z + 0.15], [x + 0.85, y, z + 0.85], [x + 0.85, y + 0.85, z + 0.85], [x + 0.15, y + 0.85, z + 0.15]],
      [[x + 0.85, y, z + 0.15], [x + 0.15, y, z + 0.85], [x + 0.15, y + 0.85, z + 0.85], [x + 0.85, y + 0.85, z + 0.15]],
    ];
    for (const c of planes) {
      quad(g, c, [0, 1, 0], [0.92, 0.92, 1, 1]);
      const base = g.p.length / 3;
      quad(g, c, [0, 1, 0], [0.92, 0.92, 1, 1]);
      g.i.splice(g.i.length - 6, 6, base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const out = new THREE.Group();
  for (const g of groups.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.u, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 3));
    geo.setIndex(g.i);
    const map = getTex(g.tex);
    const mat = g.kind === 'water'
      ? new THREE.MeshLambertMaterial({ map, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false })
      : g.kind === 'solid'
        ? new THREE.MeshLambertMaterial({ map, vertexColors: true })
        : new THREE.MeshLambertMaterial({ map, vertexColors: true, alphaTest: 0.5 });
    out.add(new THREE.Mesh(geo, mat));
  }
  return out;
}

// ---------- sky palette ----------
const KEYS = [
  { t: 0.0, top: '#05051a', hor: '#1d1545', sun: '#4060a0', amb: 0.45, sunI: 0.15, night: 1 },
  { t: 0.22, top: '#1a1a4a', hor: '#5a3a7a', sun: '#ff9a6a', amb: 0.4, sunI: 0.4, night: 0.6 },
  { t: 0.28, top: '#3a5aa8', hor: '#ff9a6c', sun: '#ffc08a', amb: 0.62, sunI: 0.9, night: 0.1 },
  { t: 0.4, top: '#2f6fe0', hor: '#9fd0ff', sun: '#fff2d8', amb: 0.85, sunI: 1.25, night: 0 },
  { t: 0.62, top: '#2f6fe0', hor: '#a8d4ff', sun: '#fff2d8', amb: 0.85, sunI: 1.2, night: 0 },
  { t: 0.73, top: '#3b3a8f', hor: '#ff7a6b', sun: '#ff9a5a', amb: 0.6, sunI: 0.85, night: 0.15 },
  { t: 0.8, top: '#1b1650', hor: '#7a3a8a', sun: '#c070ff', amb: 0.38, sunI: 0.3, night: 0.7 },
  { t: 1.0, top: '#05051a', hor: '#1d1545', sun: '#4060a0', amb: 0.45, sunI: 0.15, night: 1 },
];
const col = (h) => new THREE.Color(h);
function palette(t) {
  let a = KEYS[0], b = KEYS[1];
  for (let i = 0; i < KEYS.length - 1; i++) if (t >= KEYS[i].t && t <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
  const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
  return {
    top: col(a.top).lerp(col(b.top), k), hor: col(a.hor).lerp(col(b.hor), k), sun: col(a.sun).lerp(col(b.sun), k),
    amb: a.amb + (b.amb - a.amb) * k, sunI: a.sunI + (b.sunI - a.sunI) * k, night: a.night + (b.night - a.night) * k,
  };
}

function glowTexture(color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, color); g.addColorStop(0.25, color + 'aa'); g.addColorStop(1, color + '00');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cssColor(name, fb) { return (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb); }

export function initBackground(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping; // keep Minecraft colours as they are
  let quality = opts.quality || 'high';
  const setPR = () => renderer.setPixelRatio(quality === 'low' ? 0.75 : Math.min(window.devicePixelRatio, 2));
  setPR();

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x140f33, 60, 170);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);

  // sky dome
  const skyUni = { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() }, night: { value: 0 }, a1: { value: new THREE.Color(cssColor('--a1', '#8b5cf6')) }, a2: { value: new THREE.Color(cssColor('--a2', '#22d3ee')) } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: skyUni, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float night; uniform vec3 a1; uniform vec3 a2; varying vec3 vP;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*n(p); p*=2.03; a*=.5; } return s; }
      void main(){ float y = clamp(vP.y, -0.2, 1.0); vec3 c = mix(hor, top, smoothstep(-0.05, 0.6, y));
        float sd = max(dot(normalize(vP), normalize(sunDir)), 0.0); c += sunCol * (pow(sd, 6.0) * 0.35 + pow(sd, 200.0) * 1.5) * (1.0 - night * 0.7);
        vec2 q = vP.xz / (vP.y + 0.6) * 1.6; float neb = fbm(q * 1.3 + 3.0); float neb2 = fbm(q * 2.2 - 7.0);
        vec3 nebula = a1 * smoothstep(0.45, 0.85, neb) * 0.55 + a2 * smoothstep(0.55, 0.9, neb2) * 0.35;
        c += nebula * night * smoothstep(0.0, 0.5, y);
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  scene.add(sky);

  // stars
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 1600; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 350;
    const y = Math.abs(u) * 0.95 + 0.05;
    const rr = Math.sqrt(1 - y * y);
    sp.push(Math.cos(th) * rr * r, y * r, Math.sin(th) * rr * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // sun / moon sprites
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('#fff3c4'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  sun.scale.set(70, 70, 1);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('#cfd8ff'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  moon.scale.set(40, 40, 1);
  scene.add(sun, moon);

  // lights
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a2a40, 0.8);
  const dir = new THREE.DirectionalLight(0xffffff, 1);
  scene.add(hemi, dir);

  // world
  const atlas = buildTextures(renderer);
  const world = new THREE.Group();
  const main = buildMesh(generateIsland(opts.seed || 4242, 14, { trees: 6, pond: true, cherry: true, depth: 15, glow: true }), atlas);
  world.add(main);
  const islets = [];
  const isletRing = new THREE.Group();
  world.add(isletRing);
  // [angle from the camera side (PI = behind the big island), distance, height, radius, seed]
  [[Math.PI - 0.75, 40, 10, 4, 31], [Math.PI + 0.7, 44, 15, 3, 77], [Math.PI + 1.25, 36, -6, 3, 123], [Math.PI - 1.3, 38, -2, 3, 999]].forEach(([ang, dist, y, r, s], i) => {
    const m = buildMesh(generateIsland(s, r, { trees: r > 3 ? 1 : 0, depth: 6, hilly: 0.5 }), atlas);
    m.position.set(Math.cos(ang) * dist, y, Math.sin(ang) * dist);
    m.userData = { baseY: y, ph: i * 1.7 };
    isletRing.add(m);
    islets.push(m);
  });
  scene.add(world);

  // under-island glow light
  const glowLight = new THREE.PointLight(0xffd27a, 0, 30, 1.6);
  glowLight.position.set(0.5, -12, 0.5);
  scene.add(glowLight);

  // clouds
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, emissive: 0x222233 });
  const clouds = new THREE.Group();
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group();
    const parts = 2 + Math.floor(Math.random() * 4);
    for (let j = 0; j < parts; j++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(6 + Math.random() * 10, 2, 5 + Math.random() * 8), cloudMat);
      m.position.set(j * 6 - parts * 3, 0, (Math.random() - 0.5) * 6);
      g.add(m);
    }
    g.position.set((Math.random() - 0.5) * 220, 22 + Math.random() * 14, (Math.random() - 0.5) * 220);
    g.userData.speed = 0.6 + Math.random() * 0.8;
    clouds.add(g);
  }
  scene.add(clouds);

  // fireflies / pollen
  const FF = 140;
  const ffGeo = new THREE.BufferGeometry();
  const ffPos = new Float32Array(FF * 3), ffSeed = new Float32Array(FF);
  for (let i = 0; i < FF; i++) { ffPos[i * 3] = (Math.random() - 0.5) * 34; ffPos[i * 3 + 1] = Math.random() * 14 - 2; ffPos[i * 3 + 2] = (Math.random() - 0.5) * 34; ffSeed[i] = Math.random() * 100; }
  ffGeo.setAttribute('position', new THREE.BufferAttribute(ffPos, 3));
  const ffMat = new THREE.PointsMaterial({ map: glowTexture('#fff7a0'), size: 0.9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
  const fireflies = new THREE.Points(ffGeo, ffMat);
  scene.add(fireflies);

  // falling block bursts (easter egg)
  const bursts = [];

  // ---------- state ----------
  let mode = opts.timeOfDay || 'auto';
  let mouseX = 0, mouseY = 0, tmx = 0, tmy = 0;
  let running = true, focused = true, lastFrame = 0, raf = 0;
  const t0 = performance.now();
  const onMouse = (e) => { tmx = e.clientX / window.innerWidth - 0.5; tmy = e.clientY / window.innerHeight - 0.5; };
  window.addEventListener('mousemove', onMouse);

  function timeValue(now) {
    if (mode === 'day') return 0.47;
    if (mode === 'sunset') return 0.735;
    if (mode === 'night') return 0.02;
    if (mode === 'sunrise') return 0.255;
    if (mode === 'cycle') return ((now - t0) / 1000 / 240 + 0.3) % 1;
    const d = new Date();
    return (d.getHours() + d.getMinutes() / 60) / 24;
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // shift the island to the right part of the screen (UI lives on the left)
    camera.setViewOffset(w, h, -w * (opts.offset ?? 0.17), 0, w, h);
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!running) return;
    const minDt = focused ? 1000 / 50 : 1000 / 12;
    if (now - lastFrame < minDt) return;
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const time = (now - t0) / 1000;

    const t = timeValue(now);
    const p = palette(t);
    skyUni.top.value.copy(p.top); skyUni.hor.value.copy(p.hor); skyUni.sunCol.value.copy(p.sun); skyUni.night.value = p.night;
    scene.fog.color.copy(p.hor).lerp(p.top, 0.25);
    const ang = (t - 0.25) * Math.PI * 2;
    const sd = new THREE.Vector3(Math.cos(ang) * 0.9, Math.sin(ang), 0.35).normalize();
    skyUni.sunDir.value.copy(sd);
    sun.position.copy(sd).multiplyScalar(300); moon.position.copy(sd).multiplyScalar(-300);
    sun.material.opacity = Math.max(0, Math.min(1, sd.y * 4 + 0.3)); moon.material.opacity = Math.max(0, Math.min(1, -sd.y * 4 + 0.3));
    dir.position.copy(sd.y > -0.05 ? sd : sd.clone().negate()).multiplyScalar(50);
    dir.color.copy(sd.y > -0.05 ? p.sun : new THREE.Color('#8fa0ff'));
    dir.intensity = sd.y > -0.05 ? p.sunI * 0.85 : 0.35;
    hemi.intensity = p.amb * 0.95 + p.night * 0.2;
    hemi.color.copy(p.top).lerp(new THREE.Color('#ffffff'), 0.5);
    starMat.opacity = p.night * 0.95 * (0.85 + Math.sin(time * 1.3) * 0.05);
    stars.rotation.y = time * 0.004;
    glowLight.intensity = 3 + p.night * 25;
    ffMat.opacity = 0.25 + p.night * 0.75;
    ffMat.color.set(p.night > 0.5 ? '#fff7a0' : '#ffffff');
    ffMat.size = p.night > 0.5 ? 0.9 : 0.35;
    cloudMat.color.copy(p.hor).lerp(new THREE.Color('#ffffff'), 0.65);
    cloudMat.opacity = 0.75 - p.night * 0.35;

    // camera orbit + parallax
    mouseX += (tmx - mouseX) * 0.04; mouseY += (tmy - mouseY) * 0.04;
    const orbit = time * 0.035 + mouseX * 0.5;
    const r = 74;
    camera.position.set(Math.cos(orbit) * r, 13 + mouseY * -6 + Math.sin(time * 0.2) * 0.6, Math.sin(orbit) * r);
    camera.lookAt(0, -1 + mouseY * 2, 0);

    world.position.y = Math.sin(time * 0.5) * 0.35;
    isletRing.rotation.y = -orbit;
    for (const m of islets) m.position.y = m.userData.baseY + Math.sin(time * 0.6 + m.userData.ph) * 0.8;
    for (const c of clouds.children) { c.position.x += c.userData.speed * dt * 2; if (c.position.x > 120) c.position.x = -120; }
    const pa = ffGeo.attributes.position;
    for (let i = 0; i < FF; i++) {
      const s = ffSeed[i];
      pa.array[i * 3] += Math.sin(time * 0.5 + s) * dt * 0.6;
      pa.array[i * 3 + 1] += Math.cos(time * 0.7 + s * 1.3) * dt * 0.4;
      pa.array[i * 3 + 2] += Math.sin(time * 0.4 + s * 0.7) * dt * 0.6;
    }
    pa.needsUpdate = true;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.userData.v.y -= 22 * dt;
      b.position.addScaledVector(b.userData.v, dt);
      b.rotation.x += dt * 3; b.rotation.y += dt * 2;
      if (b.position.y < -60) { scene.remove(b); bursts.splice(i, 1); }
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  const onVis = () => { running = !document.hidden; };
  document.addEventListener('visibilitychange', onVis);

  return {
    setMode(m) { mode = m; },
    setQuality(q) { quality = q; setPR(); resize(); },
    setFocused(f) { focused = f; },
    pause(p) { running = !p; },
    refreshAccent() { skyUni.a1.value.set(cssColor('--a1', '#8b5cf6')); skyUni.a2.value.set(cssColor('--a2', '#22d3ee')); },
    burst(n = 40) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const keys = ['grass_top', 'diamond', 'gold', 'emerald', 'redstone', 'amethyst', 'planks', 'stone'];
      for (let i = 0; i < n; i++) {
        const tex = new THREE.CanvasTexture(TEXTURES[keys[i % keys.length]]);
        tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
        const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
        m.position.set((Math.random() - 0.5) * 4, 8, (Math.random() - 0.5) * 4);
        m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 18, 12 + Math.random() * 14, (Math.random() - 0.5) * 18);
        scene.add(m); bursts.push(m);
      }
    },
    destroy() { cancelAnimationFrame(raf); window.removeEventListener('mousemove', onMouse); window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', onVis); renderer.dispose(); },
  };
}
