// Skins: 3D viewer, library, one-click apply (Mojang upload or offline), import by file / nickname / URL / generator, capes.
import { api, state, listen, activeAccount, refreshAccounts, emit } from '../api.js';
import { h, icon, btn, busy, toast, promptDialog, confirmDialog, tabs } from '../ui.js';
import { loadImage, bodyCanvas, generateSkin, getDefaultSkins } from '../blocks.js';
import { mcAnimation } from '../mcanim.js';
import { sfx } from '../sound.js';

let viewer = null;
let ro = null;
let offs = [];

// Minecraft-accurate animations (HumanoidModel formulas) + a couple of skinview3d extras
let lookTarget = { x: 0, y: 0 };
const getLook = () => lookTarget;
const ANIMS = [
  ['idle', 'Стоять', 'person-standing', () => mcAnimation('idle', getLook)],
  ['walk', 'Идти', 'footprints', () => mcAnimation('walk', getLook)],
  ['run', 'Бежать', 'zap', () => mcAnimation('run', getLook)],
  ['crouch', 'Шифт', 'arrow-down', () => mcAnimation('crouch', getLook)],
  ['attack', 'Удар', 'swords', () => mcAnimation('attack', getLook)],
  ['sit', 'Сидеть', 'armchair', () => mcAnimation('sit', getLook)],
  ['fly', 'Элитры', 'plane', () => new skinview3d.FlyingAnimation()],
  ['wave', 'Махать', 'hand', () => new skinview3d.WaveAnimation('right')],
];

async function skinSrc(acc) {
  if (!acc) return null;
  if (acc.skinId) { const s = (await api('skins.list')).find((x) => x.id === acc.skinId); if (s) return { url: s.url, variant: acc.skinVariant || s.variant, id: s.id }; }
  if (acc.skinUrl) { try { return { url: await api('app.fetchDataUrl', acc.skinUrl), variant: acc.skinVariant }; } catch {} }
  return null;
}

