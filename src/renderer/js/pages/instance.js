// Instance details: overview, content tabs, worlds, screenshots, live console, settings.
import { api, state, listen, refreshInstances, selectInstance } from '../api.js';
import { h, icon, btn, busy, toast, tabs, switchEl, rangeEl, select, confirmDialog, fmtBytes, fmtDuration, timeAgo, plural, loaderBadge, LOADERS, debounce, menu } from '../ui.js';
import { playButton, instIcon, instanceMenu } from '../components.js';
import { iconCanvas } from '../blocks.js';
import { sfx } from '../sound.js';

let offs = [];
let tab = 'overview';
const LAST_TAB = new Map();

export async function render(root, { id, tab: t }) {
  let inst;
  try { inst = await api('instances.get', id); } catch (e) { root.append(h('.empty', h('h4', 'Сборка не найдена'))); return; }
  selectInstance(inst.id);
  tab = t || LAST_TAB.get(inst.id) || 'overview';
  const lc = LOADERS[inst.loader] || LOADERS.vanilla;

  const title = h('h1', { contenteditable: 'true', spellcheck: 'false' }, inst.name);
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
  title.addEventListener('blur', async () => {
    const n = title.textContent.trim();
    if (n && n !== inst.name) { inst = await api('instances.update', inst.id, { name: n }); refreshInstances(); toast('Переименовано', 'ok'); } else title.textContent = inst.name;
  });
  const bigIco = instIcon(inst, 104);
  bigIco.classList.add('big-ico');
  bigIco.onclick = () => { sfx('pop'); bigIco.animate([{ transform: 'rotate(0) scale(1)' }, { transform: 'rotate(-20deg) scale(1.15)' }, { transform: 'rotate(360deg) scale(1)' }], { duration: 700, easing: 'cubic-bezier(.34,1.56,.64,1)' }); };
  const banner = h('.inst-banner', bigIco,
    h('.grow', { style: { minWidth: 0 } }, title,
      h('.chips', h('span.chip', icon('box'), 'Minecraft ' + inst.mc), loaderBadge(inst.loader, inst.loaderVersion), h('span.chip', icon('clock'), fmtDuration(inst.playtime)), h('span.chip', icon('history'), timeAgo(inst.lastPlayed)))),
    h('.acts',
      btn('', { icon: 'folder-open', cls: 'icon', title: 'Папка', onclick: () => api('instances.openDir', inst.id) }),
      btn('', { icon: 'ellipsis', cls: 'icon', onclick: (e) => instanceMenu(e, inst, () => window.__nav.navigate('instances')) }),
      playButton(() => state.instances.find((i) => i.id === inst.id) || inst)));
  banner.style.setProperty('--lc', lc.color);

  const content = h('div');
  const tabBar = tabs([
    { id: 'overview', label: 'Обзор', icon: 'layout-dashboard' },
    { id: 'mod', label: 'Моды', icon: 'puzzle' },
    { id: 'resourcepack', label: 'Ресурспаки', icon: 'image' },
    { id: 'shader', label: 'Шейдеры', icon: 'sun' },
    { id: 'worlds', label: 'Миры', icon: 'globe' },
    { id: 'shots', label: 'Скриншоты', icon: 'camera' },
    { id: 'console', label: 'Консоль', icon: 'terminal' },
    { id: 'settings', label: 'Настройки', icon: 'sliders-horizontal' },
  ], tab, (t2) => { tab = t2; LAST_TAB.set(inst.id, t2); drawTab(); });
  root.append(banner, h('div', { style: { marginBottom: '16px' } }, tabBar), content);

  async function drawTab() {
    offs.filter((f) => f.tabScoped).forEach((f) => f());
    offs = offs.filter((f) => !f.tabScoped);
    content.replaceChildren();
    const el = h('div', { style: { animation: 'pageIn .35s both' } });
    content.append(el);
    inst = await api('instances.get', inst.id);
    if (tab === 'overview') return overview(el, inst);
    if (['mod', 'resourcepack', 'shader'].includes(tab)) return contentTab(el, inst, tab);
    if (tab === 'worlds') return worlds(el, inst);
    if (tab === 'shots') return shots(el, inst);
    if (tab === 'console') return consoleTab(el, inst);
    if (tab === 'settings') return settingsTab(el, inst);
  }
  drawTab();
}

