// Stats panel toggle (local player): desktop key C and HUD box, touch 📊 button, remembered setting,
// values are the hero's real totals, and a co-op guest sees the host-computed numbers (incl. host-only blessings).
// Run: sh build.sh <peerjs.min.js> && node tests/e2e/stats.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const row = (rows, k) => (rows.find(r => r[0] === k) || [])[1];
  // ---- desktop, solo
  const A = await H.player('Ann', { build: 'duskbound.html', real: true });
  await A.click('#solo'); await A.waitForTimeout(400);
  ok(await A.evaluate(() => showStats) === false, 'stats panel starts hidden');
  await A.keyboard.press('c');
  ok(await A.evaluate(() => showStats && localStorage.getItem('duskbound-stats') === '1'), 'C shows it (and it is saved)');
  await A.evaluate(() => { me.crit = 0.3; me.critMul = 2.25; me.lifesteal = 0.06; me.dmgMul = 1.4; me.venom = 1; });
  const rows = await A.evaluate(() => statRows(myStats()));
  ok(row(rows, 'Critical chance') === '30%' && row(rows, 'Critical damage') === '225%' && row(rows, 'Life leech') === '6%' && row(rows, 'Damage') === '+40%', 'rows show the hero’s real totals ' + JSON.stringify(rows.slice(0, 6)));
  ok(row(rows, 'Venom') === '5/s' && !row(rows, 'Chain lightning'), 'rare bonuses appear only once owned');
  await A.waitForTimeout(150); await A.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => { });
  const box = await A.evaluate(() => hudStats); ok(!!box, 'desktop HUD shows the stats box');
  await A.mouse.click(box.x + box.w / 2, box.y + box.h / 2); await A.waitForTimeout(100);
  ok(await A.evaluate(() => !showStats && !mouse.l), 'clicking the box hides it without attacking');
  // ---- touch (iPhone), Chinese, remembered
  const P = await H.player('Pia', { build: 'duskbound.html', real: true, device: 'iPhone 13 landscape', contextOptions: { deviceScaleFactor: 1, locale: 'zh-TW' } });
  await P.tap('#solo'); await P.waitForTimeout(400);
  const b = await P.evaluate(() => touchButtons().find(b => b.id === 'stats'));
  ok(!!b, 'touch: 📊 button shown');
  ok(await P.evaluate(b => touchButtons().filter(o => o.id !== 'stats').every(o => Math.hypot(o.x - b.x, o.y - b.y) > o.r + b.r), b), '📊 does not overlap other buttons');
  const cdp = await P.ctx.newCDPSession(P);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y, id: 1 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await P.waitForTimeout(150);
  ok(await P.evaluate(() => showStats), 'tapping 📊 shows the panel');
  ok(await P.evaluate(() => statRows(myStats()).every(r => T(r[0]) !== r[0])), 'every row label has a Chinese version');
  await P.screenshot({ path: process.env.SHOT2 || '/dev/null' }).catch(() => { });
  await P.reload(); await P.waitForTimeout(300);
  ok(await P.evaluate(() => showStats), 'setting remembered after restarting');
  // ---- co-op: the guest sees numbers computed by the host
  const G = await H.player('Gus'), Ho = await H.player('Hal');
  await H.hostAndJoin(Ho, G); await Ho.click('#start'); await G.waitForFunction(() => game.state === 'play' && me, null, { timeout: 15000 });
  await Ho.evaluate(() => { const g = players.find(p => p.remote); g.crit += 0.2; g.lifesteal = 0.1; g.maxHp = 321; }); // e.g. a shrine blessing, host only
  await wait(800);
  const gr = await G.evaluate(() => statRows(myStats()));
  ok(row(gr, 'Critical chance') === '25%' && row(gr, 'Life leech') === '10%' && row(gr, 'Max health') === '321', 'guest panel shows host-side totals ' + JSON.stringify(gr.slice(0, 6)));
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
