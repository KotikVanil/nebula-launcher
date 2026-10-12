// App shell: titlebar, sidebar, router, background, global events.
import { api, on, state, emit, listen, refreshInstances, refreshAccounts, activeAccount, isRunning, selectInstance } from './api.js';
import { h, $, icon, toast, popover, closePopover, modal, btn, plural } from './ui.js';
import { logoCanvas, headCanvas, loadImage, iconCanvas, generateSkin, applyRealTextures, setDefaultSkins, steveImage } from './blocks.js';
import { sfx, setSoundEnabled } from './sound.js';
import { initBackground } from './bg.js';
import { openLogin } from './pages/account.js';
import { openWizard } from './pages/wizard.js';
import { showCrash } from './pages/crash.js';

const PAGES = {
  home: () => import('./pages/home.js'),
  instances: () => import('./pages/instances.js'),
  instance: () => import('./pages/instance.js'),
  catalog: () => import('./pages/catalog.js'),
  skins: () => import('./pages/skins.js'),
  ai: () => import('./pages/ai.js'),
  settings: () => import('./pages/settings.js'),
};
const DENSE = new Set(['instances', 'instance', 'catalog', 'settings', 'skins', 'ai']);

let current = { name: null, mod: null, el: null, params: null };
let bg = null;

export async function navigate(name, params = {}) {
  closePopover();
  const mod = await PAGES[name]();
  if (current.mod && current.mod.destroy) try { current.mod.destroy(); } catch {}
  const main = $('#main');
  if (current.el) { const old = current.el; old.classList.add('leaving'); setTimeout(() => old.remove(), 200); }
  const el = h('.page');
  main.append(el);
  current = { name, mod, el, params };
  document.body.classList.toggle('page-dense', DENSE.has(name));
  for (const b of document.querySelectorAll('.nav-btn')) b.classList.toggle('active', b.dataset.page === (name === 'instance' ? 'instances' : name));
  try { await mod.render(el, params); } catch (e) { console.error(e); el.append(h('.empty', h('h4', 'Ошибка страницы'), h('p', e.message))); }
}
window.__navigate = navigate;
window.__nav = { navigate };
export function currentPage() { return current; }

// ---------- titlebar ----------
function titlebar() {
  const running = h('.tb-group#tb-running');
  const dl = h('button.tb-pill#tb-downloads', { title: 'Загрузки', onclick: (e) => openTasks(e.currentTarget) }, icon('arrow-down-to-line'), h('span#tb-dl-text', 'Загрузки'));
  return h('#titlebar',
    h('.brand', h('b', 'NEBULA'), h('span', 'LAUNCHER')),
    h('.spacer'),
    running,
    h('.tb-group', dl),
    h('.tb-group', { style: { marginLeft: '8px' } },
      h('button.win-btn', { onclick: () => api('app.minimize') }, icon('minus')),
      h('button.win-btn', { onclick: () => api('app.maximize') }, icon('square')),
      h('button.win-btn.close', { onclick: () => api('app.close') }, icon('x'))));
}

function renderRunning() {
  const g = $('#tb-running');
  g.replaceChildren();
  for (const r of state.running) {
    const inst = state.instances.find((i) => i.id === r.instanceId);
    const pill = h('button.tb-pill.running', { title: 'Остановить игру', onclick: () => api('game.kill', r.instanceId) }, h('span.dot'), h('span', 'В игре: ' + (inst ? inst.name : r.instanceId)), icon('square'));
    g.append(pill);
  }
  for (const b of document.querySelectorAll('.nav-btn[data-page=home] .live')) b.remove();
  if (state.running.length) document.querySelector('.nav-btn[data-page=home]').append(h('span.live'));
}

function renderDownloads() {
  const active = [...state.tasks.values()].filter((t) => t.status === 'running');
  const pill = $('#tb-downloads');
  const txt = $('#tb-dl-text');
  pill.querySelector('.badge-count')?.remove();
  pill.querySelector('.dl-ring')?.remove();
  if (active.length) {
    const t = active[0];
    const p = t.total ? t.done / t.total : 0;
    txt.textContent = (t.total ? Math.round(p * 100) + '% · ' : '') + t.stage.slice(0, 34);
    const ring = h('.dl-ring', { html: `<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,.15)" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="url(#g)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(p || 0.25) * 94} 94"><animateTransform attributeName="transform" type="rotate" from="0 18 18" to="360 18 18" dur="${t.total ? 0 : 1}s" repeatCount="indefinite"/></circle><defs><linearGradient id="g"><stop offset="0" stop-color="var(--a1)"/><stop offset="1" stop-color="var(--a2)"/></linearGradient></defs></svg>` });
    pill.prepend(ring);
    pill.querySelector('svg.lucide')?.classList.add('hidden');
    if (active.length > 1) pill.append(h('span.badge-count', String(active.length)));
  } else {
    txt.textContent = 'Загрузки';
    pill.querySelector('svg.hidden')?.classList.remove('hidden');
  }
}

