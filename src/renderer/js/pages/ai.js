// AI workshop: built-in chat (Claude CLI + launcher MCP tools), Claude Code / Codex linking, activity feed.
import { api, on, state, listen, refreshInstances } from '../api.js';
import { h, icon, btn, busy, toast, md, timeAgo, select } from '../ui.js';
import { sfx } from '../sound.js';

let offs = [];
const chat = { messages: [], sessionId: null, busy: false, id: null };
const TOOL_RU = {
  launcher_info: 'смотрю лаунчер', list_instances: 'список сборок', get_instance: 'читаю сборку', create_instance: 'создаю сборку', search_mods: 'ищу моды',
  mod_info: 'читаю о моде', add_mods: 'ставлю моды', remove_mods: 'удаляю моды', toggle_mod: 'переключаю мод', check_instance: 'проверяю совместимость',
  fix_missing_dependencies: 'чиню зависимости', apply_pack_spec: 'собираю сборку', apply_preset: 'ставлю набор', update_instance: 'меняю настройки',
  read_file: 'читаю файл', write_file: 'правлю конфиг', list_files: 'смотрю файлы', get_logs: 'читаю логи', launch_instance: 'запускаю игру',
  check_updates: 'ищу обновления', export_mrpack: 'экспортирую', list_presets: 'смотрю наборы', install_modpack: 'ставлю модпак', list_minecraft_versions: 'смотрю версии', list_loader_versions: 'версии загрузчика',
};
const PROMPTS = [
  'Собери сборку для выживания с техникой (Create) и оптимизацией на 1.20.1',
  'Сделай красивую сборку с шейдерами для слабого ПК',
  'Хочу сборку с магией и подземельями, Fabric',
  'Оптимизируй мою выбранную сборку',
  'Почему крашится игра? Почини',
  'Добавь миникарту и JEI в выбранную сборку',
];

