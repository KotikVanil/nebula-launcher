// Single entry point of the launcher core (used by Electron main, MCP server and CLI).
const fs = require('fs');
const P = require('./paths');

function activity(source, action, details = {}) {
  const line = JSON.stringify({ t: Date.now(), source, action, ...details });
  try { fs.appendFileSync(P.activity, line + '\n'); } catch {}
}

module.exports = {
  paths: P,
  util: require('./util'),
  net: require('./net'),
  settings: require('./settings'),
  versions: require('./versions'),
  java: require('./java'),
  install: require('./install'),
  loaders: require('./loaders'),
  instances: require('./instances'),
  accounts: require('./accounts'),
  msauth: require('./msauth'),
  skins: require('./skins'),
  launch: require('./launch'),
  crash: require('./crash'),
  modrinth: require('./modrinth'),
  content: require('./content'),
  modpack: require('./modpack'),
  files: require('./files'),
  yggdrasil: require('./yggdrasil'),
  activity,
};