function scoped(off) { off.tabScoped = true; offs.push(off); }

// ---------- overview ----------
async function overview(el, inst) {
  const stats = h('.stats-row', [...Array(4)].map(() => h('.stat-tile.skeleton', { style: { height: '72px' } })));
  const health = h('.card', h('h3', icon('shield-check'), 'Проверка сборки'), h('.muted', 'Проверяю…'));
  const presetsBox = h('.card', h('h3', icon('package-plus'), 'Добавить набор модов'));
  const notes = h('textarea.input', { rows: 5, placeholder: 'Заметки о сборке: сид мира, IP сервера, что надо доделать…' }, inst.notes || '');
  notes.addEventListener('input', debounce(() => api('instances.update', inst.id, { notes: notes.value }), 600));
  el.append(stats, h('.two-col', h('.col', health, presetsBox), h('.col',
    h('.card', h('h3', icon('notebook-pen'), 'Заметки'), notes),
    h('.card', h('h3', icon('sparkles'), 'ИИ-помощник'), h('p.muted', { style: { marginBottom: '12px', fontSize: '13px' } }, 'Попроси ИИ добавить моды, оптимизировать или починить эту сборку.'),
      h('.row.wrap', ['Добавь моды на оптимизацию', 'Сделай сборку красивее', 'Проверь, всё ли совместимо'].map((p) => h('span.chip.btnlike', { onclick: () => window.__nav.navigate('ai', { prompt: p, instanceId: inst.id }) }, p)))))));

  api('instances.stats', inst.id).then((s) => {
    const tile = (v, l, ic) => h('.stat-tile', h('.v', v), h('.l', icon(ic), l));
    stats.replaceChildren(tile(String(s.mods), plural(s.mods, 'мод', 'мода', 'модов').replace(/^\d+ /, '') + (s.modsDisabled ? ` (+${s.modsDisabled} выкл.)` : ''), 'puzzle'), tile(String(s.saves), 'миров', 'globe'), tile(fmtDuration(inst.playtime), 'в игре', 'clock'), tile(fmtBytes(s.size), 'на диске', 'hard-drive'));
  });

  const runCheck = async () => {
    const r = await api('content.check', inst.id);
    const head = h('h3', icon('shield-check'), 'Проверка сборки', h('span.grow'), btn('Перепроверить', { icon: 'refresh-cw', cls: 'sm ghost', onclick: runCheck }));
    if (r.ok && !r.issues.length) {
      health.replaceChildren(head, h('.health-ok', icon('circle-check'), h('div', h('b', 'Всё в порядке'), h('.muted', { style: { fontSize: '12.5px' } }, inst.loader === 'vanilla' ? 'Ванильная сборка' : `${r.modCount} модов, зависимости на месте`))));
      return;
    }
    const fix = btn('Починить автоматически', { icon: 'wrench', cls: 'primary sm' });
    fix.onclick = busy(fix, async () => {
      const rep = await api('modpack.fixMissing', inst.id);
      toast(`Поставлено: ${rep.installed.map((x) => x.title).join(', ') || 'ничего'}`, rep.installed.length ? 'ok' : 'info', 'Починка');
      runCheck();
    });
    health.replaceChildren(head, h('.col', r.issues.slice(0, 12).map((i) => h('.issue' + (i.level === 'warn' ? '.warn' : ''), icon(i.level === 'warn' ? 'triangle-alert' : 'circle-x'), h('span', i.text)))),
      r.missing.length ? h('.row', { style: { marginTop: '12px' } }, fix, h('span.muted', { style: { fontSize: '12px' } }, 'Найдёт недостающие моды на Modrinth')) : null);
  };
  runCheck();

  if (inst.loader === 'vanilla') {
    presetsBox.append(h('p.muted', { style: { fontSize: '13px' } }, 'Наборы модов работают только со сборками на загрузчике. Смени загрузчик во вкладке «Настройки».'));
  } else {
    const presets = await api('modpack.presets');
    presetsBox.append(h('.preset-grid', presets.map((p) => {
      const b = h('.preset', h('.pi', icon(p.icon)), h('div', h('b', p.name), h('span', p.desc)));
      b.onclick = async () => {
        if (b.classList.contains('on')) return;
        b.classList.add('on'); sfx('click');
        try {
          const r = await api('modpack.applyPreset', inst.id, p.id);
          toast(`+${r.installed.length} модов${r.failed.length ? ` · нет под ${inst.mc}: ${r.failed.map((f) => f.title || f.ref).slice(0, 3).join(', ')}` : ''}`, 'ok', p.name);
          runCheck();
        } catch (e) { toast(e.message, 'error'); b.classList.remove('on'); }
      };
      return b;
    })));
  }
}

