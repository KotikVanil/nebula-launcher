// Accounts: offline (nickname) and Microsoft. Tokens can be encrypted by the host (Electron safeStorage).
const crypto = require('crypto');
const P = require('./paths');
const msauth = require('./msauth');
const { readJSON, writeJSON, offlineUUID } = require('./util');

let box = { encrypt: (s) => s, decrypt: (s) => s };
function setSecretBox(b) { box = b; }

function load() { return readJSON(P.accounts, { active: null, list: [] }); }
function save(d) { writeJSON(P.accounts, d); }

function publicView(a) {
  return {
    id: a.id, type: a.type, name: a.name, uuid: a.uuid, skinId: a.skinId || null, skinUrl: a.skinUrl || null,
    skinVariant: a.skinVariant || 'classic', capes: a.capes || [], added: a.added,
  };
}

function list() {
  const d = load();
  return { active: d.active, list: d.list.map(publicView) };
}

function getRaw(id) {
  const d = load();
  return d.list.find((a) => a.id === (id || d.active)) || d.list[0] || null;
}

function upsert(acc) {
  const d = load();
  const i = d.list.findIndex((a) => a.id === acc.id);
  if (i >= 0) d.list[i] = { ...d.list[i], ...acc }; else d.list.push(acc);
  if (!d.active) d.active = acc.id;
  save(d);
  return publicView(i >= 0 ? d.list[i] : acc);
}

function addOffline(name) {
  name = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Ник: 3–16 символов, латиница, цифры и _');
  const uuid = offlineUUID(name);
  const acc = upsert({ id: 'off-' + uuid, type: 'offline', name, uuid, added: Date.now() });
  setActive(acc.id);
  return acc;
}

function fromMsResult(r) {
  const p = r.profile;
  const skin = (p.skins || []).find((s) => s.state === 'ACTIVE');
  return {
    id: 'ms-' + p.id, type: 'msa', name: p.name, uuid: p.id,
    accessToken: box.encrypt(r.accessToken), refreshToken: box.encrypt(r.refreshToken),
    expiresAt: r.expiresAt, xuid: r.xuid, clientId: r.clientId,
    skinUrl: skin ? skin.url : null, skinVariant: skin && skin.variant === 'SLIM' ? 'slim' : 'classic',
    capes: (p.capes || []).map((c) => ({ id: c.id, alias: c.alias, url: c.url, active: c.state === 'ACTIVE' })),
  };
}

async function addMicrosoft(code, clientId) {
  const r = await msauth.loginWithCode(code, clientId);
  const acc = upsert({ ...fromMsResult(r), added: Date.now() });
  setActive(acc.id);
  return acc;
}

// Returns a raw account with a valid (decrypted) Minecraft token
async function ensureFresh(id) {
  const a = getRaw(id);
  if (!a) throw new Error('Нет аккаунта. Добавьте аккаунт в лаунчере.');
  if (a.type !== 'msa') return { ...a, accessToken: crypto.randomBytes(16).toString('hex') };
  if (a.expiresAt && Date.now() < a.expiresAt) return { ...a, accessToken: box.decrypt(a.accessToken), refreshToken: box.decrypt(a.refreshToken) };
  const r = await msauth.refresh(box.decrypt(a.refreshToken), a.clientId);
  upsert(fromMsResult(r));
  return { ...getRaw(a.id), accessToken: r.accessToken, refreshToken: r.refreshToken };
}

async function refreshProfile(id) {
  const a = await ensureFresh(id);
  if (a.type !== 'msa') return publicView(a);
  const prof = await msauth.profile(a.accessToken);
  return upsert({ ...fromMsResult({ profile: prof, accessToken: a.accessToken, refreshToken: a.refreshToken, expiresAt: a.expiresAt, xuid: a.xuid, clientId: a.clientId }) });
}

function setActive(id) { const d = load(); d.active = id; save(d); }

function remove(id) {
  const d = load();
  d.list = d.list.filter((a) => a.id !== id);
  if (d.active === id) d.active = d.list[0] ? d.list[0].id : null;
  save(d);
}

function patch(id, p) { const a = getRaw(id); if (a) upsert({ ...a, ...p }); }

module.exports = { setSecretBox, list, getRaw, addOffline, addMicrosoft, ensureFresh, refreshProfile, setActive, remove, patch };