export async function render(root, params = {}) {
  const acc = activeAccount();
  let selected = null;
  let anim = 'idle';
  let elytra = false;

  const canvas = h('canvas.viewer');
  const stage = h('.card.skin-stage', h('.platform'), canvas);
  const animBar = h('.row.wrap', { style: { gap: '6px' } });
  const modelBar = h('div');
  const bottom = h('.stage-bottom', animBar, h('.grow'), modelBar);
  stage.append(h('.stage-top', h('span.chip', icon('mouse-pointer-2'), 'Крути мышкой'), h('.grow'), h('span.chip#skin-acc-chip')), bottom);

  const lib = h('.skin-lib');
  const defaultsBox = h('.skin-lib');
  const capesBox = h('div');
  const applyBtn = btn('Применить к аккаунту', { icon: 'wand-sparkles', cls: 'primary' });
  const right = h('.col', { style: { minHeight: 0, overflow: 'auto', gap: '14px' } },
    h('.card', h('h3', icon('upload'), 'Добавить скин'),
      h('.dropzone', 'Перетащи PNG-файл в любое место окна', h('br'), h('span.dim', { style: { fontSize: '12px' } }, '64×64 или 64×32')),
      h('.row.wrap', { style: { marginTop: '12px', gap: '8px' } },
        btn('Файл', { icon: 'file-image', onclick: fromFile }),
        btn('По нику игрока', { icon: 'at-sign', onclick: fromNick }),
        btn('По ссылке', { icon: 'link', onclick: fromUrl }),
        btn('Случайный', { icon: 'dices', onclick: randomSkin }))),
    h('.card', h('h3', icon('library'), 'Библиотека', h('span.grow'), applyBtn), lib),
    h('.card', h('h3', icon('users'), 'Стандартные скины Minecraft'), h('p.muted', { style: { fontSize: '12.5px', marginBottom: '10px' } }, 'Взяты из файлов игры. Выбери и нажми «Применить к аккаунту».'), defaultsBox),
    capesBox);

  root.append(
    h('.page-head', h('div', h('h1', 'Скины ', h('span.grad', '3D')), h('.sub', 'Лицензия — скин загружается в Mojang. Оффлайн — лаунчер сам покажет скин в игре, без модов.'))),
    h('.skins-layout', stage, right));

  // ---------- viewer ----------
  viewer = new skinview3d.SkinViewer({ canvas, width: 400, height: 500, zoom: 0.68, fov: 45, enableControls: true });
  viewer.background = null;
  try { viewer.renderer.setClearColor(0x000000, 0); } catch {}
  viewer.autoRotate = false;
  viewer.controls.enableZoom = true;
  viewer.globalLight.intensity = 3.2;
  try { viewer.playerWrapper.rotation.y = -0.42; } catch {}
  viewer.cameraLight.intensity = 1.0;
  const fit = () => { const r = stage.getBoundingClientRect(); viewer.width = Math.max(200, r.width); viewer.height = Math.max(200, r.height - bottom.offsetHeight); };
  ro = new ResizeObserver(fit); ro.observe(stage); fit();
  // inventory-style: the player looks at the mouse cursor
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    lookTarget = { x: (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y: (e.clientY - (r.top + r.height * 0.3)) / (r.height / 2) };
  };
  window.addEventListener('mousemove', onMove);
  offs.push(() => window.removeEventListener('mousemove', onMove));
  const setAnim = (id) => {
    anim = id;
    viewer.animation = ANIMS.find((a) => a[0] === id)[3]();
    animBar.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.id === id));
  };
  animBar.append(...ANIMS.map(([id, label, ic]) => h('span.chip.btnlike', { dataset: { id }, onclick: () => { sfx('tick'); setAnim(id); } }, icon(ic), label)),
    h('span.chip.btnlike', { onclick: (e) => { viewer.autoRotate = !viewer.autoRotate; e.currentTarget.classList.toggle('on', viewer.autoRotate); sfx('tick'); } }, icon('rotate-3d'), 'Вращать'));
  setAnim('idle');

  const show = async (src, variant) => {
    try {
      await viewer.loadSkin(src, { model: variant === 'slim' ? 'slim' : variant === 'classic' ? 'default' : 'auto-detect' });
    } catch (e) { console.error(e); }
  };

  const drawModel = () => {
    const v = selected ? selected.variant : 'classic';
    modelBar.replaceChildren(tabs([{ id: 'classic', label: 'Steve (4px)' }, { id: 'slim', label: 'Alex (3px)' }], v, async (nv) => {
      if (!selected) return;
      selected.variant = nv;
      show(selected.url, nv);
      if (selected.isDefault) return;
      await api('skins.update', selected.id, { variant: nv });
      drawLib();
    }));
  };

  // account chip + nametag
  const accChip = stage.querySelector('#skin-acc-chip');
  accChip.replaceChildren(icon(acc && acc.type === 'msa' ? 'shield-check' : 'user'), acc ? `${acc.name} · ${acc.type === 'msa' ? 'лицензия' : 'оффлайн'}` : 'нет аккаунта');


  // ---------- library ----------
  let skins = [];
  async function drawLib() {
    skins = await api('skins.list');
    const accNow = activeAccount();
    if (!skins.length) {
      lib.replaceChildren(h('.empty', { style: { gridColumn: '1/-1', padding: '20px' } }, h('p', 'Библиотека пуста. Добавь скин файлом, по нику или нажми «Случайный».')));
      return;
    }
    lib.replaceChildren(...skins.map((s, i) => {
      const c = h('.skin-card' + (selected && selected.id === s.id ? '.sel' : '') + (accNow && accNow.skinId === s.id ? '.applied' : ''), { onclick: () => select(s), oncontextmenu: (e) => skinMenu(e, s) },
        h('canvas', { width: 16, height: 32 }), h('.n', s.name), h('.v', s.variant === 'slim' ? 'Alex' : 'Steve'));
      c.style.animationDelay = i * 20 + 'ms';
      loadImage(s.url).then((img) => { const cv = bodyCanvas(img, s.variant === 'slim'); c.querySelector('canvas').getContext('2d').drawImage(cv, 0, 0); }).catch(() => {});
      return c;
    }));
  }
  function drawDefaults() {
    const list = getDefaultSkins();
    if (!list.length) { defaultsBox.replaceChildren(h('.muted', { style: { gridColumn: '1/-1', fontSize: '12.5px' } }, 'Появятся после первой загрузки игры (лаунчер возьмёт их из файлов Minecraft).')); return; }
    defaultsBox.replaceChildren(...list.map((d) => {
      const c = h('.skin-card', { onclick: () => select({ ...d, isDefault: true }) }, h('canvas', { width: 16, height: 32 }), h('.n', d.name), h('.v', d.variant === 'slim' ? 'Alex' : 'Steve'));
      c.dataset.sid = d.id;
      loadImage(d.url).then((img) => c.querySelector('canvas').getContext('2d').drawImage(bodyCanvas(img, d.variant === 'slim'), 0, 0));
      return c;
    }));
  }
  function select(s) {
    selected = s; sfx('tick');
    lib.querySelectorAll('.skin-card').forEach((c, i) => c.classList.toggle('sel', !s.isDefault && skins[i] && skins[i].id === s.id));
    defaultsBox.querySelectorAll('.skin-card').forEach((c) => c.classList.toggle('sel', !!s.isDefault && c.dataset.sid === s.id));
    show(s.url, s.variant);
    drawModel();
  }
  function skinMenu(e, s) {
    import('../ui.js').then(({ menu }) => menu({ x: e.clientX, y: e.clientY }, [
      { icon: 'pencil', label: 'Переименовать', onclick: async () => { const n = await promptDialog('', { title: 'Имя скина', value: s.name }); if (n) { await api('skins.update', s.id, { name: n }); drawLib(); } } },
      { icon: 'download', label: 'Сохранить PNG', onclick: () => api('skins.export', s.id) },
      { icon: 'trash-2', label: 'Удалить', danger: true, onclick: async () => { if (await confirmDialog(`Удалить скин «${s.name}» из библиотеки?`, { ok: 'Удалить', danger: true })) { await api('skins.remove', s.id); if (selected && selected.id === s.id) selected = null; drawLib(); } } },
    ]));
  }

  applyBtn.onclick = busy(applyBtn, async () => {
    const a = activeAccount();
    if (!a) return toast('Сначала добавь аккаунт', 'error');
    if (!selected) return toast('Выбери скин в библиотеке', 'error');
    if (selected.isDefault) { const lib2 = await api('skins.addDefault', selected.id); selected = { ...lib2, url: selected.url }; }
    await api('skins.apply', a.id, selected.id, selected.variant);
    await refreshAccounts();
    sfx('levelup');
    viewer.animation = new skinview3d.WaveAnimation('right');
    setTimeout(() => setAnim(anim), 2200);
    toast(a.type === 'msa' ? 'Скин загружен в Mojang — его увидят все игроки' : 'Скин появится в игре (одиночка и LAN). Для серверов — мод CustomSkinLoader', 'ok', 'Скин применён');
    drawLib();
  });

  // ---------- imports ----------
  async function added(s) { toast(`«${s.name}» в библиотеке`, 'ok'); await drawLib(); select(skins.find((x) => x.id === s.id) || skins[0]); }
  async function fromFile() {
    const f = await api('app.pickFile', [{ name: 'PNG', extensions: ['png'] }], 'Выбери скин');
    if (f) try { added(await api('skins.addFile', f)); } catch (e) { toast(e.message, 'error'); }
  }
  async function fromNick() {
    const n = await promptDialog('Скин любого лицензионного игрока скопируется в твою библиотеку.', { title: 'Скин по нику', placeholder: 'Notch' });
    if (n) try { added(await api('skins.fromNickname', n)); } catch (e) { toast(e.message, 'error'); }
  }
  async function fromUrl() {
    const u = await promptDialog('Прямая ссылка на PNG', { title: 'Скин по ссылке', placeholder: 'https://…/skin.png' });
    if (u) try { added(await api('skins.fromUrl', u)); } catch (e) { toast(e.message, 'error'); }
  }
  async function randomSkin() {
    const c = generateSkin(Math.floor(Math.random() * 1e9));
    sfx('pop');
    try { added(await api('skins.addBase64', c.toDataURL('image/png').split(',')[1], { name: 'Случайный #' + Math.floor(Math.random() * 999), source: 'gen', variant: c.dataset.variant || 'classic' })); } catch (e) { toast(e.message, 'error'); }
  }

  // ---------- capes (Microsoft) ----------
  async function drawCapes() {
    const a = activeAccount();
    if (!a || a.type !== 'msa') { capesBox.replaceChildren(h('.card', h('h3', icon('flag'), 'Плащи'), h('p.muted', { style: { fontSize: '12.5px' } }, 'Плащи доступны лицензионным аккаунтам. В оффлайне можно посмотреть элитры:'), h('.row', { style: { marginTop: '10px' } }, btn('Элитры на превью', { icon: 'feather', cls: 'sm', onclick: () => { elytra = !elytra; viewer.loadCape(elytra ? capeTexture() : null, { backEquipment: 'elytra' }); } })))); return; }
    const row = h('.cape-row');
    const active = (a.capes || []).find((c) => c.active);
    const none = h('.cape' + (!active ? '.on' : ''), { onclick: async () => { await api('skins.setCape', a.id, null); await refreshAccounts(); drawCapes(); viewer.loadCape(null); } }, 'нет');
    row.append(none);
    for (const c of a.capes || []) {
      const el = h('.cape' + (c.active ? '.on' : ''), { title: c.alias, onclick: async () => { try { await api('skins.setCape', a.id, c.id); await refreshAccounts(); drawCapes(); toast(`Плащ «${c.alias}» надет`, 'ok'); } catch (e) { toast(e.message, 'error'); } } }, h('canvas', { width: 10, height: 16 }));
      api('app.fetchDataUrl', c.url).then(loadImage).then((img) => { const k = img.width / 64; el.querySelector('canvas').getContext('2d').drawImage(img, 1 * k, 1 * k, 10 * k, 16 * k, 0, 0, 10, 16); }).catch(() => {});
      row.append(el);
    }
    capesBox.replaceChildren(h('.card', h('h3', icon('flag'), 'Плащи'), (a.capes || []).length ? row : h('p.muted', 'У аккаунта нет плащей'), h('.row', { style: { marginTop: '10px' } }, btn('Элитры', { icon: 'feather', cls: 'sm', onclick: async () => { elytra = !elytra; if (active) viewer.loadCape(await api('app.fetchDataUrl', active.url), { backEquipment: elytra ? 'elytra' : 'cape' }); } }))));
    if (active) api('app.fetchDataUrl', active.url).then((d) => viewer.loadCape(d)).catch(() => {});
  }

  function capeTexture() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 32;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 22, 17); g.addColorStop(0, getComputedStyle(document.documentElement).getPropertyValue('--a1')); g.addColorStop(1, getComputedStyle(document.documentElement).getPropertyValue('--a2'));
    x.fillStyle = g; x.fillRect(0, 0, 64, 32);
    return c.toDataURL();
  }

  await drawLib();
  drawDefaults();
  drawModel();
  const cur = await skinSrc(acc);
  if (params.select) { const s = skins.find((x) => x.id === params.select); if (s) select(s); }
  else if (cur && cur.id) { const s = skins.find((x) => x.id === cur.id); if (s) select(s); else show(cur.url, cur.variant); }
  else if (cur) show(cur.url, cur.variant);
  else { const st = getDefaultSkins().find((d) => d.id === 'steve-classic'); show(st ? st.url : generateSkin(2026).toDataURL(), 'classic'); }
  drawCapes();
  offs.push(listen('skins', drawLib), listen('accounts', () => { drawCapes();  }));
}

export function destroy() {
  offs.forEach((f) => f()); offs = [];
  if (ro) ro.disconnect();
  if (viewer) { viewer.dispose(); viewer = null; }
}
