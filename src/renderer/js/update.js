// Launcher self-update UI: titlebar pill + dialog with release notes.
import { api } from './api.js';
import { h, icon, btn, busy, modal, toast, md } from './ui.js';

let lastInfo = null;

export function openUpdateDialog(info) {
  const m = modal({
    title: `Nebula ${info.latest}`,
    body: h('div',
      h('p.muted', { style: { marginBottom: '10px' } }, `Сейчас установлена ${info.current}. Обновление скачается с GitHub (${Math.round(info.asset.size / 1048576)} МБ) и поставится само, лаунчер перезапустится. Сборки, миры и аккаунты не пострадают.`),
      info.notes ? h('.md', { style: { maxHeight: '260px', overflow: 'auto', padding: '12px 14px', borderRadius: '12px', background: 'rgba(255,255,255,.04)' }, html: md(info.notes) }) : null,
      info.canInstall ? null : h('p.dim', { style: { marginTop: '10px', fontSize: '12px' } }, 'Лаунчер запущен из исходников — откроется страница релиза.')),
    actions: [
      btn('На GitHub', { icon: 'external-link', cls: 'ghost', onclick: () => api('app.openExternal', info.page) }),
      (() => {
        const b = btn(info.canInstall ? 'Обновить сейчас' : 'Открыть релиз', { icon: 'download', cls: 'primary' });
        b.onclick = busy(b, async () => { await api('update.install'); m.close(); });
        return b;
      })(),
    ],
  });
}

function showPill(info) {
  const g = document.getElementById('tb-update');
  if (!g) return;
  g.replaceChildren(h('button.tb-pill', { style: { borderColor: 'rgba(var(--a2-rgb), .5)', color: 'var(--a2)' }, title: 'Доступно обновление лаунчера', onclick: () => openUpdateDialog(info) }, icon('sparkles'), `Обновление ${info.latest}`));
}

export async function checkForUpdates({ silent = true } = {}) {
  try {
    const info = await api('update.check');
    lastInfo = info;
    if (info.available) {
      showPill(info);
      if (silent) toast(`Вышла версия ${info.latest}. Нажми «Обновление» вверху окна.`, 'info', 'Обновление лаунчера');
      else openUpdateDialog(info);
    } else if (!silent) toast(`У тебя последняя версия (${info.current})`, 'ok');
    return info;
  } catch (e) {
    if (!silent) toast('Не удалось проверить обновления: ' + e.message, 'error');
    return null;
  }
}

export function lastUpdateInfo() { return lastInfo; }
