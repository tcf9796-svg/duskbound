// Full screen: button on every menu, remembered ("kept") full screen that comes back after being knocked out,
// in-game ⛶ button, iPhone help. Run: sh build.sh <peerjs.min.js> && node tests/e2e/fullscreen.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  const A = await H.player('Ann', { build: 'duskbound.html', real: true, device: 'Pixel 7 landscape', contextOptions: { deviceScaleFactor: 1 } });
  const fs = () => A.evaluate(() => !!document.fullscreenElement);
  ok(await A.evaluate(() => !!$('fsb')), 'title screen: full screen button');
  await A.tap('#fsb'); await A.waitForTimeout(500);
  ok(await fs() && await A.evaluate(() => keepFS && localStorage.getItem('duskbound-fs') === '1'), 'tap: full screen, and the choice is remembered');
  ok(/Exit|離開/.test(await A.textContent('#fsb')), 'button now offers to exit');
  // something knocks it out of full screen (notification, app switch): the next tap brings it back
  await A.evaluate(() => document.exitFullscreen()); await A.waitForTimeout(300);
  ok(!(await fs()), '(knocked out of full screen)');
  await A.tap('#nm'); await A.waitForTimeout(500);
  ok(await fs(), 'next tap anywhere: back in full screen');
  // pause menu (solo) and in-game button
  await A.evaluate(() => document.exitFullscreen()); await A.evaluate(() => setKeepFS(false)); await A.waitForTimeout(300);
  await A.tap('#solo'); await A.waitForTimeout(600);
  ok(await fs(), 'starting a game on a phone goes full screen (as before)');
  await A.evaluate(() => document.exitFullscreen()); await A.waitForTimeout(300);
  ok(!(await fs()) && await A.evaluate(() => touchButtons().some(b => b.id === 'fs')), 'in game, not full screen: ⛶ button shown');
  const b = await A.evaluate(() => touchButtons().find(b => b.id === 'fs'));
  const cdp = await A.ctx.newCDPSession(A);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await A.waitForTimeout(500);
  ok(await fs() && await A.evaluate(() => !touchButtons().some(b => b.id === 'fs')), 'in-game ⛶: full screen, button hides');
  await A.evaluate(() => onKey('p')); await A.waitForTimeout(200);
  ok(await A.evaluate(() => !!document.querySelector('#overlay .fsrow')), 'pause menu: full screen button');
  await A.tap('#overlay .fsrow'); await A.waitForTimeout(500);
  ok(!(await fs()) && await A.evaluate(() => !keepFS && game.paused && !!$('res')), 'pause menu: exit full screen, stays paused');
  // remembered across a restart
  await A.evaluate(() => setKeepFS(true)); await A.reload(); await A.waitForTimeout(400);
  ok(await A.evaluate(() => keepFS), 'kept setting survives restarting');
  await A.tap('#nm'); await A.waitForTimeout(500); ok(await fs(), 'after restart, first tap goes full screen');
  // lobby and voice panel
  await A.evaluate(() => { net.mode = 'host'; net.code = 'ABCDE'; net.ready = true; net.lobby = [{ id: 1, name: 'Ann', hero: 'bramble' }]; game.state = 'lobby'; showLobby(); });
  ok(await A.evaluate(() => !!document.querySelector('#overlay .fsrow')), 'lobby: full screen button');
  await A.evaluate(() => showVoice(showLobby)); await A.waitForTimeout(200);
  ok(await A.evaluate(() => !!document.querySelector('#overlay .fsrow')), 'voice panel: full screen button');
  // iPhone Safari: in-game ⛶ shows the help, solo game pauses, "Got it" resumes
  const I = await H.player('Ivy', { build: 'duskbound.html', real: true, device: 'iPhone 13 landscape', contextOptions: { deviceScaleFactor: 1 } });
  ok(await I.evaluate(() => !!$('fsb')), 'iPhone: title screen button');
  await I.tap('#solo'); await I.waitForTimeout(600);
  const ib = await I.evaluate(() => touchButtons().find(b => b.id === 'fs'));
  ok(!!ib, 'iPhone in game (Safari bars showing): ⛶ button shown');
  const c2 = await I.ctx.newCDPSession(I);
  await c2.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ib.x, y: ib.y, id: 1 }] }); await c2.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await I.waitForTimeout(300);
  ok(await I.evaluate(() => !!$('fsok') && game.paused), 'iPhone: help shown, solo game paused');
  await I.tap('#fsok'); await I.waitForTimeout(200);
  ok(await I.evaluate(() => !game.paused && overlay.className === 'hidden'), '"Got it": back to the game');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