// ---------- mods / resourcepacks / shaders ----------
async function contentTab(el, inst, type) {
  const names = { mod: ['модов', 'Моды'], resourcepack: ['ресурспаков', 'Ресурспаки'], shader: ['шейдеров', 'Шейдеры'] }[type];
  const list = h('.list');
  const q = h('input.input', { placeholder: 'Фильтр…' });
  const updBox = h('div');
  const count = h('span.muted');
  el.append(
    h('.toolbar',
      h('.search', { style: { width: '240px' } }, icon('search'), q), count, h('.grow'),
      type === 'mod' ? btn('Обновления', { icon: 'refresh-cw', onclick: (e) => checkUpdates(e.currentTarget) }) : null,
      btn('Из файла', { icon: 'file-plus', onclick: async () => { const n = await api('content.addFiles', inst.id, type); if (n) { toast(`Добавлено: ${n}`, 'ok'); load(); } } }),
      btn('Папка', { icon: 'folder-open', onclick: () => api('instances.openDir', inst.id, { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }[type]) }),
      btn('Найти на Modrinth', { icon: 'compass', cls: 'primary', onclick: () => window.__nav.navigate('catalog', { type, instanceId: inst.id }) })),
    updBox, list);
  if (type === 'mod' && inst.loader === 'vanilla') list.before(h('.issue.warn', { style: { marginBottom: '12px' } }, icon('triangle-alert'), h('span', 'Это ванильная сборка — моды не загрузятся. Выбери Fabric/Forge/NeoForge в настройках сборки.')));
  if (type === 'shader' && inst.loader !== 'vanilla') list.before(h('.muted', { style: { fontSize: '12.5px', marginBottom: '10px' } }, 'Для шейдеров нужен Iris (Fabric/NeoForge) или Oculus (Forge). Набор «Шейдеры» на вкладке «Обзор» поставит всё сразу.'));

  let items = [];
  const draw = () => {
    const f = q.value.toLowerCase();
    const shown = items.filter((m) => !f || m.title.toLowerCase().includes(f) || m.filename.toLowerCase().includes(f));
    count.textContent = `${items.filter((m) => m.enabled).length} из ${items.length} включено`;
    if (!items.length) {
      list.replaceChildren(h('.empty', iconCanvas(type === 'mod' ? 'crafting' : type === 'shader' ? 'glowstone' : 'bookshelf', 84, 84), h('h4', `Нет ${names[0]}`), h('p', 'Найди их в каталоге Modrinth или перетащи файлы в окно.'), btn('Открыть каталог', { icon: 'compass', cls: 'primary', onclick: () => window.__nav.navigate('catalog', { type, instanceId: inst.id }) })));
      return;
    }
    list.replaceChildren(...shown.map((m) => {
      const ico = h('.ico', m.icon ? h('img', { src: m.icon, loading: 'lazy', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : icon(type === 'mod' ? 'puzzle' : 'image'));
      if (!m.icon && m.hasJarIcon) api('content.jarIcon', inst.id, m.file).then((d) => { if (d) ico.replaceChildren(h('img.pixel', { src: d, style: { width: '100%', height: '100%' } })); });
      const row = h('.item' + (m.enabled ? '' : '.off'),
        ico,
        h('.grow', { style: { minWidth: 0 } },
          h('.t.ellipsis', m.title, m.dependency ? h('span.tag-dep', 'зависимость') : null),
          h('.s.ellipsis', [m.version, m.filename, m.size ? fmtBytes(m.size) : null].filter(Boolean).join(' · '))),
        m.source === 'modrinth' ? h('span.chip', { title: 'Отслеживается через Modrinth' }, icon('link'), 'Modrinth') : null,
        h('.acts',
          m.slug ? btn('', { icon: 'external-link', cls: 'ghost icon sm', title: 'Страница мода', onclick: () => api('app.openExternal', `https://modrinth.com/${type === 'shader' ? 'shader' : type}/${m.slug}`) }) : null,
          btn('', { icon: 'trash-2', cls: 'ghost icon sm danger', title: 'Удалить', onclick: async () => { if (await confirmDialog(`Удалить «${m.title}»?`, { ok: 'Удалить', danger: true })) { await api('content.remove', inst.id, m.file); sfx('pop'); load(); } } })),
        switchEl(m.enabled, async (v) => { await api('content.toggle', inst.id, m.file, v); m.enabled = v; row.classList.toggle('off', !v); count.textContent = `${items.filter((x) => x.enabled).length} из ${items.length} включено`; }));
      return row;
    }));
  };
  q.addEventListener('input', draw);

  async function load() {
    items = await api('content.list', inst.id, type);
    draw();
  }
  list.append(...[...Array(5)].map(() => h('.skeleton', { style: { height: '58px' } })));
  await load();
  // fill titles/icons of manually added files in background
  if (items.some((m) => m.source === 'local')) api('content.identify', inst.id).then((n) => { if (n) load(); }).catch(() => {});
  scoped(listen('content-changed', (id) => { if (!id || id === inst.id) load(); }));

  async function checkUpdates(button) {
    const orig = button.innerHTML;
    button.disabled = true; button.innerHTML = '<span class="spinner"></span> Проверка…';
    try {
      const ups = await api('modrinth.checkUpdates', inst.id);
      if (!ups.length) { toast('Все моды актуальны', 'ok'); updBox.replaceChildren(); return; }
      const all = btn(`Обновить всё (${ups.length})`, { icon: 'download', cls: 'primary sm' });
      all.onclick = busy(all, async () => {
        for (const u of ups) await api('modrinth.install', inst.id, u.projectId, { versionId: u.versionId, update: true, deps: true });
        toast(`Обновлено: ${ups.length}`, 'ok'); updBox.replaceChildren(); load();
      });
      updBox.replaceChildren(h('.card', { style: { marginBottom: '12px' } }, h('h3', icon('arrow-up-circle'), `Доступны обновления: ${ups.length}`, h('span.grow'), all),
        h('.col', { style: { gap: '4px' } }, ups.map((u) => h('.row', { style: { fontSize: '13px' } }, h('b', u.title), h('span.muted', `${u.from} → ${u.to}`))))));
    } catch (e) { toast(e.message, 'error'); } finally { button.disabled = false; button.innerHTML = orig; }
  }
}

// ---------- worlds ----------
async function worlds(el, inst) {
  const list = await api('files.worlds', inst.id);
  if (!list.length) { el.append(h('.empty', iconCanvas('grass', 84, 84), h('h4', 'Миров пока нет'), h('p', 'Запусти игру и создай мир — он появится здесь.'))); return; }
  el.append(h('.worlds', list.map((w) => h('.world',
    w.iconUrl ? h('img', { src: w.iconUrl }) : h('.noimg'),
    h('.grow', { style: { minWidth: 0 } }, h('b.ellipsis', { style: { display: 'block' } }, w.name), h('.muted', { style: { fontSize: '12px' } }, timeAgo(w.lastPlayed) + ' · ' + fmtBytes(w.size)),
      h('.row', { style: { marginTop: '8px', gap: '6px' } },
        btn('Играть', { icon: 'play', cls: 'sm primary', title: 'Сразу в этот мир (Quick Play, 1.20+)', onclick: () => api('game.play', inst.id, { quickPlay: { world: w.name } }).catch((e) => toast(e.message, 'error')) }),
        btn('', { icon: 'archive', cls: 'sm icon', title: 'Резервная копия', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const f = await api('files.backupWorld', inst.id, w.name); toast('Бэкап создан', 'ok'); api('files.showItem', f); } catch (er) { toast(er.message, 'error'); } b.disabled = false; } }),
        btn('', { icon: 'folder-open', cls: 'sm icon', onclick: () => api('app.openPath', w.path) })))))));
}

