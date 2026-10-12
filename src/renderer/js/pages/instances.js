import { api, state, listen, refreshInstances } from '../api.js';
import { h, icon, btn, toast, LOADERS, debounce } from '../ui.js';
import { instCard } from '../components.js';
import { openWizard } from './wizard.js';

let offs = [];
const view = { q: '', loader: 'all', sort: 'recent', group: true };

export async function render(root) {
  const grid = h('div');
  const search = h('input.input', { placeholder: 'Поиск сборок…', value: view.q });
  search.addEventListener('input', debounce(() => { view.q = search.value.toLowerCase(); draw(); }, 120));
  const chips = h('.row.wrap', { style: { gap: '6px' } });
  const drawChips = () => {
    chips.replaceChildren(...['all', ...Object.keys(LOADERS)].map((l) => h('span.chip.btnlike' + (view.loader === l ? '.on' : ''), { onclick: () => { view.loader = l; drawChips(); draw(); } }, l === 'all' ? 'Все' : LOADERS[l].name)));
  };
  drawChips();
  const sortSel = h('select.select', { style: { width: '170px' }, onchange: (e) => { view.sort = e.target.value; draw(); } },
    [['recent', 'Недавние'], ['name', 'По имени'], ['playtime', 'По времени в игре'], ['created', 'По дате создания']].map(([v, l]) => h('option', { value: v, selected: view.sort === v }, l)));

  root.append(
    h('.page-head',
      h('div', h('h1', 'Мои ', h('span.grad', 'сборки')), h('.sub', 'Каждая сборка — отдельная папка игры со своими модами, мирами и настройками')),
      h('.actions',
        btn('Импорт .mrpack', { icon: 'file-archive', onclick: () => api('modpack.importFile').then((i) => { if (i) { toast(`«${i.name}» импортирована`, 'ok'); refreshInstances(); } }).catch((e) => toast(e.message, 'error')) }),
        btn('Сборки Modrinth', { icon: 'compass', onclick: () => window.__nav.navigate('catalog', { type: 'modpack' }) }),
        btn('Новая сборка', { icon: 'plus', cls: 'primary', onclick: () => openWizard() }))),
    h('.toolbar', h('.search', { style: { width: '280px' } }, icon('search'), search), chips, h('.grow'), sortSel),
    grid);

  function draw() {
    let list = state.instances.filter((i) => (view.loader === 'all' || i.loader === view.loader) && (!view.q || i.name.toLowerCase().includes(view.q) || i.mc.includes(view.q)));
    const by = { recent: (a, b) => (b.lastPlayed || b.created) - (a.lastPlayed || a.created), name: (a, b) => a.name.localeCompare(b.name), playtime: (a, b) => b.playtime - a.playtime, created: (a, b) => b.created - a.created }[view.sort];
    list = list.sort(by);
    const newCard = h('.inst-card.new-card', { onclick: () => openWizard() }, h('div', { style: { textAlign: 'center' } }, h('.plus', icon('plus')), h('b', 'Новая сборка'), h('.muted', { style: { fontSize: '12px' } }, 'или брось .mrpack в окно')));
    const groups = new Map();
    for (const i of list) { const g = i.group || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); }
    grid.replaceChildren();
    if (!state.instances.length) {
      grid.append(h('.inst-grid', newCard), h('.empty', h('h4', 'Пока пусто'), h('p', 'Создай первую сборку — ванилла или с модами. Можно попросить ИИ собрать её за тебя.'), btn('Открыть ИИ-мастерскую', { icon: 'sparkles', onclick: () => window.__nav.navigate('ai') })));
      return;
    }
    let first = true;
    for (const [g, items] of [...groups.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0])))) {
      if (g) grid.append(h('.group-title', icon('folder'), g));
      const gg = h('.inst-grid');
      items.forEach((inst, i) => { const c = instCard(inst); c.style.animationDelay = i * 35 + 'ms'; gg.append(c); });
      if (first) { gg.append(newCard); first = false; }
      grid.append(gg);
    }
  }
  draw();
  offs.push(listen('instances', draw), listen('running', draw));
}

export function destroy() { offs.forEach((f) => f()); offs = []; }
