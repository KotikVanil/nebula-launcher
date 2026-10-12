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
    await wait(9000);
    for (const p of pages) {
      try {
        await win.webContents.executeJavaScript(`window.__shot && window.__shot(${JSON.stringify(p)})`);
        await wait(2600);
        if (process.env.SHOT_DEBUG) console.log('[news]', await win.webContents.executeJavaScript("window.nebula.call('news.get').then(r => 'ok ' + r.length).catch(e => 'ERR ' + e.message)"), await win.webContents.executeJavaScript("String(document.getElementById('news-list') && document.getElementById('news-list').children.length)"));
        if (process.env.SHOT_DEBUG) console.log('[dbg]', p, await win.webContents.executeJavaScript("JSON.stringify([...document.querySelectorAll('.page')].map(e => [e.className, e.childElementCount, getComputedStyle(e).opacity, e.getAnimations().map(a => [a.animationName, a.playState, Math.round(a.currentTime)]), document.timeline.currentTime|0, document.visibilityState]))"));
        let img;
        for (let k = 0; k < 3 && !img; k++) { try { img = await win.webContents.capturePage(); } catch { await wait(800); } }
        fs.writeFileSync(path.join(out, p.replace(/[^a-z0-9_-]/gi, '_') + '.png'), img.toPNG());
      } catch (e) { console.error('shot', p, e.message); }
    }
    app.quit();
  });
};