// ---------- screenshots ----------
async function shots(el, inst) {
  const list = await api('files.screenshots', inst.id);
  if (!list.length) { el.append(h('.empty', iconCanvas('glowstone', 84, 84), h('h4', 'Скриншотов нет'), h('p', 'Нажми F2 в игре — скриншот появится здесь.'))); return; }
  el.append(h('.shots', list.map((s) => h('img', { src: s.url, loading: 'lazy', onclick: () => {
    const lb = h('.lightbox', { onclick: () => lb.remove() }, h('img', { src: s.url }));
    document.body.append(lb);
  }, oncontextmenu: (e) => menu({ x: e.clientX, y: e.clientY }, [{ icon: 'folder-open', label: 'Показать в папке', onclick: () => api('files.showItem', s.path) }]) }))));
}

// ---------- console ----------
async function consoleTab(el, inst) {
  const box = h('.console');
  const filter = h('input.input', { placeholder: 'Поиск в логе…' });
  let auto = true;
  const cls = (l) => (/ERROR|Exception|FATAL|Caused by|\tat /.test(l) ? 'l-err' : /WARN/.test(l) ? 'l-warn' : /INFO/.test(l) ? 'l-info' : 'l-dim');
  const addLines = (lines) => {
    const f = filter.value.toLowerCase();
    const frag = document.createDocumentFragment();
    for (const l of lines) {
      if (f && !l.toLowerCase().includes(f)) continue;
      frag.append(h('div.' + cls(l), l));
    }
    box.append(frag);
    while (box.childElementCount > 4000) box.firstChild.remove();
    if (auto) box.scrollTop = box.scrollHeight;
  };
  const reload = async () => { box.replaceChildren(); addLines((await api('game.log', inst.id)).split('\n')); };
  filter.addEventListener('input', debounce(reload, 200));
  box.addEventListener('scroll', () => { auto = box.scrollTop + box.clientHeight >= box.scrollHeight - 30; });
  el.append(h('.toolbar', h('.search', { style: { width: '280px' } }, icon('search'), filter), h('.grow'),
    btn('Копировать', { icon: 'copy', onclick: () => { navigator.clipboard.writeText(box.innerText); toast('Лог скопирован', 'ok'); } }),
    btn('Папка логов', { icon: 'folder-open', onclick: () => api('instances.openDir', inst.id, 'logs') }),
    btn('Разбор ИИ', { icon: 'sparkles', cls: 'primary', onclick: () => window.__nav.navigate('ai', { prompt: 'Посмотри лог последнего запуска сборки и объясни, что не так. Если можно — почини.', instanceId: inst.id }) })), box);
  await reload();
  scoped(listen('game:log', (batch) => addLines(batch.filter((b) => b.instanceId === inst.id).map((b) => b.line))));
}

