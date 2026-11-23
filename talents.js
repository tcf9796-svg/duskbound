'use strict';
// Chapter talents (HERO_TALENTS in data.js, earning rule CHAPTER_TALENT in meta.js).
// A player picks ONE of their hero's remaining talents when they have earned a pick; it lasts for the rest of the run.
// Everything here runs on the host (or in solo) and is called from game.js; guests see the results in snapshots.
// Guard rails shared by all effects: talent damage is flagged `proc` (never triggers venom, chain, more talents or
// Soul Tether spreading when also `dot`), crowd control on bosses is scaled by ccScale, and spawned
// projectiles / zones are capped.

const hasT = (p, id) => !!(p && p.ct && p.ct.indexOf(id) >= 0);
const tv = (p, id) => heroTalent(p.hero, id).v;
// Slows and roots last this fraction as long on bosses; arena objects (anchored, hidden or immune) are never affected.
const ccScale = e => e.anchor || e.invuln || e.hidden ? 0 : e.type === 'boss' ? 0.4 : 1;
const TALENT_PROJ_CAP = 200, TALENT_ZONE_CAP = 40;
const projRoom = () => projs.length < TALENT_PROJ_CAP;
const tzones = () => zones.filter(z => z.tal && z.life > 0).length;
const hasteMul = p => p.hasteT > 0 ? p.hasteMul : 1;
// distance from point (px,py) to the segment (x,y)-(x2,y2)
function segD(px, py, x, y, x2, y2) { const dx = x2 - x, dy = y2 - y, l = dx * dx + dy * dy || 1, t = clamp(((px - x) * dx + (py - y) * dy) / l, 0, 1); return Math.hypot(px - x - dx * t, py - y - dy * t); }
function tzone(o) { o.tal = true; o.friendly = true; o.oid = o.owner ? o.owner.id : 0; o.delay = 0; if (tzones() < TALENT_ZONE_CAP) zones.push(o); return o; }

// ---------- picking ----------
const ctEligible = p => (HERO_TALENTS[p.hero] || []).filter(t => p.ct.indexOf(t.id) < 0);
function offerChapterTalent(p) {
  if (p.ctChoice || p.ctPending <= 0) return;
  const list = ctEligible(p); if (!list.length) { p.ctPending = 0; return; } // all five picked this run
  p.ctChoice = list.map(t => t.id); p.ctSeq++;
}
// The host (or solo game) accepts a pick only if it answers the current offer with one of its own eligible talents.
function applyChapterTalent(p, id, seq) {
  const t = heroTalent(p.hero, id);
  if (!t || !p.ctChoice || seq !== p.ctSeq || p.ctChoice.indexOf(id) < 0 || p.ct.indexOf(id) >= 0) return false;
  p.ct.push(id); p.ctPending = Math.max(0, p.ctPending - 1); p.ctChoice = null;
  if (id === 'coven') { p.lanCh = t.v.charges; p.lanRe = 0; }
  sfx('level', null, p.id); banner(t.name, 'Chapter talent', 2.5, p.id);
  return true;
}

