// Background task registry: every long operation shows up in the downloads panel.
const { EventEmitter } = require('events');

const bus = new EventEmitter();
const tasks = new Map();
let seq = 0;

function create(title, meta = {}) {
  const id = 't' + (++seq) + '-' + Date.now().toString(36);
  const ctrl = new AbortController();
  const t = { id, title, stage: 'Ожидание', done: 0, total: 0, bytes: 0, status: 'running', started: Date.now(), ...meta };
  tasks.set(id, { t, ctrl });
  let last = 0;
  const emit = (force) => {
    const now = Date.now();
    if (!force && now - last < 100) return;
    last = now;
    bus.emit('update', { ...t });
  };
  emit(true);
  return {
    id,
    signal: ctrl.signal,
    progress(p) {
      if (p.stage) t.stage = p.stage;
      if (p.total !== undefined) { t.done = p.done || 0; t.total = p.total; }
      if (p.bytes !== undefined) t.bytes = p.bytes;
      emit();
    },
    finish(result) { t.status = 'done'; t.stage = 'Готово'; t.result = result; t.ended = Date.now(); emit(true); setTimeout(() => tasks.delete(id), 60000); },
    fail(err) { t.status = ctrl.signal.aborted ? 'cancelled' : 'error'; t.error = String(err && err.message || err); t.ended = Date.now(); emit(true); },
  };
}

function cancel(id) { const e = tasks.get(id); if (e) e.ctrl.abort(); }
function list() { return [...tasks.values()].map((e) => ({ ...e.t })); }

// Wrap an async job into a task
async function run(title, meta, fn) {
  const task = create(title, meta);
  try {
    const r = await fn(task);
    task.finish(r);
    return r;
  } catch (e) {
    task.fail(e);
    throw e;
  }
}

module.exports = { bus, create, cancel, list, run };