function openTasks(anchor) {
  const list = [...state.tasks.values()].sort((a, b) => b.started - a.started);
  const content = list.length ? list.map((t) => {
    const p = t.total ? Math.round(t.done / t.total * 100) : 0;
    return h('.task',
      h('.row', h('.tt.grow', t.title), t.status === 'running' ? h('button.btn.ghost.icon.sm', { title: 'Отменить', onclick: () => api('tasks.cancel', t.id) }, icon('x')) : h('span.chip', t.status === 'done' ? '✓ готово' : t.status === 'cancelled' ? 'отменено' : 'ошибка')),
      h('.ts', t.error || t.stage + (t.total ? ` · ${t.done}/${t.total}` : '')),
      t.status === 'running' ? h('.bar' + (t.total ? '' : '.indet'), h('i', { style: { width: p + '%' } })) : null);
  }) : h('.empty', { style: { padding: '24px' } }, icon('package-check'), 'Нет загрузок');
  popover(anchor, h('div', { style: { maxHeight: '420px', overflowY: 'auto' } }, content), { width: 360 });
}

// ---------- sidebar ----------
function sidebar() {
  const nav = (page, ic, tip, cls = '') => h('button.nav-btn' + cls, { dataset: { page }, onclick: () => { sfx('tab'); navigate(page); }, onmouseenter: () => sfx('hover') }, icon(ic), h('span.tip', tip));
  const logo = h('.logo', { title: 'Nebula' }, logoCanvas(104));
  let clicks = 0, ct;
  logo.onclick = () => {
    clicks++; clearTimeout(ct); ct = setTimeout(() => (clicks = 0), 900);
    if (clicks >= 5) { clicks = 0; creeper(); }
    else navigate('home');
  };
  return h('#sidebar',
    logo,
    nav('home', 'house', 'Главная'),
    nav('instances', 'layers', 'Сборки'),
    nav('catalog', 'compass', 'Каталог модов'),
    nav('skins', 'shirt', 'Скины'),
    h('.nav-sep'),
    nav('ai', 'sparkles', 'ИИ-мастерская', '.ai-btn'),
    h('.sidebar-bottom',
      nav('settings', 'settings', 'Настройки'),
      h('button.account-btn#acc-btn', { onclick: (e) => openAccounts(e.currentTarget) })));
}

const DEFAULT_SKIN = (() => { let c = null; return () => steveImage() || (c = c || generateSkin(2026)); })();
async function headFor(acc, size = 64) {
  if (!acc) return headCanvas(null, size);
  try {
    let url = null;
    if (acc.skinId) { const s = (await api('skins.list')).find((x) => x.id === acc.skinId); if (s) url = s.url; }
    if (!url && acc.skinUrl) url = await api('app.fetchDataUrl', acc.skinUrl);
    if (!url) return headCanvas(DEFAULT_SKIN(), size);
    return headCanvas(await loadImage(url), size);
  } catch { return headCanvas(DEFAULT_SKIN(), size); }
}
export { headFor };

async function renderAccountBtn() {
  const b = $('#acc-btn');
  const acc = activeAccount();
  const head = await headFor(acc);
  b.replaceChildren(head, h('span.acc-type', icon(acc && acc.type === 'msa' ? 'shield-check' : acc ? 'user' : 'user-plus')));
  b.title = acc ? `${acc.name} (${acc.type === 'msa' ? 'Microsoft' : 'оффлайн'})` : 'Добавить аккаунт';
}

