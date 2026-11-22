// Phones must stay in touch mode: taps that phones turn into fake mouse events (e.g. a finger that lands on an
// upgrade card and lifts off it, or a tap beside the cards) must not switch the game to the desktop layout.
// A real mouse still switches it. Run: sh build.sh <peerjs.min.js> && node tests/e2e/touchmode.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  const dev = { device: 'iPhone 13 landscape', contextOptions: { deviceScaleFactor: 1, locale: 'zh-TW' } };
  const Ho = await H.player('Hal'), G = await H.player('Gus', dev);
  await H.hostAndJoin(Ho, G); await Ho.click('#start'); await G.waitForFunction(() => game.state === 'play' && me && world, null, { timeout: 15000 });
  const cdp = await G.ctx.newCDPSession(G);
  const touchPath = async pts => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...pts[0], id: 1 }] }); for (const p of pts.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...p, id: 1 }] }); await G.waitForTimeout(16); } await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await G.waitForTimeout(150); };
  const offer = () => Ho.evaluate(() => { const g = players.find(p => p.remote); g.pending = 1; rollChoice(g); g.choiceTitle = 'Level 2'; });
  ok(await G.evaluate(() => touch.on), 'phone starts in touch mode');
  // 1) finger lands on a card and lifts off it to the right
  await offer(); await G.waitForFunction(() => choiceEl.className === 'coop' && choiceEl.querySelector('.card'), null, { timeout: 5000 });
  let r = await G.evaluate(() => { const b = choiceEl.querySelector('.card[data-i="2"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, right: b.right }; });
  await touchPath([{ x: r.x, y: r.y }, { x: r.right + 20, y: r.y }, { x: r.right + 60, y: r.y + 10 }]);
  ok(await G.evaluate(() => touch.on), 'finger slides off a card: still in touch mode');
  // 2) plain taps on the right side of the screen beside the cards, and on the HUD area
  for (const [x, y] of [[730, 120], [700, 300], [400, 330]]) await touchPath([{ x, y }]);
  ok(await G.evaluate(() => touch.on), 'taps beside the cards / on the right side: still in touch mode');
  // 3) the fake mouse events a phone sends right after a tap are ignored
  await G.evaluate(() => { cv.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [], changedTouches: [] })); cv.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 600, clientY: 200 })); });
  ok(await G.evaluate(() => touch.on && !mouse.l), 'mouse event right after a touch is ignored');
  // picking still works
  const card = await G.evaluate(() => { const b = choiceEl.querySelector('.card').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await touchPath([{ x: card.x, y: card.y }]); await G.waitForTimeout(500);
  ok(await Ho.evaluate(() => Object.keys(players.find(p => p.remote).talents).length) === 1 && await G.evaluate(() => touch.on), 'tapping a card picks it, still in touch mode');
  // 4) a real mouse (no touch for a while) still switches a touchscreen laptop to the desktop layout
  await G.waitForTimeout(1300);
  await G.mouse.move(500, 200); await G.mouse.down(); await G.mouse.up();
  ok(await G.evaluate(() => !touch.on), 'a real mouse click (no recent touch) switches to the desktop layout');
  await touchPath([{ x: 100, y: 250 }]);
  ok(await G.evaluate(() => touch.on), 'touching again switches back to touch mode');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
