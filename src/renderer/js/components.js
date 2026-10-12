// Shared widgets: play button, instance icon, instance cards.
import { api, state, listen, activeAccount, isRunning, refreshInstances, selectInstance } from './api.js';
import { h, icon, toast, menu, confirmDialog, promptDialog, loaderBadge, fmtDuration, LOADERS } from './ui.js';
import { iconCanvas, faceTextureUrl } from './blocks.js';
import { sfx } from './sound.js';

export function instIcon(inst, size = 88) {
  if (inst && inst.icon && inst.icon.startsWith('data:')) {
    const img = h('img.ico.pixel', { src: inst.icon });
    img.style.width = img.style.height = size + 'px';
    img.style.borderRadius = '14px';
    return img;
  }
  return iconCanvas((inst && inst.icon) || 'grass', size, size);
}

function launchTask(id) {
  return [...state.tasks.values()].find((t) => t.instanceId === id && t.kind === 'launch' && t.status === 'running');
}

export function playButton(getInst, { small = false } = {}) {
  const b = h('button.play-btn', h('span.fill'), h('span.pico'), h('span.ptext', h('span.big'), h('small')));
  const pico = b.querySelector('.pico'), big = b.querySelector('.big'), sm = b.querySelector('small');
  const render = () => {
    if (b.isConnected) b._was = true; else if (b._was) return b._cleanup();
    const inst = getInst();
    b.classList.remove('busy', 'running');
    if (!inst) { pico.replaceChildren(icon('plus')); big.textContent = 'СОЗДАТЬ'; sm.textContent = 'первую сборку'; return; }
    const task = launchTask(inst.id);
    if (isRunning(inst.id)) {
      b.classList.add('running');
      pico.replaceChildren(icon('square'));
      big.textContent = 'В ИГРЕ';
      sm.textContent = 'нажми, чтобы закрыть игру';
    } else if (task) {
      b.classList.add('busy');
      const p = task.total ? task.done / task.total : 0;
      b.style.setProperty('--pp', p);
      pico.replaceChildren(h('span.spinner'));
      big.textContent = task.total ? Math.round(p * 100) + '%' : 'ЗАПУСК';
      sm.textContent = task.stage;
    } else {
      const acc = activeAccount();
      pico.replaceChildren(icon('play'));
      big.textContent = small ? 'ИГРАТЬ' : 'ИГРАТЬ';
      sm.textContent = acc ? `${acc.name} · ${inst.mc}${inst.loader !== 'vanilla' ? ' · ' + LOADERS[inst.loader].name : ''}` : 'сначала добавьте аккаунт';
    }
  };
  b.addEventListener('click', async () => {
    const inst = getInst();
    if (!inst) { const { openWizard } = await import('./pages/wizard.js'); return openWizard(); }
    if (isRunning(inst.id)) {
      if (await confirmDialog('Закрыть игру принудительно? Несохранённый прогресс может пропасть.', { ok: 'Закрыть', danger: true })) api('game.kill', inst.id);
      return;
    }
    if (launchTask(inst.id)) return;
    if (!activeAccount()) { const { openLogin } = await import('./pages/account.js'); return openLogin(); }
    sfx('launch');
    b.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 450, easing: 'ease-out' });
    api('game.play', inst.id).catch((e) => toast(e.message, 'error', 'Не удалось запустить'));
  });
  const offs = [listen('task', render), listen('running', render), listen('accounts', render), listen('instances', render), listen('selected', render)];
  b._cleanup = () => offs.forEach((f) => f());
  render();
  return b;
}

export function instanceMenu(e, inst, after) {
  const { navigate } = window.__nav;
  menu({ x: e.clientX, y: e.clientY }, [
    { icon: 'play', label: 'Играть', onclick: () => api('game.play', inst.id).catch((er) => toast(er.message, 'error')) },
    { icon: 'square-pen', label: 'Открыть', onclick: () => navigate('instance', { id: inst.id }) },
    { icon: 'folder-open', label: 'Открыть папку', onclick: () => api('instances.openDir', inst.id) },
    '-',
    { icon: 'copy', label: 'Дублировать', onclick: async () => { const n = await promptDialog('Имя копии', { value: inst.name + ' (копия)', title: 'Дублировать сборку' }); if (n) { await api('instances.duplicate', inst.id, n); refreshInstances(); toast('Копия создана', 'ok'); } } },
    { icon: 'package', label: 'Экспорт .mrpack', onclick: () => api('modpack.export', inst.id).then((r) => r && toast(`Экспортировано: ${r.mods} модов`, 'ok')) },
    '-',
    { icon: 'trash-2', label: 'Удалить', danger: true, onclick: async () => {
      if (!(await confirmDialog(`Удалить сборку «${inst.name}» со всеми мирами? Она переместится в корзину лаунчера (.trash).`, { ok: 'Удалить', danger: true }))) return;
      await api('instances.remove', inst.id); await refreshInstances(); toast('Сборка удалена', 'ok'); after && after();
    } },
  ]);
}

export function instCard(inst, { onOpen } = {}) {
  const lc = LOADERS[inst.loader] || LOADERS.vanilla;
  const cover = h('.inst-cover', inst.modpack && inst.modpack.icon ? h('img.modpack-ico', { src: inst.modpack.icon }) : null, instIcon(inst, 88));
  if (!String(inst.icon).startsWith('data:')) cover.style.setProperty('--tex', `url(${faceTextureUrl(inst.icon)})`);
  const quick = h('button.inst-quick', { title: 'Играть', onclick: (e) => { e.stopPropagation(); selectInstance(inst.id); sfx('launch'); api('game.play', inst.id).catch((er) => toast(er.message, 'error')); } }, icon('play'));
  const card = h('.inst-card', { onclick: () => { sfx('click'); onOpen ? onOpen(inst) : window.__nav.navigate('instance', { id: inst.id }); }, oncontextmenu: (e) => { e.preventDefault(); instanceMenu(e, inst); }, onmouseenter: () => sfx('hover') },
    cover, quick,
    isRunning(inst.id) ? h('span.chip.running-tag', { style: { background: 'rgba(74,222,128,.15)', color: '#bbf7d0' } }, '● в игре') : null,
    h('.inst-body',
      h('.name', inst.name),
      h('.info', h('span.chip', inst.mc), loaderBadge(inst.loader), h('span.grow'), h('span.stat', icon('clock'), fmtDuration(inst.playtime)))));
  card.style.setProperty('--lc', lc.color);
  // 3D tilt
  card.addEventListener('mousemove', (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `perspective(700px) rotateY(${x * 8}deg) rotateX(${-y * 8}deg) translateY(-4px)`;
  });
  card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  return card;
}