// ---------- normal attacks (manual or automatic: both go through doAttack) ----------
// Bramble's Sweep: `hits` are the foes it struck.
function talentSweep(p, hits) {
  if (hasT(p, 'splinter')) { const v = tv(p, 'splinter'); for (const e of hits) if (e.type !== 'boss' && !e.anchor && !e.dead) e.splint = { p, t: v.window, used: false }; }
  if (hasT(p, 'growth') && p.ultT > 0 && hits.length) { const v = tv(p, 'growth'), add = Math.min(v.per, v.max - p.ultExt); if (add > 0) { p.ultT += add; p.ultExt += add; } }
}
// Splintering Impact: a foe knocked by a Sweep explodes once if the knock carries it into a wall or another foe.
// (bx, by): where it moved to before walls pushed it back.
function splinterCheck(e, dt, bx, by) {
  const s = e.splint; if (!s) return;
  if ((s.t -= dt) <= 0 || s.used || e.dead) { e.splint = null; return; }
  if (Math.hypot(e.kbx, e.kby) < 40) return; // only while it is actually being knocked
  const wall = Math.hypot(e.x - bx, e.y - by) > 0.5, other = !wall && enemies.some(q => q !== e && !q.dead && dist(q, e) < q.r + e.r + 2);
  if (!wall && !other) return;
  s.used = true; e.splint = null; const v = tv(s.p, 'splinter');
  ring(e.x, e.y, v.radius, '#9fe08a'); burst(e.x, e.y, '#9fe08a', 12, 220, 3);
  for (const q of enemies) if (!q.dead && dist(q, e) < v.radius + q.r) hitEnemy(s.p, q, s.p.dmg * v.dmg, { proc: true, quiet: true, color: '#9fe08a' });
}
// Wick's Cinder Bolt volley. Returns { bonus, home, fork } for the bolts about to be thrown.
function wickVolley(p) {
  const bonus = night > 0.5 || (hasT(p, 'midnight') && p.bmT > 0) ? 1 : 0; // never more than one extra bolt
  const home = bonus && night > 0.5 && p.bmHome; if (home) p.bmHome = false;
  return { bonus, home, fork: hasT(p, 'forked') ? { sparks: 0 } : null };
}
// Vesper's Twin Cuts, after the combo counter moved: third-cut blade options and day-time Lunar Rhythm.
function vesperCut(p, third) {
  if (hasT(p, 'lunar') && third && night <= 0.5) lunarCut(p);
  if (p.wingbeat) { p.wingbeat = false; if (projRoom()) shoot(p.x, p.y, p.face + 0.12, 780, { owner: p, dmg: p.dmg * tv(p, 'wingbeat').dmg, life: 0.6, pierce: 2, color: '#f0e8ff', kind: 'blade' }); }
}
function lunarCut(p) { if (p.lrCd > 0) return; const v = tv(p, 'lunar'); p.lrCd = v.cd; if (p.dashes < p.dashMax) p.dashRe -= v.cut; }
// Rowan's Briar Thrust: a stored Thorn Reprisal goes out with it.
function rowanThrust(p) {
  if (!p.reprisal) return; p.reprisal = false; const v = tv(p, 'reprisal');
  if (projRoom()) shoot(p.x + Math.cos(p.face) * 20, p.y + Math.sin(p.face) * 20, p.face, v.speed, { owner: p, dmg: p.dmg * v.dmg, life: v.life, r: 14, pierce: 99, color: '#a9c46c', kind: 'root' });
}

// ---------- projectiles ----------
// Before moving: homing bolts and returning blades steer.
function talentProjSteer(q, dt) {
  if (q.back) {
    const o = q.owner; if (!o || o.down) { q.life = 0; return; }
    const a = angTo(q, o), sp = Math.hypot(q.vx, q.vy) || 760; q.vx = Math.cos(a) * sp; q.vy = Math.sin(a) * sp;
    if (dist(q, o) < 26) q.life = 0;
  } else if (q.home) {
    if (!q.tgt || !targetable(q.tgt)) { let b = null, bd = q.home.range; for (const e of enemies) { if (!targetable(e)) continue; const d = dist(e, q); if (d < bd) { bd = d; b = e; } } q.tgt = b; }
    if (q.tgt) { const sp = Math.hypot(q.vx, q.vy), cur = Math.atan2(q.vy, q.vx), na = cur + clamp(angDiff(angTo(q, q.tgt), cur), -q.home.turn * dt, q.home.turn * dt); q.vx = Math.cos(na) * sp; q.vy = Math.sin(na) * sp; }
  }
}
// When a projectile's flight ends (time or a wall): a Returning Edge blade turns back, once.
function talentProjEnd(q) {
  if (!q.ret || q.back || !q.owner) return false;
  const v = tv(q.owner, 'returning'); q.back = true; q.life = 1.4; q.hit = new Set(); q.pierce = 99; q.dmg *= v.dmg;
  const a = angTo(q, q.owner); q.vx = Math.cos(a) * v.speed; q.vy = Math.sin(a) * v.speed; return true;
}
// After a friendly projectile hits e.
function talentProjHit(q, e) {
  if (q.falloff) q.dmg *= q.falloff; // Wandering Flame: weaker after the first target
  if (q.fork && !q.forked) { // Forked Cinders: first impact only; sparks never fork
    q.forked = true; const p = q.owner, v = tv(p, 'forked');
    const near = enemies.filter(o => o !== e && targetable(o) && dist(o, e) < v.range).sort((a, b) => dist(a, e) - dist(b, e));
    for (let i = 0; i < v.n && i < near.length && q.fork.sparks < v.cap && projRoom(); i++) { q.fork.sparks++; shoot(e.x, e.y, angTo(e, near[i]), 560, { owner: p, dmg: p.dmg * v.dmg, life: 0.6, r: 5, color: '#ffd27a', kind: 'fire', hit: new Set([e]) }); }
  }
}

