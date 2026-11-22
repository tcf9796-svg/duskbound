// Boss fights in co-op (host authoritative): the guest sees the boss, its phase and its hazards; local effects
// (whirlpool pull, cages) act on the guest's own device; a guest's attacks break a cage; a reconnect mid-fight keeps
// the same boss with the same health and no duplicate. Run: sh build.sh <peerjs.min.js> && node tests/e2e/bosses-coop.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  const Ho = await H.player('Hal'), G = await H.player('Gus');
  const code = await H.hostAndJoin(Ho, G); await Ho.click('#start'); await G.waitForFunction(() => game.state === 'play' && me && world, null, { timeout: 15000 });
  // Chapter 2: Poseidon, both players close by; the host is untouchable and idle (so only the test changes boss health)
  await Ho.evaluate(() => { game.chapter = 2; enemies.forEach(e => e.dead = true); players.forEach(p => { p.hp = p.maxHp = 1e9; }); const g = players.find(p => p.remote); me.x = me.tx = g.x + 40; me.y = me.ty = g.y; spawnBoss(); const b = game.boss; b.x = g.x + 500; b.y = g.y; b.t = 99; game.arena = { x: b.x, y: b.y }; });
  await G.waitForFunction(() => !!game.boss, null, { timeout: 5000 });
  ok(await G.evaluate(() => bossCfg(game.chapter).name === 'Poseidon' && game.boss.phase === 1 && enemies.filter(e => e.type === 'boss').length === 1), 'guest sees Poseidon (phase 1)');
  ok(await G.evaluate(() => enemies.filter(e => e.type === 'orb').length) === 3, 'guest sees the three tide orbs');
  // whirlpool on the guest: the pull happens on the guest's device
  await Ho.evaluate(() => { const b = game.boss, g = players.find(p => p.remote); for (const [, f] of atk(b, 'whirlpool', g)) f(); });
  await G.waitForFunction(() => hazards.some(h => h.k === 'vortex'), null, { timeout: 4000 }).catch(() => { });
  ok(await G.evaluate(() => hazards.some(h => h.k === 'vortex')), 'guest receives the whirlpool hazard');
  const v = await G.evaluate(() => { const h = hazards.find(h => h.k === 'vortex'); return { x: h.x, y: h.y, d0: Math.hypot(me.x - h.x, me.y - h.y) }; });
  await G.waitForTimeout(1800);
  const d1 = await G.evaluate(v => Math.hypot(me.x - v.x, me.y - v.y), v);
  ok(d1 < v.d0 - 15 || d1 < 20, `whirlpool pulls the guest in (${Math.round(v.d0)} -> ${Math.round(d1)} px)`);
  // destroying the core ends the pull
  await Ho.evaluate(() => { const c = enemies.find(e => e.type === 'vcore' && !e.dead); if (c) killEnemy(c, null); });
  await G.waitForFunction(() => !hazards.some(h => h.k === 'vortex'), null, { timeout: 4000 }).catch(() => { });
  ok(await G.evaluate(() => !hazards.some(h => h.k === 'vortex')), 'destroying the whirlpool core ends it');
  // a cage holds the guest; the guest's attacks break it
  await Ho.evaluate(() => { const g = players.find(p => p.remote); spawnSummon('cage', g.x, g.y, 60, { life: 6, holds: g.id }); });
  await G.waitForFunction(() => enemies.some(e => e.type === 'cage'), null, { timeout: 4000 });
  const c0 = await G.evaluate(() => ({ x: me.x, y: me.y }));
  await G.bringToFront(); await G.keyboard.down('d'); await G.waitForTimeout(800); await G.keyboard.up('d');
  const c1 = await G.evaluate(() => ({ x: me.x, y: me.y }));
  ok(Math.hypot(c1.x - c0.x, c1.y - c0.y) < 30, 'caged guest cannot walk away');
  await G.evaluate(() => { autoAtk = true; });
  await G.waitForFunction(() => !enemies.some(e => e.type === 'cage'), null, { timeout: 6000 }).catch(() => { });
  ok(await Ho.evaluate(() => !enemies.some(e => e.type === 'cage' && !e.dead)), 'the guest’s own attacks break the cage');
  await G.evaluate(() => { autoAtk = false; });
  // phase 2 reaches the guest, once
  await Ho.evaluate(() => { const b = game.boss; b.hp = b.maxHp * 0.45; });
  await G.waitForFunction(() => game.boss && game.boss.phase === 2, null, { timeout: 5000 }).catch(() => { });
  ok(await G.evaluate(() => game.boss && game.boss.phase === 2), 'phase 2 shown to the guest');
  // reconnect mid-fight
  await Ho.evaluate(() => { const b = game.boss; b.t = 99; b.script = null; b.state = 'b_rec'; b.t = 99; });
  const before = await Ho.evaluate(() => ({ id: game.boss.id, hp: game.boss.hp }));
  await G.close();
  await Ho.waitForFunction(() => net.away.size === 1, null, { timeout: 8000 });
  const G2 = await H.player('Gus', { ctx: G.ctx }); await G2.click('#joinb');
  await G2.waitForFunction(() => game.state === 'play' && me && game.boss, null, { timeout: 15000 });
  const after = await Ho.evaluate(() => ({ id: game.boss.id, hp: game.boss.hp, n: enemies.filter(e => e.type === 'boss' && !e.dead).length, players: players.length }));
  ok(after.id === before.id && Math.abs(after.hp - before.hp) < 1 && after.n === 1 && after.players === 2, 'reconnect: same boss, same health, no duplicate boss or player');
  ok(await G2.evaluate(() => bossCfg(game.chapter).name === 'Poseidon' && game.boss.phase === 2 && game.arena), 'rejoined guest sees the fight in progress (phase 2, arena)');
  await Ho.evaluate(() => { const b = game.boss, g = players.find(p => p.remote); b.state = 'chase'; for (const [, f] of atk(b, 'tidal', g)) f(); });
  await G2.waitForFunction(() => hazards.some(h => h.k === 'wall'), null, { timeout: 4000 }).catch(() => { });
  ok(await G2.evaluate(() => hazards.some(h => h.k === 'wall')), 'rejoined guest receives new hazards');
  // victory: everyone's hazards and summons are gone
  await Ho.evaluate(() => killEnemy(game.boss, me));
  await G2.waitForFunction(() => !game.boss, null, { timeout: 5000 }).catch(() => { });
  await G2.waitForTimeout(600);
  ok(await G2.evaluate(() => !game.boss && hazards.length === 0 && !enemies.some(e => ['orb', 'vcore'].includes(e.type))), 'after the win the guest has no hazards or summons left');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
