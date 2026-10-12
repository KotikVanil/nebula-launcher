// Modrinth catalog: mods, modpacks, resource packs, shaders with an install target.
import { api, state, listen, refreshInstances, selectInstance } from '../api.js';
import { h, icon, btn, toast, tabs, fmtNum, timeAgo, debounce, md, LOADERS, loaderBadge } from '../ui.js';
import { iconCanvas } from '../blocks.js';
import { sfx } from '../sound.js';

const view = { type: 'mod', q: '', sort: 'relevance', cats: new Set(), target: null, ignoreVersion: false };
let installedProjects = new Set();
let offs = [];

export async function render(root, params = {}) {
  if (params.type) view.type = params.type;
  if (params.instanceId) view.target = params.instanceId;
  if (!view.target || !state.instances.find((i) => i.id === view.target)) view.target = state.selected || (state.instances[0] && state.instances[0].id) || null;
  view.cats = new Set();

  const results = h('.proj-list');
  const more = h('div', { style: { textAlign: 'center', padding: '16px' } });
  const catsBox = h('.cat-cats');
  const targetBox = h('div');
  const search = h('input.input', { placeholder: 'Поиск на Modrinth… (например: sodium, create, шейдеры)', value: view.q });
  const sortSel = h('select.select', { style: { width: '190px' } }, [['relevance', 'По релевантности'], ['downloads', 'По загрузкам'], ['follows', 'По популярности'], ['newest', 'Новые'], ['updated', 'Обновлённые']].map(([v, l]) => h('option', { value: v, selected: view.sort === v }, l)));
  sortSel.onchange = () => { view.sort = sortSel.value; load(true); };
  search.addEventListener('input', debounce(() => { view.q = search.value; load(true); }, 350));

  const typeTabs = tabs([
    { id: 'mod', label: 'Моды', icon: 'puzzle' }, { id: 'modpack', label: 'Сборки', icon: 'package' },
    { id: 'resourcepack', label: 'Ресурспаки', icon: 'image' }, { id: 'shader', label: 'Шейдеры', icon: 'sun' },
  ], view.type, (t) => { view.type = t; view.cats.clear(); drawTarget(); loadCats(); load(true); });

  root.append(
    h('.page-head', h('div', h('h1', 'Каталог ', h('span.grad', 'Modrinth')), h('.sub', 'Тысячи модов, сборок, ресурспаков и шейдеров. Зависимости ставятся сами.')), h('.actions', typeTabs)),
    h('.cat-layout',
      h('.cat-side', h('.card', h('h3', icon('target'), 'Куда ставить'), targetBox), h('.card', h('h3', icon('tags'), 'Категории'), catsBox)),
      h('div', h('.toolbar', h('.search.grow', icon('search'), search), sortSel), results, more)));

  function target() { return state.instances.find((i) => i.id === view.target) || null; }

  function drawTarget() {
    const t = target();
    if (view.type === 'modpack') { targetBox.replaceChildren(h('p.muted', { style: { fontSize: '12.5px' } }, 'Сборка ставится как новая отдельная сборка со всеми модами и настройками.')); return; }
    const sel = h('select.select', state.instances.map((i) => h('option', { value: i.id, selected: i.id === view.target }, `${i.name} (${i.mc} ${LOADERS[i.loader].name})`)));
    sel.onchange = () => { view.target = sel.value; selectInstance(sel.value); refreshInstalled().then(() => load(true)); drawTarget(); };
    const ign = h('label.row', { style: { gap: '8px', fontSize: '12.5px', marginTop: '10px', cursor: 'pointer', color: 'var(--text-2)' } }, h('input', { type: 'checkbox', checked: view.ignoreVersion, onchange: (e) => { view.ignoreVersion = e.target.checked; load(true); } }), 'Показывать все версии');
    targetBox.replaceChildren(
      state.instances.length ? sel : h('p.muted', 'Нет сборок — создай сборку, чтобы ставить моды'),
      t ? h('.row', { style: { marginTop: '10px', gap: '6px' } }, h('span.chip', t.mc), loaderBadge(t.loader)) : null,
      t ? ign : null,
      t && view.type === 'mod' && t.loader === 'vanilla' ? h('.issue.warn', { style: { marginTop: '10px' } }, icon('triangle-alert'), h('span', 'Ванильная сборка: моды не заработают')) : null);
  }

  async function loadCats() {
    catsBox.replaceChildren(h('.skeleton', { style: { height: '200px' } }));
    try {
      const all = await api('modrinth.categories');
      const list = all.filter((c) => c.project_type === view.type && c.header !== 'resolutions' && !['fabric', 'forge', 'quilt', 'neoforge', 'liteloader', 'modloader', 'rift', 'minecraft'].includes(c.name));
      const RU = { adventure: 'Приключения', cursed: 'Проклятое', decoration: 'Декор', economy: 'Экономика', equipment: 'Снаряжение', food: 'Еда', 'game-mechanics': 'Механики', library: 'Библиотеки', magic: 'Магия', management: 'Управление', minigame: 'Мини-игры', mobs: 'Мобы', optimization: 'Оптимизация', social: 'Социальное', storage: 'Хранение', technology: 'Технологии', transportation: 'Транспорт', utility: 'Утилиты', worldgen: 'Генерация мира', combat: 'Бой', challenging: 'Хардкор', 'kitchen-sink': 'Всё и сразу', lightweight: 'Лёгкие', multiplayer: 'Мультиплеер', quests: 'Квесты', atmosphere: 'Атмосфера', bloom: 'Bloom', 'colored-lighting': 'Цветной свет', foliage: 'Листва', 'path-tracing': 'Path tracing', pbr: 'PBR', reflections: 'Отражения', shadows: 'Тени', 'cartoon': 'Мультяшные', fantasy: 'Фэнтези', realistic: 'Реалистичные', 'semi-realistic': 'Полуреализм', vanilla_like: 'Как ванилла', 'vanilla-like': 'Как ванилла', blocks: 'Блоки', audio: 'Звуки', fonts: 'Шрифты', gui: 'Интерфейс', items: 'Предметы', models: 'Модели', simplistic: 'Минимализм', themed: 'Тематические', tweaks: 'Твики', 'entities': 'Существа', environment: 'Окружение', locale: 'Языки', modded: 'Для модов', 'core-shaders': 'Core-шейдеры', potato: 'Слабый ПК', low: 'Низкие', medium: 'Средние', high: 'Высокие', screenshot: 'Для скриншотов' };
      catsBox.replaceChildren(...list.map((c) => {
        const el = h('.cat-cat' + (view.cats.has(c.name) ? '.on' : ''), { onclick: () => { view.cats.has(c.name) ? view.cats.delete(c.name) : view.cats.add(c.name); el.classList.toggle('on'); sfx('tick'); load(true); } },
          h('span.cico', { html: window.DOMPurify.sanitize(c.icon || '', { USE_PROFILES: { svg: true } }) }), RU[c.name] || c.name.replace(/-/g, ' '));
        return el;
      }));
    } catch { catsBox.replaceChildren(h('.muted', 'Нет сети')); }
  }

  async function refreshInstalled() {
    installedProjects = new Set();
    if (!view.target) return;
    for (const t of ['mod', 'resourcepack', 'shader']) {
      try { for (const m of await api('content.list', view.target, t)) if (m.projectId) installedProjects.add(m.projectId); } catch {}
    }
  }

  let offset = 0, total = 0, seq = 0;
  async function load(reset) {
    const my = ++seq;
    if (reset) { offset = 0; results.replaceChildren(...[...Array(6)].map(() => h('.skeleton', { style: { height: '102px' } }))); }
    const t = target();
    const params = { query: view.q, type: view.type, sort: view.sort, offset, limit: 20, categories: [...view.cats] };
    if (t && view.type !== 'modpack' && !view.ignoreVersion) { params.mc = t.mc; params.loader = view.type === 'mod' ? t.loader : undefined; }
    try {
      const r = await api('modrinth.search', params);
      if (my !== seq) return;
      total = r.total;
      if (reset) results.replaceChildren();
      if (!r.hits.length && reset) results.append(h('.empty', iconCanvas('bookshelf', 84, 84), h('h4', 'Ничего не найдено'), h('p', t && !view.ignoreVersion ? `Под ${t.mc} ${LOADERS[t.loader].name} ничего нет. Попробуй другой запрос или включи «Показывать все версии».` : 'Попробуй другой запрос.')));
      r.hits.forEach((p, i) => { const c = card(p); c.style.animationDelay = i * 25 + 'ms'; results.append(c); });
      offset += r.hits.length;
      more.replaceChildren(offset < total ? btn(`Показать ещё (${fmtNum(total - offset)})`, { icon: 'chevrons-down', onclick: () => load(false) }) : h('span.dim', total ? `Всего: ${total}` : ''));
    } catch (e) {
      if (my === seq) results.replaceChildren(h('.empty', icon('wifi-off'), h('h4', 'Modrinth недоступен'), h('p', e.message)));
    }
  }

  function installBtn(p, compact) {
    const installed = installedProjects.has(p.id);
    const b = btn(installed ? 'Установлено' : view.type === 'modpack' ? 'Установить сборку' : 'Установить', { icon: installed ? 'check' : 'download', cls: installed ? 'installed sm' : 'primary sm' });
    if (installed) return b;
    b.onclick = async (e) => {
      e.stopPropagation();
      if (view.type !== 'modpack' && !view.target) return toast('Сначала создай сборку', 'error');
      b.disabled = true; b.replaceChildren(h('span.spinner'), h('span', 'Ставлю…'));
      try {
        if (view.type === 'modpack') {
          const inst = await api('modrinth.installPack', p.id);
          await refreshInstances();
          toast(`Сборка «${inst.name}» установлена`, 'ok');
          b.className = 'btn installed sm'; b.replaceChildren(icon('check'), h('span', 'Готово'));
          return;
        }
        const r = await api('modrinth.install', view.target, p.id, {});
        r.installed.forEach((x) => installedProjects.add(p.id));
        const deps = r.installed.filter((x) => x.asDependency).map((x) => x.title);
        if (r.failed.length && !r.installed.length) { toast(r.failed[0].reason, 'error', p.title); b.disabled = false; b.replaceChildren(icon('download'), h('span', 'Установить')); return; }
        toast(deps.length ? `+ зависимости: ${deps.join(', ')}` : `Версия ${r.installed[0] ? r.installed[0].version : ''}`, 'ok', `${p.title} установлен`);
        if (r.conflicts.length) toast(`Конфликт с «${r.conflicts[0].with}»`, 'error', p.title);
        b.className = 'btn installed sm'; b.disabled = false; b.replaceChildren(icon('check'), h('span', 'Установлено'));
        sfx('success');
      } catch (er) { toast(er.message, 'error'); b.disabled = false; b.replaceChildren(icon('download'), h('span', 'Установить')); }
    };
    return b;
  }

  function card(p) {
    return h('.proj', { onclick: () => openProject(p), onmouseenter: () => sfx('hover') },
      p.icon ? h('img.pico', { src: p.icon, loading: 'lazy' }) : h('.pico', { style: { display: 'grid', placeItems: 'center' } }, iconCanvas('crafting', 48, 48)),
      h('.grow', { style: { minWidth: 0 } },
        h('.row', { style: { gap: '8px' } }, h('.ptitle', p.title), h('.pauthor', 'от ' + p.author)),
        h('.pdesc', p.description),
        h('.pmeta',
          h('span', icon('download'), fmtNum(p.downloads)), h('span', icon('heart'), fmtNum(p.follows)), h('span', icon('refresh-cw'), timeAgo(new Date(p.updated).getTime())),
          ...(p.categories || []).slice(0, 4).map((c) => h('span.chip', { style: { height: '22px' } }, c)))),
      h('.pside', installBtn(p), p.versions && p.versions.length ? h('span.dim', { style: { fontSize: '11.5px' } }, p.versions[0] === p.versions[p.versions.length - 1] ? p.versions[0] : `${p.versions[0]} – ${p.versions[p.versions.length - 1]}`) : null));
  }

  async function openProject(hit) {
    sfx('open');
    const back = h('.drawer-back');
    const dr = h('.drawer');
    const close = () => { dr.classList.add('out'); back.remove(); setTimeout(() => dr.remove(), 250); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    back.onclick = close;
    const bodyEl = h('.drawer-body', h('.skeleton', { style: { height: '300px' } }));
    dr.append(h('.drawer-head',
      hit.gallery ? h('img.bgimg', { src: hit.gallery }) : null,
      hit.icon ? h('img.pico', { src: hit.icon }) : null,
      h('.grow', { style: { position: 'relative', minWidth: 0 } }, h('h2', { style: { fontFamily: 'var(--display)', fontSize: '22px' } }, hit.title), h('.muted', 'от ' + hit.author + ' · ' + fmtNum(hit.downloads) + ' загрузок'), h('p', { style: { marginTop: '6px', color: 'var(--text-2)' } }, hit.description),
        h('.row', { style: { marginTop: '12px' } }, installBtn(hit), btn('На сайте', { icon: 'external-link', cls: 'sm', onclick: () => api('app.openExternal', `https://modrinth.com/${hit.type}/${hit.slug}`) }))),
      btn('', { icon: 'x', cls: 'ghost icon', onclick: close })), bodyEl);
    document.body.append(back, dr);
    try {
      const p = await api('modrinth.project', hit.id);
      const t = target();
      const vers = await api('modrinth.versions', hit.id, {});
      const compat = (v) => t && v.game_versions.includes(t.mc) && (hit.type !== 'mod' || v.loaders.some((l) => l === t.loader || (t.loader === 'quilt' && l === 'fabric')));
      bodyEl.replaceChildren(
        p.gallery && p.gallery.length ? h('.gallery', p.gallery.map((g) => h('img', { src: g.url, loading: 'lazy', onclick: () => { const lb = h('.lightbox', { onclick: () => lb.remove() }, h('img', { src: g.raw_url || g.url })); document.body.append(lb); } }))) : null,
        h('.row.wrap', { style: { marginBottom: '14px', gap: '6px' } },
          p.client_side === 'required' ? h('span.chip', icon('monitor'), 'Клиент') : null, p.server_side !== 'unsupported' ? h('span.chip', icon('server'), 'Сервер') : null,
          p.license ? h('span.chip', icon('scale'), p.license.id) : null,
          p.source_url ? h('span.chip.btnlike', { onclick: () => api('app.openExternal', p.source_url) }, icon('github'), 'Исходники') : null,
          p.discord_url ? h('span.chip.btnlike', { onclick: () => api('app.openExternal', p.discord_url) }, icon('message-circle'), 'Discord') : null),
        h('h3', { style: { fontFamily: 'var(--display)', fontSize: '15px', margin: '6px 0 10px' } }, 'Версии', t ? h('span.muted', { style: { fontFamily: 'var(--font)', fontSize: '12px', marginLeft: '8px' } }, `зелёные подходят к «${t.name}»`) : null),
        h('div', vers.slice(0, 25).map((v) => h('.ver-row' + (compat(v) ? '.compat' : ''),
          h('span.ver-type.' + v.version_type, v.version_type),
          h('.grow', { style: { minWidth: 0 } }, h('b.ellipsis', { style: { display: 'block' } }, v.name || v.version_number), h('.dim.ellipsis', { style: { fontSize: '11.5px' } }, v.loaders.join(', ') + ' · ' + v.game_versions.slice(-4).join(', '))),
          hit.type !== 'modpack' && t ? btn('', { icon: 'download', cls: 'sm icon', title: 'Поставить эту версию', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const r = await api('modrinth.install', t.id, hit.id, { versionId: v.id, update: true }); toast(`${hit.title} ${v.version_number} установлен` + (r.installed.length > 1 ? ` (+${r.installed.length - 1} зависимостей)` : ''), 'ok'); installedProjects.add(hit.id); } catch (er) { toast(er.message, 'error'); } b.disabled = false; } }) : null))),
        h('h3', { style: { fontFamily: 'var(--display)', fontSize: '15px', margin: '20px 0 6px' } }, 'Описание'),
        h('.md', { html: md(p.body) }));
      bodyEl.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); api('app.openExternal', a.href); }));
    } catch (e) { bodyEl.replaceChildren(h('.empty', h('h4', 'Не удалось загрузить'), h('p', e.message))); }
  }

  drawTarget();
  loadCats();
  await refreshInstalled();
  load(true);
  offs.push(listen('instances', drawTarget));
  setTimeout(() => search.focus(), 100);
}

export function destroy() { offs.forEach((f) => f()); offs = []; document.querySelectorAll('.drawer, .drawer-back').forEach((d) => d.remove()); }