async function openAccounts(anchor) {
  const { list, active } = state.accounts;
  const rows = await Promise.all(list.map(async (a) => {
    const head = await headFor(a, 32);
    head.style.cssText = 'width:32px;height:32px;border-radius:8px;image-rendering:pixelated';
    return h('.menu-item', { onclick: async () => { await api('accounts.setActive', a.id); await refreshAccounts(); closePopover(); toast(`Аккаунт: ${a.name}`, 'ok'); } },
      head, h('.grow', h('div', { style: { fontWeight: 700, color: 'var(--text)' } }, a.name), h('div.muted', { style: { fontSize: '11.5px' } }, a.type === 'msa' ? 'Microsoft · лицензия' : 'Оффлайн')),
      a.id === active ? icon('check') : null);
  }));
  popover(anchor, h('div',
    h('div', { style: { padding: '8px 12px 4px', fontFamily: 'var(--display)', fontSize: '12px', letterSpacing: '.12em', color: 'var(--muted)' } }, 'АККАУНТЫ'),
    rows,
    h('.menu-sep'),
    h('.menu-item', { onclick: () => { closePopover(); openLogin(); } }, icon('user-plus'), 'Добавить аккаунт'),
    h('.menu-item', { onclick: () => { closePopover(); navigate('skins'); } }, icon('shirt'), 'Сменить скин'),
    h('.menu-item', { onclick: () => { closePopover(); navigate('settings', { section: 'accounts' }); } }, icon('users'), 'Управление аккаунтами')), { align: 'side', width: 280 });
}

// ---------- background ----------
function applyVisualSettings(s) {
  document.documentElement.dataset.accent = s.accent || 'nebula';
  document.body.classList.toggle('reduce-motion', !!s.reduceMotion);
  setSoundEnabled(s.uiSounds !== false);
  const canvas = $('#bg-canvas');
  if (s.liveBackground !== false) {
    canvas.classList.remove('hidden');
    if (!bg) {
      try { bg = initBackground(canvas, { quality: s.backgroundQuality, timeOfDay: s.timeOfDay }); } catch (e) { console.error('bg', e); canvas.classList.add('hidden'); }
    } else { bg.pause(false); bg.setMode(s.timeOfDay); bg.setQuality(s.backgroundQuality); bg.refreshAccent(); }
  } else {
    canvas.classList.add('hidden');
    if (bg) bg.pause(true);
  }
  const logo = document.querySelector('.logo');
  if (logo) logo.replaceChildren(logoCanvas(104));
}
export function getBackground() { return bg; }

// ---------- easter eggs ----------
function creeper() {
  sfx('hiss');
  toast('Ссссс...', 'info', 'Криппер рядом');
  setTimeout(() => {
    sfx('boom');
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 600);
    if (bg) bg.burst(60);
  }, 1500);
}
const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let kpos = 0;
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, [contenteditable=true]')) return;
  kpos = e.key === KONAMI[kpos] ? kpos + 1 : (e.key === KONAMI[0] ? 1 : 0);
  if (kpos === KONAMI.length) {
    kpos = 0;
    sfx('levelup');
    toast('Режим «Ночь звездопада» включён до перезапуска', 'ai', '↑↑↓↓←→←→BA');
    if (bg) { bg.setMode('cycle'); bg.burst(120); }
  }
  if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); navigate('catalog'); }
});

// ---------- drag & drop: skins, mods, mrpacks anywhere ----------
function setupDrop() {
  let depth = 0;
  window.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { depth++; document.body.classList.add('dragging-file'); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging-file'); });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); depth = 0; document.body.classList.remove('dragging-file');
    const files = [...e.dataTransfer.files].map((f) => window.nebula.pathForFile(f)).filter(Boolean);
    if (!files.length) return;
    const pngs = files.filter((f) => /\.png$/i.test(f));
    const packs = files.filter((f) => /\.mrpack$/i.test(f));
    const jars = files.filter((f) => /\.(jar|zip)$/i.test(f));
    for (const p of pngs) {
      try { const s = await api('skins.addFile', p); toast(`Скин «${s.name}» добавлен в библиотеку`, 'ok'); emit('skins'); if (current.name !== 'skins') navigate('skins', { select: s.id }); } catch (err) { toast(err.message, 'error'); }
    }
    for (const p of packs) api('modpack.importFile', p).then((inst) => { toast(`Сборка «${inst.name}» импортирована`, 'ok'); refreshInstances(); }).catch((err) => toast(err.message, 'error'));
    if (jars.length) {
      const target = current.name === 'instance' ? current.params.id : state.selected;
      if (!target) return toast('Сначала создайте сборку', 'error');
      const n = await api('content.dropFiles', target, jars);
      const inst = state.instances.find((i) => i.id === target);
      toast(`${plural(n, 'файл', 'файла', 'файлов')} добавлено в «${inst ? inst.name : target}»`, 'ok');
      emit('content-changed', target);
    }
  });
}

