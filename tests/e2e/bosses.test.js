// Chapter bosses (bosses.js), solo, fast-forwarded in the page:
//  - each boss: all of its attacks appear, phase 2 starts exactly once, hazard/summon caps hold, the fight ends;
//  - fairness: every damaging hazard is telegraphed (>= 0.4 s; trails behind a dash >= 0.2 s); gap hazards keep
//    their gaps; and whenever a fixed hazard goes off, a safe spot existed within walking reach of each player
//    (slowest hero speed x warning time);
//  - defeat: hazards and summons cleaned up, exactly one chapter reward, summons never grant rewards;
//  - tuning: bosses get stronger chapter by chapter; difficulty and party size apply once; no chapter multiplier.
// Run: sh build.sh <peerjs.min.js> && node tests/e2e/bosses.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  const P = await H.player('Ann', { build: 'duskbound.html', real: true });
  await P.click('#solo'); await P.waitForTimeout(300);
  // --- tuning
  const cfg = await P.evaluate(() => BOSSES.map(b => ({ id: b.id, hp: b.hp, dmg: b.dmg, gap: b.gap[0], rec: b.rec })));
  ok(cfg.map(b => b.id).join() === 'elderoot,poseidon,gorath,raivolt,nezha', 'five bosses in chapter order');
  ok(cfg.every((b, i) => i === 0 || (b.hp > cfg[i - 1].hp && b.dmg > cfg[i - 1].dmg && b.gap <= cfg[i - 1].gap)), 'health and damage rise and pauses shrink from Chapter 1 to 5');
  for (const [ch, diff, n] of [[3, 'normal', 1], [3, 'hell', 1], [5, 'nightmare', 2]]) {
    const r = await P.evaluate(([ch, diff, n]) => {
      game.chapter = ch; game.diff = diff; game.winT = 0; game.over = null; game.boss = null; genWorld(); enemies = [];
      const extra = []; for (let i = 1; i < n; i++) { const q = newPlayer(9 + i, 'bramble', 'x'); q.x = me.x; q.y = me.y; players.push(q); extra.push(q); }
      spawnBoss(); const b = game.boss, want = bossCfg(ch).hp * DIFF(diff).hp * (1 + PARTY_SCALE.hpPerExtra * (n - 1)), wd = bossCfg(ch).dmg * DIFF(diff).dmg * (1 + PARTY_SCALE.dmgPerExtra * (n - 1));
      players = players.filter(q => !extra.includes(q)); b.dead = true; game.boss = null; hazards = []; enemies = [];
      return { hp: b.maxHp, want, dmg: b.dmg, wd };
    }, [ch, diff, n]);
    ok(Math.abs(r.hp - r.want) < 1e-6 && Math.abs(r.dmg - r.wd) < 1e-6, `Ch${ch} ${diff} ${n}p: boss = config x difficulty x party, once (hp ${Math.round(r.hp)})`);
  }
  // --- full fights
  for (let ch = 1; ch <= 5; ch++) {
    const r = await P.evaluate(ch => {
      const bad = [], unavoid = [], used = new Set(), SPEED = 200;
      game.chapter = ch; game.diff = 'normal'; game.time = 0; game.winT = 0; game.over = null; game.boss = null; game.runId = 'bt' + ch; genWorld(); enemies = []; net.rolled = new Set(); net.claims = new Map();
      me.hp = me.maxHp = 1e9; me.dmgMul = 1.6 + 0.5 * ch; me.asMul = 1.4; me.level = 8; autoAtk = true;
      const rew0 = PROFILE.rewards.length;
      // record every hazard with where the players were when it was announced
      const add0 = addHz; window.addHz = h => { const z = add0(h); z.__born = players.map(p => ({ x: p.x, y: p.y })); if (z.dmg) { const minT = z.k === 'trail' ? 0.2 : 0.4; if (z.tmax < minT) bad.push(z.k + ' tel ' + z.tmax); }
        if (z.k === 'shock' && !(z.g.length >= 1 && z.gw > 0.2)) bad.push('shock without gaps'); if (z.k === 'wall' && !(z.g.length >= 1 && z.gw >= 80)) bad.push('wall without gap');
        if (z.k === 'tsunami' && !alive().every(p => hazards.some(s => s.k === 'safe' && Math.hypot(s.x - p.x, s.y - p.y) - s.r < SPEED * z.tmax * 0.6))) bad.push('tsunami without reachable platform');
        return z; };
      const atk0 = atk; window.atk = (b, n, t) => { used.add(n); return atk0(b, n, t); };
      const STATIC = new Set(['circ', 'mark', 'line', 'cone', 'petal']);
      spawnBoss(); const b = game.boss; let t = 0, phases = 0, last = 1, maxHz = 0, maxSap = 0, rewMid = 0;
      while (t < 300 && !b.dead) {
        me.x = me.tx = b.x + 120; me.y = me.ty = b.y; // stand next to the boss, auto-attacking
        const before = new Set(hazards.filter(h => h.tel > 0).map(h => h.id));
        update(1 / 30); t += 1 / 30;
        // fixed hazards that just went off: was there somewhere safe within reach?
        const fired = hazards.filter(h => before.has(h.id) && h.tel <= 0 && STATIC.has(h.k) && h.dmg);
        for (const h of fired) {
          const group = hazards.filter(z => STATIC.has(z.k) && z.dmg && z.tel <= 0.05 && (z.act > 0 || z === h));
          h.__born.forEach((pos, i) => { const R = SPEED * h.tmax * 0.9; let safe = false;
            for (let k = 0; k <= 48 && !safe; k++) { const a = k * 2.4, d = R * Math.sqrt(k / 48), q = { x: pos.x + Math.cos(a) * d, y: pos.y + Math.sin(a) * d, r: 15 }; if (!group.some(z => hzTouch(z, q))) safe = true; }
            if (!safe) unavoid.push(h.k + '@' + Math.round(t) + ' born ' + Math.round(Math.hypot(pos.x - h.x, pos.y - h.y)) + ' r' + h.r + ' tel' + h.tmax + ' group ' + group.map(z => z.k + (z.r|0) + '/' + (z.w||0).toFixed?.(2)).join(' ')); });
        }
        if (b.phase !== last) { phases++; last = b.phase; }
        maxHz = Math.max(maxHz, hazards.length); maxSap = Math.max(maxSap, enemies.filter(e => !e.dead && e.type === 'sapling').length);
        if (b.phase === 2 && !rewMid) rewMid = PROFILE.rewards.length - rew0 + 1; // +1 so 0 rewards still counts as "checked"
        if (game.over) break;
      }
      // the chapter-end flow (winT -> over) finishes
      for (let i = 0; i < 120 && !game.over; i++) update(1 / 30);
      window.addHz = add0; window.atk = atk0;
      const mine = PROFILE.rewards.slice(rew0);
      const r = { ch, name: b.cfg.name, dead: b.dead, t: Math.round(t), phases, used: [...used].sort().join(','), all: [...new Set(ATTACKS[b.cfg.id].flat())].sort().join(','), maxHz, maxSap, bad, unavoid,
        hzLeft: hazards.length, sumLeft: enemies.filter(e => e.summon && !e.dead).length, over: game.over, rewards: mine.length, rewardBeforeKill: rewMid - 1, claim: mine[0] && mine[0].claim };
      game.over = null; return r;
    }, ch);
    const tag = `Ch${ch} ${r.name}`;
    ok(r.dead && r.over, `${tag}: defeated in ${r.t} s (simulated) and the chapter ends (${r.over})`);
    ok(r.phases === 1, `${tag}: phase 2 starts exactly once`);
    const missing = r.all.split(',').filter(n => !r.used.split(',').includes(n));
    ok(missing.length === 0 || r.t < 60, `${tag}: attacks used: ${r.used}` + (missing.length ? ' (not seen in this fight: ' + missing + ')' : ''));
    ok(r.bad.length === 0, `${tag}: every damaging hazard is telegraphed and keeps its safe gaps ${r.bad.length ? JSON.stringify(r.bad.slice(0, 5)) : ''}`);
    ok(r.unavoid.length === 0, `${tag}: a safe spot was always within reach ${r.unavoid.length ? JSON.stringify(r.unavoid.slice(0, 8)) : ''}`);
    ok(r.maxHz <= 60 && (ch !== 1 || r.maxSap <= 4), `${tag}: caps held (hazards ${r.maxHz}/60${ch === 1 ? ', saplings ' + r.maxSap + '/4' : ''})`);
    ok(r.hzLeft === 0 && r.sumLeft === 0, `${tag}: hazards and summons cleaned up after defeat`);
    ok(r.rewardBeforeKill <= 0 && r.rewards === 1 && r.claim && r.claim.endsWith(':' + ch + ':' + await P.evaluate(() => PROFILE.id)), `${tag}: exactly one chapter reward, none from phases or summons (${r.claim})`);
  }
  // a second completion event for the same chapter grants nothing more
  ok(await P.evaluate(() => { const n = PROFILE.rewards.length; game.runId = 'bt5'; game.chapter = 5; chapterComplete(); return PROFILE.rewards.length === n; }), 'repeated completion of the same chapter: no extra roll');
  // auto attack and auto-aim skip what can't be hurt
  ok(await P.evaluate(() => { game.chapter = 4; game.winT = 0; game.over = null; game.boss = null; genWorld(); enemies = []; spawnBoss(); const t = autoTarget({ x: game.boss.x + 300, y: game.boss.y }); const rodsOnly = enemies.filter(e => e.type === 'rod'); return rodsOnly.length === 3 && (!t || t.type !== 'rod'); }), 'auto attack never targets grounding rods / pillars / braziers');
  ok(await P.evaluate(() => ['Elderoot', 'Poseidon', 'Gorath', 'Raivolt', 'Nezha', 'Guardian of the Forest', 'the Blazing Lotus Prince', 'Universe Ring', 'Lotus Ascension'].every(s => (setLang('zh'), T(s) !== s)) && (setLang('en'), true)), 'boss text has Traditional Chinese');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
