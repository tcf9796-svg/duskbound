// The merged hero roster: unlock carry-over from the old per-device save, locked heroes can't be picked (also not by
// a guest through the host), and every hero (incl. Rowan, Mira, Vespera) plays solo and in co-op without errors.
// Run: sh build.sh <peerjs.min.js> && node tests/e2e/heroes.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  // an older install that unlocked Mira with the previous system
  const A = await H.player('Ann', { init: "localStorage.setItem('duskbound-unlocks', JSON.stringify({ heroes: ['mira'], pools: ['green','blue'] }))" });
  ok(await A.evaluate(() => PROFILE.characters.includes('mira') && localStorage.getItem('duskbound-unlocks') === null), 'old unlock save carried into the profile');
  ok(await A.evaluate(() => document.querySelectorAll('#overlay .card').length) === 6, 'title screen shows all six heroes');
  ok(await A.evaluate(() => [...document.querySelectorAll('#overlay .card.locked')].map(c => c.dataset.hero).sort().join()) === 'rowan,vespera', 'Rowan and Vespera locked, Mira open');
  await A.evaluate(() => selectHero('rowan')); ok(await A.evaluate(() => net.hero) !== 'rowan', 'a locked hero cannot be selected');
  // every hero runs: solo, a few seconds of combat with all abilities
  const all = await A.evaluate(() => Object.keys(HEROES));
  for (const h of all) {
    await A.evaluate(h => { if (!PROFILE.characters.includes(h)) PROFILE.characters.push(h); showMenu(); selectHero(h); }, h);
    await A.click('#solo'); await A.waitForTimeout(300);
    await A.evaluate(() => { me.level = 4; me.hp = me.maxHp = 1e6; for (let i = 0; i < 8; i++) spawnEnemy('husk', me.x + 80 + i * 10, me.y + 40); });
    for (const k of ['e', ' ', 'q', 'e', ' ']) { await A.evaluate(k => { mouse.l = true; pressed[k] = true; }, k); await A.waitForTimeout(350); }
    const st = await A.evaluate(() => ({ hero: me.hero, ok: game.state === 'play' && Number.isFinite(me.x) && Number.isFinite(me.hp) }));
    ok(st.hero === h && st.ok && A.errors.length === 0, 'plays: ' + h + (A.errors.length ? ' ' + A.errors.join(' | ') : ''));
    await A.evaluate(() => { mouse.l = false; showMenu(); });
  }
  // co-op: a guest who doesn't own Vespera can't bring her in, even by asking the host directly
  const B = await H.player('Ben'); await A.evaluate(() => { showMenu(); selectHero('vespera'); });
  await H.hostAndJoin(A, B);
  await B.evaluate(() => net.host.send({ t: 'hero', hero: 'vespera', lo: loadoutOf(PROFILE, 'vespera') }));
  await A.waitForTimeout(600);
  ok(await A.evaluate(() => net.lobby.find(q => q.id === 2).hero) !== 'vespera', 'host refuses a hero the guest has not unlocked');
  await B.evaluate(() => { PROFILE.characters.push('mira'); saveMe(); selectHero('mira'); }); await A.waitForTimeout(600);
  ok(await A.evaluate(() => net.lobby.find(q => q.id === 2).hero) === 'mira', 'host accepts a hero the guest owns');
  await A.click('#start'); await B.waitForFunction(() => game.state === 'play' && me, null, { timeout: 15000 });
  for (const k of ['e', ' ', 'e']) { await B.evaluate(k => { pressed[k] = true; mouse.l = true; }, k); await B.waitForTimeout(400); }
  ok(await B.evaluate(() => me.hero === 'mira' && game.state === 'play') && await A.evaluate(() => players.find(p => p.id === 2).hero === 'mira'), 'co-op: host Vespera + guest Mira play together');
  // Chinese: the new heroes are translated
  await B.evaluate(() => setLang('zh'));
  ok(await B.evaluate(() => T(HEROES.rowan.name) === '羅文' && T(HEROES.mira.kit[1]).includes('鏡像交換') && T(HEROES.vespera.title) === '守燈人' && T('Deep Roots ×3') === '深根 ×3'), 'new heroes in Traditional Chinese');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
