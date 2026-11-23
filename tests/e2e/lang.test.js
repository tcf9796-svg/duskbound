// Switching language during a run: the 🌐 button on the pause screen (solo, desktop and touch) and on the co-op
// Voice & sound screen. The run keeps going, the choice is saved, and the overlay and HUD redraw in the new language.
// Run: sh build.sh <peerjs.min.js> && node tests/e2e/lang.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  // ---- desktop, solo
  const A = await H.player('Ann', { build: 'duskbound.html', real: true });
  await A.click('#solo'); await A.waitForTimeout(400);
  await A.evaluate(() => { me.hp = me.maxHp = 1e6; window.__t = game.time; });
  await A.keyboard.press('p'); await A.waitForTimeout(100);
  ok(await A.evaluate(() => game.paused && !!document.getElementById('plang') && LANG === 'en'), 'pause screen has the language button');
  await A.click('#plang'); await A.waitForTimeout(150);
  ok(await A.evaluate(() => LANG === 'zh' && localStorage.getItem('duskbound-lang') === 'zh'), 'switches to Chinese (and it is saved)');
  ok(await A.evaluate(() => game.paused && game.state === 'play' && document.querySelector('#overlay h2').textContent === '暫停' && $('plang').textContent.includes('English')), 'still paused, the pause screen is now in Chinese');
  await A.click('#res'); await A.waitForTimeout(300);
  ok(await A.evaluate(() => !game.paused && game.time > __t && me && !game.over), 'resuming continues the same run');
  ok(await A.evaluate(() => T('Auto attack') !== 'Auto attack'), 'HUD labels draw in Chinese');
  await A.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => { });
  await A.keyboard.press('p'); await A.click('#plang'); await A.waitForTimeout(100);
  ok(await A.evaluate(() => LANG === 'en' && document.querySelector('#overlay h2').textContent === 'Paused'), 'and back to English');
  // ---- touch (iPhone): pause button, then 🌐
  const P = await H.player('Pia', { build: 'duskbound.html', real: true, device: 'iPhone 13 landscape', contextOptions: { deviceScaleFactor: 1 } });
  await P.tap('#solo'); await P.waitForTimeout(400);
  const b = await P.evaluate(() => touchButtons().find(b => b.id === 'menu'));
  const cdp = await P.ctx.newCDPSession(P);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await P.waitForTimeout(200);
  ok(await P.evaluate(() => game.paused && !!$('plang')), 'touch: pause screen has the language button');
  await P.tap('#plang'); await P.waitForTimeout(150);
  ok(await P.evaluate(() => LANG === 'zh' && game.paused && !!$('res') && $('res').textContent === '繼續'), 'touch: switched, still paused');
  await P.screenshot({ path: process.env.SHOT2 || '/dev/null' }).catch(() => { });
  // ---- co-op guest: Voice & sound screen, the run does not stop
  const G = await H.player('Gus'), Ho = await H.player('Hal');
  await H.hostAndJoin(Ho, G); await Ho.click('#start'); await G.waitForFunction(() => game.state === 'play' && me, null, { timeout: 15000 });
  await G.keyboard.press('p'); await G.waitForTimeout(300);
  ok(await G.evaluate(() => !!$('plang')), 'co-op: Voice & sound screen has the language button');
  const was = await G.evaluate(() => LANG);
  await G.click('#plang'); await G.waitForTimeout(300);
  ok(await G.evaluate(w => LANG !== w && !!$('vback') && game.state === 'play' && !game.over, was), 'co-op: switched, panel redrawn, still in the run');
  ok(await Ho.evaluate(() => game.state === 'play' && players.length === 2), 'host unaffected');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