// ---------- skills, dashes, ultimates ----------
// Lantern Coven: is a lantern ready? (charges replace the plain cooldown)
function covenReady(p) { return !hasT(p, 'coven') || p.lanCh > 0; }
function covenUse(p, z) {
  const v = tv(p, 'coven'); p.lanCh--; if (p.lanRe <= 0) p.lanRe = v.recharge * p.cdr;
  p.tSkill = p.lanCh > 0 ? 0.35 : p.lanRe;
  const mine = zones.filter(o => o.lantern && o.owner === p && o.life > 0 && o !== z);
  while (mine.length >= v.charges) mine.shift().life = 0; // a third lantern replaces the oldest
  z.coven = true; z.oid = p.id;
}
function briarTerritory(p, R) { const v = tv(p, 'territory'); tzone({ kind: 'thorns', owner: p, x: p.x, y: p.y, r: R * v.radius, life: v.life, max: v.life, tickT: 0, color: '#7bc96f' }); }
function silkTrails(p, angles) {
  const v = tv(p, 'silk'), mine = zones.filter(z => z.kind === 'silk' && z.owner === p && z.life > 0);
  for (const a of angles) {
    while (mine.length >= v.cap) mine.shift().life = 0;
    mine.push(tzone({ kind: 'silk', owner: p, x: p.x, y: p.y, x2: p.x + Math.cos(a) * v.len, y2: p.y + Math.sin(a) * v.len, r: v.width, life: v.life, max: v.life, color: '#e6dcff' }));
  }
}
// Mira's Mirror Exchange, after the swap: Shared Opening marks, Mirror Relay's second reflection.
function miraExchange(p, z, ox, oy, R) {
  if (hasT(p, 'opening')) { const v = tv(p, 'opening'); for (const e of enemies) if (!e.dead && !e.noDrop && dist(e, { x: ox, y: oy }) < R + e.r) e.mark = { by: p, t: v.time }; }
  if (hasT(p, 'relay') && !z.relay) {
    const v = tv(p, 'relay');
    p.decoy = { kind: 'decoy', dec: true, friendly: true, owner: p, oid: p.id, x: ox, y: oy, r: 15, life: v.life, max: v.life, color: HEROES.mira.color, relay: true };
    zones.push(p.decoy); p.decoyOn = true; p.tSkill = 0.4; burst(ox, oy, '#e8fbff', 10, 160);
  }
}
// Mira's Reflection Step decoy.
function miraDecoy(p, z) { if (hasT(p, 'echoing')) { const v = tv(p, 'echoing'); z.echo = { n: 3, t: v.gap }; } }
// The dash connected with foe e (Bramble's Charge, Vesper's Flit).
function talentDashHit(p, e) {
  if (p.hero === 'bramble' && hasT(p, 'rampart')) { const v = tv(p, 'rampart'); p.shield = Math.max(p.shield, Math.min(v.cap, p.shield + v.per)); p.shieldT = Math.max(p.shieldT, v.time); }
  if (p.hero === 'vesper' && hasT(p, 'wingbeat')) p.wingbeat = true; // stores one
}
// While Bramble charges with Living Rampart: an ally held by a cage or binding is freed on contact.
function rampartFree(p) {
  if (p.hero !== 'bramble' || !hasT(p, 'rampart')) return;
  for (const q of players) if (q !== p && !q.down && dist(p, q) < p.r + q.r + 22) { const cg = cageOn(q); if (cg) { killEnemy(cg, null); floatText(q.x, q.y - 34, 'Freed', '#9fe08a', 15); } }
}
// Wick's Blink from (x0,y0) to where Wick is now.
function wickBlink(p, x0, y0) {
  if (hasT(p, 'passage')) { const v = tv(p, 'passage'); tzone({ kind: 'etrail', owner: p, x: x0, y: y0, x2: p.x, y2: p.y, r: v.width, life: v.life, max: v.life, tickT: 0, color: '#ff9b3d' }); }
  if (hasT(p, 'midnight')) { if (night > 0.5) p.bmHome = true; else p.bmT = tv(p, 'midnight').time; } // refreshes, never stacks
}
// Total Eclipse: 8 strikes while foes remain; a foe already struck takes reduced damage.
function eclipseStart(p) {
  const v = tv(p, 'total'), list = enemies.filter(e => targetable(e) && dist(e, p) < v.range).sort((a, b) => dist(a, p) - dist(b, p)).slice(0, v.strikes);
  if (!list.length) return false;
  p.flurry = { total: true, list, left: v.strikes, struck: new Map(), t: 0 }; return true;
}
function eclipseNext(p) {
  const f = p.flurry, v = tv(p, 'total');
  let e = f.list.find(o => targetable(o) && !f.struck.has(o));
  if (!e) e = enemies.find(o => targetable(o) && !f.struck.has(o) && dist(o, p) < v.range); // a new foe replaces a fallen one
  if (!e) { let best = null, n = 1e9; for (const [o, k] of f.struck) if (targetable(o) && k < n) { n = k; best = o; } e = best; } // revisit
  return e;
}
// An ultimate ran out on its own (never on going down, loading or leaving a chapter).
function talentUltEnd(p) {
  if (p.hero === 'rowan' && hasT(p, 'aftergrowth')) { const v = tv(p, 'aftergrowth'); tzone({ kind: 'sapling', owner: p, x: p.x, y: p.y, r: v.radius, life: v.life, max: v.life, tickT: 0, color: '#9fe08a', dr: v.dr }); ring(p.x, p.y, v.radius, '#9fe08a'); }
  if (p.hero === 'mira' && hasT(p, 'curtain')) {
    const v = tv(p, 'curtain');
    for (const s of mirrorSpots(p)) { ring(s.x, s.y, v.radius, '#e8fbff'); burst(s.x, s.y, '#e8fbff', 16, 260, 4); for (const e of enemies) if (!e.dead && dist(e, s) < v.radius + e.r) hitEnemy(p, e, p.dmg * v.dmg, { proc: true, quiet: true, color: '#bff6ff' }); }
    sfx('shatter', p);
  }
}

