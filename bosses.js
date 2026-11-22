'use strict';
// Chapter bosses: one per chapter, each a scripted encounter built from shared pieces:
//  - hazards: telegraphed shapes (warning outline first, solid when they deal damage), simulated on the host and
//    mirrored to guests in snapshots (field X), capped at HAZARD_CAP;
//  - summons: arena objects that are ordinary enemies (so hits, health bars and sync work), never drop loot and never
//    end the chapter: saplings, tide orbs, whirlpool cores, pillars, decoy bodies, thunder masks, cages, rods, braziers;
//  - a script runner: each attack is a list of timed steps, followed by a recovery window (boss vulnerable).
// Balance lives in BOSSES below. Boss numbers are final for the chapter: the generic chapter / time-of-day enemy
// multipliers do NOT apply to bosses; difficulty (DIFFICULTIES) and party size (PARTY_SCALE) apply once, at spawn.

// ---------- CONFIG ----------
const HAZARD_CAP = 60;          // most hazards alive at once (older finished ones go first)
const BOSS_ARENA_R = 620;       // walls / tsunami / petals are laid out inside this radius around the arena centre
const BOSS_PHASE2 = 0.5;        // health fraction where phase 2 starts (once)
const BOSS_VULN = 1.25;         // damage taken during recovery windows
// Initial values, sized against the heroes (95–170 HP, 30–40 base DPS at level 1, roughly 2–4x by chapters 1–5 from
// levels and boons). hp: total health solo on Normal; dmg: base hit (attacks use multiples of it); spd: move speed;
// gap: pause between attacks [min, max] s (phase 2 uses gap x 0.75); rec: recovery after an attack (s).
const BOSSES = [
  { id: 'elderoot', element: 'Forest', name: 'Elderoot', title: 'Guardian of the Forest', hp: 2200, dmg: 22, spd: 90, r: 52, gap: [1.8, 2.6], rec: 1.8, color: '#8fd16b',
    phase2: 'Ancient Growth', sapling: { hp: 70, n: 3, maxAlive: 4, every: 18, heal: 0.012, healCap: 0.2, armorBase: 0.15, armorPer: 0.1 } },
  { id: 'poseidon', element: 'Water', name: 'Poseidon', title: 'Sovereign of the Tides', hp: 3400, dmg: 26, spd: 105, r: 50, gap: [1.6, 2.3], rec: 1.5, color: '#5fc8ff',
    phase2: 'Avatar of the Deep', orb: { hp: 90, n: 3, every: 28, armorPer: 0.15 }, collapse: 5 },
  { id: 'gorath', element: 'Earth', name: 'Gorath', title: 'the Shifting Colossus', hp: 4600, dmg: 31, spd: 95, r: 58, gap: [1.4, 2.1], rec: 1.4, color: '#d9b26a',
    phase2: 'The Colossus Splits', armor: 0.45, pillar: { n: 4, min: 2, respawn: 10 }, breakT: 7, split: { n: 3, every: 30, take: 0.15, maxT: 18 } },
  { id: 'raivolt', element: 'Lightning', name: 'Raivolt', title: 'the Storm Sovereign', hp: 6000, dmg: 35, spd: 120, r: 54, gap: [1.2, 1.8], rec: 1.1, color: '#b98cff',
    phase2: 'The Masks Take Flight', rods: 3, mask: { hp: 0.07, n: 3, armorPer: 0.2, beamEvery: 2.6, maxBeams: 2 } },
  { id: 'nezha', element: 'Fire', name: 'Nezha', title: 'the Blazing Lotus Prince', hp: 8000, dmg: 40, spd: 150, r: 44, gap: [1.0, 1.5], rec: 1.3, color: '#ff7a3d',
    phase2: 'Lotus Ascension', braziers: 4, relight: 15 }
];
const bossCfg = ch => BOSSES[Math.max(0, Math.min(BOSSES.length - 1, (ch || 1) - 1))];

// ---------- hazards ----------
// Fields: k kind, x/y origin, a angle, r radius/length, w width or half-angle, tel warning time left, tmax, act active
// time left, dmg, s progress, g gaps, n count, col colour, id. Damage only while active (after the warning).
let hazards = [];
let hzId = 1;
const HZK = ['circ', 'line', 'cone', 'shock', 'wall', 'trail', 'beam', 'petal', 'vortex', 'safe', 'tsunami', 'ringp', 'mark', 'runner'];
function addHz(h) {
  if (hazards.length >= HAZARD_CAP) { const i = hazards.findIndex(z => z.tel <= 0); hazards.splice(i >= 0 ? i : 0, 1); }
  h.id = hzId++; h.tmax = h.tel = h.tel || 0; h.act = h.act || 0; h.s = h.s || 0; h.hit = new Set(); h.cd = new Map(); hazards.push(h); return h;
}
const segDist = (px, py, x, y, a, len) => { const ux = Math.cos(a), uy = Math.sin(a), t = clamp((px - x) * ux + (py - y) * uy, 0, len); return Math.hypot(px - (x + ux * t), py - (y + uy * t)); };
const sheltered = p => enemies.some(e => !e.dead && e.type === 'rod' && dist(e, p) < 90);
const onSafe = p => hazards.some(h => h.k === 'safe' && dist(h, p) < h.r);
// Is player p inside the damaging part of hazard h right now?
function hzTouch(h, p) {
  const R = p.r;
  switch (h.k) {
    case 'circ': case 'mark': return dist(h, p) < h.r + R * 0.5;
    case 'line': case 'trail': return segDist(p.x, p.y, h.x, h.y, h.a, h.r) < h.w + R * 0.5;
    case 'cone': case 'petal': { const d = dist(h, p); return d < h.r && d > (h.r0 || 0) && Math.abs(angDiff(angTo(h, p), h.a)) < h.w; }
    case 'shock': { const d = dist(h, p), rr = h.r0 + h.s; if (Math.abs(d - rr) > h.w + R * 0.4) return false; const a = angTo(h, p); return !h.g.some(g => Math.abs(angDiff(a, g)) < h.gw); }
    case 'wall': { // a wall crossing the arena along direction h.a; gaps (in -R..R along the wall) are safe
      const ux = Math.cos(h.a), uy = Math.sin(h.a), along = (p.x - h.x) * ux + (p.y - h.y) * uy, side = -(p.x - h.x) * uy + (p.y - h.y) * ux;
      if (Math.abs(along - h.s) > h.w + R * 0.4 || Math.abs(side) > BOSS_ARENA_R + 60) return false; return !h.g.some(g => Math.abs(side - g) < h.gw);
    }
    case 'beam': for (let i = 0; i < h.n; i++) if (segDist(p.x, p.y, h.x, h.y, h.a + i * TAU / h.n, h.r) < h.w + R * 0.4) return true; return false;
    case 'vortex': return dist(h, p) < 60;
    case 'ringp': return dist({ x: h.px, y: h.py }, p) < h.w + R * 0.5;
    case 'runner': return dist({ x: h.x + Math.cos(h.a) * h.s, y: h.y + Math.sin(h.a) * h.s }, p) < h.w + R * 0.5;
    case 'tsunami': return dist(h, p) < h.r + 300 && !onSafe(p);
  }
  return false;
}
// Advance a hazard. sim = host (deals damage); guests call it with sim = false to keep motion smooth between snapshots.
function hzStep(h, dt, sim) {
  if (h.tel > 0) { h.tel -= dt; if (h.tel > 0) return; if (sim && h.onStart) h.onStart(h); }
  if (h.k === 'shock') h.s += h.v * dt;
  else if (h.k === 'wall') h.s += h.v * dt;
  else if (h.k === 'beam') { h.a += h.v * dt; if (h.follow) { const b = enemies.find(e => e.id === h.follow); if (b) { h.x = b.x; h.y = b.y; } } }
  else if (h.k === 'runner') h.s = Math.min(h.r, h.s + h.v * dt);
  else if (h.k === 'ringp') { // out to h.r, then back to its owner
    if (!h.back) { h.s += h.v * dt; if (h.s >= h.r) { h.back = true; h.hit.clear(); } h.px = h.x + Math.cos(h.a) * h.s; h.py = h.y + Math.sin(h.a) * h.s; }
    else { const b = enemies.find(e => e.id === h.follow) || h; const a = Math.atan2(b.y - h.py, b.x - h.px), d = Math.hypot(b.x - h.px, b.y - h.py); const m = Math.min(d, h.v * dt); h.px += Math.cos(a) * m; h.py += Math.sin(a) * m; if (d < 30) h.act = 0; }
  }
  h.act -= dt;
  if (!sim) return;
  const once = h.k !== 'trail' && h.k !== 'beam' && h.k !== 'vortex';
  for (const p of players) {
    if (p.down || !h.dmg || !hzTouch(h, p)) continue;
    if ((h.k === 'mark') && sheltered(p)) continue;
    if (once) { if (h.hit.has(p.id)) continue; h.hit.add(p.id); }
    else { const t = h.cd.get(p.id) || 0; if (game.t < t) continue; h.cd.set(p.id, game.t + (h.k === 'vortex' ? 0.5 : 0.45)); }
    hurtPlayer(p, h.dmg, { x: h.x, y: h.y });
    if (h.onHit) h.onHit(h, p);
  }
}
function updHazards(dt, sim) {
  for (const h of hazards) hzStep(h, dt, sim);
  hazards = hazards.filter(h => h.tel > 0 || h.act > 0);
}
// what guests get (and how they rebuild it)
const hzSnap = h => [h.id, HZK.indexOf(h.k), h.x | 0, h.y | 0, r2(h.a || 0), h.r | 0, r2(h.w || 0), r2(Math.max(0, h.tel)), r2(h.tmax), r2(Math.max(0, h.act)), r1(h.s || 0), h.v ? r2(h.v) : 0, h.n || 0, h.g ? h.g.map(r2) : 0, r2(h.gw || 0), h.r0 | 0, h.col || 0, h.px | 0, h.py | 0, h.back ? 1 : 0, h.follow || 0];
function hzFromSnap(a) { return { id: a[0], k: HZK[a[1]], x: a[2], y: a[3], a: a[4], r: a[5], w: a[6], tel: a[7], tmax: a[8], act: a[9], s: a[10], v: a[11], n: a[12], g: a[13] || [], gw: a[14], r0: a[15], col: a[16], px: a[17], py: a[18], back: !!a[19], follow: a[20], hit: new Set(), cd: new Map() }; }