// ---------- settings ----------
async function settingsTab(el, inst) {
  const info = await api('app.info');
  const g = state.settings;
  const save = async (patch, msg) => { inst = await api('instances.update', inst.id, patch); refreshInstances(); if (msg) toast(msg, 'ok'); };

  // icon picker
  const icons = await api('instances.icons');
  const grid = h('.icon-grid');
  for (const ic of icons) {
    const o = h('.icon-opt' + (ic === inst.icon ? '.on' : ''), { onclick: () => { grid.querySelectorAll('.icon-opt').forEach((x) => x.classList.remove('on')); o.classList.add('on'); sfx('tick'); save({ icon: ic }); } }, iconCanvas(ic, 40, 40));
    grid.append(o);
  }

  // version + loader
  const versions = await api('versions.list', { snapshots: g.showSnapshots });
  const mcSel = select(versions.map((v) => ({ value: v.id, label: v.id })), inst.mc, async (v) => { await save({ mc: v, loaderVersion: null }, 'Версия изменена — файлы скачаются при запуске'); drawLoaderVer(); });
  if (!versions.find((v) => v.id === inst.mc)) mcSel.prepend(h('option', { value: inst.mc, selected: true }, inst.mc));
  const loaderSel = select(Object.entries(LOADERS).map(([k, l]) => ({ value: k, label: l.name })), inst.loader, async (v) => { await save({ loader: v, loaderVersion: null }, 'Загрузчик изменён'); drawLoaderVer(); });
  const lvSel = h('select.select');
  lvSel.onchange = () => save({ loaderVersion: lvSel.value || null }, 'Версия загрузчика изменена');
  async function drawLoaderVer() {
    lvSel.replaceChildren(h('option', { value: '' }, 'Авто'));
    if (inst.loader === 'vanilla') { lvSel.disabled = true; return; }
    lvSel.disabled = false;
    try { (await api('loaders.list', inst.loader, inst.mc)).slice(0, 80).forEach((v) => lvSel.append(h('option', { value: v.version, selected: v.version === inst.loaderVersion }, v.version + (v.recommended ? ' ★' : '')))); } catch {}
  }
  drawLoaderVer();

  // memory
  const total = info.totalMem;
  const mem = inst.memory || { min: g.memoryMin, max: g.memoryMax };
  const memVal = h('.mem-val', (mem.max / 1024).toFixed(1) + ' ГБ');
  const custom = !!inst.memory;
  const memRange = rangeEl({ min: 1024, max: Math.max(4096, Math.floor(total * 0.8 / 512) * 512), step: 512, value: mem.max, onInput: (v) => { memVal.textContent = (v / 1024).toFixed(1) + ' ГБ'; memVal.style.color = v > total * 0.6 ? 'var(--warn)' : ''; } });
  memRange.addEventListener('change', () => save({ memory: { min: Math.min(2048, Number(memRange.value)), max: Number(memRange.value) } }, 'Память сохранена'));
  const memWrap = h('.row', memRange, memVal);
  if (!custom) memWrap.style.opacity = '.45';
  const memSwitch = switchEl(custom, (v) => { memWrap.style.opacity = v ? '1' : '.45'; save({ memory: v ? { min: Math.min(2048, Number(memRange.value)), max: Number(memRange.value) } : null }); });

  const jvm = h('input.input.mono', { value: inst.jvmArgs || '', placeholder: '-XX:+UseZGC …' });
  jvm.addEventListener('change', () => save({ jvmArgs: jvm.value }, 'Аргументы сохранены'));
  const java = h('input.input.mono', { value: inst.javaPath || '', placeholder: 'Авто (лаунчер скачает нужную Java)' });
  java.addEventListener('change', () => save({ javaPath: java.value.trim() }, 'Путь к Java сохранён'));
  const res = inst.resolution || {};
  const rw = h('input.input', { type: 'number', value: res.width || '', placeholder: '1280', style: { width: '100px' } });
  const rh = h('input.input', { type: 'number', value: res.height || '', placeholder: '720', style: { width: '100px' } });
  const saveRes = () => save({ resolution: rw.value && rh.value ? { width: Number(rw.value), height: Number(rh.value), fullscreen: !!(inst.resolution && inst.resolution.fullscreen) } : null });
  rw.onchange = rh.onchange = saveRes;
  const group = h('input.input', { value: inst.group || '', placeholder: 'Без группы' });
  group.addEventListener('change', () => save({ group: group.value.trim() }, 'Группа сохранена'));

  const row = (title, sub, ctrl) => h('.set-row', h('.lbl', h('b', title), sub ? h('span', sub) : null), ctrl);
  const reinstall = btn('Переустановить файлы', { icon: 'hammer' });
  reinstall.onclick = busy(reinstall, async () => { await api('instances.reinstall', inst.id); toast('Файлы игры проверены и докачаны', 'ok'); });

  el.append(h('.settings-grid',
    h('.card', h('h3', icon('box'), 'Игра'),
      row('Версия Minecraft', 'При смене моды могут перестать работать', h('div', { style: { width: '170px' } }, mcSel)),
      row('Загрузчик', null, h('div', { style: { width: '170px' } }, loaderSel)),
      row('Версия загрузчика', null, h('div', { style: { width: '170px' } }, lvSel)),
      row('Группа', 'Для сортировки на странице сборок', h('div', { style: { width: '170px' } }, group)),
      row('Скин в оффлайне', 'Свой скин без модов через локальный сервер (authlib-injector)', switchEl(inst.offlineSkins !== false, (v) => save({ offlineSkins: v })))),
    h('.card', h('h3', icon('memory-stick'), 'Производительность'),
      row('Своя память для сборки', `Иначе берётся из общих настроек (${(g.memoryMax / 1024).toFixed(1)} ГБ). В ПК: ${(total / 1024).toFixed(0)} ГБ`, memSwitch),
      h('div', { style: { padding: '6px 0 12px' } }, memWrap),
      h('label.field', 'Аргументы JVM', jvm),
      h('label.field', { style: { marginTop: '10px' } }, 'Java', java),
      h('.row', { style: { marginTop: '12px' } }, h('span.muted', 'Разрешение окна'), rw, h('span', '×'), rh)),
    h('.card', h('h3', icon('palette'), 'Иконка'), grid),
    h('.card', h('h3', icon('wrench'), 'Обслуживание'),
      h('.col',
        h('.row.wrap', reinstall, btn('Дублировать', { icon: 'copy', onclick: async () => { const c = await api('instances.duplicate', inst.id); refreshInstances(); toast('Копия создана', 'ok'); window.__nav.navigate('instance', { id: c.id }); } }),
          btn('Экспорт .mrpack', { icon: 'package', onclick: () => api('modpack.export', inst.id).then((r) => r && toast(`Готово: ${r.mods} модов по ссылкам`, 'ok')) })),
        h('.row.wrap', btn('Удалить сборку', { icon: 'trash-2', cls: 'danger', onclick: async () => {
          if (!(await confirmDialog(`Удалить «${inst.name}» вместе с мирами? Папка уйдёт в .trash лаунчера.`, { ok: 'Удалить', danger: true }))) return;
          await api('instances.remove', inst.id); await refreshInstances(); toast('Удалено', 'ok'); window.__nav.navigate('instances');
        } })),
        h('.muted.mono', { style: { fontSize: '11px', userSelect: 'text' } }, 'ID: ' + inst.id)))));
}

export function destroy() { offs.forEach((f) => f()); offs = []; }
