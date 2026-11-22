// End-to-end: co-op party with separate profiles. Covers the party difficulty rule, player-count scaling across
// disconnect/reconnect/grace expiry, one reward per player per chapter (and no extra rolls from duplicates or
// reconnects), five chapters, unlocking only the next difficulty, profile persistence, and takeover protection.
// Run: sh build.sh <peerjs.min.js> && node tests/e2e/progression.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const A = await H.player('Ann'), B = await H.player('Ben');
  // Ann already has Nightmare unlocked and wants to play it; Ben only has Normal.
  await A.evaluate(() => { PROFILE.unlocked.push('nightmare'); saveMe(); setDiff('nightmare'); });
  const [aid, bid] = [await A.evaluate(() => PROFILE.id), await B.evaluate(() => PROFILE.id)];
  ok(aid !== bid, 'two players, two different profile ids');
  await H.hostAndJoin(A, B);
  ok(await A.evaluate(() => net.diff) === 'normal', 'mixed unlocks: party difficulty drops to one everyone has unlocked');
  ok(await A.evaluate(() => $('diffsel').querySelector('option[value=nightmare]').disabled), 'Nightmare is disabled for the host while Ben lacks it');
  ok(await A.evaluate(() => !partyDiffOk('nightmare') && partyDiffOk('normal')), 'party rule: only difficulties every player has');
  ok(await B.evaluate(() => /Normal/.test(document.body.textContent)), 'guest sees the party difficulty');
  // a second tab with the same profile can't join as another player
  const B2 = await H.player('Ben2', { ctx: B.ctx }); const code = await A.evaluate(() => net.code);
  await B2.fill('#code', code); await B2.click('#joinb');
  await B2.waitForFunction(() => game.state === 'menu' && $('msg').textContent, null, { timeout: 15000 });
  ok(/already in this party/.test(await B2.textContent('#msg')), 'same profile twice is refused');
  await B2.close();

  await A.click('#start'); await B.waitForFunction(() => game.state === 'play' && me && world, null, { timeout: 15000 });
  ok(await A.evaluate(() => game.diff) === 'normal' && await B.evaluate(() => game.diff) === 'normal', 'run started on Normal for both');
  // --- player-count scaling
  const hpRatio = () => A.evaluate(() => { const e = spawnEnemy('husk', 100, 100); const base = ET.husk.hp * (1 + 0.3 * dayIdx()) * (1 + 0.9 * (game.chapter - 1)) * DIFF(game.diff).hp; e.dead = true; return e.maxHp / base; });
  ok(await A.evaluate(() => partyN()) === 2 && Math.abs(await hpRatio() - 1.6) < 1e-9, '2 players: enemy health x1.6 (1 + 0.6 x 1)');
  const hp0 = await A.evaluate(() => { const e = spawnEnemy('ram', 300, 300); window.__keep = e; return e.maxHp; });

  // --- chapter 1 complete: exactly one roll per player
  const winChapter = async () => { await A.evaluate(() => { game.winT = 0.001; }); await A.waitForFunction(() => !!game.over, null, { timeout: 5000 }); await wait(700); };
  await winChapter();
  const rewardsOf = P => P.evaluate(() => PROFILE.rewards.map(r => r.claim));
  let ra = await rewardsOf(A), rb = await rewardsOf(B);
  ok(ra.length === 1 && rb.length === 1, 'chapter 1: one reward result per player (' + ra.length + ', ' + rb.length + ')');
  ok(ra[0].endsWith(':1:' + aid) && rb[0].endsWith(':1:' + bid), 'claims are run:chapter:profile');
  ok(await B.evaluate(() => game.rewards && game.rewards.length === 2) && await B.evaluate(() => /Chapter reward/.test(overlay.textContent)), 'end screen shows both players’ results');
  // duplicate completion events
  await A.evaluate(() => { chapterComplete(); chapterComplete(); net.rolled.clear(); chapterComplete(); }); await wait(700);
  ok((await rewardsOf(A)).length === 1 && (await rewardsOf(B)).length === 1 && await A.evaluate(() => net.claims.size) === 2, 'duplicate completion events: no extra rolls');
  const rolled = await A.evaluate(() => [...net.claims.values()].map(r => r.rarity + '/' + r.item).join());

  // --- next chapter; Ben's state, then Ben's game crashes
  await A.evaluate(() => nextChapter()); await B.waitForFunction(() => game.chapter === 2 && !game.over, null, { timeout: 10000 });
  await A.evaluate(() => { const b = players.find(p => p.remote); b.level = 6; b.gold = 55; b.hp = 41; b.talents.keen = 2; });
  await wait(400);
  const secret = await B.evaluate(() => localStorage.getItem('duskbound-rejoin'));
  await B.close();
  await A.waitForFunction(() => net.away.size === 1, null, { timeout: 8000 });
  const held = await A.evaluate(() => { const p = [...net.away.values()][0].p; return { hp: p.hp, lv: p.level, gold: p.gold }; });
  ok(await A.evaluate(() => players.length === 1 && partyN() === 2), 'Ben disconnected: slot held, still counted for scaling');
  ok(Math.abs(await hpRatio() - 1.6) < 1e-9, 'scaling unchanged while Ben is away (no weaker spawns from disconnecting)');
  ok(await A.evaluate(h => window.__keep.maxHp === h, hp0), 'existing enemies are never re-scaled');
  // someone else (different profile) tries to take Ben's place with Ben's secret
  const C = await H.player('Cat', { init: `localStorage.setItem('duskbound-rejoin', ${JSON.stringify(secret)})` });
  await C.fill('#code', code); await C.click('#joinb');
  await C.waitForFunction(() => game.state === 'menu' && $('msg').textContent, null, { timeout: 15000 });
  ok(await A.evaluate(() => net.away.size === 1 && players.length === 1), 'another profile with a copied secret cannot take Ben’s place');
  const D = await H.player('Dee'); await D.fill('#code', code); await D.click('#joinb');
  await D.waitForFunction(() => game.state === 'menu' && $('msg').textContent, null, { timeout: 15000 });
  ok(/already set out/.test(await D.textContent('#msg')), 'a stranger cannot join a run in progress');
  // Ben reopens the game (same browser = same profile + secret) and rejoins
  const B3 = await H.player('Ben', { ctx: B.ctx });
  ok(await B3.inputValue('#code') === code, 'room code is pre-filled after the crash');
  await B3.click('#joinb'); await B3.waitForFunction(() => game.state === 'play' && me && world, null, { timeout: 15000 }); await wait(800);
  const back = await B3.evaluate(() => ({ lv: me.level, gold: me.gold, hp: me.hp, keen: me.talents.keen, n: players.length }));
  ok(back.lv === 6 && back.gold === 55 && Math.abs(back.hp - held.hp) <= 3 && back.keen === 2 && back.n === 2, 'rejoin restores level, gold, health (' + Math.round(held.hp) + ' when he dropped) and boons, no duplicate: ' + JSON.stringify(back));
  ok(await A.evaluate(() => players.length === 2 && net.away.size === 0 && partyN() === 2 && new Set(players.map(p => p.id)).size === 2), 'host: one Ben, slot reclaimed');
  ok((await rewardsOf(B3)).length === 1 && await A.evaluate(r => [...net.claims.values()].map(r => r.rarity + '/' + r.item).join() === r, rolled), 'reconnect re-delivers the same results, no new rolls');

  // --- chapters 2..5
  for (let ch = 2; ch <= 5; ch++) {
    if (ch > 2) { await A.evaluate(() => nextChapter()); await B3.waitForFunction(c => game.chapter === c && !game.over, ch, { timeout: 10000 }); }
    await winChapter();
  }
  ok(await A.evaluate(() => game.over) === 'final' && await B3.evaluate(() => game.over) === 'final', 'chapter 5 ends the campaign (both screens)');
  ok(await A.evaluate(() => PAL[3].placeholder && PAL[4].placeholder && CHAPTERS === 5), 'chapters 4-5 are marked placeholder');
  ra = await rewardsOf(A); rb = await rewardsOf(B3);
  ok(ra.length === 5 && rb.length === 5 && new Set(rb.map(c => c.split(':')[1])).size === 5, 'five chapters: five results each, one per chapter');
  ok(JSON.stringify(await B3.evaluate(() => PROFILE.unlocked)) === '["normal","nightmare"]', 'Ben cleared Normal: Nightmare unlocked, nothing more');
  ok(JSON.stringify(await A.evaluate(() => PROFILE.unlocked)) === '["normal","nightmare"]' && await A.evaluate(() => PROFILE.cleared.normal) === 1, 'Ann (already had Nightmare): clear recorded, nothing else unlocked');
  await A.evaluate(() => chapterComplete()); await wait(500);
  ok(await B3.evaluate(() => PROFILE.cleared.normal) === 1, 'a repeated final completion does not count twice');

  // --- profiles survive a restart
  const before = await B3.evaluate(() => JSON.stringify([PROFILE.id, PROFILE.unlocked, PROFILE.rewards.length, PROFILE.weapons]));
  const B4 = await H.player('Ben', { ctx: B.ctx, name: false });
  ok(await B4.evaluate(() => JSON.stringify([PROFILE.id, PROFILE.unlocked, PROFILE.rewards.length, PROFILE.weapons])) === before, 'profile, unlocks and rewards survive restarting the game');
  ok(await B4.evaluate(() => [...$('diffsel').options].filter(o => !o.disabled).map(o => o.value).join()) === 'normal,nightmare', 'title screen offers only unlocked difficulties');

  // --- grace period expiry releases the slot
  await A.evaluate(() => { endRun(); }); await wait(300);
  await A.evaluate(() => { PARTY_SCALE.graceSeconds = 1; startHosted(); }); await B3.waitForFunction(() => game.state === 'play' && game.chapter === 1 && !game.over, null, { timeout: 10000 });
  await B3.close(); await B4.close();
  await A.waitForFunction(() => net.away.size === 1, null, { timeout: 8000 });
  await A.waitForFunction(() => net.away.size === 0, null, { timeout: 8000 });
  ok(await A.evaluate(() => partyN() === 1 && players.length === 1), 'after the grace period the slot is released and scaling drops to 1 player');
  const B5 = await H.player('Ben', { ctx: B.ctx }); await B5.click('#joinb');
  await B5.waitForFunction(() => game.state === 'menu' && $('msg').textContent, null, { timeout: 15000 });
  ok(/already set out/.test(await B5.textContent('#msg')), 'rejoining after the grace period is refused');

  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
