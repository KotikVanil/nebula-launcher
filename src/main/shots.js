// Dev helper: `electron . --shots[=home,ai]` captures each page to ./shots and quits.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports.run = (win) => {
  const arg = process.argv.find((a) => a.startsWith('--shots='));
  const pages = arg ? arg.slice(8).split(',') : ['home', 'instances', 'instance', 'catalog', 'skins', 'ai', 'settings', 'wizard', 'account'];
  const out = path.join(__dirname, '..', '..', 'shots');
  fs.mkdirSync(out, { recursive: true });
  win.setPosition(20, 20);
  win.showInactive();
  win.webContents.once('did-finish-load', async () => {
    await wait(3500);
    for (const p of pages) {
      try {
        await win.webContents.executeJavaScript(`window.__shot && window.__shot(${JSON.stringify(p)})`);
        await wait(2600);
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(out, p + '.png'), img.toPNG());
      } catch (e) { console.error('shot', p, e.message); }
    }
    app.quit();
  });
};
