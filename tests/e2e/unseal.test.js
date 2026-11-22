// Boss altar: standing in the ring for UNSEAL_TIME seconds unseals the Gloam Stag; leaving drains the progress;
// fallen players don't count; F no longer wakes it; in co-op a guest in the ring counts and everyone sees progress.
// Run: sh build.sh <peerjs.min.js> && node tests/e2e/unseal.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  const A = await H.player('Ann', { build: 'duskbound.html', real: true });
  await A.click('#solo'); await A.waitForTimeout(400);
  const alt = () => A.evaluate(() => ({ u: world.pois[0].unseal || 0, used: world.pois[0].used, boss: !!game.boss }));
  await A.evaluate(() => { me.hp = me.maxHp = 1e6; enemies.forEach(e => e.dead = true); const a = world.pois[0]; me.x = me.tx = a.x + 200; me.y = me.ty = a.y; });
  ok(await A.evaluate(() => world.pois[0].kind === 'altar' && UNSEAL_TIME === 5), 'the altar is the boss ring; 5 s to unseal');
  // F next to the altar no longer summons the boss
  await A.evaluate(() => { const a = world.pois[0]; me.x = a.x + 70; me.y = a.y; }); await A.keyboard.press('f'); await A.waitForTimeout(300);
  ok(!(await alt()).boss, 'pressing F at the altar does nothing now');
  ok(await A.evaluate(() => poiPrompt(world.pois[0])) === 'Stand in the ring for 5 s to unseal Elderoot', 'prompt explains the ring (names this chapter’s boss)');
  // stand in the ring 2.5 s, step out: progress drains, no boss
  await A.evaluate(() => { const a = world.pois[0]; me.x = me.tx = a.x; me.y = me.ty = a.y + 10; });
  await A.waitForTimeout(2500); let s = await alt();
  ok(s.u > 2 && s.u < 3 && !s.boss, '2.5 s in the ring: progress ' + s.u.toFixed(2) + ' s, no boss yet');
  await A.evaluate(() => { const a = world.pois[0]; me.x = me.tx = a.x + 200; }); await A.waitForTimeout(1000); s = await alt();
  ok(s.u < 1.5 && !s.boss, 'stepped out: progress drains (' + s.u.toFixed(2) + ' s)');
  // a fallen player in the ring doesn't count
  await A.evaluate(() => { const a = world.pois[0]; me.x = me.tx = a.x; me.down = true; }); await A.waitForTimeout(1500); s = await alt();
  ok(s.u < 0.5, 'a fallen player in the ring does not count');
  await A.evaluate(() => { me.down = false; });
  // stay the full 5 s: the Gloam Stag is unsealed
  await A.waitForTimeout(4000); ok(!(await alt()).boss, '4 s: still sealed');
  await A.waitForTimeout(1600); s = await alt();
  ok(s.boss && s.used, '5 s in the ring: the Gloam Stag is unsealed');
  ok(await A.evaluate(() => game.banner && game.banner.text) === 'Elderoot', 'boss intro banner shown');
  ok(await A.evaluate(() => poiPrompt(world.pois[0])) === null, 'altar spent afterwards');
  // co-op: the guest stands in the ring
  const Ho = await H.player('Hal'), G = await H.player('Gus');
  await H.hostAndJoin(Ho, G); await Ho.click('#start'); await G.waitForFunction(() => game.state === 'play' && me && world, null, { timeout: 15000 });
  await Ho.evaluate(() => { players.forEach(p => { p.hp = p.maxHp = 1e6; }); enemies.forEach(e => e.dead = true); const a = world.pois[0]; me.x = me.tx = a.x + 400; me.y = me.ty = a.y; });
  await G.evaluate(() => { const a = world.pois[0]; me.x = a.x; me.y = a.y + 5; });
  await G.waitForTimeout(2500);
  const gu = await G.evaluate(() => world.pois[0].unseal || 0);
  ok(gu > 1.5, 'co-op: guest in the ring, progress counted by the host and shown to the guest (' + gu.toFixed(2) + ' s)');
  await G.waitForFunction(() => !!game.boss, null, { timeout: 6000 }).catch(() => { });
  ok(await G.evaluate(() => !!game.boss) && await Ho.evaluate(() => !!game.boss), 'co-op: the Stag is unsealed for everyone');
  // Chinese
  await G.evaluate(() => setLang('zh'));
  ok(await G.evaluate(() => T('Stand in the ring for 5 s to unseal Elderoot') === '站在法陣中 5 秒即可解封古根' && T('Unsealing') === '解封中'), 'Traditional Chinese');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