// ---------- local effects for the player on this device (guests own their movement) ----------
function cageOn(p) { return enemies.find(e => !e.dead && (e.type === 'cage' || e.type === 'bind') && Math.hypot(e.x - p.x, e.y - p.y) < 26); }
function bossLocalMove(p, dt) {
  if (p.down) return;
  const cg = cageOn(p);
  if (cg && cg.type === 'cage') { p.x = cg.x; p.y = cg.y; p.dashT = 0; return; } // held in place until it breaks
  for (const h of hazards) if (h.k === 'vortex' && h.tel <= 0) { // pulled toward the whirlpool
    const d = dist(h, p); if (d > 6 && d < h.r) { const a = angTo(p, h), f = 95 * dt; p.x += Math.cos(a) * f; p.y += Math.sin(a) * f; }
  }
}
const bindSlow = p => { const cg = cageOn(p); return cg && cg.type === 'bind' ? 0.45 : 1; };

// ---------- spawning ----------
function bossHp(base) { return base * DIFF(game.diff).hp * partyMul(PARTY_SCALE.hpPerExtra); }
function spawnSummon(type, x, y, hp, o = {}) {
  const e = spawnEnemy(type, x, y);
  e.hp = e.maxHp = hp; e.aggro = true; e.noDrop = true; e.summon = true; e.xp = 0; Object.assign(e, o); return e;
}
function arenaPoint(cx, cy, minR, maxR) { for (let k = 0; k < 30; k++) { const a = rand(TAU), d = rand(minR, maxR), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d; if (x > 80 && y > 80 && x < world.S - 80 && y < world.S - 80) return { x, y }; } return { x: cx, y: cy }; }
// Called by spawnBoss: builds this chapter's boss at (x, y).
function makeBoss(e) {
  const C = bossCfg(game.chapter);
  e.cfg = C; e.bossId = C.id; e.r = C.r; e.spd = C.spd;
  e.hp = e.maxHp = bossHp(C.hp);
  e.dmg = C.dmg * DIFF(game.diff).dmg * partyMul(PARTY_SCALE.dmgPerExtra);
  e.phase = 1; e.armor = C.armor || 0; e.state = 'chase'; e.t = 2.5; e.script = null; e.last = '';
  e.healed = 0; e.waves = 0; e.lastSum = 0; e.breakT = 0; e.hidden = false;
  game.arena = { x: e.x, y: e.y };
  const A = game.arena;
  if (C.id === 'gorath') for (let i = 0; i < C.pillar.n; i++) { const q = arenaPoint(A.x, A.y, 180, 420); spawnSummon('pillar', q.x, q.y, 1, { invuln: true, anchor: true }); }
  if (C.id === 'raivolt') for (let i = 0; i < C.rods; i++) { const a = i * TAU / C.rods + 0.5, q = { x: A.x + Math.cos(a) * 300, y: A.y + Math.sin(a) * 300 }; spawnSummon('rod', q.x, q.y, 1, { invuln: true, anchor: true }); }
  if (C.id === 'nezha') for (let i = 0; i < C.braziers; i++) { const a = i * TAU / C.braziers + 0.78, q = { x: A.x + Math.cos(a) * 330, y: A.y + Math.sin(a) * 330 }; spawnSummon('brazier', q.x, q.y, 1, { invuln: true, anchor: true, lit: true }); }
  if (C.id === 'poseidon') spawnOrbs(e);
}
function spawnOrbs(b) { const C = b.cfg, A = game.arena; const have = enemies.filter(e => !e.dead && e.type === 'orb').length; for (let i = have; i < C.orb.n; i++) { const q = arenaPoint(A.x, A.y, 220, 480); spawnSummon('orb', q.x, q.y, bossHp(C.orb.hp) / DIFF(game.diff).hp); } }
const summonsOf = t => enemies.filter(e => !e.dead && e.type === t);

