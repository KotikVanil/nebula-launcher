// Data layout of the launcher. Everything lives under one root so the
// Electron app, the MCP server and the CLI all see the same instances.
const os = require('os');
const path = require('path');
const fs = require('fs');

const ROOT = process.env.NEBULA_HOME ||
  path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), '.nebula-launcher');

const P = {
  root: ROOT,
  settings: path.join(ROOT, 'settings.json'),
  accounts: path.join(ROOT, 'accounts.json'),
  launcherInfo: path.join(ROOT, 'launcher.json'),
  activity: path.join(ROOT, 'ai-activity.jsonl'),
  instances: path.join(ROOT, 'instances'),
  versions: path.join(ROOT, 'versions'),
  libraries: path.join(ROOT, 'libraries'),
  assets: path.join(ROOT, 'assets'),
  runtimes: path.join(ROOT, 'runtimes'),
  cache: path.join(ROOT, 'cache'),
  skins: path.join(ROOT, 'skins'),
  authlib: path.join(ROOT, 'authlib'),
  trash: path.join(ROOT, '.trash'),
  tmp: path.join(ROOT, 'tmp'),
};

for (const k of ['root', 'instances', 'versions', 'libraries', 'assets', 'runtimes', 'cache', 'skins', 'authlib', 'tmp']) {
  try { fs.mkdirSync(P[k], { recursive: true }); } catch {}
}

P.instanceDir = (id) => path.join(P.instances, id);
P.gameDir = (id) => path.join(P.instances, id, '.minecraft');
P.versionDir = (id) => path.join(P.versions, id);
P.versionJson = (id) => path.join(P.versions, id, id + '.json');
P.versionJar = (id) => path.join(P.versions, id, id + '.jar');

module.exports = P;