// ---------- taking hits, healing, shields ----------
// Rowan blocked a frontal hit; `reached` = this block filled Deep Roots.
function rowanBlock(p, reached) {
  if (hasT(p, 'reprisal')) p.reprisal = true; // stores one
  if (reached && hasT(p, 'heartwood') && p.hbCd <= 0) {
    const v = tv(p, 'heartwood'); p.hbCd = v.cd;
    let t = null, lo = 2; for (const q of players) if (q !== p && !q.down && dist(q, p) < v.range && q.hp / q.maxHp < lo) { lo = q.hp / q.maxHp; t = q; }
    t = t || p; t.shield = Math.max(t.shield, v.shield); t.shieldT = Math.max(t.shieldT, v.time);
    addFx({ kind: 'bolt', x: p.x, y: p.y, x2: t.x, y2: t.y, life: 0.3, max: 0.3, color: '#d8c08a' }); ring(t.x, t.y, 40, '#d8c08a'); sfx('shield', t);
  }
}
// Damage reduction from zones: Shelterwood 35% or an Aftergrowth sapling; the stronger one applies, they never stack.
function zoneDR(p) {
  let dr = inShelter(p) ? 0.35 : 0;
  for (const z of zones) if (z.kind === 'sapling' && z.life > 0 && dist(z, p) < z.r + p.r) dr = Math.max(dr, z.dr);
  return dr;
}
// Guiding Wisp from caster c onto t: Merciful Wisp remembers how much it gave (a replacement starts over).
function wispGiven(c, t, amount) { t.mercy = hasT(c, 'merciful') ? { amt: amount, pct: tv(c, 'merciful').pct } : null; }
function shieldExpired(p) { if (p.mercy && p.shield > 0) heal(p, Math.min(p.shield, p.mercy.amt) * p.mercy.pct); p.mercy = null; }
// Sunseed Reserve: Daybloom's healing at full health tops up a barrier (kept after nightfall, capped).
function sunseed(p, perSec, dt) { if (hasT(p, 'sunseed') && perSec > 0) p.barrier = Math.min(tv(p, 'sunseed').cap, (p.barrier || 0) + perSec * dt); }
// Lingering Light ember collected by p.
function emberCollected(p) {
  if (!hasT(p, 'communion')) return; const v = tv(p, 'communion');
  ring(p.x, p.y, v.radius, '#86f0cf'); for (const q of players) if (!q.down && dist(q, p) < v.radius) heal(q, v.heal + v.healPct * q.maxHp);
}

