// Run: node tests/talents.test.js   (no dependencies; uses tests/sim-harness.js)
const vm = require('vm'); const { makeWorld } = require('./sim-harness.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const PRE = `
  initAudio = () => {}; PROFILE.characters.push('rowan', 'mira', 'vespera');
  function setup(hero, ids, n = 1) {
    players = []; for (let i = 1; i <= n; i++) players.push(newPlayer(i, i === 1 ? hero : 'bramble', 'P' + i));
    me = players[0]; beginRun('normal'); clearEntities(); game.time = 1; night = 0; world.pois[0].used = true; world.obs = world.obs.filter(o => Math.hypot(o.x - 1800, o.y - 1700) > 600); // no altar boss, no random trees in the test area
    players.forEach((p, i) => { p.x = p.tx = 1700 + i * 40; p.y = p.ty = 1700; p.level = 6; p.crit = 0; p.iT = 0; });
    me.ct = ids.slice(); if (ids.includes('coven')) { me.lanCh = 2; me.lanRe = 0; } return me;
  }
  function foe(x, y, o = {}) { const e = spawnEnemy(o.type || 'husk', x, y); e.hp = e.maxHp = o.hp || 1e5; e.near = true; e.aggro = !!o.aggro; e.spd = 0; e.cd = 99; return e; }
  function step(n, dt = 1 / 60) { for (let i = 0; i < n; i++) { for (const p of players) p.iT = Math.max(p.iT, 0); update(dt); } }
  const lost = e => e.maxHp - e.hp;
  function atNight() { game.time = DAY + 1; night = 1; } function atDay() { game.time = 1; night = 0; }
`;
const run = (code) => { const w = makeWorld({}); return vm.runInContext(PRE + code, w); };

// ===== earning, picking, lifecycle =====
{
  const r = run(`(() => {
    const out = {};
    out.policy = CHAPTER_TALENT.policy;
    out.rules = [earnsChapterTalent('t:keen', 1), earnsChapterTalent('u:hp:4', 1), earnsChapterTalent('t:keen', 5), earnsChapterTalent('u:hp:4', 2, 'every'), earnsChapterTalent('t:keen', 2, 'off')];
    setup('bramble', []); me.lo = loadoutOf(PROFILE, 'bramble');
    const R = Math.random; let seq; const roll = arr => { seq = arr.slice(); Math.random = () => seq.length ? seq.shift() : 0.5; };
    // chapter 1 roll lands on a starting-talent reward (blue pool index 3 = t:keen)
    roll([0.5, 3.5 / 8]); game.over = 'win'; chapterComplete(); Math.random = R;
    out.reward1 = game.rewards[0]; out.pend1 = me.ctPending;
    chapterComplete(); out.pendAgain = me.ctPending; // same claim: never twice
    nextChapter(); update(1 / 60); out.offer = me.ctChoice && me.ctChoice.slice(); out.seq = me.ctSeq;
    out.badId = applyChapterTalent(me, 'forked', me.ctSeq); out.badSeq = applyChapterTalent(me, 'territory', me.ctSeq + 1);
    out.good = applyChapterTalent(me, 'territory', me.ctSeq); out.again = applyChapterTalent(me, 'territory', me.ctSeq);
    out.ct = me.ct.slice(); out.pendAfter = me.ctPending;
    // chapter 2 roll lands on an upgrade: no pick
    roll([0.1, 0.1]); game.over = 'win'; chapterComplete(); Math.random = R; out.pend2 = me.ctPending; out.reward2 = game.rewards[0];
    // a later pick excludes what was already chosen
    game.over = null; me.ctPending = 1; update(1 / 60); out.offer2 = me.ctChoice.slice();
    // the final chapter never earns a pick
    me.ctChoice = null; me.ctPending = 0; game.chapter = CHAPTERS; roll([0.5, 3.5 / 8]); game.over = 'final'; chapterComplete(); Math.random = R; out.pendFinal = me.ctPending;
    // the pick lasts through chapters, not into a new run
    out.keptAcrossChapter = me.ct.includes('territory');
    players = [newPlayer(1, 'bramble', 'P1')]; me = players[0]; beginRun('normal'); out.newRun = me.ct.length;
    // solo pauses while the offer is open
    me.ctPending = 1; update(1 / 60); const t0 = game.time; tick(1000); tick(1016); out.paused = game.time === t0 && !!me.ctChoice;
    syncChoice(); out.cards = (choiceEl.innerHTML.match(/class="card ctc"/g) || []).length; out.html = choiceEl.innerHTML;
    onKey('2'); out.keyPick = me.ct.slice(); out.closed = !me.ctChoice;
    return out;
  })()`);
  ok(r.policy === 'reward', 'policy defaults to "reward" (no extra guaranteed reward)');
  ok(JSON.stringify(r.rules) === '[true,false,false,true,false]', 'earning rule: talent reward yes, other reward no, final chapter no, "every" guaranteed, "off" never');
  ok(r.reward1.item === 't:keen' && r.reward1.ct === 1 && r.pend1 === 1 && r.pendAgain === 1, 'a chapter roll that lands on a talent reward earns one pick, once per claim (' + JSON.stringify(r.reward1) + ')');
  ok(r.offer && r.offer.length === 5 && r.offer[0] === 'splinter', 'next chapter offers the hero\'s five talents');
  ok(r.badId === false && r.badSeq === false && r.good === true && r.again === false, 'only a pick answering the current offer with one of the offered talents is accepted');
  ok(r.ct.join() === 'territory' && r.pendAfter === 0, 'exactly one talent selected');
  ok(r.pend2 === 0 && r.reward2.ct === 0, 'a roll landing on another reward earns no pick (' + r.reward2.item + ')');
  ok(r.offer2.length === 4 && !r.offer2.includes('territory'), 'later offers leave out talents already picked this run');
  ok(r.pendFinal === 0, 'no pick after the final chapter');
  ok(r.keptAcrossChapter && r.newRun === 0, 'picks last for the run and reset for a new run');
  ok(r.paused, 'solo game pauses while the talent cards are open');
  ok(r.cards === 5 && /Sweep/.test(r.html) && /Splintering Impact/.test(r.html) && /One explosion per foe per Sweep/.test(r.html), 'cards show name, ability, description and limits');
  ok(r.keyPick.join() === 'territory' && r.closed, 'number key picks a card (2 = Briar Territory) and closes the offer');
}

// ===== Bramble =====
{
  const r = run(`(() => {
    const out = {};
    // Splintering Impact: knocked into another foe -> one explosion
    setup('bramble', ['splinter']); me.face = 0; me.aim = { x: 2000, y: 1700 };
    const a = foe(1765, 1700), b = foe(1818, 1700, { type: 'ram' }); doAttack(me); step(30);
    out.b = lost(b); out.expected = Math.round(15 * 0.6); out.aSpl = a.splint;
    setup('bramble', ['splinter']); me.face = 0; world.obs.push({ x: 1800, y: 1700, r: 15, cr: 15, tree: false, v: 0, tone: 0 }); const wa = foe(1765, 1700), wb = foe(1765, 1760); doAttack(me); step(30); out.wall = lost(wb) > 0;
    setup('bramble', []); me.face = 0; const a2 = foe(1765, 1700), b2 = foe(1818, 1700, { type: 'ram' }); doAttack(me); step(30); out.bNo = lost(b2);
    // Briar Territory
    setup('bramble', ['territory']); const t = foe(1760, 1700); me.tSkill = 0; doSkill(me); const z = zones.find(z => z.kind === 'thorns'); const h0 = lost(t);
    step(60); out.thorns = !!z && lost(t) > h0 && t.slowT > 0; step(200); out.gone = !zones.includes(z);
    out.cc = [ccScale({ type: 'boss' }), ccScale({ type: 'husk' }), ccScale({ type: 'pillar', anchor: true })];
    // Living Rampart: shield per foe, capped; frees a caged ally
    setup('bramble', ['rampart'], 2); const q = players[1]; q.x = 1900; q.y = 1700;
    for (let i = 0; i < 6; i++) foe(1760 + i * 22, 1700, { hp: 1e6 });
    me.dashes = 1; doDash(me, 0); step(20); out.shield = me.shield;
    setup('bramble', ['rampart'], 2); const q2 = players[1]; q2.x = 1900; q2.y = 1700; const cage = spawnSummon('cage', q2.x, q2.y, 500); me.dashes = 1; doDash(me, 0); step(20); out.cageDead = cage.dead;
    setup('bramble', [], 2); const q3 = players[1]; q3.x = 1900; q3.y = 1700; const cage3 = spawnSummon('cage', q3.x, q3.y, 500); me.dashes = 1; doDash(me, 0); step(20); out.cageNo = !cage3.dead;
    // Unstoppable Growth: +0.5 s per hitting Sweep, max +3 s
    setup('bramble', ['growth']); const g = foe(1760, 1700, { hp: 1e7 }); me.face = 0; me.tUlt = 0; doUlt(me);
    for (let i = 0; i < 12; i++) { me.tAtk = 0; doAttack(me); }
    out.ext = me.ultExt; out.ultT = me.ultT; step(60); out.extAfterPulses = me.ultExt;
    // Sunseed Reserve
    setup('bramble', ['sunseed']); atDay(); me.hp = me.maxHp; step(60 * 30); out.barrier = me.barrier;
    atNight(); step(60); out.barrierNight = me.barrier;
    const hp0 = me.hp; me.iT = 0; hurtPlayer(me, 20); out.absorbed = me.hp === hp0 && me.barrier < out.barrierNight;
    return out;
  })()`);
  ok(r.b === r.expected && !r.aSpl, 'Splintering Impact: a foe swept into another explodes once (' + r.b + ' dmg)');
ok(r.wall, 'Splintering Impact: a foe swept into a wall explodes, hurting a foe nearby');
  ok(r.bNo === 0, 'Splintering Impact: no explosion without the talent');
  ok(r.thorns && r.gone, 'Briar Territory: thorn field damages and slows, gone after 4 s');
  ok(JSON.stringify(r.cc) === '[0.4,1,0]', 'crowd control: bosses 40%, arena objects never');
  ok(r.shield > 0 && r.shield <= 30, 'Living Rampart: shield from Charge, capped at 30 (' + r.shield + ')');
  ok(r.cageDead && r.cageNo, 'Living Rampart: charging into a caged ally breaks the cage (and not without the talent)');
  ok(r.ext === 3 && r.ultT > 10.9 && r.extAfterPulses === 3, 'Unstoppable Growth: +3 s max (Overgrowth ' + r.ultT.toFixed(1) + ' s); pulses don\'t extend');
  ok(r.barrier === 30 && r.barrierNight === 30 && r.absorbed, 'Sunseed Reserve: barrier fills to 30 by day, stays at night, absorbs hits');
}

// ===== Wick =====
{
  const r = run(`(() => {
    const out = {};
    let sparks = 0; const _s = shoot; shoot = (x, y, a, sp, o) => { if (o && o.r === 5 && o.kind === 'fire') sparks++; return _s(x, y, a, sp, o); };
    // Forked Cinders
    setup('wick', ['forked']); atDay(); me.face = 0; const t = foe(1820, 1700), o1 = foe(1860, 1760), o2 = foe(1860, 1640);
    doAttack(me); step(40); out.forkHits = lost(o1) > 0 && lost(o2) > 0; out.sparksDay = sparks;
    sparks = 0; setup('wick', ['forked']); atNight(); me.face = 0; foe(1820, 1700); for (let i = 0; i < 6; i++) foe(1860, 1640 + i * 25);
    doAttack(me); step(40); out.sparksNight = sparks;
    // Lantern Coven
    setup('wick', ['coven']); me.aim = { x: 1900, y: 1700 }; me.tSkill = 0; doSkill(me); const c1 = me.tSkill;
    me.aim = { x: 1900, y: 1900 }; me.tSkill = 0; doSkill(me); const blocked = (me.tSkill = 0, doSkill(me), zones.filter(z => z.lantern).length);
    out.coven = [c1 < 1, blocked]; const mid = foe(1900, 1800); step(70); out.thread = lost(mid) > 0;
    for (const z of zones) if (z.lantern) z.life = 99; step(60 * 9); out.recharged = me.lanCh; me.tSkill = 0; me.aim = { x: 1700, y: 1900 }; doSkill(me); out.twoMax = zones.filter(z => z.lantern && z.life > 0).length;
    // Ember Passage
    setup('wick', ['passage'], 2); const q = players[1]; me.dashes = 1; const x0 = me.x; doDash(me, 0); const tr = zones.find(z => z.kind === 'etrail');
    q.x = (x0 + me.x) / 2; q.y = 1700; const tf = foe((x0 + me.x) / 2, 1700); step(40);
    out.passage = !!tr && q.hasteT > 0 && q.hasteT <= 1.5 && q.hasteMul === 1.25 && lost(tf) > 0;
    // Falling Constellation
    setup('wick', ['constellation'], 2); const L1 = { kind: 'burn', friendly: true, owner: me, x: 2000, y: 1700, r: 110, delay: 0, life: 9, max: 9, dmg: 1, tickT: 9, lantern: true };
    const L2 = Object.assign({}, L1, { owner: players[1], x: 2010 }); zones.push(L1, L2); const near = foe(2000, 1760);
    me.aim = { x: 2000, y: 1700 }; me.tUlt = 0; doUlt(me); step(60 * 3.5);
    out.const = L1.det && L1.life <= 0 && !L2.det && zones.includes(L2);
    // Borrowed Midnight
    setup('wick', ['midnight']); atDay(); me.face = 0; projs.length = 0; doAttack(me); out.dayPlain = projs.length;
    me.dashes = 1; doDash(me, 0); projs.length = 0; me.tAtk = 0; doAttack(me); out.dayBorrowed = projs.length;
    me.dashes = 1; doDash(me, 0); out.bmT = me.bmT;
    atNight(); me.bmT = 0; projs.length = 0; me.tAtk = 0; doAttack(me); out.nightPlain = [projs.length, projs.some(q => q.home)];
    me.dashes = 1; doDash(me, 0); me.dashes = 1; doDash(me, 0); projs.length = 0; me.tAtk = 0; doAttack(me); out.nightHome = [projs.length, projs.filter(q => q.home).length];
    shoot = _s; return out;
  })()`);
  ok(r.forkHits && r.sparksDay === 2, 'Forked Cinders: first hit throws 2 sparks at other foes');
  ok(r.sparksNight <= 4 && r.sparksNight >= 2, 'Forked Cinders: night volley capped at 4 sparks (' + r.sparksNight + ')');
  ok(r.coven[0] && r.coven[1] === 2, 'Lantern Coven: two charges back to back, no third without recharge');
  ok(r.thread, 'Lantern Coven: the thread between lanterns burns a foe on it');
  ok(r.recharged >= 1 && r.twoMax === 2, 'Lantern Coven: charges recharge; never more than two lanterns (a new one replaces the oldest)');
  ok(r.passage, 'Ember Passage: burning trail hurts foes; an ally crossing gets +25% speed, refreshed not stacked');
  ok(r.const, 'Falling Constellation: last star detonates own lantern only, once');
  ok(r.dayPlain === 1 && r.dayBorrowed === 2 && r.bmT > 4.9, 'Borrowed Midnight: by day Blink gives the extra bolt (refreshing to 5 s)');
  ok(r.nightPlain[0] === 2 && !r.nightPlain[1] && r.nightHome[0] === 2 && r.nightHome[1] === 1, 'Borrowed Midnight: at night Blink makes the extra bolt home, never a third bolt');
}

// ===== Vesper =====
{
  const r = run(`(() => {
    const out = {};
    // Returning Edge: out and back, one hit each way, attacks counted once
    setup('vesper', ['returning']); me.face = 0; const t = foe(1860, 1700);
    for (let i = 0; i < 3; i++) { me.tAtk = 0; doAttack(me); }
    const blade = projs.find(q => q.ret); step(20); const out1 = lost(t); step(25); out.wentBack = blade.back; step(80);
    out.ret = [out1 > 0, lost(t) > out1, !projs.includes(blade), me.combo]; out.hits = [out1, lost(t) - out1];
    // Silken Crossfire
    setup('vesper', ['silk']); me.face = 0; for (let i = 0; i < 4; i++) { me.tSkill = 0; doSkill(me); }
    out.silk = zones.filter(z => z.kind === 'silk' && z.life > 0).length; const s = foe(1900, 1700); s.slowT = 0; step(2); out.slowed = s.slowT > 0;
    // Wingbeat Riposte
    setup('vesper', ['wingbeat']); me.face = 0; foe(1730, 1700, { hp: 1e6 }); me.dashes = 2; doDash(me, 0); step(15);
    out.wb = me.wingbeat; projs.length = 0; me.tAtk = 0; doAttack(me); out.extra = projs.length; projs.length = 0; me.tAtk = 0; doAttack(me); out.extra2 = projs.length; out.combo = me.combo;
    // Total Eclipse
    setup('vesper', ['total']); const fs = [foe(1800, 1700), foe(1700, 1800), foe(1600, 1700)]; me.tUlt = 0; me.level = 6; doUlt(me); step(120);
    out.total = fs.map(lost); out.strikes = 8 - (me.flurry ? me.flurry.left : 0);
    setup('vesper', ['total']); const weak = [foe(1800, 1700, { hp: 1 }), foe(1700, 1800, { hp: 1 })]; doUlt(me); step(120); out.endEarly = !me.flurry && weak.every(e => e.dead);
    // Lunar Rhythm
    setup('vesper', ['lunar']); atNight(); me.dashes = 0; me.dashRe = 2; me.crit = 1; const l = foe(1760, 1700);
    hitEnemy(me, l, 5); hitEnemy(me, l, 5); out.night = me.dashRe; step(70); const before = me.dashRe; me.dashes = 0; hitEnemy(me, l, 5); out.night2 = before - me.dashRe;
    setup('vesper', ['lunar']); atDay(); me.dashes = 1; me.dashRe = 2; me.combo = 0; me.face = 0;
    for (let i = 0; i < 3; i++) { me.tAtk = 0; doAttack(me); } out.day = me.dashRe; me.dashes = 2; me.dashRe = 0; me.lrCd = 0; me.combo = 2; me.tAtk = 0; doAttack(me); out.capped = me.dashes;
    return out;
  })()`);
  ok(r.wentBack && r.ret[0] && r.ret[1] && r.ret[2] && r.ret[3] === 3, 'Returning Edge: blade flies back, hits on the way out and back, then ends; counter unchanged');
  ok(r.hits[1] < r.hits[0], 'Returning Edge: return hit is weaker (' + r.hits.join(' then ') + ')');
  ok(r.silk === 14 && r.slowed, 'Silken Crossfire: trails slow foes; at most 14 at once (' + r.silk + ')');
  ok(r.wb && r.extra === 1 && r.extra2 === 0 && r.combo === 2, 'Wingbeat Riposte: one stored empowered attack throws an extra blade; not counted as an attack');
  ok(r.strikes === 8 && r.total.every(x => x > 0), 'Total Eclipse: 8 strikes across 3 foes (' + r.total.join('/') + ')');
  ok(r.endEarly, 'Total Eclipse: finishes when every foe is dead');
  ok(Math.abs(r.night - 1.5) < 1e-9 && Math.abs(r.night2 - 0.5) < 1e-9, 'Lunar Rhythm: night crits cut Flit recharge 0.5 s, once per second');
  ok(Math.abs(r.day - 1.5) < 1e-9 && r.capped === 2, 'Lunar Rhythm: by day every third attack does; never above two charges');
}

// ===== Rowan =====
{
  const r = run(`(() => {
    const out = {};
    setup('rowan', ['reprisal']); me.face = 0; hurtPlayer(me, 10, { x: 1800, y: 1700 }); out.rep = me.reprisal;
    projs.length = 0; me.tAtk = 0; doAttack(me); out.wave = projs.filter(q => q.kind === 'root').length; me.tAtk = 0; doAttack(me); out.wave2 = projs.filter(q => q.kind === 'root').length;
    setup('rowan', ['grove']); me.dashes = 1; doDash(me, 0); const g = zones.find(z => z.kind === 'shelter'); me.x += 200; step(2); out.grove = [Math.round(g.r), Math.abs(g.x - me.x) < 1];
    // Spreading Roots
    setup('rowan', ['spreading']); const A = foe(1840, 1700), B = foe(2020, 1700), C = foe(2030, 1760), D = foe(2040, 1640);
    me.tSkill = 0; doSkill(me); out.pre = [A.rootT > 0, B.rootT > 0]; killEnemy(A, me);
    const spread = [B, C, D].filter(e => e.rootT > 0); out.spread = spread.length; const unrooted = [B, C, D].find(e => !(e.rootT > 0));
    killEnemy(spread[0], me); out.again = unrooted ? !(unrooted.rootT > 0) : true;
    // Heartwood Bond
    setup('rowan', ['heartwood'], 2); const q = players[1]; q.hp = 20; me.face = 0;
    for (let i = 0; i < 5; i++) { me.iT = 0; hurtPlayer(me, 1, { x: 1800, y: 1700 }); } out.hb = [q.shield, me.hbCd > 7]; q.shield = 0;
    me.iT = 0; hurtPlayer(me, 1, { x: 1800, y: 1700 }); out.hbAgain = q.shield;
    // Ancient Aftergrowth
    setup('rowan', ['aftergrowth']); me.tUlt = 0; doUlt(me); step(60 * 8.2); out.sap = zones.some(z => z.kind === 'sapling');
    me.hp = 50; const h0 = me.hp; step(60); out.healed = me.hp > h0; const dr = zoneDR(me); out.dr = dr;
    setup('rowan', ['aftergrowth']); me.tUlt = 0; doUlt(me); step(30); me.iT = 0; me.embers = 0; hurtPlayer(me, 9999); step(60 * 8); out.sapDown = zones.some(z => z.kind === 'sapling');
    return out;
  })()`);
  ok(r.rep && r.wave === 1 && r.wave2 === 1, 'Thorn Reprisal: a block stores one root wave for the next attack');
  ok(r.grove[0] === 105 && r.grove[1], 'Walking Grove: Shelterwood follows Rowan at 70% radius');
  ok(r.pre[0] && !r.pre[1] && r.spread === 2 && r.again, 'Spreading Roots: a rooted foe dying roots 2 nearby foes, once per cast; spread roots don\'t spread');
  ok(r.hb[0] === 25 && r.hb[1] && r.hbAgain === 0, 'Heartwood Bond: reaching 5 charges shields the wounded ally (25), then 8 s cooldown');
  ok(r.sap && r.healed && r.dr === 0.15, 'Ancient Aftergrowth: sapling after Sentinel ends naturally; heals and gives 15% reduction');
  ok(!r.sapDown, 'Ancient Aftergrowth: no sapling if Rowan goes down during Sentinel');
}

// ===== Mira =====
{
  const r = run(`(() => {
    const out = {};
    setup('mira', ['echoing']); const e = foe(1690, 1760); me.dashes = 1; doDash(me, 0); const d0 = lost(e); step(60); out.echo = lost(e) > d0; out.n = me.decoy && me.decoy.echo ? me.decoy.echo.n : -1;
    setup('mira', ['relay']); me.dashes = 1; doDash(me, 0); step(20); me.tSkill = 0; doSkill(me); out.relay = [!!me.decoy && me.decoy.relay, me.tSkill < 1];
    step(30); me.tSkill = 0; doSkill(me); out.relay2 = [me.decoy, me.decoyOn];
    setup('mira', ['splintered']); const b = foe(1760, 1700); b.aggro = true; b.tgt = { x: 0, y: 0 };
    for (let i = 0; i < 6; i++) hitEnemy(me, b, 5); out.stacks = b.bleed.n; const before = lost(b); step(60); out.bleedDmg = lost(b) > before; out.stacksAfter = b.bleed ? b.bleed.n : 0;
    setup('mira', ['opening']); me.dashes = 1; doDash(me, 0); step(20); const m = foe(me.x, me.y + 60); me.tSkill = 0; doSkill(me);
    out.marked = !!m.mark; m.aggro = false; const x1 = hitEnemy(me, m, 10); m.tgt = me; const x2 = hitEnemy(me, m, 10); out.bonus = [x1, x2, !m.mark];
    setup('mira', ['curtain']); const c = foe(1700, 1745); me.face = 0; me.tUlt = 0; doUlt(me); step(60 * 7.2); out.curtain = lost(c) > 0;
    setup('mira', ['curtain']); const c2 = foe(1700, 1745); me.face = 0; me.tUlt = 0; doUlt(me); game.over = 'win'; nextChapter(); step(60 * 8); out.cleanup = lost(c2) === 0;
    return out;
  })()`);
  ok(r.echo && r.n === 0, 'Echoing Step: the decoy repeats one combo (3 cuts) and stops');
  ok(r.relay[0] && r.relay[1] && r.relay2[0] === null && !r.relay2[1], 'Mirror Relay: one extra reflection, at most two swaps in a row');
  ok(r.stacks === 3 && r.bleedDmg && r.stacksAfter <= 3, 'Splintered Edge: Blind Spot bleed capped at 3 stacks; ticks add none');
  ok(r.marked && r.bonus[0] === 13 && r.bonus[1] === 10 && r.bonus[2], 'Shared Opening: solo Mira\'s next hit on a marked foe +30% once (' + r.bonus.slice(0, 2).join(', ') + ')');
  ok(r.curtain, 'Final Curtain: reflections burst when Hall of Mirrors runs out');
  ok(r.cleanup, 'Final Curtain: no burst when a chapter change clears the ultimate');
}

// ===== Lanternkeeper =====
{
  const r = run(`(() => {
    const out = {};
    setup('vespera', ['wandering']); me.face = 0; const a = foe(1800, 1700), b = foe(1880, 1700), c = foe(1960, 1700); doAttack(me); step(40);
    out.wf = [lost(a), lost(b), lost(c)];
    setup('vespera', ['merciful']); me.hp = 40; me.tSkill = 0; me.aim = { x: me.x, y: me.y }; doSkill(me); const sh = me.shield; step(60 * 6.2); out.merc = [sh, me.hp];
    setup('vespera', ['merciful']); me.hp = 40; me.tSkill = 0; doSkill(me); me.iT = 0; hurtPlayer(me, 999 > me.shield ? me.shield : 0); step(60 * 6.2); out.mercUsed = me.hp;
    setup('vespera', ['succession']); const t = [foe(1900, 1700), foe(1930, 1700), foe(1960, 1700)], extra = foe(1900, 1950), extra2 = foe(1900, 1450);
    me.aim = { x: 1930, y: 1700 }; me.dashes = 1; doDash(me, 0); killEnemy(t[0], me); out.moved = extra.tid > 0 || extra2.tid > 0;
    const left = [extra, extra2].find(e => !e.tid); killEnemy(t[1], me); out.once = !left.tid;
    setup('vespera', ['communion'], 2); const q = players[1]; q.hp = 20; me.hp = 20; me.lan = 10;
    pickups.push({ id: 999, kind: 'lume', x: me.x, y: me.y, val: 6, vx: 0, vy: 0, t: 0, life: 8 }); step(1); out.comm = [me.lan > 10, me.hp > 20, q.hp > 20];
    setup('vespera', ['rprocession']); const f1 = foe(2100, 1700, { hp: 1e7 }); me.aim = { x: 2400, y: 1700 }; me.tUlt = 0; doUlt(me); step(60 * 10.2);
    const back = zones.find(z => z.kind === 'proc' && z.back); out.back = !!back && back.str === 0.5; step(60 * 12); out.done = !zones.some(z => z.kind === 'proc');
    out.hitCap = back ? Math.max(0, ...back.hits.values()) : -1;
    return out;
  })()`);
  ok(r.wf[0] > 0 && r.wf[1] > 0 && r.wf[1] < r.wf[0] && r.wf[2] === 0, 'Wandering Flame: passes through one target, second hit weaker, no third (' + r.wf.join('/') + ')');
  ok(r.merc[1] > 40, 'Merciful Wisp: an unused shield expiring heals the player (shield ' + Math.round(r.merc[0]) + ' -> hp ' + Math.round(r.merc[1]) + ')');
  ok(r.mercUsed === 40, 'Merciful Wisp: a used-up shield heals nothing');
  ok(r.moved && r.once, 'Soul Succession: link passes to a nearby foe once per tether');
  ok(r.comm.every(Boolean), 'Ember Communion: ember restores energy and heals the Lanternkeeper and a nearby ally');
  ok(r.back && r.done && r.hitCap <= 3, 'Returning Procession: one weaker return pass, each foe hit at most 3 times on it (' + r.hitCap + ')');
}

// ===== translations =====
{
  const w = makeWorld({ 'duskbound-lang': 'zh' });
  const miss = vm.runInContext(`(() => { const s = []; for (const h in HERO_TALENTS) for (const t of HERO_TALENTS[h]) { s.push(t.name, t.desc, t.limits, ...t.ab); } s.push('Chapter talent', 'Freed'); return [...new Set(s)].filter(x => T(x) === x); })()`, w);
  ok(miss.length === 0, 'every talent name, ability, description and limit has Chinese' + (miss.length ? ': ' + miss.slice(0, 5).join(' | ') : ''));
  const count = vm.runInContext(`Object.values(HERO_TALENTS).map(l => l.length).join() + ' ' + new Set(Object.values(HERO_TALENTS).flat().map(t => t.id)).size`, w);
  ok(count === '5,5,5,5,5,5 30', 'six heroes x five unique talents (' + count + ')');
}
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
