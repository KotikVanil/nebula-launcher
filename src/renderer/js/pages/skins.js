// Skins: 3D viewer, library, one-click apply (Mojang upload or offline), import by file / nickname / URL / generator, capes.
import { api, state, listen, activeAccount, refreshAccounts, emit } from '../api.js';
import { h, icon, btn, busy, toast, promptDialog, confirmDialog, tabs } from '../ui.js';
import { loadImage, bodyCanvas, generateSkin } from '../blocks.js';
import { sfx } from '../sound.js';

let viewer = null;
let ro = null;
let offs = [];

const ANIMS = [
  ['idle', 'Стоять', 'person-standing', () => new skinview3d.IdleAnimation()],
  ['walk', 'Идти', 'footprints', () => new skinview3d.WalkingAnimation()],
  ['run', 'Бежать', 'zap', () => new skinview3d.RunningAnimation()],
  ['fly', 'Лететь', 'plane', () => new skinview3d.FlyingAnimation()],
  ['wave', 'Махать', 'hand', () => new skinview3d.WaveAnimation('right')],
  ['crouch', 'Присесть', 'arrow-down', () => new skinview3d.CrouchAnimation()],
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
  viewer.globalLight.intensity = 2.2;
  viewer.cameraLight.intensity = 1.0;
  const fit = () => { const r = stage.getBoundingClientRect(); viewer.width = Math.max(200, r.width); viewer.height = Math.max(200, r.height - bottom.offsetHeight); };
  ro = new ResizeObserver(fit); ro.observe(stage); fit();
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
      await api('skins.update', selected.id, { variant: nv });
      show(selected.url, nv);
      drawLib();
    }));
  };

  // account chip + nametag
  const accChip = stage.querySelector('#skin-acc-chip');
  accChip.replaceChildren(icon(acc && acc.type === 'msa' ? 'shield-check' : 'user'), acc ? `${acc.name} · ${acc.type === 'msa' ? 'лицензия' : 'оффлайн'}` : 'нет аккаунта');
  if (acc) viewer.nameTag = acc.name;

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
  function select(s) {
    selected = s; sfx('tick');
    lib.querySelectorAll('.skin-card').forEach((c, i) => c.classList.toggle('sel', skins[i] && skins[i].id === s.id));
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
    try { added(await api('skins.addBase64', c.toDataURL('image/png').split(',')[1], { name: 'Случайный #' + Math.floor(Math.random() * 999), source: 'gen' })); } catch (e) { toast(e.message, 'error'); }
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
  drawModel();
  const cur = await skinSrc(acc);
  if (params.select) { const s = skins.find((x) => x.id === params.select); if (s) select(s); }
  else if (cur && cur.id) { const s = skins.find((x) => x.id === cur.id); if (s) select(s); else show(cur.url, cur.variant); }
  else if (cur) show(cur.url, cur.variant);
  else show(generateSkin(2026).toDataURL(), 'classic');
  drawCapes();
  offs.push(listen('skins', drawLib), listen('accounts', () => { drawCapes(); const a = activeAccount(); if (a) viewer.nameTag = a.name; }));
}

export function destroy() {
  offs.forEach((f) => f()); offs = [];
  if (ro) ro.disconnect();
  if (viewer) { viewer.dispose(); viewer = null; }
}
