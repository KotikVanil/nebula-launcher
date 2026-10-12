// Dev check: launch an instance headless through the core, wait until the game window
// is up (resource reload / sound engine), then kill it. Usage: node tools/launch_test.js <instanceId> [seconds]
const core = require('../src/core');

const id = process.argv[2];
const limit = Number(process.argv[3] || 300) * 1000;
const OK = /Sound engine started|Created: \d+x\d+x\d+ minecraft:textures\/atlas|Backend library: LWJGL/;
let lastStage = '', lastPrint = 0, done = false;
const t0 = Date.now();

function finish(code, msg) {
  if (done) return;
  done = true;
  console.log(`\n[RESULT] ${msg} after ${Math.round((Date.now() - t0) / 1000)}s`);
  core.launch.kill(id);
  setTimeout(() => process.exit(code), 3000);
}

core.launch.bus.on('log', ({ line }) => {
  if (/ERROR|Exception|FATAL|authlib|Setting user|Loading Minecraft|Fabric|Loading \d+ mods/i.test(line)) console.log('  log:', line.slice(0, 220));
  if (OK.test(line)) setTimeout(() => finish(0, 'GAME STARTED: ' + line.slice(0, 120)), 4000);
});
core.launch.bus.on('exit', (e) => finish(1, 'game exited with code ' + e.code + ' ' + JSON.stringify(e.crash && e.crash.findings)));

core.launch.launch(id, {
  onProgress: (p) => {
    const now = Date.now();
    if (p.stage !== lastStage || now - lastPrint > 5000) {
      console.log(`[${Math.round((now - t0) / 1000)}s] ${p.stage}${p.total ? ` ${p.done}/${p.total}` : ''}`);
      lastStage = p.stage; lastPrint = now;
    }
  },
}).then((r) => console.log('[spawned] pid', r.pid)).catch((e) => finish(2, 'LAUNCH ERROR: ' + e.stack));

setTimeout(() => finish(3, 'TIMEOUT'), limit);
