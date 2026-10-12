import { api, state, saveSettings, refreshAccounts } from '../api.js';
import { h, icon, btn, toast, switchEl, rangeEl, select, confirmDialog, fmtBytes } from '../ui.js';
import { openLogin } from './account.js';
import { headFor } from '../app.js';
import { sfx } from '../sound.js';
import { checkForUpdates } from '../update.js';

const ACCENTS = [
  ['nebula', 'Туманность', '#8b5cf6', '#22d3ee'], ['emerald', 'Изумруд', '#10b981', '#a3e635'], ['ember', 'Лава', '#f97316', '#facc15'],
  ['ocean', 'Океан', '#3b82f6', '#06b6d4'], ['sakura', 'Сакура', '#ec4899', '#c084fc'], ['crimson', 'Незер', '#ef4444', '#f59e0b'], ['mono', 'Кварц', '#e5e7eb', '#94a3b8'],
];

export async function render(root, params = {}) {
  const s = state.settings;
  const info = state.info;
  const row = (title, sub, ctrl) => h('.set-row', h('.lbl', h('b', title), sub ? h('span', sub) : null), ctrl);
  const set = (patch, msg) => saveSettings(patch).then(() => msg && toast(msg, 'ok'));

  // appearance
  const swatches = h('.row.wrap', { style: { gap: '10px' } }, ACCENTS.map(([id, name, a, b]) => {
    const sw = h('button', { title: name, style: { width: '44px', height: '44px', borderRadius: '14px', border: s.accent === id ? '2px solid #fff' : '2px solid transparent', background: `linear-gradient(135deg, ${a}, ${b})`, cursor: 'pointer', boxShadow: s.accent === id ? `0 0 20px ${a}` : 'none', transition: 'all .25s' },
      onclick: () => { sfx('pop'); set({ accent: id }); swatches.querySelectorAll('button').forEach((x) => { x.style.border = '2px solid transparent'; x.style.boxShadow = 'none'; }); sw.style.border = '2px solid #fff'; sw.style.boxShadow = `0 0 20px ${a}`; } });
    return sw;
  }));

  // memory
  const total = info.totalMem;
  const memVal = h('.mem-val', (s.memoryMax / 1024).toFixed(1) + ' ГБ');
  const memRange = rangeEl({ min: 1024, max: Math.max(4096, Math.floor(total * 0.8 / 512) * 512), step: 512, value: s.memoryMax, onInput: (v) => { memVal.textContent = (v / 1024).toFixed(1) + ' ГБ'; memVal.style.color = v > total * 0.6 ? 'var(--warn)' : ''; } });
  memRange.addEventListener('change', () => set({ memoryMax: Number(memRange.value) }, 'Память по умолчанию сохранена'));

  const jvm = h('input.input.mono', { value: s.jvmArgs, placeholder: 'Доп. аргументы для всех сборок' });
  jvm.onchange = () => set({ jvmArgs: jvm.value }, 'Сохранено');
  const java = h('input.input.mono', { value: s.javaPath, placeholder: 'Авто — лаунчер скачает нужную Java от Mojang' });
  java.onchange = async () => {
    if (java.value.trim()) { const v = await api('java.probe', java.value.trim()); if (!v) return toast('По этому пути нет рабочей Java', 'error'); toast('Java ' + v, 'ok'); }
    set({ javaPath: java.value.trim() });
  };
  const msId = h('input.input.mono', { value: s.msClientId, placeholder: 'Пусто = встроенный ID официального лаунчера' });
  msId.onchange = () => set({ msClientId: msId.value.trim() }, 'Client ID сохранён');

  // accounts
  const accBox = h('.col');
  async function drawAccounts() {
    const { list, active } = await refreshAccounts();
    const rows = await Promise.all(list.map(async (a) => {
      const head = await headFor(a, 40);
      head.style.cssText = 'width:40px;height:40px;border-radius:10px;image-rendering:pixelated';
      return h('.item', head, h('.grow', h('.t', a.name, a.id === active ? h('span.tag-dep', 'активный') : null), h('.s', a.type === 'msa' ? 'Microsoft · ' + a.uuid : 'Оффлайн · UUID ' + a.uuid.slice(0, 8) + '…')),
        h('.acts',
          a.id !== active ? btn('Выбрать', { cls: 'sm', onclick: async () => { await api('accounts.setActive', a.id); drawAccounts(); } }) : null,
          a.type === 'msa' ? btn('', { icon: 'refresh-cw', cls: 'sm icon ghost', title: 'Обновить профиль', onclick: async () => { try { await api('accounts.refresh', a.id); toast('Профиль обновлён', 'ok'); drawAccounts(); } catch (e) { toast(e.message, 'error'); } } }) : null,
          btn('', { icon: 'trash-2', cls: 'sm icon ghost danger', onclick: async () => { if (await confirmDialog(`Удалить аккаунт ${a.name} из лаунчера?`, { ok: 'Удалить', danger: true })) { await api('accounts.remove', a.id); drawAccounts(); } } })));
    }));
    accBox.replaceChildren(...rows, h('.row', btn('Добавить аккаунт', { icon: 'user-plus', cls: 'primary', onclick: () => openLogin() })));
  }

  const runtimes = await api('java.runtimes');
  const accCard = h('.card#sec-accounts', h('h3', icon('users'), 'Аккаунты'), accBox);
  root.append(
    h('.page-head', h('div', h('h1', 'Настройки'), h('.sub', 'Всё сохраняется сразу'))),
    h('.settings-grid',
      h('.card', h('h3', icon('palette'), 'Внешний вид'),
        h('div', { style: { padding: '6px 0 14px' } }, swatches),
        row('Живой фон', '3D-остров со сменой дня и ночи', switchEl(s.liveBackground !== false, (v) => set({ liveBackground: v }))),
        row('Время суток на фоне', null, h('div', { style: { width: '170px' } }, select([{ value: 'auto', label: 'Как на часах' }, { value: 'cycle', label: 'Цикл (4 мин)' }, { value: 'sunrise', label: 'Рассвет' }, { value: 'day', label: 'День' }, { value: 'sunset', label: 'Закат' }, { value: 'night', label: 'Ночь' }], s.timeOfDay, (v) => set({ timeOfDay: v })))),
        row('Качество фона', 'Низкое — для слабых видеокарт', h('div', { style: { width: '170px' } }, select([{ value: 'high', label: 'Высокое' }, { value: 'low', label: 'Низкое' }], s.backgroundQuality, (v) => set({ backgroundQuality: v })))),
        row('Звуки интерфейса', null, switchEl(s.uiSounds !== false, (v) => set({ uiSounds: v }))),
        row('Меньше анимаций', null, switchEl(!!s.reduceMotion, (v) => set({ reduceMotion: v })))),
      accCard,
      h('.card', h('h3', icon('memory-stick'), 'Игра по умолчанию'),
        row('Память (ОЗУ)', `В компьютере ${(total / 1024).toFixed(0)} ГБ. Для модов обычно 4–8 ГБ`, h('span')),
        h('.row', { style: { padding: '0 0 10px' } }, memRange, memVal),
        row('Оптимальные флаги JVM', 'Рекомендации Mojang (ZGC/G1) из файла версии', switchEl(s.useMojangJvmFlags !== false, (v) => set({ useMojangJvmFlags: v }))),
        row('После запуска игры', null, h('div', { style: { width: '170px' } }, select([{ value: 'minimize', label: 'Свернуть' }, { value: 'hide', label: 'Скрыть' }, { value: 'keep', label: 'Оставить' }], s.afterLaunch, (v) => set({ afterLaunch: v })))),
        row('Скины в оффлайне', 'Локальный сервер скинов + authlib-injector', switchEl(s.offlineSkins !== false, (v) => set({ offlineSkins: v }))),
        row('Показывать снапшоты', null, switchEl(!!s.showSnapshots, (v) => set({ showSnapshots: v }))),
        h('label.field', { style: { marginTop: '10px' } }, 'Аргументы JVM', jvm),
        h('label.field', { style: { marginTop: '10px' } }, 'Java', java, h('span.hint', 'Скачанные: ' + (runtimes.map((r) => `${r.component} (${r.version})`).join(', ') || 'пока нет')))),
      h('.card', h('h3', icon('shield'), 'Microsoft и загрузки'),
        h('label.field', 'Azure Client ID', msId, h('span.hint', 'Свой ID нужен, только если Mojang одобрил ваше приложение. Иначе вход вернёт ошибку 403.')),
        row('Потоков загрузки', 'Больше — быстрее на хорошем интернете', h('div', { style: { width: '120px' } }, select([4, 8, 16, 32, 48].map((n) => ({ value: String(n), label: String(n) })), String(s.downloadThreads), (v) => set({ downloadThreads: Number(v) })))),
        h('.set-row', h('.lbl', h('b', 'Папка лаунчера'), h('span.mono', { style: { userSelect: 'text' } }, info.root)), btn('Открыть', { icon: 'folder-open', cls: 'sm', onclick: () => api('app.openPath', info.root) }))),
      h('.card', h('h3', icon('info'), 'О лаунчере'),
        h('p', { style: { marginBottom: '8px' } }, h('b', 'Nebula Launcher ' + info.version), h('span.muted', ' · Electron ' + info.electron)),
        h('.row.wrap', { style: { margin: '4px 0 12px' } },
          (() => { const b = btn('Проверить обновления', { icon: 'refresh-cw', cls: 'primary sm' }); b.onclick = async () => { b.disabled = true; await checkForUpdates({ silent: false }); b.disabled = false; }; return b; })(),
          btn('GitHub', { icon: 'github', cls: 'sm', onclick: () => api('app.openExternal', 'https://github.com/KotikVanil/nebula-launcher') })),
        h('p.muted', { style: { fontSize: '12.5px' } }, 'Моды и сборки — Modrinth. Java — официальные сборки Mojang. Оффлайн-скины — authlib-injector. Подключение ИИ — Model Context Protocol.'),
        h('p.dim', { style: { fontSize: '12px', marginTop: '10px' } }, 'Подсказка: попробуй ↑↑↓↓←→←→BA или 5 кликов по логотипу.'))));
  drawAccounts();
  if (params.section === 'accounts') setTimeout(() => accCard.scrollIntoView({ behavior: 'smooth' }), 200);
}
