// Skin library + applying skins (Mojang upload for Microsoft accounts, local server for offline).
const fs = require('fs');
const path = require('path');
const P = require('./paths');
const net = require('./net');
const accounts = require('./accounts');
const { readJSON, writeJSON, hashBuffer } = require('./util');

const INDEX = path.join(P.skins, 'index.json');

function loadIndex() { return readJSON(INDEX, []); }
function saveIndex(d) { writeJSON(INDEX, d); }

function isPng(buf) { return buf && buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47; }

function pngSize(buf) { return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }; }

function list() {
  return loadIndex().map((s) => ({ ...s, path: path.join(P.skins, s.file) }));
}

function add(buf, { name = 'Скин', variant = 'classic', source = 'file' } = {}) {
  if (!isPng(buf)) throw new Error('Скин должен быть PNG-файлом');
  const { w, h } = pngSize(buf);
  if (!((w === 64 && (h === 64 || h === 32)) || (w % 64 === 0 && (h === w || h * 2 === w)))) throw new Error(`Размер скина ${w}x${h} не подходит (нужно 64x64 или 64x32)`);
  const hash = hashBuffer(buf, 'sha256').slice(0, 24);
  const idx = loadIndex();
  const existing = idx.find((s) => s.hash === hash);
  if (existing) return existing;
  const file = hash + '.png';
  fs.writeFileSync(path.join(P.skins, file), buf);
  const entry = { id: hash, hash, name: String(name).slice(0, 40), variant, file, source, added: Date.now() };
  idx.unshift(entry);
  saveIndex(idx);
  return entry;
}

function addFile(file, opts = {}) {
  return add(fs.readFileSync(file), { name: path.basename(file, path.extname(file)), ...opts });
}

function update(id, patch) {
  const idx = loadIndex();
  const s = idx.find((x) => x.id === id);
  if (!s) throw new Error('Скин не найден');
  Object.assign(s, patch);
  saveIndex(idx);
  return s;
}

function remove(id) {
  const idx = loadIndex();
  const s = idx.find((x) => x.id === id);
  saveIndex(idx.filter((x) => x.id !== id));
  if (s) try { fs.unlinkSync(path.join(P.skins, s.file)); } catch {}
}

function get(id) {
  const s = loadIndex().find((x) => x.id === id);
  return s ? { ...s, path: path.join(P.skins, s.file) } : null;
}

// Copy any licensed player's skin by nickname
async function fromNickname(nick) {
  const res = await net.request(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(nick)}`);
  if (res.status === 404 || res.status === 204) throw new Error(`Игрок ${nick} не найден`);
  const { id, name } = await res.json();
  const prof = await net.getJSON(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
  const tex = JSON.parse(Buffer.from(prof.properties.find((p) => p.name === 'textures').value, 'base64').toString());
  if (!tex.textures.SKIN) throw new Error('У игрока стандартный скин');
  const buf = Buffer.from(await (await net.request(tex.textures.SKIN.url)).arrayBuffer());
  const variant = tex.textures.SKIN.metadata && tex.textures.SKIN.metadata.model === 'slim' ? 'slim' : 'classic';
  return add(buf, { name, variant, source: 'nick' });
}

async function fromUrl(url) {
  const buf = Buffer.from(await (await net.request(url)).arrayBuffer());
  return add(buf, { name: 'Скин по ссылке', source: 'url' });
}

// Apply skin to account: upload for Microsoft, store reference for offline
async function apply(accountId, skinId, variant) {
  const s = get(skinId);
  if (!s) throw new Error('Скин не найден');
  const v = variant || s.variant || 'classic';
  const acc = accounts.getRaw(accountId);
  if (!acc) throw new Error('Нет аккаунта');
  if (acc.type === 'msa') {
    const a = await accounts.ensureFresh(acc.id);
    const fd = new FormData();
    fd.append('variant', v);
    fd.append('file', new Blob([fs.readFileSync(s.path)], { type: 'image/png' }), 'skin.png');
    const res = await net.request('https://api.minecraftservices.com/minecraft/profile/skins', {
      method: 'POST', body: fd, headers: { Authorization: 'Bearer ' + a.accessToken }, timeout: 60000,
    });
    if (!res.ok) throw new Error('Mojang не принял скин: HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
    accounts.patch(acc.id, { skinId: s.id, skinVariant: v });
    return accounts.refreshProfile(acc.id);
  }
  accounts.patch(acc.id, { skinId: s.id, skinVariant: v });
  return accounts.list().list.find((x) => x.id === acc.id);
}

async function setCape(accountId, capeId) {
  const a = await accounts.ensureFresh(accountId);
  if (a.type !== 'msa') throw new Error('Плащи есть только у лицензионных аккаунтов');
  const url = 'https://api.minecraftservices.com/minecraft/profile/capes/active';
  const res = capeId
    ? await net.request(url, { method: 'PUT', body: JSON.stringify({ capeId }), headers: { Authorization: 'Bearer ' + a.accessToken, 'Content-Type': 'application/json' } })
    : await net.request(url, { method: 'DELETE', headers: { Authorization: 'Bearer ' + a.accessToken } });
  if (!res.ok) throw new Error('Не удалось сменить плащ: HTTP ' + res.status);
  return accounts.refreshProfile(accountId);
}

module.exports = { list, add, addFile, update, remove, get, fromNickname, fromUrl, apply, setCape };
