// HTTP helpers: JSON with retries, verified downloads and a download pool.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { readJSON, writeJSON, fileSize } = require('./util');
const P = require('./paths');

const UA = 'NebulaLauncher/1.0 (nebula-launcher; minecraft launcher)';

async function request(url, opts = {}, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        ...opts,
        headers: { 'User-Agent': UA, ...(opts.headers || {}) },
        signal: opts.signal || AbortSignal.timeout(opts.timeout || 30000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (opts.signal && opts.signal.aborted) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

async function getJSON(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`HTTP ${res.status}: ${url}\n${body.slice(0, 300)}`);
    err.status = res.status; err.body = body;
    throw err;
  }
  return res.json();
}

async function getText(url, opts = {}) {
  const res = await request(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

// JSON cached on disk with TTL; falls back to stale cache when offline.
const memCache = new Map();
async function cachedJSON(url, name, ttlMs = 10 * 60 * 1000) {
  const m = memCache.get(url);
  if (m && Date.now() - m.t < ttlMs) return m.data;
  const file = path.join(P.cache, name);
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < ttlMs) {
      const data = readJSON(file);
      if (data) { memCache.set(url, { t: Date.now(), data }); return data; }
    }
  } catch {}
  try {
    const data = await getJSON(url);
    writeJSON(file, data);
    memCache.set(url, { t: Date.now(), data });
    return data;
  } catch (e) {
    const stale = readJSON(file);
    if (stale) return stale;
    throw e;
  }
}

// Download to file, verifying sha1 (if given). Skips when the file already matches by size.
async function download(url, dest, { sha1, size, force = false, onBytes, signal } = {}) {
  if (!force && size && fileSize(dest) === size) return false;
  if (!force && !size && !sha1 && fileSize(dest) > 0) return false;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part' + Math.random().toString(36).slice(2, 6);
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await request(url, { timeout: 120000, signal }, 2);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
      const hash = crypto.createHash('sha1');
      const body = Readable.fromWeb(res.body);
      body.on('data', (c) => { hash.update(c); if (onBytes) onBytes(c.length); });
      await pipeline(body, fs.createWriteStream(tmp));
      const got = hash.digest('hex');
      if (sha1 && got !== sha1.toLowerCase()) throw new Error(`Хэш не совпал для ${path.basename(dest)}`);
      await fsp.rename(tmp, dest).catch(async () => { await fsp.copyFile(tmp, dest); await fsp.rm(tmp, { force: true }); });
      return true;
    } catch (e) {
      lastErr = e;
      await fsp.rm(tmp, { force: true }).catch(() => {});
      if (signal && signal.aborted) throw e;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw lastErr;
}

// Run download jobs with limited concurrency. jobs: [{url, dest, sha1, size}]
async function downloadAll(jobs, { concurrency = 16, onProgress, signal } = {}) {
  let done = 0, bytes = 0, idx = 0;
  const total = jobs.length;
  const errors = [];
  let lastEmit = 0;
  const emit = (force) => {
    const now = Date.now();
    if (!onProgress || (!force && now - lastEmit < 120)) return;
    lastEmit = now;
    onProgress({ done, total, bytes });
  };
  async function worker() {
    while (idx < jobs.length) {
      if (signal && signal.aborted) return;
      const j = jobs[idx++];
      try {
        await download(j.url, j.dest, { sha1: j.sha1, size: j.size, signal, onBytes: (n) => { bytes += n; emit(); } });
      } catch (e) {
        errors.push({ job: j, error: e.message });
      }
      done++;
      emit();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  emit(true);
  if (errors.length) {
    const err = new Error(`Не удалось скачать ${errors.length} файл(ов). Первый: ${errors[0].job.url} — ${errors[0].error}`);
    err.errors = errors;
    throw err;
  }
}

module.exports = { UA, request, getJSON, getText, cachedJSON, download, downloadAll };
