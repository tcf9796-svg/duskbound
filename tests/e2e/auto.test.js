// Auto attack toggle (local player only): desktop key R and HUD box, touch AUTO button, remembered setting,
// attacks only while an enemy is in range, and a co-op guest's auto attacks count on the host.
// Run: sh build.sh <peerjs.min.js> && node tests/e2e/auto.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // ---- desktop, solo
  const A = await H.player('Ann', { build: 'duskbound.html', real: true });
  await A.click('#solo'); await A.waitForTimeout(400);
  const swings = async ms => { const n0 = await A.evaluate(() => { window.__sw = 0; const o = doAttack; if (!window.__wrapped) { window.__wrapped = 1; doAttack = p => { if (p === me) window.__sw++; o(p); }; } return 0; }); await A.waitForTimeout(ms); return A.evaluate(() => window.__sw); };
  await A.evaluate(() => { me.hp = me.maxHp = 1e6; enemies.forEach(e => e.dead = true); });
  ok(await A.evaluate(() => autoAtk) === false, 'auto attack starts off');
  await A.evaluate(() => spawnEnemy('ram', me.x + 120, me.y)); // nothing pressed, auto off
  ok(await swings(1200) === 0, 'off: no attacks without input');
  await A.keyboard.press('r');
  ok(await A.evaluate(() => autoAtk && localStorage.getItem('duskbound-auto') === '1'), 'R turns it on (and it is saved)');
  const on = await swings(1500); ok(on >= 2, 'on: attacks by itself with an enemy near (' + on + ' swings in 1.5 s)');
  ok(await A.evaluate(() => { const e = enemies.find(e => !e.dead); return Math.abs(angDiff(me.face, angTo(me, e))) < 0.3; }), 'aims at the nearest enemy');
  await A.evaluate(() => { enemies.forEach(e => e.dead = true); spawnEnemy('ram', me.x + 900, me.y + 900); });
  ok(await swings(1200) === 0, 'on, but nothing within reach: no swinging at the air');
  // click the HUD box: toggles, and that click is not an attack
  const box = await A.evaluate(() => hudAuto);
  ok(!!box, 'desktop HUD shows the AUTO box');
  await A.evaluate(() => { enemies.forEach(e => e.dead = true); spawnEnemy('ram', me.x + 120, me.y); });
  await A.mouse.click(box.x + box.w / 2, box.y + box.h / 2); await A.waitForTimeout(100);
  ok(await A.evaluate(() => !autoAtk && !mouse.l), 'clicking AUTO turns it off without attacking');
  ok(await swings(1200) === 0, 'off again: no attacks');
  // ---- touch (iPhone), remembered
  const P = await H.player('Pia', { build: 'duskbound.html', real: true, device: 'iPhone 13 landscape', contextOptions: { deviceScaleFactor: 1, locale: 'zh-TW' } });
  await P.tap('#solo'); await P.waitForTimeout(400);
  const b = await P.evaluate(() => touchButtons().find(b => b.id === 'auto'));
  ok(!!b, 'touch: AUTO button shown');
  const others = await P.evaluate(b => touchButtons().filter(o => o.id !== 'auto').every(o => Math.hypot(o.x - b.x, o.y - b.y) > o.r + b.r), b);
  ok(others, 'AUTO does not overlap other buttons');
  const cdp = await P.ctx.newCDPSession(P);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await P.waitForTimeout(100);
  ok(await P.evaluate(() => autoAtk), 'tapping AUTO turns it on');
  await P.evaluate(() => { me.hp = me.maxHp = 1e6; enemies.forEach(e => e.dead = true); const e = spawnEnemy('ram', me.x + 120, me.y); e.hp = e.maxHp = 1e6; window.__e = e; });
  await P.waitForTimeout(1500);
  ok(await P.evaluate(() => __e.hp < __e.maxHp), 'touch: enemy damaged with no fingers on the screen');
  await P.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => { });
  await P.reload(); await P.waitForTimeout(300);
  ok(await P.evaluate(() => autoAtk), 'setting remembered after restarting');
  // ---- co-op: a guest's auto attacks are simulated by the host
  const G = await H.player('Gus'), Ho = await H.player('Hal');
  await H.hostAndJoin(Ho, G); await Ho.click('#start'); await G.waitForFunction(() => game.state === 'play' && me, null, { timeout: 15000 });
  await G.keyboard.press('r');
  await Ho.evaluate(() => { players.forEach(p => { p.hp = p.maxHp = 1e6; }); enemies.forEach(e => e.dead = true); const g = players.find(p => p.remote); const e = spawnEnemy('ram', g.x + 110, g.y); e.hp = e.maxHp = 1e6; window.__e = e; });
  await wait(2000);
  ok(await G.evaluate(() => autoAtk) && await Ho.evaluate(() => __e.hp < __e.maxHp && !autoAtk), 'co-op guest auto-attacks; the host’s own setting stays off');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