// ---------- attacks ----------
// Each returns a script: [[time, fn], ...]; when the last step has run, the boss recovers for cfg.rec seconds.
// D = base damage; tg = target player; b = boss.
function atk(b, name, tg) {
  const D = b.dmg, A = game.arena, P2 = b.phase === 2, col = b.cfg.color, at = () => angTo(b, tg);
  switch (name) {
    // ----- Elderoot
    case 'hammer': return [[0, () => { b.face = at(); addHz({ k: 'circ', x: b.x + Math.cos(b.face) * 70, y: b.y + Math.sin(b.face) * 70, r: 120, tel: 0.9, act: 0.1, dmg: D * 1.3, col: 1 }); b.arms = 1; }],
      [0.9, () => { sfx('boom', b); shake(8, b); for (let i = 0; i < (P2 ? 2 : 1); i++) addHz({ k: 'shock', x: b.x, y: b.y, r0: 110, s: 0, v: 240, w: 16, tel: 0.6 + i * 0.9, act: 1.6, dmg: D * 0.8, g: (o => [0, 1, 2].map(j => o + j * TAU / 3))(rand(TAU)), gw: 0.38, col: 1 }); b.arms = 0; }], [1.0, () => { }]];
    case 'roots': return [[0, () => { const n = P2 ? 3 : 2; for (let i = 0; i < n; i++) { const q = alive()[i % alive().length] || tg; const a = angTo(b, q) + (i - (n - 1) / 2) * 0.35; addHz({ k: 'runner', x: b.x, y: b.y, a, r: 620, w: 34, s: 0, v: 300, tel: 1.0, act: 3.2, dmg: D * 0.9, col: 1 }); } }], [1.2, () => { }]];
    case 'prison': return [[0, () => { addHz({ k: 'circ', x: tg.x, y: tg.y, r: 46, tel: 1.1, act: 0.1, dmg: D * 0.4, col: 1, onHit: (h, p) => { if (!cageOn(p)) spawnSummon('cage', p.x, p.y, 60 * DIFF(game.diff).hp, { life: 4.2, holds: p.id }); } }); }], [1.2, () => { }]];
    case 'thorns': return [[0, () => { b.face = at(); addHz({ k: 'cone', x: b.x, y: b.y, a: b.face, r: 560, w: 0.55, tel: 0.7, act: 0, col: 1 }); }],
      [0.7, () => { const n = P2 ? 9 : 7; for (let i = 0; i < n; i++) shoot(b.x, b.y, b.face + (i - (n - 1) / 2) * 0.13, 330, { friendly: false, dmg: D * 0.6, life: 1.8, r: 8, color: '#c99a5b', kind: 'spit' }); sfx('spit', b); }], [0.9, () => { }]];
    // ----- Poseidon
    case 'trident': return [[0, () => thrust(b, tg, D, 0)], [0.55, () => thrust(b, tg, D, 0)], [1.1, () => thrust(b, tg, D, 0)],
      [1.6, () => { b.face = at(); addHz({ k: 'cone', x: b.x, y: b.y, a: b.face, r: 430, r0: 0, w: 0.6, tel: 0.8, act: 0.12, dmg: D * 1.1, col: 2 }); }], [2.5, () => { }]];
    case 'tidal': { const dir = (b.tideDir = (b.tideDir || 0) + 1) % 2 ? 0 : Math.PI, ax = rand(-0.4, 0.4);
      return [[0, () => { for (let i = 0; i < (P2 ? 2 : 1); i++) { const a = dir + ax + i * Math.PI; addHz({ k: 'wall', x: A.x, y: A.y, a, s: -BOSS_ARENA_R, v: 260, w: 26, tel: 1.3 + i * 1.6, act: 2 * BOSS_ARENA_R / 260, dmg: D * 1.0, g: [rand(-380, 380)], gw: 95, col: 2 }); } sfx('warn', b); }], [1.5, () => { }]]; }
    case 'whirlpool': return [[0, () => { const q = { x: tg.x + rand(-60, 60), y: tg.y + rand(-60, 60) }; const core = spawnSummon('vcore', q.x, q.y, 110 * DIFF(game.diff).hp, { life: 7 }); addHz({ k: 'vortex', x: q.x, y: q.y, r: 280, tel: 0.8, act: 7, dmg: D * 0.35, core: core.id, col: 2 }); }], [1.0, () => { }]];
    case 'judgment': return [[0, () => { // raised platforms appear near every player first; then the tsunami
      for (const q of alive()) { const s = arenaPoint(q.x, q.y, 90, 200); addHz({ k: 'safe', x: s.x, y: s.y, r: 75, tel: 0, act: 4.6, col: 2 }); }
      addHz({ k: 'tsunami', x: A.x, y: A.y, a: 0, r: BOSS_ARENA_R, tel: 3.6, act: 0.15, dmg: D * 2.2, col: 2, onStart: () => { b.armorDown = b.cfg.collapse; sfx('boom', b); shake(12); } }); sfx('warn', b); }], [3.9, () => { }]];
    case 'seahorse': return [[0, () => { for (let i = 0; i < 2; i++) { const q = alive()[i % alive().length] || tg, a = rand(TAU), sx = q.x - Math.cos(a) * 520, sy = q.y - Math.sin(a) * 520; addHz({ k: 'runner', x: sx, y: sy, a, r: 1040, w: 40, s: 0, v: 620, tel: 1.0 + i * 0.5, act: 1.8, dmg: D * 0.9, col: 2 }); } }], [1.3, () => { }]];
    // ----- Gorath
    case 'boulders': return [[0, () => { const n = P2 ? 6 : 4; for (let i = 0; i < n; i++) { const q = alive()[i % alive().length] || tg, d = i < alive().length ? 0 : rand(60, 200), a = rand(TAU); addHz({ k: 'circ', x: q.x + Math.cos(a) * d, y: q.y + Math.sin(a) * d, r: 80, tel: 1.1 + i * 0.12, act: 0.1, dmg: D * 1.0, col: 3, onStart: h => { burst(h.x, h.y, '#b08a50', 14, 260, 5); sfx('boom', h); } }); } }], [1.6, () => { }]];
    case 'seismic': return [[0, () => fissures(b, D, 0)], [1.3, () => fissures(b, D, Math.PI / 4)], [2.2, () => { }]];
    case 'charge': return [[0, () => { b.face = at(); addHz({ k: 'line', x: b.x, y: b.y, a: b.face, r: 640, w: b.r, tel: 1.0, act: 0, col: 3 }); b.stateHint = 'wind'; }],
      [1.0, () => { b.dash = { a: b.face, v: 640, t: 1.0, dmg: D * 1.3, hit: new Set(), crash: 'pillar' }; sfx('dash', b); }], [2.1, () => { }]];
    // ----- Raivolt
    case 'sweep': return [[0, () => { addHz({ k: 'beam', x: b.x, y: b.y, a: rand(TAU), r: 520, w: 22, n: 3, v: (Math.random() < 0.5 ? 1 : -1) * (P2 ? 0.58 : 0.45), tel: 1.2, act: 3.2, dmg: D * 0.7, follow: b.id, col: 4 }); b.still = 4.4; }], [4.5, () => { }]];
    case 'marks': return [[0, () => { for (const q of alive()) for (let i = 0; i < (P2 ? 2 : 1); i++) { const a = rand(TAU), d = i ? rand(90, 160) : 0; addHz({ k: 'mark', x: q.x + Math.cos(a) * d, y: q.y + Math.sin(a) * d, r: 72, tel: 1.1 + i * 0.4, act: 0.1, dmg: D * 1.0, col: 4, onStart: h => { addFx({ kind: 'bolt', x: h.x, y: h.y - 400, x2: h.x, y2: h.y, life: 0.2, max: 0.2, color: '#e4d4ff' }); sfx('crit', h); } }); } }], [1.8, () => { }]];
    case 'chain': return [[0, () => { // strike the marked player's spot; it jumps to anyone within 230 of a struck player (spread out!)
      addHz({ k: 'mark', x: tg.x, y: tg.y, r: 64, tel: 1.2, act: 0.1, dmg: D * 0.9, col: 4, chain: 230, onHit: (h, p) => { for (const q of players) if (q !== p && !q.down && !h.hit.has(q.id) && dist(q, p) < h.chain && !sheltered(q)) { h.hit.add(q.id); addFx({ kind: 'bolt', x: p.x, y: p.y, x2: q.x, y2: q.y, life: 0.2, max: 0.2, color: '#e4d4ff' }); hurtPlayer(q, h.dmg * 0.8, p); } } }); }], [1.5, () => { }]];
    // ----- Nezha
    case 'spear': { const n = P2 ? 4 : 3; const s = []; for (let i = 0; i < n; i++) s.push([i * 0.5, () => thrust(b, tg, D * 0.8, 1, 0.42)]); s.push([n * 0.5 + 0.1, () => { addHz({ k: 'circ', x: b.x, y: b.y, r: 140, tel: 0.9, act: 0.1, dmg: D * 1.2, col: 5 }); if (P2) ringThrow(b, tg, D); }]); s.push([n * 0.5 + 1.15, () => { }]); return s; }
    case 'wheels': return [[0, () => { b.face = at(); addHz({ k: 'line', x: b.x, y: b.y, a: b.face, r: 600, w: b.r, tel: 0.8, act: 0, col: 5 }); }],
      [0.8, () => { b.dash = { a: b.face, v: 760, t: 0.8, dmg: D * 1.1, hit: new Set(), crash: 'brazier', trail: true }; sfx('dash', b); }], [1.8, () => { }]];
    case 'ring': return [[0, () => ringThrow(b, tg, D)], [1.9, () => { }]];
    case 'sash': return [[0, () => { b.face = at(); addHz({ k: 'cone', x: b.x, y: b.y, a: b.face, r: 340, w: 1.0, tel: 0.85, act: 0.12, dmg: D * 0.6, col: 5, onHit: (h, p) => { if (!cageOn(p)) spawnSummon('bind', p.x, p.y, 45 * DIFF(game.diff).hp, { life: 3.5, holds: p.id }); } }); }], [1.2, () => { }]];
    case 'lotus': { const N = 8, safe0 = randi(0, N - 1), s = [];
      for (let w = 0; w < (P2 ? 4 : 3); w++) s.push([w * 1.25, () => { const safe = (safe0 + w) % N; for (let i = 0; i < N; i++) if (i !== safe) addHz({ k: 'petal', x: b.x, y: b.y, a: i * TAU / N, r: 460, r0: 40, w: TAU / N / 2, tel: 1.0, act: 0.15, dmg: D * 1.0, col: 5 }); }]);
      s.push([(P2 ? 4 : 3) * 1.25 + 0.4, () => { }]); b.still = (P2 ? 4 : 3) * 1.25 + 1.2; return s; }
  }
  return [[0, () => { }]];
}
function thrust(b, tg, D, col, tel = 0.48) { b.face = angTo(b, tg); addHz({ k: 'line', x: b.x, y: b.y, a: b.face, r: 300, w: 26, tel, act: 0.12, dmg: D, col: col ? 5 : 2 }); }
function fissures(b, D, off) { for (let i = 0; i < 4; i++) addHz({ k: 'line', x: b.x, y: b.y, a: off + i * Math.PI / 2, r: 600, w: 30, tel: 0.9, act: 0.15, dmg: D * 0.9, col: 3 }); shake(4, b); }
function ringThrow(b, tg, D) { const a = angTo(b, tg); addHz({ k: 'line', x: b.x, y: b.y, a, r: 520, w: 30, tel: 0.7, act: 0, col: 5 }); addHz({ k: 'ringp', x: b.x, y: b.y, a, r: 520, w: 30, s: 0, v: 520, tel: 0.7, act: 4, dmg: D * 0.8, px: b.x, py: b.y, follow: b.id, col: 5 }); }
// Shown above the boss when an attack starts (readability, and the names from the design).
const ATK_NAMES = { hammer: 'Branch Hammer', roots: 'Root Pursuit', prison: 'Vine Prison', thorns: 'Thorn Volley', trident: 'Trident Breaker', tidal: 'Tidal Crossing', whirlpool: 'Whirlpool Prison',
  judgment: "Ocean's Judgment", seahorse: 'Sea-horse Charge', boulders: 'Boulder Throw', seismic: 'Seismic Slam', charge: 'Colossus Charge', sweep: 'Storm Sweep', marks: 'Lightning Mark', chain: 'Chain Lightning',
  spear: 'Fire-Tipped Spear', wheels: 'Wind-Fire Wheels', ring: 'Universe Ring', sash: 'Red Sash', lotus: 'Blazing Lotus' };
