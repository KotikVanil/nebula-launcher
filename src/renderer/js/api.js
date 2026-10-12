// Renderer side API + shared state store.
export const api = (method, ...args) => window.nebula.call(method, ...args);
export const on = (ch, cb) => window.nebula.on(ch, cb);

const listeners = new Map();
export const state = {
  settings: {}, accounts: { active: null, list: [] }, instances: [], running: [], tasks: new Map(),
  selected: null, info: {}, skinsCache: new Map(),
};

export function emit(ev, data) { for (const cb of listeners.get(ev) || []) try { cb(data); } catch (e) { console.error(e); } }
export function listen(ev, cb) {
  if (!listeners.has(ev)) listeners.set(ev, new Set());
  listeners.get(ev).add(cb);
  return () => listeners.get(ev).delete(cb);
}

export async function refreshInstances() {
  state.instances = await api('instances.list');
  if (!state.selected || !state.instances.find((i) => i.id === state.selected)) {
    state.selected = localStorage.getItem('selected') && state.instances.find((i) => i.id === localStorage.getItem('selected')) ? localStorage.getItem('selected') : (state.instances[0] && state.instances[0].id);
  }
  emit('instances', state.instances);
  return state.instances;
}

export function selectInstance(id) {
  state.selected = id;
  try { localStorage.setItem('selected', id); } catch {}
  emit('selected', id);
}

export async function refreshAccounts() {
  state.accounts = await api('accounts.list');
  emit('accounts', state.accounts);
  return state.accounts;
}

export function activeAccount() {
  return state.accounts.list.find((a) => a.id === state.accounts.active) || state.accounts.list[0] || null;
}

export async function saveSettings(patch) {
  state.settings = await api('settings.set', patch);
  emit('settings', state.settings);
  return state.settings;
}

export function isRunning(id) { return state.running.some((r) => r.instanceId === id); }