// ---------- boot ----------
async function boot() {
  const app = $('#app');
  app.append(titlebar(), sidebar(), h('#main'));
  document.body.append(h('#toasts'), h('.drop-overlay', h('.box', icon('download'), h('h3', 'Бросай файлы сюда'), h('p.muted', 'PNG — скин · JAR — мод · ZIP — ресурспак/шейдер · MRPACK — сборка'))));
  setupDrop();

  state.info = await api('app.info');
  state.settings = await api('settings.get');
  // real Minecraft textures from the local client jar (downloaded once if no version is installed yet)
  const texP = api('textures.get').then(async (t) => { if (t) { await applyRealTextures(t.blocks); await setDefaultSkins(t.skins); } return !!t; }).catch(() => false);
  const quick = await Promise.race([texP, new Promise((r) => setTimeout(() => r('slow'), 2500))]);
  if (quick === 'slow') texP.then((ok) => { if (!ok) return; if (bg) { bg.destroy(); bg = null; applyVisualSettings(state.settings); } renderAccountBtn(); if (current.name) navigate(current.name, current.params); });
  applyVisualSettings(state.settings);
  listen('settings', applyVisualSettings);

  await Promise.all([refreshInstances(), refreshAccounts()]);
  state.running = await api('game.running');
  for (const t of await api('tasks.list')) state.tasks.set(t.id, t);
  renderAccountBtn();
  listen('accounts', renderAccountBtn);
  renderRunning(); renderDownloads();

  on('task', (t) => {
    state.tasks.set(t.id, t);
    renderDownloads();
    emit('task', t);
    if (t.status === 'error') toast(t.error, 'error', t.title);
  });
  on('game:start', (e) => { state.running.push({ instanceId: e.instanceId, pid: e.pid, started: Date.now() }); renderRunning(); emit('running'); sfx('launch'); });
  on('game:exit', (e) => {
    state.running = state.running.filter((r) => r.instanceId !== e.instanceId);
    renderRunning(); emit('running'); refreshInstances();
    if (e.code !== 0 && e.code !== null && e.seconds < 36000) showCrash(e);
  });
  on('game:log', (batch) => emit('game:log', batch));
  on('instances:changed', () => { refreshInstances(); emit('content-changed', null); });
  on('activity', (ev) => {
    emit('activity', ev);
    const inst = state.instances.find((i) => i.id === ev.instanceId);
    const what = { create: 'создал сборку', install: 'установил моды', remove: 'удалил моды', update: 'обновил сборку', config: 'изменил настройки', launch: 'запустил игру', spec: 'собрал сборку' }[ev.action] || ev.action;
    toast(`${what}${inst ? ' в «' + inst.name + '»' : ev.name ? ' «' + ev.name + '»' : ''}`, 'ai', 'ИИ ' + (ev.source === 'mcp' ? '(MCP)' : ''));
  });
  on('toast', (t) => toast(t.text, t.type));
  on('window:focus', (f) => bg && bg.setFocused(f));

  window.addEventListener('contextmenu', (e) => { if (!e.target.closest('input, textarea, .console, .md, .msg')) e.preventDefault(); });

  await navigate('home');
  if (!state.accounts.list.length) setTimeout(() => openLogin({ welcome: true }), 600);
}

// dev screenshots helper
window.__shot = async (p) => {
  document.querySelectorAll('.modal-back, .popover').forEach((m) => m.remove());
  if (p === 'wizard') return openWizard();
  if (p === 'account') return openLogin({ welcome: true });
  if (p.startsWith('skins:')) {
    await navigate('skins');
    setTimeout(() => {
      document.querySelector('.skin-lib .skin-card[data-sid="steve-classic"]')?.click();
      document.querySelector(`.chip[data-id="${p.split(':')[1]}"]`)?.click();
    }, 600);
    return;
  }
  if (p === 'instance') return navigate('instance', { id: state.instances[0] && state.instances[0].id });
  return navigate(p);
};

boot().catch((e) => { console.error(e); document.body.append(h('pre', { style: { color: '#f88', padding: '20px', position: 'relative', zIndex: 99 } }, e.stack)); });

export { refreshInstances, isRunning, selectInstance, openWizard, iconCanvas, modal, btn };
