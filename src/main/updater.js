// Self-update from GitHub Releases: compares the latest release tag with the app version,
// downloads the NSIS installer and runs it silently, then restarts into the new version.
const { app, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const core = require('../core');
const pkg = require('../../package.json');

const REPO = pkg.nebula && pkg.nebula.repo;

function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0; }
  return false;
}

async function check() {
  if (!REPO) throw new Error('Репозиторий обновлений не настроен');
  const r = await core.net.getJSON(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  const asset = (r.assets || []).find((a) => /setup.*\.exe$/i.test(a.name));
  const current = app.getVersion();
  return {
    current, latest: r.tag_name.replace(/^v/, ''), available: newer(r.tag_name, current) && !!asset,
    notes: r.body || '', page: r.html_url, published: r.published_at,
    asset: asset ? { name: asset.name, size: asset.size, url: asset.browser_download_url } : null,
    canInstall: app.isPackaged,
  };
}

async function install(task) {
  const info = await check();
  if (!info.available) throw new Error('Обновлений нет');
  if (!app.isPackaged) { shell.openExternal(info.page); return { opened: info.page }; }
  const file = path.join(core.paths.tmp, info.asset.name);
  let bytes = 0;
  const mb = (n) => Math.round(n / 1048576);
  await core.net.download(info.asset.url, file, {
    size: info.asset.size, signal: task.signal,
    onBytes: (n) => { bytes += n; task.progress({ stage: `Скачивание Nebula ${info.latest} (МБ)`, done: mb(bytes), total: mb(info.asset.size) }); },
  });
  task.progress({ stage: 'Установка обновления…' });
  // NSIS: /S = silent, --force-run = start the app after install
  spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 800);
  return { installing: info.latest };
}

module.exports = { check, install, REPO };