export async function render(root, params = {}) {
  const msgs = h('.ai-msgs');
  const input = h('textarea', { rows: 1, placeholder: 'Опиши сборку мечты или спроси что-нибудь… (Enter — отправить)' });
  const orb = h('.ai-orb', h('.ring'), h('.ring.r2'), h('.core'));
  const sendBtn = btn('', { icon: 'send-horizontal', cls: 'primary icon' });
  const stopBtn = btn('', { icon: 'square', cls: 'icon hidden', title: 'Остановить' });
  const s = state.settings;
  const modelSel = select([{ value: 'claude-sonnet-5-5', label: 'Sonnet 5.5 — быстро' }, { value: 'claude-opus-5-5', label: 'Opus 5.5 — умнее' }, { value: 'claude-haiku-5-5', label: 'Haiku 5.5 — дёшево' }], s.aiModel || 'claude-sonnet-5-5', (v) => api('settings.set', { aiModel: v }));
  modelSel.style.width = '210px'; modelSel.style.height = '34px';
  const inst = () => state.instances.find((i) => i.id === (params.instanceId || state.selected));

  const chatCard = h('.card.ai-chat',
    h('.ai-hero', orb, h('h2', 'ИИ-мастерская ', h('span', { style: { background: 'var(--grad)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' } }, 'сборок')),
      h('p', 'Claude сам ищет моды на Modrinth, проверяет совместимость версий, ставит зависимости, правит конфиги и разбирает краши. Он видит только инструменты лаунчера — ничего лишнего на компьютере.')),
    msgs,
    h('.ai-input', h('.prompts', PROMPTS.map((p) => h('span.chip', { onclick: () => { input.value = p; send(); } }, p))),
      h('.box', input, stopBtn, sendBtn),
      h('.row', { style: { marginTop: '8px', fontSize: '12px' } }, h('span.muted', 'Модель:'), modelSel, h('.grow'), h('span.muted#ai-ctx'), btn('Новый чат', { icon: 'rotate-ccw', cls: 'ghost sm', onclick: () => { chat.messages = []; chat.sessionId = null; drawMsgs(); } }))));

  const side = h('.col', { style: { minHeight: 0, overflowY: 'auto', gap: '14px' } });
  root.append(h('.ai-layout', chatCard, side));

  const ctx = root.querySelector('#ai-ctx');
  const drawCtx = () => { const i = inst(); ctx.textContent = i ? `Контекст: «${i.name}»` : ''; };
  drawCtx();

  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(140, input.scrollHeight) + 'px'; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  sendBtn.onclick = send;
  stopBtn.onclick = () => { if (chat.id) api('ai.stop', chat.id); };

  function bubble(m) {
    if (m.role === 'user') return h('.msg.user', m.text);
    const el = h('.msg.bot' + (m.error ? '.err' : ''));
    if (m.tools.length) el.append(h('div', m.tools.map((t) => h('span.tool-chip' + (t.done ? '.done' : ''), t.done ? null : h('span.spinner'), TOOL_RU[t.name] || t.name))));
    if (m.text) el.append(h('div', { html: md(m.text) }));
    else if (!m.done && !m.tools.length) el.append(h('.typing', h('i'), h('i'), h('i')));
    if (m.error) el.append(h('p', { style: { color: '#fecaca' } }, m.error));
    return el;
  }
  function drawMsgs() {
    if (!chat.messages.length) {
      msgs.replaceChildren(h('.empty', { style: { margin: 'auto' } }, h('h4', 'С чего начнём?'), h('p', 'Например: «Собери сборку на 1.20.1 с Create, миникартой и шейдерами, 6 ГБ памяти». ИИ создаст её прямо здесь, а ты увидишь каждый шаг.')));
      return;
    }
    msgs.replaceChildren(...chat.messages.map(bubble));
    msgs.scrollTop = msgs.scrollHeight;
  }
  function setBusy(b) {
    chat.busy = b;
    orb.classList.toggle('thinking', b);
    sendBtn.classList.toggle('hidden', b);
    stopBtn.classList.toggle('hidden', !b);
  }

  async function send() {
    const text = input.value.trim();
    if (!text || chat.busy) return;
    const st = await api('ai.status');
    if (!st.claude) return toast('Claude Code не найден. Установи Claude Desktop/Claude Code — или подключи свой ИИ справа.', 'error');
    input.value = ''; input.style.height = 'auto';
    chat.messages.push({ role: 'user', text });
    const bot = { role: 'bot', text: '', tools: [], done: false };
    chat.messages.push(bot);
    chat.id = 'c' + Date.now();
    setBusy(true); drawMsgs(); sfx('pop');
    try {
      const i = inst();
      await api('ai.chat', { chatId: chat.id, prompt: text, sessionId: chat.sessionId, instanceId: i && i.id });
    } catch (e) { bot.error = e.message; bot.done = true; setBusy(false); drawMsgs(); }
  }

  let raf = 0;
  const redraw = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawMsgs); };
  offs.push(on('ai:event', (ev) => {
    if (ev.chatId !== chat.id) return;
    const bot = chat.messages[chat.messages.length - 1];
    if (!bot || bot.role !== 'bot') return;
    if (ev.type === 'text') bot.text += ev.text;
    if (ev.type === 'tool') { bot.tools.push({ name: ev.name, done: false }); sfx('tick'); }
    if (ev.type === 'tool_done') { const t = bot.tools.find((x) => !x.done); if (t) t.done = true; refreshInstances(); }
    if (ev.type === 'init' && ev.sessionId) chat.sessionId = ev.sessionId;
    if (ev.type === 'done') {
      bot.done = true; bot.tools.forEach((t) => (t.done = true));
      if (ev.sessionId) chat.sessionId = ev.sessionId;
      if (ev.error && !bot.text) bot.error = ev.error;
      setBusy(false); refreshInstances();
      sfx(ev.error ? 'error' : 'success');
    }
    redraw();
  }));

  // ---------- side: integrations ----------
  async function drawSide() {
    const st = await api('ai.status');
    const status = (on2, linked) => h('span.status-dot' + (linked ? '.on' : on2 ? '.mid' : ''), linked ? 'подключено' : on2 ? 'найден, не подключён' : 'не найден');
    const linkClaude = btn(st.claudeLinked ? 'Переподключить' : 'Подключить', { icon: 'plug', cls: st.claudeLinked ? 'sm' : 'primary sm' });
    linkClaude.onclick = busy(linkClaude, async () => { await api('ai.linkClaude'); toast('Claude Code видит лаунчер. В новом чате Claude Code спроси: «собери сборку в Nebula»', 'ok', 'Готово'); drawSide(); });
    const linkCodex = btn(st.codexLinked ? 'Переподключить' : 'Подключить', { icon: 'plug', cls: st.codexLinked ? 'sm' : 'primary sm' });
    linkCodex.onclick = busy(linkCodex, async () => { await api('ai.linkCodex'); toast('Codex подключён через ~/.codex/config.toml', 'ok', 'Готово'); drawSide(); });
    const cfg = JSON.stringify({ mcpServers: { nebula: st.mcp } }, null, 2);
    const activity = h('.activity');
    side.replaceChildren(
      h('.card.int-card', h('.head', h('.logo-box', { style: { background: 'linear-gradient(135deg,#d97757,#b85c3c)' } }, 'C'), h('.grow', h('b', 'Claude Code'), h('div', status(st.claude, st.claudeLinked)))),
        h('p.muted', { style: { fontSize: '12.5px', marginBottom: '10px' } }, 'Даст Claude Code инструменты лаунчера (MCP). Встроенный чат слева работает и без этого.'), st.claude ? linkClaude : null),
      h('.card.int-card', h('.head', h('.logo-box', { style: { background: 'linear-gradient(135deg,#10a37f,#0b6e56)' } }, 'GPT'), h('.grow', h('b', 'Codex CLI'), h('div', status(st.codex, st.codexLinked)))),
        h('p.muted', { style: { fontSize: '12.5px', marginBottom: '10px' } }, 'Добавит сервер nebula в ~/.codex/config.toml (старый файл сохранится как .nebula-backup).'), linkCodex),
      h('.card.int-card', h('.head', h('.logo-box', { style: { background: 'var(--grad)', color: '#0a0816' } }, icon('cpu')), h('.grow', h('b', 'Любой другой ИИ'), h('.muted', { style: { fontSize: '12px' } }, 'Cursor, Windsurf, Gemini CLI…'))),
        h('p.muted', { style: { fontSize: '12.5px', marginBottom: '8px' } }, 'MCP-конфиг (stdio):'), h('pre.code', cfg),
        h('.row', { style: { marginTop: '8px' } }, btn('Копировать', { icon: 'copy', cls: 'sm', onclick: () => { navigator.clipboard.writeText(cfg); toast('Скопировано', 'ok'); } }), btn('Гайд для ИИ', { icon: 'book-open', cls: 'sm ghost', onclick: () => api('app.openGuide') }))),
      h('.card', h('h3', icon('activity'), 'Что делал ИИ'), activity));
    const acts = await api('ai.activity', 30);
    const drawAct = (list) => activity.replaceChildren(...(list.length ? list.map(actRow) : [h('.muted', { style: { fontSize: '12.5px' } }, 'Пока тихо. Действия ИИ через MCP появятся здесь в реальном времени.')]));
    drawAct(acts.filter((a) => a.source !== 'launcher'));
  }
  function actRow(a) {
    const iconFor = { create: 'folder-plus', install: 'download', remove: 'trash-2', launch: 'play', config: 'file-pen', spec: 'package', update: 'settings-2' };
    const inst2 = state.instances.find((i) => i.id === a.instanceId);
    const text = { create: 'Создана сборка', install: 'Установлено: ' + (a.installed || []).slice(0, 4).join(', '), remove: 'Удалено: ' + (a.removed || []).join(', '), launch: 'Запуск', config: 'Изменён файл ' + (a.file || ''), spec: 'Собрана сборка', update: 'Изменены настройки' }[a.action] || a.action;
    return h('.act', icon(iconFor[a.action] || 'sparkles'), h('div', h('div', text), inst2 ? h('.dim', { style: { fontSize: '11.5px' } }, inst2.name) : a.name ? h('.dim', a.name) : null), h('span.when', timeAgo(a.t)));
  }
  drawSide();
  offs.push(listen('activity', (a) => { const act = side.querySelector('.activity'); if (act) { act.querySelector('.muted')?.remove(); act.prepend(actRow(a)); } }));
  offs.push(listen('selected', drawCtx));

  drawMsgs();
  if (params.prompt) { input.value = params.prompt; setTimeout(send, 300); }
  else setTimeout(() => input.focus(), 100);
}

export function destroy() { offs.forEach((f) => f()); offs = []; }
