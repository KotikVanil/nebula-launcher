// DOM helpers, icons, toasts, modals, popovers, formatting.
import { sfx } from './sound.js';

// Native append/replaceChildren turn null into the text "null"; skip empty values like h() does.
for (const m of ['append', 'prepend', 'replaceChildren']) {
  const orig = Element.prototype[m];
  Element.prototype[m] = function (...nodes) { return orig.apply(this, nodes.flat(Infinity).filter((n) => n !== null && n !== undefined && n !== false)); };
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// h('div.card#id', {onclick, style:{}, html:'...'}, children...)
export function h(sel, attrs, ...children) {
  if (attrs && (attrs instanceof Node || typeof attrs !== 'object' || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className += ' ' + v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

// Lucide icons -> inline SVG
const pascal = (s) => s.replace(/(^|-)(\w)/g, (m, a, b) => b.toUpperCase());
export function icon(name, cls) {
  const L = window.lucide;
  const node = L && (L.icons ? L.icons[pascal(name)] : L[pascal(name)]);
  if (!node) return h('span.ico-missing');
  try {
    const svg = L.createElement(node);
    svg.setAttribute('width', '24'); svg.setAttribute('height', '24');
    if (cls) svg.classList.add(cls);
    return svg;
  } catch {
    return h('span');
  }
}

export function btn(label, opts = {}) {
  const b = h('button.btn' + (opts.cls ? '.' + opts.cls.split(' ').join('.') : ''), { onclick: opts.onclick, title: opts.title, disabled: opts.disabled },
    opts.icon ? icon(opts.icon) : null, label ? h('span', label) : null);
  b.addEventListener('mouseenter', () => sfx('hover'));
  b.addEventListener('click', () => sfx('click'));
  return b;
}

// Wrap async click handler with spinner + error toast
export function busy(button, fn) {
  return async (...a) => {
    if (button.disabled) return;
    const old = [...button.childNodes];
    button.disabled = true;
    button.replaceChildren(h('span.spinner'), ...old.filter((n) => n.tagName === 'SPAN' && !n.classList.contains('spinner')));
    try { return await fn(...a); } catch (e) { toast(e.message || String(e), 'error'); } finally {
      if (button.isConnected) { button.disabled = false; button.replaceChildren(...old); }
    }
  };
}

// ---------- toasts ----------
export function toast(text, type = 'info', title) {
  const icons = { ok: 'circle-check', error: 'circle-alert', info: 'info', ai: 'sparkles' };
  const host = $('#toasts');
  const t = h('.toast.' + type, icon(icons[type] || 'info'), h('div', title ? h('b', title) : null, h('span', text)));
  host.append(t);
  if (type === 'error') sfx('error'); else if (type === 'ok') sfx('success'); else sfx('pop');
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 260); };
  t.onclick = kill;
  setTimeout(kill, type === 'error' ? 7000 : 4200);
}

// ---------- modal ----------
export function modal({ title, body, actions = [], wide = false, onClose, closable = true, cls = '' }) {
  const back = h('.modal-back');
  const close = () => { if (!back.isConnected) return; back.classList.add('out'); setTimeout(() => back.remove(), 200); onClose && onClose(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && closable) close(); };
  document.addEventListener('keydown', onKey);
  const m = h('.modal' + (wide ? '.wide' : '') + (cls ? '.' + cls : ''),
    title ? h('.modal-head', h('h2', title), closable ? btn('', { icon: 'x', cls: 'ghost icon sm x', onclick: close }) : null) : null,
    h('.modal-body', body),
    actions.length ? h('.modal-foot', actions) : null);
  back.append(m);
  back.addEventListener('mousedown', (e) => { if (e.target === back && closable) close(); });
  document.body.append(back);
  sfx('open');
  return { close, el: m, back };
}

export function confirmDialog(text, { title = 'Подтверждение', ok = 'Да', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, body: h('p.muted', text),
      onClose: () => { if (!done) resolve(false); },
      actions: [
        btn('Отмена', { cls: 'ghost', onclick: () => { done = true; resolve(false); m.close(); } }),
        btn(ok, { cls: danger ? 'danger' : 'primary', onclick: () => { done = true; resolve(true); m.close(); } }),
      ],
    });
  });
}

export function promptDialog(text, { title = 'Ввод', value = '', placeholder = '', ok = 'OK' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input.input', { value, placeholder });
    const submit = () => { done = true; resolve(input.value.trim()); m.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const m = modal({ title, body: h('.col', text ? h('p.muted', text) : null, input), onClose: () => { if (!done) resolve(null); }, actions: [btn('Отмена', { cls: 'ghost', onclick: () => m.close() }), btn(ok, { cls: 'primary', onclick: submit })] });
    setTimeout(() => input.focus(), 50);
  });
}