const ATTACKS = {
  elderoot: [['hammer', 'roots', 'prison', 'thorns'], ['hammer', 'roots', 'prison', 'thorns', 'hammer']],
  poseidon: [['trident', 'tidal', 'whirlpool', 'judgment'], ['trident', 'tidal', 'whirlpool', 'judgment', 'seahorse', 'seahorse']],
  gorath: [['boulders', 'seismic', 'charge', 'charge'], ['boulders', 'seismic', 'charge']],
  raivolt: [['sweep', 'marks', 'chain'], ['sweep', 'marks', 'chain', 'marks']],
  nezha: [['spear', 'wheels', 'ring', 'sash', 'lotus'], ['spear', 'wheels', 'ring', 'sash', 'lotus', 'wheels']]
};

// ---------- the boss brain (host only) ----------
// Returns [mx, my] movement for this frame.
function bossThink(e, dt, p) {
  const C = e.cfg || (makeBoss(e), e.cfg);
  let mx = 0, my = 0;
  if (e.armorDown > 0) e.armorDown -= dt; if (e.breakT > 0) e.breakT -= dt; if (e.still > 0) e.still -= dt;
  e.vuln = e.state === 'b_rec'; if (e.face !== undefined) e.a = e.face;
  bossArmor(e);
  // phase 2, exactly once
  if (e.phase === 1 && e.hp < e.maxHp * BOSS_PHASE2) {
    e.phase = 2; e.script = null; e.dash = null; e.state = 'b_tel'; e.t = 1.6; e.invuln = true; e.r = C.r * 1.15;
    banner(C.phase2, C.name, 2.6); sfx('boss', e); shake(12, e); ring(e.x, e.y, 200, C.color);
    if (C.id === 'elderoot') e.lastSum = -99;
    if (C.id === 'poseidon') spawnOrbs(e);
    if (C.id === 'gorath') e.splitAt = 0;
    if (C.id === 'raivolt') for (let i = 0; i < C.mask.n; i++) { const a = i * TAU / C.mask.n; spawnSummon('mask', e.x + Math.cos(a) * 240, e.y + Math.sin(a) * 240, e.maxHp * C.mask.hp, { orbit: a, owner: e.id, beamT: 1.5 + i * 0.9 }); }
    return [0, 0];
  }
  phaseUpkeep(e, dt);
  if (e.state === 'b_hide') return [0, 0];
  if (e.dash) { // charges / wheel dashes
    const d = e.dash; d.t -= dt; mx = Math.cos(d.a) * d.v; my = Math.sin(d.a) * d.v;
    for (const q of players) if (!q.down && !d.hit.has(q.id) && dist(q, e) < e.r + q.r) { d.hit.add(q.id); hurtPlayer(q, d.dmg, e); }
    if (d.trail && (e.trailT = (e.trailT || 0) - dt) <= 0) { e.trailT = 0.12; addHz({ k: 'trail', x: e.x, y: e.y, a: d.a, r: d.v * 0.14, w: 22, tel: 0.25, act: 2.4, dmg: e.dmg * 0.3, col: 5 }); }
    const hitObj = d.crash && enemies.find(o => !o.dead && o.type === d.crash && (d.crash !== 'brazier' || o.lit) && dist(o, e) < o.r + e.r);
    if (hitObj) { // baited into a pillar / brazier: staggered and exposed
      e.dash = null; e.script = null; e.state = 'b_rec'; e.t = 3; burst(hitObj.x, hitObj.y, d.crash === 'brazier' ? '#ffb347' : '#b08a50', 30, 320, 6); sfx('boom', e); shake(14, e);
      if (d.crash === 'pillar') { killEnemy(hitObj, null); e.breakT = C.breakT; banner('Armor broken', C.name, 2); }
      else { hitObj.lit = false; hitObj.state = 'rest'; hitObj.relight = C.relight; banner('Staggered', C.name, 2); }
      return [0, 0];
    }
    if (d.t <= 0) e.dash = null;
    return [mx, my];
  }
  if (e.state === 'b_tel') { if ((e.t -= dt) <= 0) { e.invuln = false; e.state = 'chase'; e.t = 0.8; } return [0, 0]; }
  if (e.state === 'b_rec') { if ((e.t -= dt) <= 0) { e.state = 'chase'; const g = C.gap; e.t = rand(g[0], g[1]) * (e.phase === 2 ? 0.75 : 1); } return [0, 0]; }
  if (e.script) {
    e.st += dt;
    while (e.script.length && e.script[0][0] <= e.st) { const [, f] = e.script.shift(); f(); }
    if (!e.script.length) { e.script = null; e.state = 'b_rec'; e.t = C.rec * (e.phase === 2 ? 0.85 : 1); }
    return [0, 0];
  }
  // chase and pick the next attack
  const d = dist(e, p), a = angTo(e, p);
  e.face = a;
  if (d > e.r + 70 && !(e.still > 0)) { mx = Math.cos(a) * e.spd; my = Math.sin(a) * e.spd; }
  if (d < e.r + p.r && e.cd <= 0 && !p.dec) { hurtPlayer(p, e.dmg * 0.5, e); e.cd = 1; }
  e.t -= dt;
  if (e.t <= 0) {
    const list = ATTACKS[C.id][e.phase - 1].filter(n => n !== e.last || ATTACKS[C.id][e.phase - 1].length < 2);
    let name = pick(list);
    if (name === 'charge' && !summonsOf('pillar').length) name = 'boulders';
    e.last = name; e.state = 'b_act'; e.st = 0; e.script = atk(e, name, p.dec ? (nearestPlayer(e) || p) : p);
    floatText(e.x, e.y - e.r - 46, ATK_NAMES[name], C.color, 18);
  }
  return [mx, my];
}
// Damage reduction from the boss's current armour (shown on the health bar).
function bossArmor(e) {
  const C = e.cfg; let a = 0;
  if (C.id === 'elderoot' && e.phase === 2) a = Math.min(0.5, C.sapling.armorBase + C.sapling.armorPer * summonsOf('sapling').length);
  if (C.id === 'poseidon') a = e.armorDown > 0 ? 0 : C.orb.armorPer * summonsOf('orb').length;
  if (C.id === 'gorath') a = e.breakT > 0 ? 0 : C.armor;
  if (C.id === 'raivolt' && e.phase === 2) a = C.mask.armorPer * summonsOf('mask').length;
  e.armor = a;
}
// Ongoing phase mechanics: saplings, orbs, pillars, the split, masks, braziers.
function phaseUpkeep(e, dt) {
  const C = e.cfg, A = game.arena;
  if (C.id === 'elderoot' && e.phase === 2) {
    const sap = summonsOf('sapling');
    if (sap.length < 2 && game.t - e.lastSum > C.sapling.every && e.waves < 4) { e.lastSum = game.t; e.waves++; for (let i = 0; i < Math.min(C.sapling.n, C.sapling.maxAlive - sap.length); i++) { const q = arenaPoint(e.x, e.y, 200, 380); spawnSummon('sapling', q.x, q.y, C.sapling.hp * DIFF(game.diff).hp * partyMul(PARTY_SCALE.hpPerExtra)); } }
    if (sap.length && e.healed < e.maxHp * C.sapling.healCap) { const h = Math.min(e.maxHp * C.sapling.heal * sap.length * dt, e.maxHp * C.sapling.healCap - e.healed, e.maxHp - e.hp); e.hp += h; e.healed += h; if (Math.random() < 0.2) for (const s of sap) addFx({ kind: 'bolt', x: s.x, y: s.y, x2: e.x, y2: e.y, life: 0.15, max: 0.15, color: '#8dff8a' }); }
  }
  if (C.id === 'poseidon' && (e.orbT = (e.orbT || C.orb.every) - dt) <= 0) { e.orbT = C.orb.every; spawnOrbs(e); }
  if (C.id === 'gorath') {
    if (summonsOf('pillar').length < C.pillar.min && (e.pillT = (e.pillT ?? C.pillar.respawn) - dt) <= 0) { e.pillT = C.pillar.respawn; const q = arenaPoint(A.x, A.y, 180, 420); spawnSummon('pillar', q.x, q.y, 1, { invuln: true, anchor: true }); }
    if (e.phase === 2) gorathSplit(e, dt);
  }
  if (C.id === 'raivolt' && e.phase === 2) {
    const masks = summonsOf('mask'), busy = hazards.filter(h => h.fromMask && (h.tel > 0 || h.act > 0)).length;
    masks.forEach((m, i) => { m.orbit += dt * 0.5; m.x = e.x + Math.cos(m.orbit) * 250; m.y = e.y + Math.sin(m.orbit) * 250; m.beamT -= dt;
      if (m.beamT <= 0 && busy < C.mask.maxBeams) { m.beamT = C.mask.beamEvery + rand(0, 0.8); const q = pick(alive()); if (q) addHz({ k: 'line', x: m.x, y: m.y, a: angTo(m, q), r: 700, w: 20, tel: 0.95, act: 0.2, dmg: e.dmg * 0.6, col: 4, fromMask: true }); } });
    if (e.masks !== undefined && masks.length < e.masks) { e.script = null; e.dash = null; e.state = 'b_rec'; e.t = 2.5; banner('Mask shattered', C.name, 1.6); } // destroying a mask interrupts and exposes him
    e.masks = masks.length;
  }
  if (C.id === 'nezha') for (const z of summonsOf('brazier')) if (!z.lit && (z.relight -= dt) <= 0) { z.lit = true; z.state = 'chase'; burst(z.x, z.y, '#ffb347', 10, 140, 4); }
  for (const t of ['cage', 'bind', 'vcore']) for (const c of summonsOf(t)) if ((c.life -= dt) <= 0) killEnemy(c, null); // never permanent
  for (const h of hazards) if (h.k === 'vortex' && h.core && !enemies.some(o => !o.dead && o.id === h.core)) h.act = 0; // core destroyed: pull ends
}
function gorathSplit(e, dt) {
  const C = e.cfg, S = C.split;
  if (e.state !== 'b_hide') {
    if ((e.splitAt -= dt) > 0 || e.script || e.dash) return;
    e.state = 'b_hide'; e.hidden = true; e.invuln = true; e.splitHp = e.hp; e.splitT = S.maxT; e.splitAt = S.every;
    burst(e.x, e.y, '#d9b26a', 40, 360, 6); sfx('boom', e); banner('Find the core', C.name, 2.2);
    const real = randi(0, S.n - 1);
    for (let i = 0; i < S.n; i++) { const a = i * TAU / S.n + rand(-0.3, 0.3); spawnSummon('split', e.x + Math.cos(a) * 140, e.y + Math.sin(a) * 140, i === real ? 1e9 : e.maxHp * 0.03, { core: i === real, elite: i === real, link: i === real ? e.id : 0, spd: 110, dmg: e.dmg * 0.4 }); }
    return;
  }
  e.splitT -= dt;
  const bodies = summonsOf('split'), real = bodies.find(s => s.core);
  if (real) { e.x = real.x; e.y = real.y; }
  if (!real || e.splitT <= 0 || e.splitHp - e.hp >= e.maxHp * S.take) { // merge back
    for (const s of bodies) killEnemy(s, null);
    e.state = 'b_rec'; e.t = 2.2; e.hidden = false; e.invuln = false; burst(e.x, e.y, '#d9b26a', 30, 300, 6); sfx('boom', e);
  }
}
// Summons: decoy bodies chase; everything else stays put.
function summonThink(e, dt, p) {
  if (e.type === 'split') { const a = angTo(e, p); if (dist(e, p) > e.r + p.r) return [Math.cos(a) * e.spd, Math.sin(a) * e.spd]; if (e.cd <= 0) { hurtPlayer(p, e.dmg, e); e.cd = 1.1; } }
  if ((e.type === 'cage' || e.type === 'bind') && e.holds) { const q = players.find(q => q.id === e.holds); if (!q || q.down) e.life = 0; }
  return [0, 0];
}
// A hit on the real Gorath core body lands on Gorath himself.
function bossLinkHit(e, d) { if (!e.link) return false; const b = enemies.find(o => o.id === e.link && !o.dead); if (b) { b.hp -= d; b.flash = 0.1; if (b.hp <= 0) killEnemy(b, null); } return true; }

