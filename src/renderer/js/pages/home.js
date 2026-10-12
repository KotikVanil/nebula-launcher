import { api, state, listen, activeAccount, selectInstance } from '../api.js';
import { h, icon, btn, loaderBadge, fmtDuration, timeAgo, modal, md } from '../ui.js';
import { playButton, instIcon, instanceMenu } from '../components.js';
import { openWizard } from './wizard.js';
import { sfx } from '../sound.js';

let offs = [];
let clockT = null;

function greeting() {
  const hr = new Date().getHours();
  if (hr < 5) return 'Доброй ночи';
  if (hr < 12) return 'Доброе утро';
  if (hr < 18) return 'Добрый день';
  return 'Добрый вечер';
}

const TIPS = [
  'Перетащи PNG-скин прямо в окно — он сразу появится в библиотеке.',
  'Ctrl+K открывает каталог модов из любого места.',
  'ИИ-мастерская соберёт сборку по одной фразе.',
  'Правый клик по сборке — дублировать, экспорт, удаление.',
  'Кнопка «Проверить сборку» найдёт недостающие зависимости.',
  'Брось .mrpack в окно, чтобы импортировать сборку.',
];

export async function render(root) {
  const sel = () => state.instances.find((i) => i.id === state.selected) || null;
  const hero = h('.hero');
  const side = h('.side-col');
  root.append(h('.home', hero, side));

  const clock = h('span.clock');
  const tick = () => { clock.textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); };
  tick();
  clockT = setInterval(tick, 10000);

  const play = playButton(sel);
  let modsChip = null, newsList = null;

  const drawHero = () => {
    const inst = sel();
    const acc = activeAccount();
    const tip = TIPS[Math.floor(Date.now() / 60000) % TIPS.length];
    hero.replaceChildren(
      h('.greet', clock, h('span', greeting() + ', ', h('b', acc ? acc.name : 'путник')), h('span.dim', '· ' + tip)),
      inst ? h('.eyebrow', 'Выбранная сборка') : h('.eyebrow', 'Добро пожаловать'),
      inst ? h('h2', inst.name) : h('h2', 'Твой ', h('span.accent', 'Minecraft'), h('br'), 'начинается здесь'),
      inst ? h('.meta',
        h('span.chip', icon('box'), 'Minecraft ' + inst.mc),
        loaderBadge(inst.loader, inst.loaderVersion),
        h('span.chip', icon('clock'), fmtDuration(inst.playtime)),
        h('span.chip', icon('history'), timeAgo(inst.lastPlayed)),
        (modsChip = h('span.chip', icon('puzzle'), '…')))
        : h('.meta', h('span.chip', icon('sparkles'), 'Создай сборку за 10 секунд или попроси ИИ')),
      h('.hero-actions', play,
        inst ? btn('', { icon: 'folder-open', cls: 'icon lg', title: 'Папка игры', onclick: () => api('instances.openDir', inst.id) }) : null,
        inst ? btn('', { icon: 'sliders-horizontal', cls: 'icon lg', title: 'Настроить сборку', onclick: () => window.__nav.navigate('instance', { id: inst.id }) }) : null,
        inst ? btn('', { icon: 'ellipsis', cls: 'icon lg', onclick: (e) => instanceMenu(e, inst) }) : btn('Спросить ИИ', { icon: 'sparkles', cls: 'lg', onclick: () => window.__nav.navigate('ai') })),
      recentStrip());
    if (inst) api('instances.stats', inst.id).then((s) => { const c = modsChip; if (c) c.replaceChildren(icon('puzzle'), `${s.mods} модов`); }).catch(() => {});
  };

  const recentStrip = () => {
    const strip = h('.recent-strip');
    for (const inst of state.instances.slice(0, 8)) {
      const r = h('.recent' + (inst.id === state.selected ? '.sel' : ''), { onclick: () => { sfx('tick'); selectInstance(inst.id); }, ondblclick: () => window.__nav.navigate('instance', { id: inst.id }), onmouseenter: () => sfx('hover') },
        instIcon(inst, 40), h('.grow', { style: { minWidth: 0 } }, h('.t.ellipsis', inst.name), h('.s', inst.mc + ' · ' + (inst.loader === 'vanilla' ? 'Vanilla' : inst.loader))));
      strip.append(r);
    }
    strip.append(h('.recent.add', { onclick: () => openWizard() }, icon('plus'), 'Новая'));
    return strip;
  };

  drawHero();
  offs.push(listen('selected', drawHero), listen('instances', drawHero), listen('accounts', drawHero));

  // side: AI promo + news
  side.append(
    h('.card.ai-promo', { onclick: () => window.__nav.navigate('ai') }, h('.orb-sm'), h('h4', '✦ ИИ-мастерская'), h('p', 'Опиши сборку словами — Claude найдёт моды, проверит совместимость и всё установит.')),
    h('.card.news', h('h3', icon('newspaper'), 'Новости Minecraft'), (newsList = h('.news-list', [1, 2, 3, 4].map(() => h('.skeleton', { style: { height: '72px' } }))))));
  api('news.get').then((items) => {
    const list = newsList;
    if (!list) return;
    list.replaceChildren(...items.map((n) => h('.news-item', { onclick: () => openNews(n) },
      n.image ? h('img', { src: n.image, loading: 'lazy' }) : null,
      h('div', h('.tag', n.type === 'release' ? 'Релиз' : 'Снапшот'), h('.t', n.title), h('.d', n.short ? n.short.slice(0, 80) + '…' : n.version)))));
  }).catch(() => { const l = newsList; if (l) l.replaceChildren(h('.muted', 'Новости недоступны (нет сети?)')); });
}

// Patch notes right inside the launcher (official launcher content)
async function openNews(n) {
  const body = h('.md.news-body', h('.skeleton', { style: { height: '220px' } }));
  modal({ title: n.title, wide: true, body: h('div', n.image ? h('img.news-hero', { src: n.image }) : null,
    h('.row', { style: { margin: '10px 0 4px', gap: '8px' } }, h('span.chip', n.type === 'release' ? 'Релиз' : 'Снапшот'), h('span.chip', n.version), n.date ? h('span.chip', new Date(n.date).toLocaleDateString('ru-RU')) : null), body) });
  try {
    const d = await api('news.body', n.content);
    body.innerHTML = md(d.body || '');
    body.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); api('app.openExternal', a.href); }));
    body.querySelectorAll('img').forEach((img) => { const s = img.getAttribute('src') || ''; if (s.startsWith('/')) img.src = 'https://launchercontent.mojang.com' + s; });
  } catch (e) { body.replaceChildren(h('p.muted', 'Не удалось загрузить: ' + e.message)); }
}

export function destroy() { offs.forEach((f) => f()); offs = []; clearInterval(clockT); }
