// Tiny local Yggdrasil-compatible server for authlib-injector.
// Lets offline accounts see their own skin in singleplayer / LAN without any mods.
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const P = require('./paths');
const net = require('./net');
const accounts = require('./accounts');
const skins = require('./skins');
const { exists, readJSON, writeJSON, hashFile } = require('./util');

const KEY_FILE = path.join(P.authlib, 'signing-key.pem');
const JAR_META = 'https://authlib-injector.yushi.moe/artifact/latest.json';

let server = null, port = 0, keys = null;

function loadKeys() {
  if (keys) return keys;
  if (exists(KEY_FILE)) {
    const priv = crypto.createPrivateKey(fs.readFileSync(KEY_FILE, 'utf8'));
    keys = { priv, pub: crypto.createPublicKey(priv) };
  } else {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 4096 });
    fs.writeFileSync(KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    keys = { priv: privateKey, pub: publicKey };
  }
  return keys;
}

function sign(value) {
  return crypto.createSign('SHA1').update(value).sign(loadKeys().priv, 'base64');
}

function offlineProfiles() {
  return accounts.list().list.filter((a) => a.type === 'offline');
}

function texturesFor(acc, unsigned) {
  const skin = acc.skinId ? skins.get(acc.skinId) : null;
  const tex = { timestamp: Date.now(), profileId: acc.uuid, profileName: acc.name, signatureRequired: !unsigned, textures: {} };
  if (skin) {
    tex.textures.SKIN = { url: `http://127.0.0.1:${port}/textures/${skin.hash}` };
    if ((acc.skinVariant || skin.variant) === 'slim') tex.textures.SKIN.metadata = { model: 'slim' };
  }
  const value = Buffer.from(JSON.stringify(tex)).toString('base64');
  const prop = { name: 'textures', value };
  if (!unsigned) prop.signature = sign(value);
  return { id: acc.uuid, name: acc.name, properties: [prop] };
}

function meta() {
  const pem = loadKeys().pub.export({ type: 'spki', format: 'pem' });
  return {
    meta: { serverName: 'Nebula Offline Skins', implementationName: 'nebula-launcher', implementationVersion: '1.0', 'feature.non_email_login': true, 'feature.no_mojang_namespace': false },
    skinDomains: ['127.0.0.1', 'localhost'],
    signaturePublickey: pem,
  };
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
}

async function handle(req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return send(res, 200, meta());
  let m;
  if ((m = /^\/sessionserver\/session\/minecraft\/profile\/([0-9a-f-]{32,36})$/i.exec(p))) {
    const id = m[1].replace(/-/g, '');
    const acc = offlineProfiles().find((a) => a.uuid === id);
    if (!acc) return send(res, 204, '');
    return send(res, 200, texturesFor(acc, u.searchParams.get('unsigned') !== 'false'));
  }
  if (p === '/sessionserver/session/minecraft/hasJoined') {
    const acc = offlineProfiles().find((a) => a.name === u.searchParams.get('username'));
    return acc ? send(res, 200, texturesFor(acc, false)) : send(res, 204, '');
  }
  if (p === '/sessionserver/session/minecraft/join') return send(res, 204, '');
  if (p === '/api/profiles/minecraft' && req.method === 'POST') {
    let names = [];
    try { names = JSON.parse(await readBody(req)); } catch {}
    return send(res, 200, offlineProfiles().filter((a) => names.includes(a.name)).map((a) => ({ id: a.uuid, name: a.name })));
  }
  if ((m = /^\/textures\/([0-9a-f]+)$/.exec(p))) {
    const s = skins.list().find((x) => x.hash === m[1]);
    if (!s) return send(res, 404, '');
    return send(res, 200, fs.readFileSync(s.path), 'image/png');
  }
  if (p === '/minecraftservices/player/attributes') {
    return send(res, 200, { privileges: { onlineChat: { enabled: true }, multiplayerServer: { enabled: true }, multiplayerRealms: { enabled: false }, telemetry: { enabled: false } }, profanityFilterPreferences: { profanityFilterOn: false } });
  }
  if (p === '/minecraftservices/publickeys') {
    const der = loadKeys().pub.export({ type: 'spki', format: 'der' }).toString('base64');
    return send(res, 200, { profilePropertyKeys: [{ publicKey: der }], playerCertificateKeys: [{ publicKey: der }] });
  }
  if (p.startsWith('/minecraftservices/player/report') || p.startsWith('/minecraftservices/privacy')) return send(res, 200, {});
  return send(res, 404, { error: 'Not Found', path: p });
}

async function start() {
  if (server) return `http://127.0.0.1:${port}`;
  loadKeys();
  server = http.createServer((req, res) => handle(req, res).catch(() => send(res, 500, {})));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  return `http://127.0.0.1:${port}`;
}

function stop() { if (server) { server.close(); server = null; } }

// Download authlib-injector once (checks sha256)
async function ensureAgent() {
  const metaFile = path.join(P.authlib, 'agent.json');
  const cur = readJSON(metaFile);
  if (cur && exists(cur.file) && Date.now() - (cur.checked || 0) < 7 * 24 * 3600e3) return cur.file;
  try {
    const m = await net.getJSON(JAR_META);
    const file = path.join(P.authlib, `authlib-injector-${m.version}.jar`);
    if (!exists(file)) {
      await net.download(m.download_url, file);
      const sum = await hashFile(file, 'sha256');
      if (sum !== m.checksums.sha256) { fs.unlinkSync(file); throw new Error('authlib-injector: неверная контрольная сумма'); }
    }
    writeJSON(metaFile, { file, version: m.version, checked: Date.now() });
    return file;
  } catch (e) {
    if (cur && exists(cur.file)) return cur.file;
    throw e;
  }
}

async function jvmArgs() {
  const agent = await ensureAgent();
  const url = await start();
  const prefetched = Buffer.from(JSON.stringify(meta())).toString('base64');
  return [`-javaagent:${agent}=${url}`, `-Dauthlibinjector.yggdrasil.prefetched=${prefetched}`, '-Dauthlibinjector.side=client', '-Dauthlibinjector.noShowServerName'];
}

module.exports = { start, stop, jvmArgs, ensureAgent };