// ---------- drawing ----------
const HZCOL = ['220,60,255', '150,210,90', '90,190,255', '230,180,100', '200,150,255', '255,120,50'];
function drawHazards(c) {
  for (const h of hazards) {
    const warn = h.tel > 0, rgb = HZCOL[h.col || 0], k = warn ? 1 - clamp(h.tel / (h.tmax || 1), 0, 1) : 1, pulse = 0.5 + 0.5 * Math.sin(game.t * 14);
    // warning: dashed outline + growing faint fill; active: solid bright fill + white edge
    const fillA = warn ? 0.1 + 0.18 * k : 0.55, edge = warn ? 'rgba(' + rgb + ',' + (0.6 + 0.3 * pulse) + ')' : 'rgba(255,255,255,.85)';
    c.save(); c.lineWidth = warn ? 2.5 : 3; c.setLineDash(warn ? [10, 8] : []); c.strokeStyle = edge; c.fillStyle = 'rgba(' + rgb + ',' + fillA + ')';
    switch (h.k) {
      case 'circ': case 'mark': c.beginPath(); c.arc(h.x, h.y, h.r, 0, TAU); c.fill(); c.stroke(); if (warn) { c.setLineDash([]); c.fillStyle = 'rgba(' + rgb + ',.35)'; c.beginPath(); c.arc(h.x, h.y, h.r * k, 0, TAU); c.fill(); } if (h.k === 'mark' && warn) { c.fillStyle = 'rgba(255,255,255,.9)'; c.font = 'bold 26px Georgia'; c.textAlign = 'center'; c.fillText('⚡', h.x, h.y + 9); } break;
      case 'safe': c.setLineDash([]); c.fillStyle = 'rgba(120,255,200,' + (0.18 + 0.12 * pulse) + ')'; c.strokeStyle = '#7dffc8'; c.lineWidth = 4; c.beginPath(); c.arc(h.x, h.y, h.r, 0, TAU); c.fill(); c.stroke(); c.fillStyle = '#d8fff0'; c.font = 'bold 14px Georgia'; c.textAlign = 'center'; c.fillText(T('SAFE'), h.x, h.y + 5); break;
      case 'line': case 'trail': c.translate(h.x, h.y); c.rotate(h.a); c.beginPath(); c.rect(0, -h.w, h.r, h.w * 2); c.fill(); c.stroke(); if (warn && h.k === 'line') { c.setLineDash([]); c.fillStyle = 'rgba(' + rgb + ',.3)'; c.fillRect(0, -h.w, h.r * k, h.w * 2); } break;
      case 'cone': case 'petal': c.beginPath(); c.moveTo(h.x + Math.cos(h.a - h.w) * (h.r0 || 0), h.y + Math.sin(h.a - h.w) * (h.r0 || 0)); c.arc(h.x, h.y, h.r, h.a - h.w, h.a + h.w); if (h.r0) c.arc(h.x, h.y, h.r0, h.a + h.w, h.a - h.w, true); else c.lineTo(h.x, h.y); c.closePath(); c.fill(); c.stroke(); break;
      case 'shock': { if (warn) { c.beginPath(); c.arc(h.x, h.y, h.r0, 0, TAU); c.stroke(); c.setLineDash([]); c.fillStyle = 'rgba(120,255,200,.75)'; for (const g of h.g) { for (let d = h.r0 + 30; d < h.r0 + 260; d += 70) { const x = h.x + Math.cos(g) * d, y = h.y + Math.sin(g) * d; c.beginPath(); c.moveTo(x + Math.cos(g) * 14, y + Math.sin(g) * 14); c.lineTo(x + Math.cos(g + 2.4) * 10, y + Math.sin(g + 2.4) * 10); c.lineTo(x + Math.cos(g - 2.4) * 10, y + Math.sin(g - 2.4) * 10); c.fill(); } } } else { const rr2 = h.r0 + h.s; c.setLineDash([]); c.lineWidth = h.w * 2; c.strokeStyle = 'rgba(' + rgb + ',.75)'; let st = 0; const gs = h.g.slice().map(g => ((g % TAU) + TAU) % TAU).sort((a, b) => a - b); for (const g of gs) { c.beginPath(); c.arc(h.x, h.y, rr2, st, g - h.gw); c.stroke(); st = g + h.gw; } c.beginPath(); c.arc(h.x, h.y, rr2, st, (gs[0] || 0) - h.gw + TAU); c.stroke(); } break; }
      case 'wall': { c.translate(h.x, h.y); c.rotate(h.a); const R = BOSS_ARENA_R + 60, gs = h.g.slice().sort((a, b) => a - b); let y0 = -R; const seg = (a, b2) => { if (b2 > a) { c.beginPath(); c.rect(warn ? -BOSS_ARENA_R : h.s - h.w, a, warn ? 26 : h.w * 2, b2 - a); c.fill(); c.stroke(); } };
        for (const g of gs) { seg(y0, g - h.gw); y0 = g + h.gw; } seg(y0, R);
        if (warn) { c.setLineDash([]); c.fillStyle = 'rgba(120,255,200,.6)'; for (const g of gs) { c.beginPath(); c.moveTo(-BOSS_ARENA_R + 40, g - 18); c.lineTo(-BOSS_ARENA_R + 70, g); c.lineTo(-BOSS_ARENA_R + 40, g + 18); c.fill(); } } break; }
      case 'beam': for (let i = 0; i < h.n; i++) { c.save(); c.translate(h.x, h.y); c.rotate(h.a + i * TAU / h.n); c.beginPath(); c.rect(0, -h.w, h.r, h.w * 2); c.fill(); c.stroke(); if (warn) { c.setLineDash([]); c.fillStyle = edge; const s = h.v > 0 ? 1 : -1; for (let d = 120; d < h.r; d += 140) { c.beginPath(); c.moveTo(d, s * (h.w + 6)); c.lineTo(d - 14, s * (h.w + 22)); c.lineTo(d + 14, s * (h.w + 22)); c.fill(); } } c.restore(); } break;
      case 'vortex': { c.setLineDash([]); for (let i = 0; i < 3; i++) { c.strokeStyle = 'rgba(' + rgb + ',' + (warn ? 0.3 : 0.55) + ')'; c.lineWidth = 3; c.beginPath(); c.arc(h.x, h.y, h.r * (1 - ((game.t * 0.6 + i / 3) % 1)), 0, TAU); c.stroke(); } c.fillStyle = 'rgba(' + rgb + ',.25)'; c.beginPath(); c.arc(h.x, h.y, 60, 0, TAU); c.fill(); break; }
      case 'tsunami': { if (warn) { c.setLineDash([]); c.fillStyle = 'rgba(30,90,160,' + (0.08 + 0.14 * k) + ')'; c.beginPath(); c.arc(h.x, h.y, h.r + 80, 0, TAU); c.fill(); } else { c.fillStyle = 'rgba(80,170,255,.55)'; c.beginPath(); c.arc(h.x, h.y, h.r + 80, 0, TAU); c.fill(); } break; }
      case 'ringp': { c.setLineDash([]); if (!warn) { c.strokeStyle = '#ffd27a'; c.lineWidth = 7; c.beginPath(); c.arc(h.px, h.py, h.w, 0, TAU); c.stroke(); c.strokeStyle = 'rgba(255,150,60,.5)'; c.lineWidth = 14; c.stroke(); } break; }
      case 'runner': { c.translate(h.x, h.y); c.rotate(h.a); if (warn) { c.beginPath(); c.rect(0, -h.w, h.r, h.w * 2); c.fill(); c.stroke(); } else { c.setLineDash([]); c.fillStyle = 'rgba(' + rgb + ',.25)'; c.fillRect(0, -h.w * 0.5, h.s, h.w); c.fillStyle = 'rgba(' + rgb + ',.9)'; c.beginPath(); c.arc(h.s, 0, h.w, 0, TAU); c.fill(); c.strokeStyle = '#fff'; c.stroke(); } break; }
    }
    c.restore();
  }
}
const SUMMONS = new Set(['sapling', 'orb', 'vcore', 'pillar', 'split', 'mask', 'cage', 'bind', 'rod', 'brazier']);
// Boss art: original, drawn in code, one design per chapter. (Placeholder-quality: simple shapes, no sprites yet.)
function drawBossBody(c, e) {
  const C = bossCfg(game.chapter), t = game.t + (e.ph || 0), P2 = game.boss && game.boss.phase === 2, fl = e.dir || 1, s = e.r / 50;
  if (game.boss && game.boss.hidden) return;
  c.save(); c.translate(e.x, e.y); c.scale(s, s);
  ell(c, 0, 40, 46, 14, 'rgba(0,0,0,.35)');
  const bob = Math.sin(t * 2) * 2, vul = e.state === 'b_rec';
  if (vul) { c.strokeStyle = 'rgba(255,230,120,' + (0.5 + 0.3 * Math.sin(t * 8)) + ')'; c.lineWidth = 4; c.beginPath(); c.ellipse(0, 40, 60, 20, 0, 0, TAU); c.stroke(); }
  switch (C.id) {
    case 'elderoot': { // a living tree guardian: bark trunk, root feet, branch arms, leafy crown, glowing eyes
      c.fillStyle = '#4a3320'; for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(sx * 10, 30); c.quadraticCurveTo(sx * 34, 44, sx * 44, 38); c.lineTo(sx * 40, 42); c.quadraticCurveTo(sx * 26, 46, sx * 6, 36); c.fill(); }
      c.fillStyle = P2 ? '#5d4327' : '#6b4a2b'; rr(c, -24, -40 + bob, 48, 76, 18); c.fill();
      c.strokeStyle = '#3d2a18'; c.lineWidth = 2; for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * 8, -34 + bob); c.quadraticCurveTo(i * 8 + 4, 0, i * 8 - 2, 30 + bob); c.stroke(); }
      if (P2) { c.fillStyle = '#7a5a36'; for (const [x, y] of [[-20, -10], [16, 2], [-8, 18], [12, -26]]) { rr(c, x - 8, y + bob - 6, 16, 12, 4); c.fill(); } }
      const arm = (e.arms ? 1.5 : 1); c.strokeStyle = '#5a3d22'; c.lineCap = 'round'; c.lineWidth = 10 * arm;
      for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(sx * 20, -18 + bob); c.quadraticCurveTo(sx * 46, -6, sx * (40 + 10 * arm), 18 + bob); c.stroke(); }
      c.fillStyle = '#3f7a3a'; for (const [x, y, r] of [[0, -58, 26], [-22, -48, 18], [22, -48, 18], [-8, -70, 14], [12, -68, 14]]) circ(c, x, y + bob, r * (P2 ? 1.15 : 1), x % 2 ? '#4d8f45' : '#3f7a3a');
      c.fillStyle = '#d8ff9a'; c.fillRect(fl * 4 - 10, -24 + bob, 6, 4); c.fillRect(fl * 4 + 4, -24 + bob, 6, 4); c.fillStyle = '#2b1d10'; c.fillRect(-7, -12 + bob, 14, 3);
      break;
    }
    case 'poseidon': { // sea god: coral armour, seawater cloak, glowing trident; phase 2 a giant water avatar
      if (P2) { c.globalAlpha = 0.45; circ(c, 0, -20, 62 + Math.sin(t * 3) * 3, '#3ba7e8'); c.globalAlpha = 1; }
      c.fillStyle = 'rgba(70,160,230,.75)'; c.beginPath(); c.moveTo(-30, 36); c.quadraticCurveTo(-34, -20 + bob, 0, -30 + bob); c.quadraticCurveTo(34, -20 + bob, 30, 36); c.closePath(); c.fill();
      c.fillStyle = '#e8836a'; rr(c, -16, -26 + bob, 32, 40, 8); c.fill(); c.fillStyle = '#f2a48c'; for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(-8 + i * 8, -14 + bob, 4, 0, TAU); c.fill(); }
      circ(c, 0, -38 + bob, 11, '#cfe9f5'); c.fillStyle = '#e9f6ff'; c.beginPath(); c.moveTo(-12, -44 + bob); c.lineTo(0, -60 + bob); c.lineTo(12, -44 + bob); c.fill();
      c.fillStyle = '#1b3a52'; c.fillRect(fl * 3 - 5, -40 + bob, 3, 3); c.fillRect(fl * 3 + 2, -40 + bob, 3, 3);
      c.save(); c.rotate(e.a || 0); c.strokeStyle = '#ffe07a'; c.lineWidth = 4; c.beginPath(); c.moveTo(10, 0); c.lineTo(70, 0); c.stroke(); c.lineWidth = 3; c.beginPath(); c.moveTo(62, -10); c.lineTo(76, -10); c.moveTo(62, 10); c.lineTo(76, 10); c.moveTo(62, -10); c.lineTo(62, 10); c.moveTo(64, 0); c.lineTo(80, 0); c.stroke();
      const g = c.createRadialGradient(72, 0, 1, 72, 0, 18); g.addColorStop(0, 'rgba(255,240,160,.8)'); g.addColorStop(1, 'rgba(255,220,120,0)'); c.fillStyle = g; c.beginPath(); c.arc(72, 0, 18, 0, TAU); c.fill(); c.restore();
      break;
    }
    case 'gorath': { // sand-and-stone colossus with a visible crystal core
      c.fillStyle = '#a5855a'; for (const [x, y, r] of [[0, 0, 34], [-26, -14, 18], [26, -14, 18], [-18, 24, 16], [18, 24, 16], [0, -36, 16]]) { c.beginPath(); c.arc(x, y + bob, r, 0, TAU); c.fill(); }
      c.fillStyle = '#8a6b44'; for (let i = 0; i < 6; i++) { const a = i + t * 0.3; c.beginPath(); c.arc(Math.cos(a) * 40, Math.sin(a) * 16 + bob, 4, 0, TAU); c.fill(); }
      const br = game.boss && game.boss.armor === 0; if (br) { c.strokeStyle = '#ffe2a0'; c.lineWidth = 2; for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(-20 + i * 9, -20 + bob); c.lineTo(-14 + i * 9, 0 + bob); c.lineTo(-22 + i * 9, 18 + bob); c.stroke(); } }
      const g = c.createRadialGradient(0, -2 + bob, 2, 0, -2 + bob, 16); g.addColorStop(0, '#e9fbff'); g.addColorStop(1, 'rgba(120,220,255,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, -2 + bob, 16, 0, TAU); c.fill();
      c.fillStyle = '#7fe3ff'; c.beginPath(); c.moveTo(0, -12 + bob); c.lineTo(7, -2 + bob); c.lineTo(0, 8 + bob); c.lineTo(-7, -2 + bob); c.fill();
      c.fillStyle = '#3a2a16'; c.fillRect(fl * 4 - 8, -40 + bob, 5, 4); c.fillRect(fl * 4 + 3, -40 + bob, 5, 4);
      break;
    }
    case 'raivolt': { // winged storm creature with three floating thunder masks (they leave in phase 2)
      c.fillStyle = '#2a2140'; for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(sx * 12, -10 + bob); c.quadraticCurveTo(sx * 70, -50 + bob + Math.sin(t * 6) * 8, sx * 78, 6 + bob); c.quadraticCurveTo(sx * 46, -4, sx * 12, 12 + bob); c.fill(); }
      c.strokeStyle = '#c9b2ff'; c.lineWidth = 2; for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(sx * 30, -24 + bob); c.lineTo(sx * 44, -10 + bob); c.lineTo(sx * 38, -8 + bob); c.lineTo(sx * 56, 4 + bob); c.stroke(); }
      ell(c, 0, 0 + bob, 20, 30, '#3b2f5c'); circ(c, 0, -26 + bob, 13, '#4a3b70'); c.fillStyle = '#e4d4ff'; c.fillRect(fl * 3 - 6, -28 + bob, 4, 3); c.fillRect(fl * 3 + 2, -28 + bob, 4, 3);
      if (!P2) for (let i = 0; i < 3; i++) { const a = t * 0.8 + i * TAU / 3; drawMask(c, Math.cos(a) * 44, -44 + Math.sin(a) * 14 + bob, 0.7); }
      break;
    }
    case 'nezha': { // young divine warrior: red sash, golden ornaments, flaming spear, Wind-Fire Wheels
      for (const sx of [-1, 1]) { const wx = sx * 12, wy = 30; c.strokeStyle = '#ff9a3d'; c.lineWidth = 3; c.beginPath(); c.arc(wx, wy, 10, 0, TAU); c.stroke(); for (let i = 0; i < 6; i++) { const a = t * 10 + i; c.strokeStyle = 'rgba(255,' + (140 + i * 15) + ',60,.8)'; c.beginPath(); c.moveTo(wx + Math.cos(a) * 10, wy + Math.sin(a) * 10); c.lineTo(wx + Math.cos(a) * 16, wy + Math.sin(a) * 16); c.stroke(); } }
      if (P2) for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + (i - 2.5) * 0.45; c.strokeStyle = 'rgba(255,190,120,.45)'; c.lineWidth = 5; c.beginPath(); c.moveTo(0, -10 + bob); c.lineTo(Math.cos(a) * 54, -10 + Math.sin(a) * 54 + bob); c.stroke(); circ(c, Math.cos(a) * 54, -10 + Math.sin(a) * 54 + bob, 4, 'rgba(255,220,150,.6)'); }
      c.fillStyle = '#f0d9c0'; rr(c, -9, -16 + bob, 18, 34, 6); c.fill(); c.fillStyle = '#c2312a'; rr(c, -10, -6 + bob, 20, 12, 4); c.fill();
      c.strokeStyle = '#e0312a'; c.lineWidth = 4; c.beginPath(); c.moveTo(-10, -4 + bob); c.quadraticCurveTo(-34, 6 + Math.sin(t * 5) * 6, -28 + Math.sin(t * 4) * 6, 30); c.moveTo(10, -4 + bob); c.quadraticCurveTo(36, -2 + Math.cos(t * 5) * 6, 32, 24); c.stroke();
      circ(c, 0, -26 + bob, 10, '#f0d9c0'); c.fillStyle = '#1a1a1a'; c.beginPath(); c.arc(-6, -34 + bob, 5, 0, TAU); c.arc(6, -34 + bob, 5, 0, TAU); c.fill();
      c.strokeStyle = '#f3c84a'; c.lineWidth = 3; c.beginPath(); c.arc(0, -12 + bob, 9, 0.2, Math.PI - 0.2); c.stroke();
      c.save(); c.rotate(e.a || 0); c.strokeStyle = '#8a5a2a'; c.lineWidth = 3; c.beginPath(); c.moveTo(4, 0); c.lineTo(58, 0); c.stroke(); c.fillStyle = '#ffd27a'; c.beginPath(); c.moveTo(58, -5); c.lineTo(72, 0); c.lineTo(58, 5); c.fill();
      for (let i = 0; i < 4; i++) circ(c, 66 + rand(-4, 4), rand(-5, 5), rand(2, 5), 'rgba(255,' + randi(90, 180) + ',40,.7)'); c.restore();
      break;
    }
  }
  if (e.flash > 0) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.4; circ(c, 0, 0, 40, '#fff'); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
  c.restore();
}
function drawMask(c, x, y, s) { c.save(); c.translate(x, y); c.scale(s, s); c.fillStyle = '#d8c8ff'; c.beginPath(); c.moveTo(-14, -12); c.lineTo(14, -12); c.lineTo(10, 10); c.lineTo(0, 16); c.lineTo(-10, 10); c.closePath(); c.fill(); c.fillStyle = '#2a1f45'; c.fillRect(-9, -5, 6, 4); c.fillRect(3, -5, 6, 4); c.strokeStyle = '#fff6a0'; c.lineWidth = 2; c.beginPath(); c.moveTo(-4, 4); c.lineTo(0, 10); c.lineTo(4, 4); c.stroke(); c.restore(); }
function drawSummon(c, e) {
  const t = game.t + (e.ph || 0); c.save(); c.translate(e.x, e.y);
  switch (e.type) {
    case 'sapling': ell(c, 0, 10, 14, 5, 'rgba(0,0,0,.3)'); c.strokeStyle = '#6b4a2b'; c.lineWidth = 4; c.beginPath(); c.moveTo(0, 10); c.lineTo(0, -10); c.stroke(); circ(c, -6, -12, 8, '#5fae55'); circ(c, 6, -14, 8, '#7bc96f'); circ(c, 0, -20, 7, '#9fe08a'); c.strokeStyle = 'rgba(141,255,138,' + (0.4 + 0.3 * Math.sin(t * 4)) + ')'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 22, 0, TAU); c.stroke(); break;
    case 'orb': { const g = c.createRadialGradient(0, -6, 2, 0, -6, 24); g.addColorStop(0, '#e8fbff'); g.addColorStop(0.5, '#4fb6e8'); g.addColorStop(1, 'rgba(40,120,200,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, -6 + Math.sin(t * 2) * 3, 24, 0, TAU); c.fill(); break; }
    case 'vcore': circ(c, 0, 0, 18, '#1c4f7a'); circ(c, 0, 0, 11, '#7fe3ff'); c.strokeStyle = '#e8fbff'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 14, t * 6, t * 6 + 4); c.stroke(); break;
    case 'pillar': ell(c, 0, 18, 22, 8, 'rgba(0,0,0,.35)'); c.fillStyle = '#8a8070'; rr(c, -16, -54, 32, 72, 6); c.fill(); c.fillStyle = '#a59b88'; c.fillRect(-16, -54, 32, 8); c.strokeStyle = '#6e6656'; c.lineWidth = 2; c.beginPath(); c.moveTo(-6, -40); c.lineTo(-2, -20); c.lineTo(-8, 0); c.stroke(); break;
    case 'split': { c.fillStyle = '#a5855a'; c.beginPath(); c.arc(0, 0, e.r, 0, TAU); c.fill(); c.fillStyle = '#8a6b44'; circ(c, -8, -6, 6, '#8a6b44'); if (e.core || e.elite) { circ(c, 0, -2, 7, '#7fe3ff'); if (Math.random() < 0.6) parts.push({ x: e.x + rand(-6, 6), y: e.y + rand(-6, 6), vx: 0, vy: 0, life: 1.1, max: 1.1, color: '#9ff0ff', size: 4 }); } break; }
    case 'mask': drawMask(c, 0, 0, 1.6); break;
    case 'cage': { c.strokeStyle = '#7a5a36'; c.lineWidth = 5; for (let i = 0; i < 6; i++) { const a = i * TAU / 6; c.beginPath(); c.moveTo(Math.cos(a) * 26, Math.sin(a) * 12 + 14); c.quadraticCurveTo(Math.cos(a) * 34, -10, 0, -34); c.stroke(); } c.fillStyle = '#ffd27a'; c.font = 'bold 12px Georgia'; c.textAlign = 'center'; c.fillText(T('BREAK!'), 0, -40); break; }
    case 'bind': { c.strokeStyle = '#e0312a'; c.lineWidth = 4; for (let i = 0; i < 3; i++) { c.beginPath(); c.ellipse(0, -4 + i * 8, 24, 7, 0, 0, TAU); c.stroke(); } c.fillStyle = '#ffd27a'; c.font = 'bold 12px Georgia'; c.textAlign = 'center'; c.fillText(T('BREAK!'), 0, -24); break; }
    case 'rod': ell(c, 0, 14, 16, 6, 'rgba(0,0,0,.35)'); c.fillStyle = '#5a5f73'; c.fillRect(-6, -60, 12, 74); c.fillStyle = '#c9b2ff'; circ(c, 0, -64, 8, '#c9b2ff'); c.strokeStyle = 'rgba(201,178,255,.35)'; c.setLineDash([6, 6]); c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 90, 0, TAU); c.stroke(); c.setLineDash([]); break;
    case 'brazier': ell(c, 0, 14, 20, 7, 'rgba(0,0,0,.35)'); c.fillStyle = '#6b6560'; rr(c, -18, -10, 36, 24, 5); c.fill(); if (e.state !== 'rest') { c.fillStyle = '#ff8a3a'; c.beginPath(); c.moveTo(-12, -10); c.quadraticCurveTo(0, -42 - Math.sin(t * 9) * 6, 12, -10); c.fill(); c.fillStyle = '#ffe07a'; c.beginPath(); c.moveTo(-6, -10); c.quadraticCurveTo(0, -26, 6, -10); c.fill(); } break;
  }
  if (e.flash > 0) { c.globalAlpha = 0.5; circ(c, 0, -4, 18, '#fff'); c.globalAlpha = 1; }
  c.restore();
  const f = e.hp / (e.maxHp || 1); if (!['rod', 'pillar', 'brazier'].includes(e.type) && !(e.type === 'split' && (e.elite || e.core)) && f < 1 && f > 0) { const w = 40; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(e.x - w / 2, e.y - 46, w, 4); ctx.fillStyle = '#ffd27a'; ctx.fillRect(e.x - w / 2, e.y - 46, w * clamp(f, 0, 1), 4); }
}
function drawArena(c) { if (!game.boss || !game.arena) return; c.save(); c.strokeStyle = 'rgba(255,255,255,.12)'; c.setLineDash([16, 14]); c.lineWidth = 3; c.beginPath(); c.arc(game.arena.x, game.arena.y, BOSS_ARENA_R, 0, TAU); c.stroke(); c.restore(); }