// ---------- deaths ----------
function talentKill(e) {
  // Spreading Roots: once per Root Snare cast; spread roots don't spread again.
  const c = e.rootCast;
  if (c && !c.spread && e.rootT > 0) {
    c.spread = true; const v = tv(c.p, 'spreading');
    const near = enemies.filter(o => o !== e && targetable(o) && ccScale(o) > 0 && dist(o, e) < v.range).sort((a, b) => dist(a, e) - dist(b, e)).slice(0, v.n);
    for (const o of near) { o.rootT = Math.max(o.rootT || 0, v.time * ccScale(o)); o.rootCast = null; addFx({ kind: 'bolt', x: e.x, y: e.y, x2: o.x, y2: o.y, life: 0.25, max: 0.25, color: '#8a6238' }); }
  }
  // Soul Succession: the link moves to another nearby foe, once per Soul Tether.
  if (e.tid) {
    const g = tethers.find(g => g.id === e.tid);
    if (g && !g.moved && g.t > 0 && g.owner && hasT(g.owner, 'succession')) {
      const v = tv(g.owner, 'succession'), o = enemies.filter(o => o !== e && targetable(o) && !o.tid && dist(o, e) < v.range).sort((a, b) => dist(a, e) - dist(b, e))[0];
      if (o) { g.moved = true; g.list.push(o); o.tid = g.id; ring(o.x, o.y, o.r + 14, '#86f0cf'); addFx({ kind: 'bolt', x: e.x, y: e.y, x2: o.x, y2: o.y, life: 0.25, max: 0.25, color: '#86f0cf' }); }
    }
  }
}

// ---------- per-frame upkeep ----------
function talentPlayerTick(p, dt) {
  if (p.hasteT > 0) p.hasteT -= dt; if (p.bmT > 0) p.bmT -= dt; if (p.lrCd > 0) p.lrCd -= dt; if (p.hbCd > 0) p.hbCd -= dt;
  if (hasT(p, 'coven')) { const v = tv(p, 'coven'); if (p.lanCh < v.charges) { p.lanRe -= dt; if (p.lanRe <= 0) { p.lanCh++; p.lanRe = p.lanCh < v.charges ? v.recharge * p.cdr : 0; p.tSkill = Math.min(p.tSkill, 0); } } }
}
// Bleed and marks on a foe (host).
function talentEnemyTick(e, dt) {
  if (e.mark && (e.mark.t -= dt) <= 0) e.mark = null;
  const b = e.bleed; if (!b) return;
  if ((b.t -= dt) <= 0) { e.bleed = null; return; }
  if ((b.tick -= dt) <= 0) { const v = tv(b.p, 'splintered'); b.tick = v.tick; hitEnemy(b.p, e, Math.max(1, b.p.dmg * v.dmg * b.n), { flat: true, proc: true, dot: true, quiet: true, color: '#ff6b6b' }); }
}
// Blind Spot hit by Mira (direct hits only: bleed ticks can't add stacks).
function blindSpotHit(p, e, o) { if (o.proc || !hasT(p, 'splintered')) return; const v = tv(p, 'splintered'); e.bleed = { p, n: Math.min(v.stacks, (e.bleed ? e.bleed.n : 0) + 1), t: v.time, tick: e.bleed ? e.bleed.tick : v.tick }; }
// Shared Opening: a teammate's (or solo Mira's own) next direct hit on a marked foe; returns the damage multiplier.
function markBonus(p, e, o) { if (!e.mark || o.proc || o.flat || (e.mark.by === p && players.length > 1)) return 1; const b = tv(e.mark.by, 'opening').bonus; e.mark = null; return 1 + b; }

