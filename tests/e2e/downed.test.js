// Fallen-teammate indicator: off-screen edge marker pointing at them (name, distance, revive progress), beacon when
// on screen, minimap marker, translated labels; and it goes away when they are revived.
// Run: sh build.sh <peerjs.min.js> && node tests/e2e/downed.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  const Ho = await H.player('Hal'), G = await H.player('Gus', { device: 'iPhone 13 landscape', contextOptions: { deviceScaleFactor: 1, locale: 'zh-TW' } });
  await H.hostAndJoin(Ho, G); await Ho.click('#start'); await G.waitForFunction(() => game.state === 'play' && me && world, null, { timeout: 15000 });
  await Ho.evaluate(() => { players.forEach(p => { p.hp = p.maxHp = 1e6; }); enemies.forEach(e => e.dead = true); });
  ok(await G.evaluate(() => downMarkers().length) === 0, 'nobody down: no markers');
  // the host falls far to the east of the guest
  await Ho.evaluate(() => { const g = players.find(p => p.remote); me.x = me.tx = g.x + 1500; me.y = me.ty = g.y; me.down = true; me.rev = 0; me.hp = 0; });
  await G.waitForFunction(() => players.some(p => p !== me && p.down), null, { timeout: 5000 });
  await G.waitForTimeout(600);
  let m = await G.evaluate(() => downMarkers().map(d => ({ name: d.q.name, x: Math.round(d.x), y: Math.round(d.y), a: d.a })));
  ok(m.length === 1 && m[0].name === 'Hal', 'guest sees one marker, for Hal');
  const vw = await G.evaluate(() => [innerWidth, innerHeight, SA.r]);
  ok(m[0] && m[0].x > vw[0] * 0.8 && m[0].x <= vw[0] - 46 && Math.abs(m[0].a) < 0.6, 'marker sits on the right edge, pointing east (' + JSON.stringify(m[0]) + ')');
  ok(await G.evaluate(() => Math.round(dist(players.find(p => p.down), me) / 32)) > 40, 'distance shown in metres');
  ok(await G.evaluate(() => downMarkers().every(d => touchButtons().every(b => Math.hypot(d.x - b.x, d.y - b.y) > b.r + 20))), 'marker keeps clear of the touch buttons');
  await G.screenshot({ path: process.env.SHOT || '/dev/null' }).catch(() => { });
  // north-west
  await Ho.evaluate(() => { const g = players.find(p => p.remote); me.x = me.tx = g.x - 900; me.y = me.ty = g.y - 900; });
  await G.waitForTimeout(600);
  m = await G.evaluate(() => downMarkers().map(d => ({ x: d.x, y: d.y, a: d.a })));
  ok(m.length === 1 && m[0].y <= 46 + 2 && m[0].x < vw[0] / 2 && m[0].a < -Math.PI / 4 && m[0].a > -Math.PI, 'marker follows them up and to the left (' + JSON.stringify(m[0]) + ')');
  // walks close: on screen, so the edge marker gives way to the beacon
  await Ho.evaluate(() => { const g = players.find(p => p.remote); me.x = me.tx = g.x + 150; me.y = me.ty = g.y; });
  await G.waitForTimeout(600);
  ok(await G.evaluate(() => downMarkers().length) === 0, 'on screen: no edge marker (beacon above them instead)');
  ok(await G.evaluate(() => T('DOWN — stand close to revive')) === '倒地 — 靠近即可救起', 'label in Traditional Chinese');
  // the guest stands next to them: revive progress, then back up -> indicator gone
  await Ho.evaluate(() => { const g = players.find(p => p.remote); me.x = me.tx = g.x + 30; me.y = me.ty = g.y; });
  await G.waitForTimeout(1500);
  ok(await G.evaluate(() => players.find(p => p !== me).rev > 0.5), 'revive progress reaches the guest’s screen');
  await G.waitForFunction(() => players.every(p => !p.down), null, { timeout: 6000 }).catch(() => { });
  ok(await G.evaluate(() => players.every(p => !p.down) && downMarkers().length === 0), 'revived: indicator gone');
  // the fallen player doesn't see a marker for themselves
  await Ho.evaluate(() => { me.down = true; me.rev = 0; me.hp = 0; const g = players.find(p => p.remote); me.x = me.tx = g.x + 1500; });
  await Ho.waitForTimeout(400);
  ok(await Ho.evaluate(() => downMarkers().length) === 0, 'no marker for yourself');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
