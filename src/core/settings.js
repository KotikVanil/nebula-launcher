const P = require('./paths');
const { readJSON, writeJSON, totalMemMB } = require('./util');

const DEFAULTS = {
  accent: 'nebula',
  liveBackground: true,
  backgroundQuality: 'high',
  timeOfDay: 'auto',
  uiSounds: true,
  reduceMotion: false,
  memoryMax: Math.min(8192, Math.max(2048, Math.floor(totalMemMB() / 4 / 512) * 512)),
  memoryMin: 1024,
  jvmArgs: '',
  javaPath: '',
  useMojangJvmFlags: true,
  downloadThreads: 16,
  afterLaunch: 'minimize', // minimize | hide | keep
  showSnapshots: false,
  msClientId: '',
  offlineSkins: true,
  aiEngine: 'claude',
  aiModel: 'claude-sonnet-5-5',
  resolution: { width: 1280, height: 720, fullscreen: false },
};

function get() {
  return { ...DEFAULTS, ...(readJSON(P.settings, {}) || {}) };
}

function set(patch) {
  const next = { ...get(), ...patch };
  writeJSON(P.settings, next);
  return next;
}

module.exports = { get, set, DEFAULTS };