// Talent zones, ticked inside the zone loop of update(); returns true if it handled z.
function talentZone(z, dt) {
  const o = z.owner;
  switch (z.kind) {
    case 'thorns': {
      z.life -= dt; if ((z.tickT -= dt) > 0) return true; const v = tv(o, 'territory'); z.tickT = v.tick;
      for (const e of enemies) if (!e.dead && dist(e, z) < z.r + e.r) { hitEnemy(o, e, o.dmg * v.dmg, { proc: true, quiet: true, color: '#9fe08a' }); e.slowT = Math.max(e.slowT || 0, v.slow * ccScale(e)); }
      return true;
    }
    case 'silk': { z.life -= dt; const v = tv(o, 'silk'); for (const e of enemies) if (!e.dead && segD(e.x, e.y, z.x, z.y, z.x2, z.y2) < z.r + e.r) e.slowT = Math.max(e.slowT || 0, v.slow * ccScale(e)); return true; }
    case 'etrail': {
      z.life -= dt; const v = tv(o, 'passage');
      for (const q of players) if (!q.down && segD(q.x, q.y, z.x, z.y, z.x2, z.y2) < z.r + q.r) { q.hasteT = v.hasteT; q.hasteMul = 1 + v.haste; } // refresh, never stack
      if ((z.tickT -= dt) <= 0) { z.tickT = v.tick; for (const e of enemies) if (!e.dead && segD(e.x, e.y, z.x, z.y, z.x2, z.y2) < z.r + e.r) hitEnemy(o, e, o.dmg * v.dmg, { proc: true, quiet: true, color: '#ff9b3d' }); }
      if (Math.random() < 0.4) { const k = Math.random(); parts.push({ x: z.x + (z.x2 - z.x) * k, y: z.y + (z.y2 - z.y) * k, vx: 0, vy: -40, life: 0.4, max: 0.4, color: '#ff9b3d', size: 3 }); }
      return true;
    }
    case 'sapling': {
      z.life -= dt; if ((z.tickT -= dt) > 0) return true; const v = tv(o, 'aftergrowth'); z.tickT = v.tick;
      for (const q of players) if (!q.down && dist(q, z) < z.r + q.r) heal(q, v.heal + v.healPct * q.maxHp);
      return true;
    }
  }
  return false;
}
// Extra behaviour of existing zones (called for each zone before its normal update).
function talentZonePre(z, dt) {
  const o = z.owner;
  if (z.kind === 'shelter' && z.follow && o) { z.x = o.x; z.y = o.y; } // Walking Grove
  if (z.kind === 'decoy' && z.echo && z.echo.n > 0 && z.life > 0 && o) { // Echoing Step: one copied combo
    if ((z.echo.t -= dt) <= 0) {
      const v = tv(o, 'echoing'); z.echo.t = v.gap; const fin = --z.echo.n === 0;
      let tg = null, bd = v.range; for (const e of enemies) { if (!targetable(e)) continue; const d = dist(e, z); if (d < bd) { bd = d; tg = e; } }
      if (tg) meleeArc(o, fin ? 84 : 72, fin ? 2.2 : 1.4, o.dmg * (fin ? 1.8 : 1) * v.dmg, { from: z, face: angTo(z, tg), proc: true, quiet: true, color: '#9ee7f2' });
    }
  }
  if (z.kind === 'proc' && o && hasT(o, 'rprocession') && !z.back) { // remember the path for the return trip
    const v = tv(o, 'rprocession'); z.path = z.path || [{ x: z.x, y: z.y }];
    if ((z.pathT = (z.pathT || 0) - dt) <= 0) { z.pathT = v.step; if (z.path.length < 120) z.path.push({ x: z.x, y: z.y }); }
  }
}
// A Midnight Procession ran its course: Returning Procession sends it back along its path once.
function procEnded(z) {
  const o = z.owner; if (!o || z.back || z.returned || !z.path || !hasT(o, 'rprocession')) return;
  z.returned = true; const v = tv(o, 'rprocession'), path = z.path.slice().reverse(), life = path.length * v.step + 0.5;
  zones.push({ kind: 'proc', friendly: true, owner: o, oid: o.id, back: true, path, x: z.x, y: z.y, r: z.r, delay: 0, life, max: life, vx: 0, vy: 0, tickT: 0, color: z.color, str: v.str, hits: new Map(), hitCap: v.hits });
}
// Movement of a returning procession (it follows its recorded path instead of hunting).
function procBackStep(z, dt) {
  const n = z.path[0]; if (!n) { z.vx = z.vy = 0; return; }
  const d = dist(z, n), sp = 260; if (d < 12) { z.path.shift(); return; }
  z.vx = (n.x - z.x) / d * sp; z.vy = (n.y - z.y) / d * sp;
}
// Lantern Coven's burning threads, once per frame.
function covenThreads(dt) {
  for (const p of players) {
    if (!hasT(p, 'coven')) continue; const v = tv(p, 'coven');
    const L2 = zones.filter(z => z.lantern && z.owner === p && z.life > 0 && z.delay <= 0); if (L2.length < 2) continue;
    const [a, b] = L2; if (dist(a, b) > v.maxLen) continue;
    if ((p.threadT = (p.threadT || 0) - dt) > 0) continue; p.threadT = v.tick;
    for (const e of enemies) if (!e.dead && segD(e.x, e.y, a.x, a.y, b.x, b.y) < v.width + e.r) hitEnemy(p, e, p.dmg * v.dmg, { proc: true, quiet: true, color: '#ffb347' });
  }
}
// Falling Constellation: Cinderfall's final star z detonates the caster's lanterns inside the ultimate's area.
function constellation(z) {
  const p = z.owner; if (!z.final || !p || !hasT(p, 'constellation')) return; const v = tv(p, 'constellation');
  for (const l of zones) if (l.lantern && l.owner === p && l.life > 0 && !l.det && Math.hypot(l.x - z.cx, l.y - z.cy) < v.reach) {
    l.det = true; l.life = 0; ring(l.x, l.y, l.r, '#ffd27a'); burst(l.x, l.y, '#ffd27a', 26, 340, 5); sfx('boom', l);
    for (const e of enemies) if (!e.dead && dist(e, l) < l.r + e.r) hitEnemy(p, e, p.dmg * v.dmg, { proc: true, kb: 160, color: '#ffd27a' });
  }
}

