import { api, state } from '../api.js';
import { h, icon, btn, modal } from '../ui.js';
import { iconCanvas } from '../blocks.js';

export function showCrash(e) {
  const inst = state.instances.find((i) => i.id === e.instanceId);
  const c = e.crash || { findings: [], errorLines: [] };
  const body = h('.crash-box',
    h('.row', { style: { gap: '16px', marginBottom: '14px' } }, iconCanvas('tnt', 64, 64), h('div', h('p', `Сборка «${inst ? inst.name : e.instanceId}» закрылась с кодом ${e.code}.`), c.description ? h('p.muted', c.description) : null)),
    c.findings.length ? c.findings.map((f) => h('.finding', h('b', f.title), f.hint)) : h('p.muted', 'Точную причину не удалось определить автоматически. Посмотрите консоль или спросите ИИ.'),
    c.errorLines.length ? h('pre.code', { style: { maxHeight: '180px', overflow: 'auto', marginTop: '10px' } }, c.errorLines.slice(-12).join('\n')) : null);
  const m = modal({
    title: 'Игра вылетела', body,
    actions: [
      c.crashReport ? btn('Краш-репорт', { icon: 'file-text', cls: 'ghost', onclick: () => api('files.showItem', c.crashReport) }) : null,
      btn('Консоль', { icon: 'terminal', onclick: () => { m.close(); window.__nav.navigate('instance', { id: e.instanceId, tab: 'console' }); } }),
      btn('Починить с ИИ', { icon: 'sparkles', cls: 'primary', onclick: () => { m.close(); window.__nav.navigate('ai', { instanceId: e.instanceId, prompt: 'Игра вылетела при запуске этой сборки. Прочитай лог/краш-репорт, найди причину и почини сборку.' }); } }),
    ].filter(Boolean),
  });
}