// ---------- popover / context menu ----------
let currentPop = null;
export function popover(anchorOrPoint, content, { align = 'right', width } = {}) {
  closePopover();
  const p = h('.popover', content);
  if (width) p.style.width = width + 'px';
  document.body.append(p);
  let x, y;
  if (anchorOrPoint instanceof Element) {
    const r = anchorOrPoint.getBoundingClientRect();
    y = r.bottom + 8;
    x = align === 'right' ? r.right - p.offsetWidth : align === 'side' ? r.right + 10 : r.left;
    if (align === 'side') y = Math.max(10, r.bottom - p.offsetHeight);
  } else { x = anchorOrPoint.x; y = anchorOrPoint.y; }
  x = Math.max(10, Math.min(x, window.innerWidth - p.offsetWidth - 10));
  y = Math.max(10, Math.min(y, window.innerHeight - p.offsetHeight - 10));
  p.style.left = x + 'px'; p.style.top = y + 'px';
  currentPop = p;
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  function outside(e) { if (!p.contains(e.target)) closePopover(); }
  p._outside = outside;
  return p;
}
export function closePopover() {
  if (currentPop) { document.removeEventListener('mousedown', currentPop._outside); currentPop.remove(); currentPop = null; }
}
export function menu(point, items) {
  const content = items.map((it) => (it === '-' ? h('.menu-sep') : h('.menu-item' + (it.danger ? '.danger' : ''), { onclick: () => { closePopover(); sfx('click'); it.onclick(); } }, icon(it.icon), it.label)));
  return popover(point, content);
}

// ---------- tabs with sliding ink ----------
export function tabs(items, active, onChange) {
  const wrap = h('.tabs');
  const ink = h('.tab-ink');
  wrap.append(ink);
  const set = (id) => {
    for (const b of wrap.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.id === id);
    const a = wrap.querySelector(`.tab[data-id="${id}"]`);
    if (a) requestAnimationFrame(() => { ink.style.left = a.offsetLeft + 'px'; ink.style.width = a.offsetWidth + 'px'; });
  };
  for (const it of items) {
    wrap.append(h('button.tab', { dataset: { id: it.id }, onclick: () => { sfx('tab'); set(it.id); onChange(it.id); } }, it.icon ? icon(it.icon) : null, it.label, it.count !== undefined ? h('span.count', String(it.count)) : null));
  }
  setTimeout(() => set(active), 0);
  wrap.setActive = set;
  return wrap;
}

export function switchEl(checked, onChange) {
  const input = h('input', { type: 'checkbox', checked });
  input.addEventListener('change', () => { sfx('tick'); onChange(input.checked); });
  return h('label.switch', input, h('span'));
}

export function rangeEl({ min, max, step = 1, value, onInput }) {
  const r = h('input', { type: 'range', min, max, step, value });
  const upd = () => r.style.setProperty('--p', ((r.value - min) / (max - min)) * 100 + '%');
  r.addEventListener('input', () => { upd(); onInput && onInput(Number(r.value)); });
  upd();
  return r;
}

export function select(options, value, onChange) {
  const s = h('select.select', options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

// ---------- formatting ----------
export function fmtBytes(n) {
  if (!n) return '0 Б';
  const u = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
}
export function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K';
  return String(n);
}
export function fmtDuration(sec) {
  if (!sec) return '0 мин';
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60);
  return hh ? `${hh} ч ${mm} мин` : `${mm} мин`;
}
export function timeAgo(t) {
  if (!t) return 'никогда';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'только что';
  if (s < 3600) return Math.floor(s / 60) + ' мин назад';
  if (s < 86400) return Math.floor(s / 3600) + ' ч назад';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' дн назад';
  return new Date(t).toLocaleDateString('ru-RU');
}
export function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  return n + ' ' + (m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many);
}

export const LOADERS = {
  vanilla: { name: 'Vanilla', color: '#5ec269', desc: 'Чистая игра без модов' },
  fabric: { name: 'Fabric', color: '#dbb68f', desc: 'Лёгкий и быстрый, много модов на оптимизацию' },
  quilt: { name: 'Quilt', color: '#a77bf3', desc: 'Форк Fabric, совместим с его модами' },
  forge: { name: 'Forge', color: '#e0703a', desc: 'Классика: огромные моды и старые версии' },
  neoforge: { name: 'NeoForge', color: '#f48a3a', desc: 'Современный Forge для новых версий' },
};

export function loaderBadge(loader, version) {
  const l = LOADERS[loader] || LOADERS.vanilla;
  const b = h('span.loader-badge', l.name + (version ? ' ' + version : ''));
  b.style.setProperty('--lc', l.color);
  return b;
}

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function md(text) {
  try {
    const html = window.marked.parse(text || '');
    return window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  } catch { return ''; }
}