// ---------- drawing (host and guests) ----------
function drawTalentZone(c, z) {
  const a = clamp(z.life / 0.5, 0, 1);
  if (z.kind === 'thorns') {
    c.globalAlpha = 0.16 * a; circ(c, z.x, z.y, z.r, '#7bc96f'); c.globalAlpha = 0.7 * a; c.fillStyle = '#5d8a3f';
    for (let i = 0; i < 14; i++) { const q = i * 2.39996, d = z.r * Math.sqrt((i + 0.5) / 14), x = z.x + Math.cos(q) * d, y = z.y + Math.sin(q) * d; c.beginPath(); c.moveTo(x - 4, y + 3); c.lineTo(x, y - 7); c.lineTo(x + 4, y + 3); c.fill(); }
  } else if (z.kind === 'silk' || z.kind === 'etrail') {
    c.globalAlpha = (z.kind === 'silk' ? 0.45 : 0.6) * a; c.strokeStyle = z.kind === 'silk' ? '#efe8ff' : '#ff9b3d'; c.lineWidth = z.kind === 'silk' ? 2 : z.r * 0.8; c.lineCap = 'round';
    c.beginPath(); c.moveTo(z.x, z.y); c.lineTo(z.x2, z.y2); c.stroke();
  } else if (z.kind === 'sapling') {
    c.globalAlpha = 0.16 * a; circ(c, z.x, z.y, z.r, '#9fe08a'); c.globalAlpha = a; c.fillStyle = '#5d4023'; c.fillRect(z.x - 2, z.y - 14, 4, 16); ell(c, z.x, z.y - 18, 10, 8, '#7da353'); ell(c, z.x + 6, z.y - 22, 6, 5, '#a9c46c');
  }
  c.globalAlpha = 1;
}
// Burning threads between a Coven caster's two lanterns.
function drawThreads(c) {
  const by = {}; for (const z of zones) if (z.lantern && z.coven && z.life > 0) (by[z.oid] = by[z.oid] || []).push(z);
  c.strokeStyle = '#ffb347'; c.lineWidth = 3; c.globalAlpha = 0.6 + Math.sin(game.t * 9) * 0.2;
  for (const k in by) { const l = by[k]; if (l.length < 2) continue; c.beginPath(); c.moveTo(l[0].x, l[0].y - 8); c.lineTo(l[1].x, l[1].y - 8); c.stroke(); }
  c.globalAlpha = 1;
}
const TALENT_ZONES = new Set(['thorns', 'silk', 'etrail', 'sapling']);
