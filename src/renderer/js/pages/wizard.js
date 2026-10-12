// New instance wizard with live preview card.
import { api, state, refreshInstances, selectInstance } from '../api.js';
import { h, icon, btn, modal, toast, LOADERS, loaderBadge } from '../ui.js';
import { iconCanvas } from '../blocks.js';
import { sfx } from '../sound.js';

const NAMES = ['Новый мир', 'Выживание', 'Техно-сборка', 'Магия и меч', 'Строительство', 'Хардкор', 'С друзьями', 'Красота', 'Приключения'];

export async function openWizard({ firstRun = false, preset = null } = {}) {
  const icons = await api('instances.icons');
  const latest = await api('versions.latest').catch(() => ({ release: '1.21.1' }));
  const s = {
    step: 0, name: NAMES[Math.floor(Math.random() * NAMES.length)], icon: icons[Math.floor(Math.random() * 8)],
    mc: latest.release, loader: preset ? 'fabric' : 'vanilla', loaderVersion: null, presets: new Set(preset ? [preset] : []), snapshots: false,
  };
  let versions = [];
  let presets = [];
  api('modpack.presets').then((p) => (presets = p));

  const preview = h('.wiz-preview');
  const stepsEl = h('.wiz-steps');
  const pane = h('.wiz-pane');
  const foot = h('.row', { style: { marginTop: '18px' } });
  const STEPS = ['Название', 'Версия', 'Загрузчик', 'Наборы модов'];

  const body = h('.wizard',
    h('.wiz-side', h('div', { style: { fontFamily: 'var(--display)', fontSize: '12px', letterSpacing: '.2em', color: 'var(--a2)' } }, firstRun ? 'ПЕРВАЯ СБОРКА' : 'НОВАЯ СБОРКА'), preview, stepsEl),
    h('.wiz-main', pane, foot));
  const m = modal({ body, wide: true, cls: 'wiz' });
  m.el.querySelector('.modal-body').style.padding = '0';

  const drawPreview = () => {
    const l = LOADERS[s.loader];
    const cover = h('.inst-cover', iconCanvas(s.icon, 88, 88));
    cover.style.setProperty('--lc', l.color);
    preview.replaceChildren(cover, h('.inst-body', h('.name', s.name || 'Без имени'), h('.info', h('span.chip', s.mc), loaderBadge(s.loader), s.presets.size ? h('span.chip', icon('package'), s.presets.size + ' наб.') : null)));
    stepsEl.replaceChildren(...STEPS.map((t, i) => h('.wiz-step' + (i === s.step ? '.on' : i < s.step ? '.done' : ''), h('i', i < s.step ? '✓' : String(i + 1)), t)));
  };

  const go = (n) => { s.step = n; sfx('tab'); draw(); };
  const next = () => (s.step === 2 && s.loader === 'vanilla') || s.step === 3 ? create() : go(s.step + 1);

  async function draw() {
    drawPreview();
    if (s.step === 0) {
      const input = h('input.input', { value: s.name, maxlength: 40, style: { height: '48px', fontSize: '16px', fontWeight: 700 } });
      input.addEventListener('input', () => { s.name = input.value; drawPreview(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') next(); });
      const grid = h('.icon-grid');
      for (const ic of icons) {
        const o = h('.icon-opt' + (ic === s.icon ? '.on' : ''), { onclick: () => { s.icon = ic; sfx('tick'); grid.querySelectorAll('.icon-opt').forEach((x) => x.classList.remove('on')); o.classList.add('on'); drawPreview(); } }, iconCanvas(ic, 40, 40));
        grid.append(o);
      }
      pane.replaceChildren(h('h3', 'Как назовём?'), h('p.muted', { style: { marginBottom: '14px' } }, 'Имя и иконку можно поменять потом.'), input, h('div', { style: { margin: '18px 0 8px', fontWeight: 700, fontSize: '13px', color: 'var(--text-2)' } }, 'Иконка'), grid);
      setTimeout(() => { input.focus(); input.select(); }, 60);
    }
    if (s.step === 1) {
      const list = h('.ver-list', [...Array(12)].map(() => h('.skeleton', { style: { height: '50px' } })));
      const snap = h('label.row', { style: { gap: '8px', fontSize: '13px', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: s.snapshots, onchange: async (e) => { s.snapshots = e.target.checked; versions = []; draw(); } }), 'Снапшоты');
      const filter = h('input.input', { placeholder: 'Фильтр: 1.20, 26.…', style: { maxWidth: '220px' } });
      pane.replaceChildren(h('h3', 'Версия Minecraft'), h('.row', { style: { margin: '6px 0 14px' } }, h('p.muted.grow', 'Для модов чаще всего выбирают 1.20.1 или 1.21.1 — там больше всего модов.'), filter, snap), list);
      if (!versions.length) versions = await api('versions.list', { snapshots: s.snapshots });
      const fill = () => {
        const q = filter.value.trim();
        const popular = new Set(['1.20.1', '1.21.1', '1.12.2', '1.16.5', '1.18.2', '1.19.2', '1.7.10']);
        list.replaceChildren(...versions.filter((v) => !q || v.id.includes(q)).slice(0, 150).map((v, i) => h('.ver-opt' + (v.id === s.mc ? '.on' : ''), { onclick: (e) => { s.mc = v.id; sfx('tick'); list.querySelectorAll('.ver-opt').forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); drawPreview(); }, ondblclick: next },
          h('b', v.id), h('span', i === 0 && !q ? 'последняя' : popular.has(v.id) ? '★ популярная' : v.type === 'snapshot' ? 'снапшот' : new Date(v.releaseTime).getFullYear()))));
      };
      filter.addEventListener('input', fill);
      fill();
    }
    if (s.step === 2) {
      const opts = h('.loader-opts');
      const verSel = h('select.select', { style: { maxWidth: '260px' } }, h('option', 'Авто (рекомендуемая)'));
      verSel.onchange = () => { s.loaderVersion = verSel.value || null; };
      pane.replaceChildren(h('h3', 'Загрузчик модов'), h('p.muted', { style: { marginBottom: '14px' } }, `Для Minecraft ${s.mc}. Серые — недоступны для этой версии.`), opts,
        h('.row', { style: { marginTop: '16px' } }, h('span.muted', 'Версия загрузчика:'), verSel));
      const avail = {};
      const drawOpts = () => opts.replaceChildren(...Object.entries(LOADERS).map(([k, l]) => {
        const o = h('.loader-opt' + (s.loader === k ? '.on' : '') + (avail[k] === false ? '.na' : ''), { onclick: () => { s.loader = k; s.loaderVersion = null; sfx('tick'); drawOpts(); drawPreview(); loadVers(); } },
          h('.lname', l.name), h('p', l.desc), avail[k] === undefined && k !== 'vanilla' ? h('span.spinner', { style: { position: 'absolute', top: '12px', right: '12px', width: '12px', height: '12px', borderWidth: '2px' } }) : null);
        o.style.setProperty('--lc', l.color);
        return o;
      }));
      const loadVers = async () => {
        verSel.replaceChildren(h('option', { value: '' }, 'Авто (рекомендуемая)'));
        if (s.loader === 'vanilla') { verSel.disabled = true; return; }
        verSel.disabled = false;
        try {
          const list = await api('loaders.list', s.loader, s.mc);
          verSel.append(...list.slice(0, 60).map((v) => h('option', { value: v.version, selected: v.version === s.loaderVersion }, v.version + (v.recommended ? ' ★' : v.stable ? '' : ' (beta)'))));
        } catch {}
      };
      drawOpts(); loadVers();
      for (const k of ['fabric', 'quilt', 'forge', 'neoforge']) {
        api('loaders.list', k, s.mc).then((l) => { avail[k] = l.length > 0; if (!avail[k] && s.loader === k) s.loader = 'vanilla'; drawOpts(); }).catch(() => { avail[k] = false; drawOpts(); });
      }
    }
    if (s.step === 3) {
      const grid = h('.preset-grid');
      if (!presets.length) presets = await api('modpack.presets');
      for (const p of presets) {
        const el = h('.preset' + (s.presets.has(p.id) ? '.on' : ''), { onclick: () => { s.presets.has(p.id) ? s.presets.delete(p.id) : s.presets.add(p.id); el.classList.toggle('on'); sfx('tick'); drawPreview(); } },
          h('.pi', icon(p.icon)), h('div', h('b', p.name), h('span', p.desc)));
        grid.append(el);
      }
      pane.replaceChildren(h('h3', 'Наборы модов'), h('p.muted', { style: { marginBottom: '14px' } }, 'Лаунчер сам найдёт версии под ' + s.mc + ' + ' + LOADERS[s.loader].name + ' и поставит зависимости. Можно пропустить.'), grid);
    }
    const last = s.step === 3 || (s.step === 2 && s.loader === 'vanilla');
    foot.replaceChildren(
      s.step > 0 ? btn('Назад', { icon: 'arrow-left', cls: 'ghost', onclick: () => go(s.step - 1) }) : h('span'),
      h('.grow'),
      btn(last ? 'Создать сборку' : 'Далее', { icon: last ? 'sparkles' : 'arrow-right', cls: 'primary', onclick: next }));
  }

  async function create() {
    if (!s.name.trim()) { go(0); return toast('Введите имя', 'error'); }
    try {
      const inst = await api('instances.create', { name: s.name.trim(), mc: s.mc, loader: s.loader, loaderVersion: s.loaderVersion, icon: s.icon });
      m.close();
      sfx('success');
      toast(`Сборка «${inst.name}» создана`, 'ok');
      await refreshInstances();
      selectInstance(inst.id);
      (async () => {
        for (const p of s.presets) {
          try {
            const r = await api('modpack.applyPreset', inst.id, p);
            toast(`+${r.installed.length} модов${r.failed.length ? `, ${r.failed.length} нет под эту версию` : ''}`, 'ok', 'Набор «' + (presets.find((x) => x.id === p) || {}).name + '»');
          } catch (e) { toast(e.message, 'error'); }
        }
      })();
      window.__nav.navigate('instance', { id: inst.id });
    } catch (e) { toast(e.message, 'error'); }
  }

  draw();
}
