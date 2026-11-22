'use strict';
/* DUSKBOUND — an original top-down action roguelike with online co-op.
   Solo, or up to 4 players peer-to-peer: the host simulates the world, guests send input and render snapshots.
   Files: data.js (content), art.js (procedural sprites), audio.js (synth), game.js (simulation, netcode, UI). */

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;
const rand = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
function angDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; }
const fmtTime = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
const num = (v, d = 0) => Number.isFinite(v) ? v : d;
const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

const cv = $('game'), ctx = cv.getContext('2d'), overlay = $('overlay'), choiceEl = $('choice');
let W = 0, H = 0, zoom = 1, VW = 0, VH = 0, DPR = 1;
// Touch state: on phones the left thumb steers a floating stick, the right thumb aims/attacks, plus on-screen buttons.
const touch = { on: !!(window.matchMedia && matchMedia('(pointer: coarse)').matches), move: null, aim: null, aimA: 0 };
// Safe-area insets (iPhone notch / Dynamic Island / home indicator), measured from CSS env() via the hidden #sa element.
const SA = { l: 0, r: 0, t: 0, b: 0 };
function readSafeArea() {
  const el = $('sa'); if (!el || !window.getComputedStyle) return;
  const cs = getComputedStyle(el), px = v => num(parseFloat(v), 0);
  SA.t = px(cs.paddingTop); SA.r = px(cs.paddingRight); SA.b = px(cs.paddingBottom); SA.l = px(cs.paddingLeft);
}
const IOS = /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = !!(navigator.standalone || (window.matchMedia && matchMedia('(display-mode: standalone)').matches));
// iPhone Safari (not the Home Screen app, not inside another page): Safari shrinks its bars away only when the page
// itself scrolls, so give the page some scroll room. Swiping up on menus scrolls it and the bars disappear; during play
// the canvas blocks scrolling, so they stay hidden.
const IOS_BARS = IOS && !STANDALONE && window.top === window;
if (IOS_BARS) document.documentElement.classList.add('iosbar');
// Are Safari's bars still taking up room? (screen.* is the full screen; in landscape the short side is the full height.)
const barsShowing = () => IOS_BARS && innerHeight < (innerWidth > innerHeight ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height)) - 24;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight; readSafeArea();
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  if (IOS_BARS) { cv.style.width = W + 'px'; cv.style.height = H + 'px'; document.body.classList.toggle('bars', barsShowing()); }
  zoom = clamp(Math.min(W / 1280, H / 720), touch.on ? 0.72 : 0.55, 1.6); VW = W / zoom; VH = H / zoom;
}
addEventListener('resize', resize); addEventListener('orientationchange', () => { resize(); setTimeout(resize, 300); }); resize();
// iOS Safari resizes the visual viewport as its toolbars slide in and out.
if (window.visualViewport) visualViewport.addEventListener('resize', resize);
// iOS Safari ignores user-scalable=no for pinch zoom; stop it here. Unlock audio on any tap end too (older iOS needs touchend).
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('touchend', () => initAudio(), { passive: true }); document.addEventListener('click', () => initAudio());
// Locking the phone or switching apps pauses a solo run instead of letting the night keep going unseen.
document.addEventListener('visibilitychange', () => { if (document.hidden && game.state === 'play' && net.mode === 'solo' && !game.over && !game.paused && !(me && me.choice)) onKey('p'); });

// ---------- input ----------
const keys = {}, mouse = { x: 0, y: 0, l: false, r: false };
const pressed = {};
addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase(); if (!keys[k]) pressed[k] = true; keys[k] = true;
  if (k === ' ' || k === 'tab') e.preventDefault();
  onKey(k);
});
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
cv.addEventListener('mousedown', e => { initAudio(); if (touch.on) { touch.on = false; touch.move = touch.aim = null; resize(); } if (e.button === 0) mouse.l = true; if (e.button === 2) { mouse.r = true; pressed.rmb = true; } });
addEventListener('mouseup', e => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; });
const mouseWorld = () => ({ x: cam.x + mouse.x / zoom, y: cam.y + mouse.y / zoom });
const touchU = () => clamp(Math.min(W - SA.l - SA.r, H - SA.t - SA.b) / 400, 0.8, 1.25);
// HUD scale on phones, and the safe right/bottom edges the touch controls are laid out against.
const hudScale = () => touch.on ? clamp(Math.min((W - SA.l - SA.r) / 900, (H - SA.t - SA.b) / 480), 0.7, 1) : 1;
function touchButtons() {
  const u = touchU(), R = W - SA.r, B = H - Math.max(SA.b - 8, 0), hs = hudScale();
  return [{ id: 'skill', key: 'e', x: R - 205 * u, y: B - 62 * u, r: 30 * u }, { id: 'dash', key: ' ', x: R - 190 * u, y: B - 140 * u, r: 30 * u },
  { id: 'ult', key: 'q', x: R - 118 * u, y: B - 196 * u, r: 30 * u }, { id: 'f', key: 'f', x: R - 42 * u, y: B - 210 * u, r: 26 * u },
  // left of the minimap: pause in solo, mute in co-op
  { id: 'menu', key: '', x: R - 156 * hs, y: SA.t + 38 * hs, r: 18 * hs }];
}
function touchMenu() { if (net.mode === 'solo') onKey('p'); else onKey('m'); }
cv.addEventListener('touchstart', e => {
  e.preventDefault(); initAudio(); if (!touch.on) { touch.on = true; resize(); }
  for (const t of e.changedTouches) {
    const x = t.clientX, y = t.clientY, b = touchButtons().find(b => Math.hypot(x - b.x, y - b.y) < b.r * 1.25);
    if (b) { if (b.id === 'menu') touchMenu(); else pressed[b.key] = true; }
    else if (x < W * 0.45) { if (!touch.move) touch.move = { id: t.identifier, x0: x, y0: y, x, y }; }
    else if (!touch.aim) touch.aim = { id: t.identifier, x0: x, y0: y, x, y };
  }
}, { passive: false });
cv.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) for (const s of [touch.move, touch.aim]) if (s && s.id === t.identifier) { s.x = t.clientX; s.y = t.clientY; }
}, { passive: false });
function touchEnd(e) {
  for (const t of e.changedTouches) { if (touch.move && touch.move.id === t.identifier) touch.move = null; if (touch.aim && touch.aim.id === t.identifier) touch.aim = null; }
}
cv.addEventListener('touchend', touchEnd); cv.addEventListener('touchcancel', touchEnd);
function touchInput() {
  const p = me, R = 52 * touchU(); let mx = 0, my = 0, aim = null;
  if (touch.move) { mx = (touch.move.x - touch.move.x0) / R; my = (touch.move.y - touch.move.y0) / R; const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; } else if (l < 0.18) mx = my = 0; }
  const s = touch.aim, dx = s ? s.x - s.x0 : 0, dy = s ? s.y - s.y0 : 0, dl = Math.hypot(dx, dy);
  if (s && dl > 12) { touch.aimA = Math.atan2(dy, dx); const d = 120 + 280 * clamp(dl / R, 0, 1); aim = { x: p.x + Math.cos(touch.aimA) * d, y: p.y + Math.sin(touch.aimA) * d }; }
  else {
    // not dragging the aim stick: lock on to the nearest enemy, else face the way we are walking
    let best = null, bd = 460; for (const e of enemies) { if (e.dead) continue; const d = dist(e, p); if (d < bd) { bd = d; best = e; } }
    if (best) { touch.aimA = angTo(p, best); aim = { x: best.x, y: best.y }; }
    else { if (mx || my) touch.aimA = Math.atan2(my, mx); aim = { x: p.x + Math.cos(touch.aimA) * 200, y: p.y + Math.sin(touch.aimA) * 200 }; }
  }
  return { mx, my, l: !!s, skill: !!pressed.e, dash: !!pressed[' '], ult: !!pressed.q, interact: !!pressed.f, aim };
}
function localInput() {
  if (touch.on && me) return touchInput();
  let mx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0), my = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  const ml = Math.hypot(mx, my); if (ml) { mx /= ml; my /= ml; }
  return { mx, my, l: mouse.l, skill: !!(pressed.rmb || pressed.e || mouse.r), dash: !!pressed[' '], ult: !!pressed.q, interact: !!pressed.f, aim: mouseWorld() };
}

// ---------- state ----------
const newGame = () => ({ state: 'play', diff: 'normal', runId: '', rewards: null, chapter: 1, time: 0, boss: null, banner: null, shake: 0, winT: 0, ambT: 5, wasNight: false, t: 0, over: null, paused: false });
let game = newGame(); game.state = 'menu';
let players = [], me = null, world = null, enemies = [], projs = [], zones = [], pickups = [], parts = [], texts = [], fxs = [];
let night = 0, cam = { x: 0, y: 0 }, groundPat = null, nextId = 1, evQ = [];
const net = { mode: 'solo', away: new Map(), claims: new Map(), rolled: new Set(), conns: [], host: null, handle: null, lobby: [], myId: 1, nextPid: 2, name: '', hero: 'bramble', code: '', ready: false, snapT: 0, inT: 0, out: {}, pickedSeq: -1, worker: null };
try { net.name = localStorage.getItem('duskbound-name') || ''; } catch (e) { }
// Saved profile (meta.js): identified by a random installation id kept in this browser's storage.
const STORE = (() => { try { localStorage.setItem('duskbound-probe', '1'); localStorage.removeItem('duskbound-probe'); return localStorage; } catch (e) { const d = {}; return { getItem: k => k in d ? d[k] : null, setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; } }; } })();
let PROFILE = loadProfile(STORE);
const saveMe = () => saveProfile(STORE, PROFILE);
const DIFF = id => DIFFICULTIES.find(d => d.id === id) || DIFFICULTIES[0];
// The difficulty this player wants (remembered), never above what their profile has unlocked.
net.diff = (() => { let d = ''; try { d = localStorage.getItem('duskbound-diff') || ''; } catch (e) { } return PROFILE.unlocked.includes(d) ? d : 'normal'; })();
const setDiff = d => { if (!PROFILE.unlocked.includes(d)) return; net.diff = d; try { localStorage.setItem('duskbound-diff', d); } catch (e) { } };
// Players counted for scaling: everyone in the session, including disconnected players whose slot is still held.
const partyN = () => Math.max(1, players.length + (net.mode === 'host' ? net.away.size : 0));
const partyMul = per => 1 + per * (partyN() - 1);
const ETN = ['husk', 'spitter', 'ram', 'bloat', 'wisp', 'boss'], STN = ['chase', 'wind', 'rest', 'charge', 'fuse', 'bwind', 'bcharge', 'ring', 'slam'];
const DASH_CD = 2.2, ULT_CD = 40;

function newPlayer(pid, hero, name) {
  const h = HEROES[hero];
  return {
    id: pid, name, hero, x: 0, y: 0, tx: 0, ty: 0, r: 15, hp: h.hp, maxHp: h.hp, spd: h.spd, dmg: h.dmg, atkCd: h.atkCd,
    dmgMul: 1, asMul: 1, spdMul: 1, crit: 0.05, critMul: 1.75, lifesteal: 0, armor: 0, cdr: 1, pickR: 90, xpMul: 1,
    dashMax: h.dashes, dashes: h.dashes, dashRe: 0, nightDmg: 0, dayRegen: 0, spite: 0, chain: 0, venom: 0, exec: 0, embers: 1,
    level: 1, xp: 0, gold: 0, kills: 0, tAtk: 0, tSkill: 0, tUlt: 0, iT: 0, dashT: 0, dashA: 0, dashHit: null, dashLock: 0, face: 0, swing: 0,
    ultT: 0, pulse: 0, combo: 0, flurry: null, talents: {}, h: {}, walk: 0, moving: false, healAcc: 0,
    pending: 0, choice: null, choiceSeq: 0, choiceTitle: '', down: false, rev: 0, tp: 0, remote: false,
    aim: { x: 0, y: 0 }, in: { mx: 0, my: 0, l: false, skill: false, dash: false, ult: false, interact: false, aim: { x: 0, y: 0 } }, cds: [0, 0, 0, 0]
  };
}
const xpNeed = l => 25 + l * 20 + l * l * 2;
const dayIdx = () => Math.min(DAYS - 1, Math.floor(game.time / CYCLE));
const dmgOf = e => e.dmg * (1 + 0.15 * dayIdx()) * (1 + 0.5 * (game.chapter - 1)) * (1 + 0.25 * night);
const alive = () => players.filter(p => !p.down);
function nearestPlayer(o) { let b = null, bd = 1e9; for (const p of players) { if (p.down) continue; const d = dist(p, o); if (d < bd) { bd = d; b = p; } } return b; }
const distAny = o => { let bd = 1e9; for (const p of players) bd = Math.min(bd, dist(p, o)); return bd; };

// ---------- world gen ----------
function makeGround(p) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = p.base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) { g.fillStyle = pick(p.spk); g.globalAlpha = 0.35; g.beginPath(); g.ellipse(rand(256), rand(256), rand(10, 34), rand(6, 20), rand(TAU), 0, TAU); g.fill(); }
  g.globalAlpha = 0.8;
  for (let i = 0; i < 150; i++) { g.strokeStyle = pick(p.spk); g.lineWidth = 1.4; const x = rand(256), y = rand(256); g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-2, 2), y - rand(3, 7)); g.stroke(); }
  g.globalAlpha = 1; return ctx.createPattern(c, 'repeat');
}
function clearEntities() { enemies = []; projs = []; zones = []; pickups = []; parts = []; texts = []; fxs = []; evQ = []; }
function genWorld() {
  const S = 3400, pal = PAL[(game.chapter - 1) % PAL.length];
  world = { S, obs: [], pois: [], pal }; groundPat = makeGround(pal); clearEntities();
  const c = { x: S / 2, y: S / 2 }, a = rand(TAU), sp = { x: c.x + Math.cos(a) * 1350, y: c.y + Math.sin(a) * 1350 };
  world.spawn = sp; const pois = world.pois;
  pois.push({ kind: 'altar', x: c.x, y: c.y, r: 40, seen: true, used: false, uses: 0 });
  const place = (kind, n, minD = 260) => {
    for (let i = 0; i < n; i++) for (let k = 0; k < 80; k++) {
      const q = { x: rand(220, S - 220), y: rand(220, S - 220) };
      if (dist(q, sp) < 380 || pois.some(o => dist(o, q) < minD)) continue;
      pois.push({ kind, x: q.x, y: q.y, r: 24, used: false, seen: false, uses: 0 }); break;
    }
  };
  place('camp', 6, 440); place('chest', 9); place('spring', 3); place('shrine', 4); place('merchant', 2);
  for (let i = 0; i < 380; i++) {
    const tree = Math.random() < 0.72, r = tree ? rand(34, 54) : rand(18, 32), q = { x: rand(40, S - 40), y: rand(40, S - 40) };
    if (dist(q, sp) < 190 || pois.some(o => dist(o, q) < o.r + r + 80) || world.obs.some(o => dist(o, q) < o.cr + (tree ? 16 : r) + 44)) continue;
    world.obs.push({ x: q.x, y: q.y, r, cr: tree ? rand(13, 17) : r, tree, v: rand(TAU), tone: randi(0, 2) });
  }
  players.forEach((p, i) => { const pa = i * TAU / players.length, d = players.length > 1 ? 45 : 0; p.x = p.tx = sp.x + Math.cos(pa) * d; p.y = p.ty = sp.y + Math.sin(pa) * d; p.tp++; });
  for (const p of pois) if (p.kind === 'camp') { spawnEnemy(pick(['husk', 'ram', 'spitter']), p.x, p.y - 50, true); spawnPack(p.x, p.y, 3, 70); }
  for (let i = 0; i < 36; i++) for (let k = 0; k < 30; k++) {
    const q = { x: rand(150, S - 150), y: rand(150, S - 150) };
    if (dist(q, sp) < 650 || dist(q, c) < 250) continue; spawnPack(q.x, q.y, randi(3, 5), 90); break;
  }
}
function packType() {
  const r = Math.random(), c = game.chapter;
  if (r < 0.5 - c * 0.05) return 'husk'; if (r < 0.72 - c * 0.03) return 'spitter'; if (r < 0.87) return 'bloat'; return 'ram';
}
function spawnPack(x, y, n, spread, aggro) {
  const main = packType();
  for (let i = 0; i < n; i++) {
    const e = spawnEnemy(Math.random() < 0.7 ? main : packType(), x + rand(-spread, spread), y + rand(-spread, spread));
    if (aggro) e.aggro = true;
  }
}
function spawnEnemy(type, x, y, elite = false) {
  const T = ET[type], hm = (1 + 0.3 * dayIdx()) * (1 + 0.9 * (game.chapter - 1)) * (elite ? 6 : 1) * DIFF(game.diff).hp * partyMul(PARTY_SCALE.hpPerExtra);
  const e = {
    id: nextId++, type, x: clamp(x, 40, world.S - 40), y: clamp(y, 40, world.S - 40), r: T.r * (elite ? 1.5 : 1), hp: T.hp * hm, maxHp: T.hp * hm,
    spd: T.spd, dmg: T.dmg * (elite ? 1.4 : 1) * DIFF(game.diff).dmg * partyMul(PARTY_SCALE.dmgPerExtra), xp: T.xp * (elite ? 8 : 1), elite, state: 'chase', t: 0, cd: rand(0.5, 2), aggro: false,
    flash: 0, slowT: 0, kbx: 0, kby: 0, poisT: 0, poisD: 0, poisTick: 0, poisBy: null, a: 0, dead: false, ph: rand(TAU), n: 0, near: false
  };
  enemies.push(e); return e;
}
function spawnBoss() {
  if (game.boss || game.winT > 0) return;
  const p = pick(alive()) || players[0], a = rand(TAU);
  const e = spawnEnemy('boss', p.x + Math.cos(a) * 520, p.y + Math.sin(a) * 520);
  e.aggro = true; e.t = 2; game.boss = e; world.pois[0].used = true;
  banner('THE GLOAM STAG', 'It has come for what you carry.', 4); sfx('boss'); shake(14);
}

// ---------- effects (mirrored to guests as events) ----------
function emit(k, a, at, to) { if (net.mode === 'host' && net.conns.length) evQ.push({ k, a, x: at ? Math.round(at.x) : undefined, y: at ? Math.round(at.y) : undefined, to }); }
const forMe = (at, to, range) => !(to && me && to !== me.id) && !(at && me && dist(at, me) > range);
function sfx(name, at, to) { emit('s', [name], at, to); if (forMe(at, to, 1000)) playSfx(name); }
function shake(v, at, to) { emit('k', [v], at, to); if (forMe(at, to, 900)) game.shake = Math.max(game.shake, v); }
function banner(text, sub = '', t = 3, to) { emit('n', [text, sub, t], null, to); if (forMe(null, to, 0)) game.banner = { text, sub, t, max: t }; }
function floatText(x, y, s, color = '#fff', size = 15) { emit('t', [Math.round(x), Math.round(y), s, color, size], { x, y }); if (texts.length > 90) texts.shift(); texts.push({ x: x + rand(-8, 8), y, s, color, size, life: 0.8 }); }
function burst(x, y, color, n = 8, sp = 160, size = 3) {
  emit('b', [Math.round(x), Math.round(y), color, n, sp, size], { x, y });
  for (let i = 0; i < n; i++) { const a = rand(TAU), v = rand(sp * 0.3, sp); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.25, 0.6), max: 0.6, color, size: rand(size * 0.5, size) }); }
  if (parts.length > 700) parts.splice(0, parts.length - 700);
}
function addFx(f) { emit('f', [Object.assign({}, f)], f); fxs.push(f); }
function ring(x, y, r, color) { addFx({ kind: 'ring', x, y, r, color, life: 0.35, max: 0.35 }); }
function applyEv(e) {
  const a = e.a;
  switch (e.k) {
    case 't': floatText(a[0], a[1], a[2], a[3], a[4]); break;
    case 'b': burst(a[0], a[1], a[2], a[3], a[4], a[5]); break;
    case 'f': fxs.push(a[0]); break;
    case 's': playSfx(a[0]); break;
    case 'k': game.shake = Math.max(game.shake, a[0]); break;
    case 'n': game.banner = { text: a[0], sub: a[1], t: a[2], max: a[2] }; break;
  }
}

// ---------- combat ----------
function heal(p, v) {
  if (!p || p.down || p.hp <= 0) return; const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + v);
  p.healAcc += p.hp - before; if (p.healAcc >= 3) { floatText(p.x, p.y - 26, '+' + Math.round(p.healAcc), '#8dff8a', 13); p.healAcc = 0; }
}
function hitEnemy(p, e, dmg, o = {}) {
  if (e.dead) return 0;
  let d = dmg * p.dmgMul * (1 + p.nightDmg * night) * (p.ultT > 0 && p.hero === 'bramble' ? 1.5 : 1);
  if (p.exec && e.hp < e.maxHp * 0.3) d *= 1 + p.exec;
  const crit = !o.noCrit && Math.random() < p.crit + (p.hero === 'vesper' ? 0.15 * night : 0);
  if (crit) d *= p.critMul;
  d = Math.max(1, Math.round(d)); e.hp -= d; e.flash = 0.1;
  if (!e.aggro) alertPack(e);
  if (o.kb && e.type !== 'boss') { const a = angTo(p, e); e.kbx += Math.cos(a) * o.kb; e.kby += Math.sin(a) * o.kb; }
  floatText(e.x, e.y - e.r - 4, d + (crit ? '!' : ''), crit ? '#ffd24a' : o.color || '#fff', crit ? 19 : 14);
  if (!o.quiet) sfx(crit ? 'crit' : 'hit', e);
  burst(e.x, e.y, o.color || '#e8e2d0', 3, 120, 2.5);
  if (p.lifesteal) heal(p, d * p.lifesteal);
  if (!o.proc) {
    if (p.venom) { e.poisT = 3; e.poisD = 5 * p.venom; e.poisBy = p; }
    if (p.chain && Math.random() < 0.2 * p.chain) {
      let n = 0; for (const q of enemies) { if (q === e || q.dead || dist(q, e) > 190) continue; addFx({ kind: 'bolt', x: e.x, y: e.y, x2: q.x, y2: q.y, life: 0.15, max: 0.15 }); hitEnemy(p, q, dmg * 0.6, { proc: true, color: '#9fd8ff', quiet: true }); if (++n >= 2) break; }
    }
  }
  if (e.hp <= 0) killEnemy(e, p);
  return d;
}
function killEnemy(e, p) {
  if (e.dead) return; e.dead = true; if (p) p.kills++;
  burst(e.x, e.y, e.type === 'wisp' ? '#8fd0ff' : '#b79bd6', e.elite || e.type === 'boss' ? 40 : 12, 240, 4); sfx('die', e);
  if (e.type === 'boss') { game.boss = null; game.winT = 2.2; shake(20); sfx('boom'); projs = projs.filter(q => q.friendly); zones = zones.filter(z => z.friendly); for (const q of enemies) if (!q.dead) { q.dead = true; burst(q.x, q.y, '#b79bd6', 8); } }
  const n = e.type === 'boss' ? 30 : e.elite ? 8 : 1 + (e.xp > 6 ? 1 : 0);
  for (let i = 0; i < n; i++) drop('xp', e.x, e.y, e.xp / n);
  if (e.elite || Math.random() < 0.35) drop('gold', e.x, e.y, e.elite ? 15 : randi(1, 4));
  if (Math.random() < 0.04 || e.elite) drop('heart', e.x, e.y, 20);
  if (e.elite) drop('sigil', e.x, e.y, 1);
  if (p && p.h.ghost && p.dashes < p.dashMax) p.dashes++;
}
function drop(kind, x, y, val) { const a = rand(TAU), v = rand(40, 170); pickups.push({ id: nextId++, kind, x, y, val, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: rand(TAU) }); }
function alertPack(e) { e.aggro = true; for (const q of enemies) if (!q.aggro && dist(q, e) < 240) q.aggro = true; }
function hurtPlayer(p, dmg) {
  if (p.down || p.iT > 0 || p.hp <= 0 || game.winT > 0 || game.over) return;
  const d = Math.max(1, Math.round(dmg * (1 - Math.min(0.6, p.armor))));
  p.hp -= d; p.iT = 0.55; shake(9, null, p.id); sfx('hurt', null, p.id);
  floatText(p.x, p.y - 30, '-' + d, '#ff6b6b', 17); burst(p.x, p.y, '#ff6b6b', 10, 200);
  if (p.spite) { ring(p.x, p.y, 130, '#ff9b6b'); for (const e of enemies) if (!e.dead && dist(e, p) < 130 + e.r) hitEnemy(p, e, 14 * p.spite + p.dmg, { proc: true, kb: 250, color: '#ff9b6b' }); }
  if (p.hp <= 0) {
    if (p.embers > 0) {
      p.embers--; p.hp = p.maxHp * 0.5; p.iT = 2.5; banner('An Ember rekindles you', p.embers + ' remaining', 2.5, p.id); sfx('ult', p); ring(p.x, p.y, 260, '#ffb347');
      for (const e of enemies) if (!e.dead && dist(e, p) < 260) hitEnemy(p, e, 40, { proc: true, kb: 600 });
    } else {
      p.hp = 0; p.down = true; p.rev = 0; p.flurry = null; p.dashT = 0; p.ultT = 0;
      if (players.every(q => q.down)) { game.over = 'dead'; showEnd(); }
      else banner(p.name + ' has fallen', 'Stand beside them to revive.', 3);
    }
  }
}
function hurtNear(x, y, R, dmg) { for (const q of players) if (!q.down && Math.hypot(q.x - x, q.y - y) < R + q.r) hurtPlayer(q, dmg); }
function meleeArc(p, range, arc, dmg, o = {}) {
  let n = 0;
  addFx({ kind: 'arc', x: p.x, y: p.y, a: p.face, r: range, arc, color: o.color || '#fff', life: 0.14, max: 0.14 });
  for (const e of enemies) {
    if (e.dead || !e.near) continue;
    if (dist(e, p) < range + e.r && Math.abs(angDiff(angTo(p, e), p.face)) < arc / 2 + 0.15) { hitEnemy(p, e, dmg, o); n++; }
  }
  return n;
}
function shoot(x, y, a, speed, o) { projs.push(Object.assign({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, a, r: 6, life: 1, pierce: 0, hit: new Set(), friendly: true, owner: null, color: '#fff', kind: 'bolt' }, o)); }

function doAttack(p) {
  const H = p.hero; p.tAtk = p.atkCd / p.asMul; p.swing = 1;
  if (H === 'bramble') {
    const n = meleeArc(p, 98 * (1 + 0.3 * (p.h.wide || 0)) * (p.ultT > 0 ? 1.25 : 1), 2.3, p.dmg, { kb: 170, color: '#9fe08a' });
    if (p.ultT > 0 && n) heal(p, 2 * n); sfx('slash', p);
  } else if (H === 'wick') {
    const n = 1 + (p.h.fork || 0) + (night > 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) shoot(p.x + Math.cos(p.face) * 18, p.y + Math.sin(p.face) * 18, p.face + (i - (n - 1) / 2) * 0.13, 640, { owner: p, dmg: p.dmg, life: 0.85, pierce: p.h.pierce || 0, color: '#ffb347', kind: 'fire' });
    sfx('bolt', p);
  } else {
    meleeArc(p, 80 * (1 + 0.15 * (p.h.lunar || 0)), 1.7, p.dmg, { kb: 60, color: '#d9ccff' }); sfx('blade', p);
    if (++p.combo % 3 === 0) shoot(p.x, p.y, p.face, 780, { owner: p, dmg: p.dmg * 1.3, life: 0.6, pierce: 2, color: '#e6dcff', kind: 'blade' });
  }
}
function doSkill(p) {
  const H = p.hero, m = p.aim; p.tSkill = HEROES[H].skillCd * p.cdr; sfx('skill', p);
  if (H === 'bramble') {
    const k = p.h.ring || 0, R = 150 * (1 + 0.2 * k); ring(p.x, p.y, R, '#7bc96f'); burst(p.x, p.y, '#7bc96f', 30, 380, 4); shake(5, p);
    for (const e of enemies) if (!e.dead && dist(e, p) < R + e.r) { hitEnemy(p, e, p.dmg * 2.4 * (1 + 0.5 * k), { kb: 220, color: '#9fe08a' }); e.slowT = 2.5; }
  } else if (H === 'wick') {
    const k = p.h.lantern || 0, a = angTo(p, m), d = Math.min(420, dist(p, m));
    zones.push({ kind: 'burn', friendly: true, owner: p, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 110 * (1 + 0.25 * k), delay: 0, life: 5 + 2 * k, max: 5 + 2 * k, dmg: p.dmg * 1.9, tickT: 0, color: '#ffb347', lantern: true });
  } else {
    const n = 5 + 2 * (p.h.fan || 0);
    for (let i = 0; i < n; i++) shoot(p.x, p.y, p.face + (i - (n - 1) / 2) * (1.0 / n), 720, { owner: p, dmg: p.dmg * 1.6, life: 0.65, pierce: 3, color: '#e6dcff', kind: 'blade' });
  }
}
// Movement half of a dash; runs on whichever machine owns the player's position.
function startDashMove(p, a) {
  p.dashA = a;
  if (p.hero === 'wick') { p.x += Math.cos(a) * 190; p.y += Math.sin(a) * 190; collideWorld(p, p.r); } else p.dashT = 0.18;
}
function doDash(p, a) {
  p.dashes--; if (p.dashRe <= 0) p.dashRe = DASH_CD * p.cdr;
  sfx('dash', p); p.dashHit = new Set(); p.iT = Math.max(p.iT, 0.3);
  if (p.hero === 'wick') {
    burst(p.x, p.y, '#ffb347', 14, 200);
    zones.push({ kind: 'burn', friendly: true, owner: p, x: p.x, y: p.y, r: 55, delay: 0, life: 2, max: 2, dmg: p.dmg * 1.5, tickT: 0, color: '#ffb347' });
  }
  if (p.remote) { p.dashA = a; if (p.hero === 'wick') { p.x = p.tx; p.y = p.ty; } else p.dashT = 0.18; } else startDashMove(p, a);
  if (p.hero === 'wick') burst(p.x, p.y, '#ffb347', 14, 200);
}
function doUlt(p) {
  const H = p.hero, m = p.aim; p.tUlt = ULT_CD * p.cdr; sfx('ult', p); shake(8, p);
  if (H === 'bramble') { p.ultT = 8; p.pulse = 0; ring(p.x, p.y, 180, '#7bc96f'); }
  else if (H === 'wick') {
    for (let i = 0; i < 12; i++) { const a = rand(TAU), d = i === 0 ? 0 : rand(40, 210); zones.push({ kind: 'blast', friendly: true, owner: p, x: m.x + Math.cos(a) * d, y: m.y + Math.sin(a) * d, r: 88, delay: 0.5 + i * 0.2, max: 0.5 + i * 0.2, dmg: p.dmg * 4.2, color: '#ff7a2f' }); }
  } else {
    const list = enemies.filter(e => !e.dead && dist(e, p) < 520).sort((a, b) => dist(a, p) - dist(b, p)).slice(0, 8);
    if (!list.length) { p.tUlt = 1; return; }
    if (list.length < 8) { const base = list.slice(); while (list.length < 8) list.push(base[list.length % base.length]); }
    p.flurry = { list, t: 0 };
  }
}

// ---------- update (host / solo) ----------
function collideWorld(o, r) {
  for (const b of world.obs) {
    const dx = o.x - b.x, dy = o.y - b.y, m = r + b.cr; if (Math.abs(dx) > m || Math.abs(dy) > m) continue;
    const d = Math.hypot(dx, dy); if (d < m && d > 0.001) { o.x = b.x + dx / d * m; o.y = b.y + dy / d * m; }
  }
  o.x = clamp(o.x, 30, world.S - 30); o.y = clamp(o.y, 30, world.S - 30);
}
const dashDir = (p, inp) => (inp.mx || inp.my) ? Math.atan2(inp.my, inp.mx) : p.face;
function walk(p, inp, dt) {
  const sp = p.spd * p.spdMul * (p.hero === 'vesper' ? 1 + 0.15 * night : 1) * (inp.l && p.hero !== 'vesper' ? 0.8 : 1);
  p.x += inp.mx * sp * dt; p.y += inp.my * sp * dt; if (inp.mx || inp.my) p.walk += dt;
}
const trail = p => parts.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.25, max: 0.25, color: HEROES[p.hero].color, size: 9 });
function updPlayer(p, inp, dt) {
  p.tAtk -= dt; p.tSkill -= dt; p.tUlt -= dt; p.iT -= dt; p.swing = Math.max(0, p.swing - dt * 6);
  if (p.dashes < p.dashMax) { p.dashRe -= dt; if (p.dashRe <= 0) { p.dashes++; p.dashRe = p.dashes < p.dashMax ? DASH_CD * p.cdr : 0; } }
  p.cds = [p.atkCd / p.asMul, HEROES[p.hero].skillCd * p.cdr, DASH_CD * p.cdr, ULT_CD * p.cdr];
  if (p.down) {
    const near = players.some(q => q !== p && !q.down && dist(q, p) < 75);
    p.rev = near ? p.rev + dt : Math.max(0, p.rev - dt * 0.5);
    if (p.rev >= 3) { p.down = false; p.rev = 0; p.hp = p.maxHp * 0.4; p.iT = 2; sfx('heal', p); ring(p.x, p.y, 90, '#8dff8a'); banner(p.name + ' is back up', '', 2); }
    return;
  }
  p.aim = inp.aim;
  if (!p.remote) { p.face = angTo(p, inp.aim); p.moving = !!(inp.mx || inp.my); }
  if (inp.dash && p.dashes > 0 && p.dashT <= 0 && !p.flurry) doDash(p, p.remote ? num(inp.dashA) : dashDir(p, inp));
  if (p.remote) { const k = Math.min(1, dt * 25); p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; if (p.moving) p.walk += dt; }
  if (p.dashT > 0) {
    p.dashT -= dt; if (!p.remote) { p.x += Math.cos(p.dashA) * 920 * dt; p.y += Math.sin(p.dashA) * 920 * dt; }
    trail(p);
    for (const e of enemies) if (!e.dead && e.near && !p.dashHit.has(e) && dist(e, p) < p.r + e.r + 14) {
      p.dashHit.add(e); hitEnemy(p, e, p.dmg * (p.hero === 'bramble' ? 1.6 : 1.2 * (p.h.ghost ? 2 : 1)), { kb: p.hero === 'bramble' ? 380 : 0, color: HEROES[p.hero].color });
      if (p.h.bulwark) heal(p, 4 * p.h.bulwark);
    }
  } else if (!p.remote) walk(p, inp, dt);
  if (p.flurry) {
    const f = p.flurry; p.iT = Math.max(p.iT, 0.25); f.t -= dt;
    if (f.t <= 0) {
      let e = f.list.shift(); while (e && e.dead) e = f.list.shift();
      if (e) {
        const a = rand(TAU); burst(p.x, p.y, '#cdbcff', 8); addFx({ kind: 'bolt', x: p.x, y: p.y, x2: e.x, y2: e.y, life: 0.2, max: 0.2, color: '#cdbcff' });
        p.x = p.tx = e.x + Math.cos(a) * (e.r + 20); p.y = p.ty = e.y + Math.sin(a) * (e.r + 20); p.tp++; p.face = a + Math.PI; p.swing = 1;
        hitEnemy(p, e, p.dmg * 3.6, { color: '#e6dcff' }); sfx('blade', p); f.t = 0.1;
      }
      if (!f.list.length || !e) p.flurry = null;
    }
  } else {
    if (inp.l && p.tAtk <= 0 && p.dashT <= 0) doAttack(p);
    if (inp.skill && p.tSkill <= 0) doSkill(p);
    if (inp.ult && p.tUlt <= 0) { if (p.level >= 3) doUlt(p); else floatText(p.x, p.y - 34, 'Ultimate unlocks at level 3', '#aaa', 13); }
  }
  if (!p.remote) collideWorld(p, p.r);
  if (p.ultT > 0) { p.ultT -= dt; p.pulse -= dt; if (p.pulse <= 0) { p.pulse = 1; ring(p.x, p.y, 125, '#7bc96f'); for (const e of enemies) if (!e.dead && dist(e, p) < 125 + e.r) hitEnemy(p, e, p.dmg * 1.2, { proc: true, color: '#9fe08a', quiet: true }); } }
  const regen = p.dayRegen * (1 - night) + (p.hero === 'bramble' ? 1.5 * (1 - night) : 0); if (regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + regen * dt);
  if (inp.interact) interact(p);
}
function updFx(dt) {
  for (const q of parts) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.94; q.vy *= 0.94; } parts = parts.filter(q => q.life > 0);
  for (const q of texts) { q.life -= dt; q.y -= 38 * dt; } texts = texts.filter(q => q.life > 0);
  for (const q of fxs) q.life -= dt; fxs = fxs.filter(q => q.life > 0);
  if (game.banner) { game.banner.t -= dt; if (game.banner.t <= 0) game.banner = null; }
  game.shake = Math.max(0, game.shake - dt * 30);
  if (me && world) {
    for (const o of world.pois) if (!o.seen && dist(o, me) < 520) o.seen = true;
    cam.x = clamp(me.x - VW / 2, 0, Math.max(0, world.S - VW)); cam.y = clamp(me.y - VH / 2, 0, Math.max(0, world.S - VH));
  }
}
function update(dt) {
  game.t += dt;
  // clock & day/night
  if (!game.boss && game.winT <= 0) game.time += dt;
  const ct = game.time % CYCLE, isNight = !!game.boss || game.time >= TOTAL || ct >= DAY;
  night += ((isNight ? 1 : 0) - night) * Math.min(1, dt * 1.3);
  if (isNight && !game.wasNight && !game.boss && game.time < TOTAL) {
    banner('Night falls', 'The wood wakes hungry.', 3); sfx('night');
    for (let i = 0; i < 10; i++) for (let k = 0; k < 20; k++) { const q = { x: rand(150, world.S - 150), y: rand(150, world.S - 150) }; if (distAny(q) < 700) continue; spawnPack(q.x, q.y, randi(3, 5), 90); break; }
  }
  if (!isNight && game.wasNight) { banner('Day ' + (dayIdx() + 1), 'A little light. Use it.', 3); sfx('dawn'); }
  game.wasNight = isNight;
  if (!game.boss && game.winT <= 0 && game.time >= TOTAL) spawnBoss();
  if (isNight && !game.boss && game.winT <= 0) {
    game.ambT -= dt;
    if (game.ambT <= 0) {
      game.ambT = rand(6, 9) / (partyMul(PARTY_SCALE.ambushPerExtra) * DIFF(game.diff).ambush); const p = pick(alive());
      if (p) { const a = rand(TAU), n = randi(3, 4) + game.chapter; for (let i = 0; i < n; i++) { const e = spawnEnemy(Math.random() < 0.8 ? 'wisp' : 'husk', p.x + Math.cos(a + rand(-0.6, 0.6)) * rand(520, 640), p.y + Math.sin(a + rand(-0.6, 0.6)) * rand(520, 640)); e.aggro = true; } }
    }
  }
  if (net.mode === 'host' && net.away.size) expireAway();
  if (game.winT > 0) { game.winT -= dt; if (game.winT <= 0) { game.over = game.chapter < CHAPTERS ? 'win' : 'final'; chapterComplete(); showEnd(); return; } }

  // players
  for (const p of players) {
    const inp = p.remote ? p.in : localInput();
    updPlayer(p, inp, dt);
    if (p.remote) { p.in.dash = p.in.ult = p.in.interact = p.in.skill = false; }
    if (game.over) return;
  }
  // enemies
  for (const e of enemies) {
    e.near = false; for (const p of players) if (Math.abs(e.x - p.x) < 1300 && Math.abs(e.y - p.y) < 1000) { e.near = true; break; }
    if (e.near && !e.dead) updEnemy(e, dt);
  }
  const act = enemies.filter(e => e.near && !e.dead && e.aggro);
  for (let i = 0; i < act.length; i++) for (let j = i + 1; j < act.length; j++) {
    const a = act[i], b = act[j], dx = b.x - a.x, dy = b.y - a.y, mm = a.r + b.r; if (Math.abs(dx) > mm || Math.abs(dy) > mm) continue;
    const d = Math.hypot(dx, dy) || 0.01; if (d < mm) { const push = (mm - d) / 2, wa = a.type === 'boss' ? 0 : 1, wb = b.type === 'boss' ? 0 : 1; a.x -= dx / d * push * wa; a.y -= dy / d * push * wa; b.x += dx / d * push * wb; b.y += dy / d * push * wb; }
  }
  // projectiles
  for (const q of projs) {
    q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.x < 0 || q.y < 0 || q.x > world.S || q.y > world.S) q.life = 0;
    for (const b of world.obs) if (Math.abs(q.x - b.x) < b.cr && Math.abs(q.y - b.y) < b.cr && dist(q, b) < b.cr) { q.life = 0; burst(q.x, q.y, q.color, 4, 100, 2); break; }
    if (q.life <= 0) continue;
    if (q.friendly) {
      for (const e of enemies) if (!e.dead && e.near && !q.hit.has(e) && dist(e, q) < e.r + q.r) { q.hit.add(e); hitEnemy(q.owner, e, q.dmg, { kb: 60, color: q.color }); if (q.pierce-- <= 0) { q.life = 0; break; } }
    } else for (const p of players) if (!p.down && dist(q, p) < p.r + q.r - 2) { if (p.iT <= 0) { hurtPlayer(p, q.dmg); q.life = 0; } break; }
  }
  projs = projs.filter(q => q.life > 0);
  // zones
  for (const z of zones) {
    if (z.delay > 0) {
      z.delay -= dt;
      if (z.delay <= 0 && z.kind === 'blast') {
        sfx('boom', z); burst(z.x, z.y, z.color, 22, 320, 5); ring(z.x, z.y, z.r, z.color); shake(5, z);
        if (z.friendly) { for (const e of enemies) if (!e.dead && dist(e, z) < z.r + e.r) hitEnemy(z.owner, e, z.dmg, { kb: 200, color: z.color }); }
        else hurtNear(z.x, z.y, z.r - 4, z.dmg);
        z.life = 0;
      }
      continue;
    }
    if (z.kind === 'burn') {
      z.life -= dt; z.tickT -= dt;
      if (Math.random() < 0.5) parts.push({ x: z.x + rand(-z.r, z.r) * 0.7, y: z.y + rand(-z.r, z.r) * 0.7, vx: 0, vy: -50, life: 0.5, max: 0.5, color: z.color, size: 3 });
      if (z.tickT <= 0) { z.tickT = 0.25; for (const e of enemies) if (!e.dead && dist(e, z) < z.r + e.r) hitEnemy(z.owner, e, z.dmg * 0.25, { proc: true, color: '#ffb347', quiet: true }); }
    }
  }
  zones = zones.filter(z => z.kind === 'blast' ? z.life !== 0 : z.life > 0);
  // pickups — experience, gold and sigils are shared by the whole party
  for (const k of pickups) {
    k.t += dt; k.x += k.vx * dt; k.y += k.vy * dt; k.vx *= Math.pow(0.02, dt); k.vy *= Math.pow(0.02, dt);
    const p = nearestPlayer(k); if (!p) continue; const d = dist(k, p);
    if (k.kind === 'heart' && p.hp >= p.maxHp) continue;
    if (d < p.pickR) { const a = angTo(k, p), v = 520 * (1 - d / (p.pickR * 1.4)) + 120; k.x += Math.cos(a) * v * dt; k.y += Math.sin(a) * v * dt; }
    if (d < 20) {
      k.dead = true;
      if (k.kind === 'xp') { for (const q of players) gainXp(q, k.val); sfx('xp', p); }
      else if (k.kind === 'gold') { for (const q of players) q.gold += k.val; sfx('gold', p); }
      else if (k.kind === 'heart') { heal(p, k.val); sfx('heal', p); }
      else if (k.kind === 'sigil') { for (const q of players) { q.pending++; q.choiceTitle = 'Sigil claimed'; } sfx('level'); }
    }
  }
  pickups = pickups.filter(k => !k.dead);
  enemies = enemies.filter(e => !e.dead);
  for (const p of players) if (p.pending > 0 && !p.choice) rollChoice(p);
  updFx(dt);
}
function gainXp(p, v) {
  p.xp += v * p.xpMul;
  while (p.xp >= xpNeed(p.level)) { p.xp -= xpNeed(p.level); p.level++; p.pending++; p.choiceTitle = 'Level ' + p.level; sfx('level', null, p.id); ring(p.x, p.y, 120, '#f3d48a'); if (p.level === 3) banner('Ultimate unlocked', 'Press Q', 3, p.id); }
}
function updEnemy(e, dt) {
  e.flash -= dt;
  if (e.poisT > 0) { e.poisT -= dt; e.poisTick -= dt; if (e.poisTick <= 0) { e.poisTick = 0.5; e.hp -= e.poisD * 0.5; floatText(e.x, e.y - e.r, Math.round(e.poisD * 0.5), '#a6e36a', 12); if (e.hp <= 0) { killEnemy(e, e.poisBy); return; } } }
  const p = nearestPlayer(e); if (!p) return;
  const d = dist(e, p);
  if (!e.aggro) { if (d < 380 + 110 * night) alertPack(e); else return; }
  e.t -= dt; e.cd -= dt;
  const slow = e.slowT > 0 ? 0.45 : 1; if (e.slowT > 0) e.slowT -= dt;
  const sp = e.spd * slow * (1 + 0.15 * night), a = angTo(e, p), ca = Math.cos(a), sa = Math.sin(a), dm = dmgOf(e);
  let mx = 0, my = 0;
  switch (e.type) {
    case 'husk':
      if (e.state === 'wind') {
        if (e.t <= 0) {
          e.state = 'rest'; e.t = 0.55; e.kbx += Math.cos(e.a) * 380; e.kby += Math.sin(e.a) * 380; addFx({ kind: 'arc', x: e.x, y: e.y, a: e.a, r: e.r + 34, arc: 1.6, color: '#d9a6ff', life: 0.14, max: 0.14 });
          for (const q of players) if (!q.down && dist(e, q) < e.r + q.r + 38 && Math.abs(angDiff(angTo(e, q), e.a)) < 1.1) hurtPlayer(q, dm);
        }
      }
      else if (e.state === 'rest') { if (e.t <= 0) e.state = 'chase'; }
      else if (d < e.r + p.r + 24) { e.state = 'wind'; e.t = 0.4; e.a = a; }
      else { mx = ca * sp; my = sa * sp; }
      break;
    case 'spitter':
      if (e.state === 'wind') { if (e.t <= 0) { const n = e.elite ? 3 : 1; for (let i = 0; i < n; i++) shoot(e.x, e.y, a + (i - (n - 1) / 2) * 0.28, 270, { friendly: false, dmg: dm, life: 2.4, r: 7, color: '#b6f25a', kind: 'spit' }); sfx('spit', e); e.state = 'chase'; e.cd = rand(1.6, 2.4); } }
      else {
        if (d > 300) { mx = ca * sp; my = sa * sp; } else if (d < 170) { mx = -ca * sp; my = -sa * sp; } else { const s = e.ph > Math.PI ? 1 : -1; mx = -sa * sp * 0.5 * s; my = ca * sp * 0.5 * s; }
        if (e.cd <= 0 && d < 430) { e.state = 'wind'; e.t = 0.45; }
      }
      break;
    case 'ram':
      if (e.state === 'wind') { if (e.t > 0.25) e.a = a; if (e.t <= 0) { e.state = 'charge'; e.t = 0.65; } }
      else if (e.state === 'charge') { mx = Math.cos(e.a) * 580 * slow; my = Math.sin(e.a) * 580 * slow; hurtNear(e.x, e.y, e.r + 4, dm); if (e.t <= 0) { e.state = 'rest'; e.t = 1.1; e.cd = 1.5; } }
      else if (e.state === 'rest') { if (e.t <= 0) e.state = 'chase'; }
      else if (d < 340 && e.cd <= 0) { e.state = 'wind'; e.t = 0.75; e.a = a; sfx('warn', e); }
      else { mx = ca * sp; my = sa * sp; }
      break;
    case 'bloat':
      if (e.state === 'fuse') { if (e.t <= 0) { const R = 96 * (e.elite ? 1.4 : 1); ring(e.x, e.y, R, '#ff9b3d'); burst(e.x, e.y, '#ff9b3d', 24, 300, 5); sfx('boom', e); hurtNear(e.x, e.y, R, dm); killEnemy(e, null); return; } }
      else if (d < 64) { e.state = 'fuse'; e.t = 0.65; sfx('warn', e); }
      else { mx = ca * sp; my = sa * sp; }
      break;
    case 'wisp': {
      const a2 = a + Math.sin(game.t * 3 + e.ph) * 0.7; mx = Math.cos(a2) * sp; my = Math.sin(a2) * sp;
      if (d < e.r + p.r + 2 && e.cd <= 0) { hurtPlayer(p, dm); e.cd = 0.9; }
      break;
    }
    case 'boss': {
      const rage = e.hp < e.maxHp * 0.5;
      if (e.state === 'chase') {
        if (d > 80) { mx = ca * sp * (rage ? 1.25 : 1); my = sa * sp * (rage ? 1.25 : 1); }
        if (d < e.r + p.r && e.cd <= 0) { hurtPlayer(p, dm); e.cd = 0.8; }
        if (e.t <= 0) {
          const r = Math.random(), tg = pick(alive()) || p;
          if (r < 0.34) { e.state = 'bwind'; e.t = 0.9; e.a = a; e.n = rage ? 2 : 0; sfx('warn', e); }
          else if (r < 0.62) { e.state = 'ring'; e.t = rage ? 1.7 : 1.2; e.cd = 0; e.n = 0; }
          else if (r < 0.86 || !rage) {
            e.state = 'slam'; e.t = 1.3; const n = 5 + game.chapter + (rage ? 2 : 0);
            for (let i = 0; i < n; i++) { const q = rand(TAU), dd = i === 0 ? 0 : rand(70, 250); zones.push({ kind: 'blast', friendly: false, x: tg.x + Math.cos(q) * dd, y: tg.y + Math.sin(q) * dd, r: 84, delay: 0.9 + i * 0.13, max: 0.9 + i * 0.13, dmg: dm, color: '#c23bff' }); }
          } else { for (let i = 0; i < 4; i++) { const w = spawnEnemy('wisp', e.x + rand(-80, 80), e.y + rand(-80, 80)); w.aggro = true; } ring(e.x, e.y, 120, '#8fd0ff'); e.t = 2; }
        }
      } else if (e.state === 'bwind') { if (e.t > 0.3) e.a = a; if (e.t <= 0) { e.state = 'bcharge'; e.t = 0.75; sfx('dash', e); } }
      else if (e.state === 'bcharge') {
        mx = Math.cos(e.a) * 720; my = Math.sin(e.a) * 720; hurtNear(e.x, e.y, e.r + 4, dm * 1.3);
        if (e.t <= 0) { if (e.n-- > 0) { e.state = 'bwind'; e.t = 0.55; e.a = a; } else { e.state = 'chase'; e.t = rand(1.5, 2.3); } }
      } else if (e.state === 'ring') {
        if (e.cd <= 0) { e.cd = 0.42; const N = 16, off = e.n++ * 0.2; for (let i = 0; i < N; i++) shoot(e.x, e.y, off + i * TAU / N, 230, { friendly: false, dmg: dm * 0.7, life: 3, r: 8, color: '#c23bff', kind: 'spit' }); sfx('spit', e); }
        if (e.t <= 0) { e.state = 'chase'; e.t = rand(1.5, 2.3); }
      } else if (e.state === 'slam') { if (e.t <= 0) { e.state = 'chase'; e.t = rand(1.2, 2); } }
      break;
    }
  }
  e.x += (mx + e.kbx) * dt; e.y += (my + e.kby) * dt; const f = Math.pow(0.003, dt); e.kbx *= f; e.kby *= f;
  if (mx || my) e.dir = mx < 0 ? -1 : 1;
  collideWorld(e, e.type === 'boss' ? 20 : e.r);
}
function nearPoi(p) { let best = null, bd = 80; for (const o of world.pois) { if (o.kind === 'camp') continue; const d = dist(o, p); if (d < bd) { bd = d; best = o; } } return best; }
const merchCost = o => 40 + 30 * o.uses;
function poiPrompt(o) {
  switch (o.kind) {
    case 'altar': return o.used ? null : 'Wake the Gloam Stag early';
    case 'spring': return o.used ? null : 'Drink from the spring';
    case 'chest': return o.used ? null : 'Open cache';
    case 'shrine': return o.used ? null : 'Pray at the wayshrine';
    case 'merchant': return 'Buy a boon — ' + merchCost(o) + ' gold';
  }
}
function interact(p) {
  const o = nearPoi(p); if (!o || !poiPrompt(o)) return;
  if (o.kind === 'altar') spawnBoss();
  else if (o.kind === 'spring') { o.used = true; for (const q of players) heal(q, q.maxHp * 0.6); sfx('heal'); ring(o.x, o.y, 90, '#7fd6ff'); }
  else if (o.kind === 'chest') { o.used = true; sfx('pick', o); for (let i = 0; i < 6; i++) drop('gold', o.x, o.y, randi(3, 6)); for (let i = 0; i < 5; i++) drop('xp', o.x, o.y, 4 + game.chapter * 2); if (Math.random() < 0.3) drop('heart', o.x, o.y, 20); }
  else if (o.kind === 'shrine') {
    o.used = true; sfx('pick'); ring(o.x, o.y, 90, '#f3d48a'); const r = randi(0, 2);
    for (const q of players) { if (r === 0) q.dmgMul += 0.08; else if (r === 1) { q.maxHp += 15; heal(q, 15); } else { q.spdMul += 0.05; q.crit += 0.04; } }
    banner(['Blessing of Teeth', 'Blessing of Root', 'Blessing of Wind'][r], ['+8% damage', '+15 max health', '+5% speed, +4% crit'][r], 2.5);
  } else if (o.kind === 'merchant') {
    const c = merchCost(o); if (p.gold < c) { floatText(p.x, p.y - 34, 'Not enough gold', '#ff9b6b', 14); sfx('warn', null, p.id); return; }
    p.gold -= c; o.uses++; p.pending++; p.choiceTitle = 'The Peddler\'s wares'; sfx('gold', null, p.id);
  }
}
function rollChoice(p) {
  const pool = TALENTS.filter(t => (!t.hero || t.hero === p.hero) && (p.talents[t.id] || 0) < t.max);
  if (!pool.length) { p.pending = 0; p.gold += 30; return; }
  const list = [];
  while (list.length < 3 && pool.length) { const w = pool.map(t => t.hero ? 2 : 1), tot = w.reduce((a, b) => a + b, 0); let r = rand(tot), i = 0; while (i < w.length - 1 && r > w[i]) r -= w[i++]; list.push(pool.splice(i, 1)[0]); }
  p.choice = list; p.choiceSeq++;
}
function applyPick(p, i) {
  const t = p.choice && p.choice[i]; if (!t) return;
  p.talents[t.id] = (p.talents[t.id] || 0) + 1; t.f(p); sfx('pick', null, p.id); p.pending--; p.choice = null;
}

// ---------- chapter rewards (host decides; meta.js holds odds and pools) ----------
// Eligible: every player in the session when the chapter ends, including disconnected players whose slot is still held.
// One roll per player per chapter. Claims are keyed run:chapter:profile, so repeated completion events, reconnects and
// duplicate players with the same profile can never roll twice.
function chapterComplete() {
  if (net.mode === 'client') return;
  const key = game.runId + ':' + game.chapter; if (net.rolled.has(key)) return; net.rolled.add(key);
  const list = [], seen = new Set();
  for (const p of players.concat([...net.away.values()].map(a => a.p))) {
    const pid = p.lo && p.lo.pid; if (!pid || seen.has(pid)) continue; seen.add(pid);
    const claim = key + ':' + pid;
    let r = net.claims.get(claim);
    if (!r) { const roll = rollReward(p.lo); r = { claim, pid, id: p.id, name: p.name, rarity: roll.rarity, item: roll.item, ch: game.chapter, diff: game.diff, run: game.runId, final: game.over === 'final' }; net.claims.set(claim, r); }
    list.push(r); deliverReward(r);
  }
  game.rewards = list.map(r => ({ id: r.id, name: r.name, rarity: r.rarity, item: r.item }));
  for (const c of net.conns) if (c.inGame) c.send({ t: 'rewards', ch: game.chapter, list: game.rewards });
}
// Sends (or, for the host, applies) one player's result. Receivers ignore claims they already applied.
function deliverReward(r) {
  const msg = { t: 'reward', claim: r.claim, rarity: r.rarity, item: r.item, ch: r.ch, diff: r.diff, run: r.run, final: r.final };
  if (r.id === 1 && net.mode !== 'client') return receiveReward(msg);
  const c = net.conns.find(q => q.pid === r.id && q.inGame); if (c) c.send(msg);
}
// Runs on the player's own device: saves the reward and, after chapter 5, the campaign clear.
function receiveReward(m) {
  if (typeof m.claim !== 'string' || !m.claim.endsWith(':' + PROFILE.id)) return;
  const valid = m.rarity === null || (RARITIES.includes(m.rarity) && typeof m.item === 'string' && (m.item === 'keepsake' || itemAvailable(m.item, { weapons: [], talents: {}, upgrades: {}, characters: [] }) || /^u:/.test(m.item)));
  if (!valid) return;
  if (grantReward(PROFILE, m.claim, m.rarity, m.rarity ? m.item : null, { chapter: m.ch, diff: m.diff })) {
    if (m.rarity) banner(rarityName(m.rarity) + ' reward', itemLabel(m.item), 4, me && me.id);
  }
  if (m.final) { const un = recordCampaignClear(PROFILE, m.diff, m.run); if (un) setTimeout(() => banner(DIFF(un).name + ' unlocked', 'Campaign cleared on ' + DIFF(m.diff).name, 5), 4200); }
  saveMe();
}
const rarityName = r => RARITY_NAMES[r] || '';
// Mixed unlocks: a party may only play a difficulty that every player in the lobby has unlocked.
const lobbyUnlocks = () => net.lobby.map(q => q.id === 1 ? PROFILE.unlocked : (q.lo && q.lo.unlocked) || ['normal']);
const partyDiffOk = d => lobbyUnlocks().every(u => u.includes(d));
const bestCommonDiff = () => DIFFICULTIES.filter(d => partyDiffOk(d.id)).pop().id;
// A disconnected player's slot is held for PARTY_SCALE.graceSeconds, then released.
function expireAway() {
  const now = Date.now();
  for (const [tok, a] of net.away) if (now - a.since > PARTY_SCALE.graceSeconds * 1000) { net.away.delete(tok); banner(a.p.name + "'s place was released", '', 3); }
}

// ---------- netcode ----------
const PEER_PREFIX = 'duskbound-v1-';
const noNetMsg = () => window.DUSK_NO_NET ? 'Online co-op is not available on this page. Solo works here; for co-op, open the downloaded duskbound.html file or a copy on your own website.' : 'Online play needs an internet connection (the networking library did not load).';
function wrapConn(c) {
  const w = { send: d => { try { c.send(d); } catch (e) { } }, onData: null, onClose: null, close: () => { try { c.close(); } catch (e) { } } };
  c.on('data', d => w.onData && w.onData(d)); c.on('close', () => w.onClose && w.onClose()); c.on('error', () => w.onClose && w.onClose());
  return w;
}
// Transport: WebRTC data channels brokered by the public PeerJS signalling server. Replaceable for tests.
let NetT = {
  ok: () => typeof Peer !== 'undefined' && !window.DUSK_NO_NET,
  host(code, h) {
    const peer = new Peer(PEER_PREFIX + code);
    peer.on('open', () => h.open()); peer.on('connection', c => c.on('open', () => h.conn(wrapConn(c)))); peer.on('error', e => h.error(e.type || 'error'));
    return { close: () => peer.destroy() };
  },
  join(code, h) {
    const peer = new Peer();
    peer.on('open', () => { const c = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' }); c.on('open', () => h.open(wrapConn(c))); });
    peer.on('error', e => h.error(e.type || 'error'));
    return { close: () => peer.destroy() };
  }
};
// Transport 2: claude.ai's live room, for the claude.ai build where WebRTC is blocked.
// Host -> guest: room events addressed to that guest (the host must be the page's owner, an Editor or a Contributor).
// Guest -> host: the guest's presence object, which every signed-in viewer may set, so guests need only view access.
// Payloads are deflated, base64'd and split to fit the 4 KiB message limit. Reliable messages carry sequence numbers
// and are resent until acknowledged; snapshots and plain input are latest-wins and may drop.
function makeRoomNet() {
  let ns; const nsP = window.claude.use('room').then(r => (ns = r), () => (ns = null));
  const CH = 3000, sleep = ms => new Promise(r => setTimeout(r, ms)), roomName = code => 'duskbound-' + code.toLowerCase();
  const canZ = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const stream = (bytes, t) => new Response(new Blob([bytes]).stream().pipeThrough(t)).arrayBuffer().then(b => new Uint8Array(b));
  async function pack(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (canZ && raw.length > 500) try { return { z: 1, s: b64(await stream(raw, new CompressionStream('deflate'))) }; } catch (e) { }
    return { z: 0, s: b64(raw) };
  }
  async function unpack(z, s) {
    let u8 = Uint8Array.from(atob(s), c => c.charCodeAt(0));
    if (z) u8 = await stream(u8, new DecompressionStream('deflate'));
    return JSON.parse(new TextDecoder().decode(u8));
  }
  // Collects the parts of one message; resolves the decoded payload once all have arrived.
  function gather(bufs, d) {
    let b = bufs.get(d.s); if (!b) { b = { n: d.n, z: d.z, parts: [], got: 0 }; bufs.set(d.s, b); }
    if (typeof d.d !== 'string' || d.i < 0 || d.i >= b.n || b.parts[d.i] != null) return null;
    b.parts[d.i] = d.d; if (++b.got < b.n) return null;
    bufs.delete(d.s); return unpack(b.z, b.parts.join(''));
  }
  const code = e => (e && e.code) || 'error';
  async function open(name, fail) {
    await nsP;
    if (!ns) { let u = null; try { u = await window.claude.use('user'); } catch (e) { } fail(u ? 'no-room' : 'signed-out'); return null; }
    try { return await ns.join(name); } catch (e) { fail(code(e)); return null; }
  }
  return {
    ok: () => true,
    snapIv: n => n <= 1 ? 1 / 15 : n === 2 ? 0.1 : 0.13,
    inIv: 1 / 20,
    host(gameCode, h) {
      let room = null, closed = false, iv = 0; const guests = new Map(), refused = new Set();
      const emit = m => room.emit('m', m).catch(e => { if (code(e) === 'not_permitted' && !closed) { handle.close(); h.error('not-allowed-to-host'); } });
      const handle = { close() { closed = true; clearInterval(iv); for (const g of guests.values()) g.closed = true; guests.clear(); if (room) room.leave().catch(() => { }); } };
      function out(g, d, rel) {
        if (g.closed) return;
        const id = rel ? ++g.outSeq : ++g.uId, rec = { parts: null, t: Date.now() };
        if (rel) g.unacked.set(id, rec);
        pack(d).then(pk => {
          if (g.closed) return; const n = Math.max(1, Math.ceil(pk.s.length / CH));
          rec.parts = []; for (let i = 0; i < n; i++) rec.parts.push({ to: g.peer, k: rel ? 'r' : 'u', s: id, i, n, z: pk.z, d: pk.s.slice(i * CH, (i + 1) * CH) });
          for (const m of rec.parts) emit(Object.assign({ a: g.inSeq }, m));
        });
      }
      function deliver(g, d) { if (!g.closed && g.conn.onData && d && typeof d === 'object') g.conn.onData(d); }
      function fromGuest(p) {
        if (p.sameTab || refused.has(p.peer)) return; const pr = p.presence || {};
        if (pr.role !== 'guest' || pr.code !== gameCode) return;
        let g = guests.get(p.peer);
        if (!g) {
          g = { peer: p.peer, inSeq: 0, uSeq: 0, outSeq: 0, uId: 0, unacked: new Map(), closed: false };
          g.conn = { send: d => out(g, d, !(d && d.t === 's')), onData: null, onClose: null, close: () => { g.closed = true; guests.delete(g.peer); refused.add(g.peer); } };
          guests.set(p.peer, g); h.conn(g.conn); if (g.closed) return;
        }
        const ack = num(pr.ack, 0); for (const s of g.unacked.keys()) if (s <= ack) g.unacked.delete(s);
        let got = false;
        if (Array.isArray(pr.out)) for (const e of pr.out.slice().sort((a, b) => a[0] - b[0])) if (Array.isArray(e) && e[0] > g.inSeq) { g.inSeq = e[0]; got = true; deliver(g, e[1]); }
        if (got && !g.closed) emit({ to: g.peer, k: 'a', a: g.inSeq });
        if (Array.isArray(pr.u) && pr.u[0] > g.uSeq) { g.uSeq = pr.u[0]; deliver(g, pr.u[1]); }
      }
      function left(peer) { refused.delete(peer); const g = guests.get(peer); if (!g) return; guests.delete(peer); g.closed = true; if (g.conn.onClose) g.conn.onClose(); }
      function resend() {
        const now = Date.now();
        for (const g of guests.values()) { let k = 0; for (const [, r] of g.unacked) { if (++k > 3) break; if (r.parts && now - r.t > 700) { r.t = now; for (const m of r.parts) emit(Object.assign({ a: g.inSeq }, m)); } } }
      }
      (async () => {
        room = await open(roomName(gameCode), t => !closed && h.error(t)); if (!room) return; if (closed) return room.leave().catch(() => { });
        await sleep(1200); if (closed) return;
        if (room.peers().some(p => !p.sameTab && p.presence && p.presence.role === 'host')) { handle.close(); return h.error('unavailable-id'); }
        room.presence({ role: 'host', code: gameCode }).catch(() => { });
        room.onPeers(ch => { if (closed) return; for (const p of ch.left) left(p.peer); for (const p of ch.joined.concat(ch.updated)) fromGuest(p); });
        iv = setInterval(resend, 300); h.open();
      })();
      return handle;
    },
    join(gameCode, h) {
      let room = null, closed = false, hostPeer = null, conn = null, outSeq = 0, uS = 0, inSeq = 0, uDone = 0, chain = Promise.resolve(), outQ = [];
      const rBufs = new Map(), uBufs = new Map(), done = new Map();
      const handle = { close() { closed = true; if (room) room.leave().catch(() => { }); } };
      const myPeer = () => { const p = room.peers().find(p => p.sameTab); return p && p.peer; };
      const findHost = () => { if (!hostPeer) { const p = room.peers().find(p => !p.sameTab && p.presence && p.presence.role === 'host' && p.presence.code === gameCode); if (p) hostPeer = p.peer; } return hostPeer; };
      const pres = patch => room.presence(patch).catch(() => { });
      function onMsg(m) {
        if (closed || m.sameTab || m.peer !== hostPeer || !conn) return; const d = m.data;
        if (!d || typeof d !== 'object' || d.to !== myPeer()) return;
        if (typeof d.a === 'number') { const n = outQ.length; outQ = outQ.filter(e => e[0] > d.a); if (outQ.length !== n) pres({ out: outQ }); }
        if (d.k === 'r' && d.s > inSeq && !done.has(d.s)) {
          const p = gather(rBufs, d); if (!p) return;
          done.set(d.s, p.catch(() => null));
          // deliver reliable messages strictly in order
          chain = chain.then(async () => { while (done.has(inSeq + 1)) { const v = await done.get(inSeq + 1); done.delete(++inSeq); if (!closed && v && conn.onData) conn.onData(v); } pres({ ack: inSeq }); });
        } else if (d.k === 'r') pres({ ack: inSeq });
        else if (d.k === 'u' && d.s > uDone) {
          for (const s of uBufs.keys()) if (s < d.s - 4) uBufs.delete(s);
          const p = gather(uBufs, d); if (p) p.then(v => { if (!closed && d.s > uDone && conn.onData) { uDone = d.s; conn.onData(v); } }, () => { });
        }
      }
      (async () => {
        room = await open(roomName(gameCode), t => !closed && h.error(t)); if (!room) return; if (closed) return room.leave().catch(() => { });
        pres({ role: 'guest', code: gameCode, out: [], ack: 0 });
        room.on('m', onMsg);
        room.onPeers(ch => { if (closed) return; findHost(); if (hostPeer && ch.left.some(p => p.peer === hostPeer) && conn && conn.onClose) { closed = true; conn.onClose(); } });
        const t0 = Date.now(); while (!closed && !findHost() && Date.now() - t0 < 8000) await sleep(200);
        if (closed) return; if (!hostPeer) { handle.close(); return h.error('peer-unavailable'); }
        conn = {
          send(d) {
            if (closed || !d) return;
            if (d.t === 'i' && d.d == null && !d.q && !d.i) { pres({ u: [++uS, d] }); return; }
            outQ.push([++outSeq, d]); while (outQ.length > 1 && JSON.stringify(outQ).length > 3000) outQ.shift();
            pres({ out: outQ });
          },
          onData: null, onClose: null, close: () => handle.close()
        };
        h.open(conn);
      })();
      return handle;
    }
  };
}
if (window.DUSK_NO_NET && window.claude && typeof window.claude.use === 'function') { NetT = makeRoomNet(); NetT.hint = ' of this same page (it must be shared with them)'; }
function genCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += pick(A); return s; }
function leaveNet() {
  if (net.handle) { try { net.handle.close(); } catch (e) { } }
  net.handle = null; net.host = null; net.conns = []; net.lobby = []; net.mode = 'solo'; net.ready = false; net.myId = 1;
}
function netFail(msg) { leaveNet(); showMenu(msg); }
// Plain-language reasons for transport errors (the claude.ai room transport reports its own codes).
const netWhy = t => ({
  'signed-out': 'Co-op here needs you signed in to claude.ai. Sign in to claude.ai in this browser, then open the page link again. (Solo works without signing in.)',
  'no-room': 'Live rooms are not available in this view. Open the page link directly in Safari or Chrome while signed in to claude.ai — not through a public share link, and not inside another app.',
  'not-allowed-to-host': 'Only the page owner, or people given Edit or Contribute access, can host here. You can still join a room.',
  not_permitted: 'This page is not allowed to open live rooms for you.', limit_reached: 'Too many rooms are open right now. Try again in a minute.',
  upstream_error: 'The live connection did not answer. Try again.'
})[t];
// Rejoining: each device keeps a random token (never shown to other players) and the last room it joined.
// Per-session rejoin secret issued privately by the host (not the profile id, not a connection id).
function rejoinSecret(code) { try { const r = JSON.parse(localStorage.getItem('duskbound-rejoin') || 'null'); if (r && r.code === code && /^[a-z0-9]{24}$/.test(r.s)) return r.s; } catch (e) { } return ''; }
function rememberRoom(code) { try { localStorage.setItem('duskbound-room', JSON.stringify({ code, t: Date.now() })); } catch (e) { } }
function lastRoom() { try { const r = JSON.parse(localStorage.getItem('duskbound-room') || 'null'); if (r && /^[A-Z0-9]{5}$/.test(r.code) && Date.now() - r.t < 3 * 3600e3) return r.code; } catch (e) { } return ''; }
const cleanName = (s, i) => (String(s || '').replace(/[^\w \-'.]/g, '').trim().slice(0, 14)) || ('Wanderer ' + i);
function hostGame() {
  if (!NetT.ok()) return showMenu(noNetMsg());
  initAudio(); leaveNet();
  net.mode = 'host'; net.code = genCode(); net.myId = 1; net.nextPid = 2; net.lobby = [{ id: 1, name: cleanName(net.name, 1), hero: net.hero }];
  const handle = net.handle = NetT.host(net.code, {
    open() { if (net.handle === handle) { net.ready = true; if (game.state === 'lobby') showLobby(); } },
    conn(c) { if (net.handle === handle) onClientConn(c); else c.close(); },
    error(t) { if (net.handle !== handle) return; if (t === 'unavailable-id') hostGame(); else if (!net.ready || netWhy(t)) netFail(netWhy(t) || 'Could not open a room (' + t + '). Check your connection and try again.'); }
  });
  game.state = 'lobby'; showLobby(); startTicker();
}
// A connection says hello first; only then do we know whether it is a new player (lobby only)
// or a teammate coming back to a run in progress (matched by the token their device keeps).
function onClientConn(c) {
  c.refuse = why => { c.pending = false; c.send({ t: 'no', why }); setTimeout(() => c.close(), 600); };
  c.pending = true; c.pid = 0; c.inGame = false;
  c.onData = d => { try { hostRecv(c, d); } catch (e) { console.error(e); } }; c.onClose = () => dropClient(c);
  setTimeout(() => { if (c.pending) { c.pending = false; c.close(); } }, 15000);
}
function greetClient(c, d) {
  c.pending = false;
  const tok = typeof d.tok === 'string' ? d.tok.slice(0, 40) : '', name = cleanName(d.name, net.nextPid), hero = HEROES[d.hero] ? d.hero : 'bramble';
  const lo = sanitizeLoadout(d.lo, hero);
  if (game.state === 'lobby') {
    if (net.conns.length >= 3) return c.refuse('That party is full (4 players).');
    if (lo.valid && (lo.pid === PROFILE.id || net.lobby.some(q => q.lo && q.lo.pid === lo.pid))) return c.refuse('That profile is already in this party.');
    const secret = randId(24);
    c.pid = net.nextPid++; net.conns.push(c); net.lobby.push({ id: c.pid, name, hero, tok: secret, lo: lo.valid ? lo : null });
    c.send({ t: 'secret', code: net.code, s: secret });
    if (!partyDiffOk(net.diff)) net.diff = bestCommonDiff();
    sendLobby(); showLobby(); return;
  }
  if (tok && game.state === 'play') {
    expireAway();
    // their old connection may not have timed out yet (e.g. the app crashed a moment ago): retire it first
    const live = players.find(p => p.remote && p.tok === tok), old = live && net.conns.find(q => q.pid === live.id);
    // the secret alone isn't enough: the profile must match too, and nobody is disconnected until it does
    if (live && live.lo && (!lo.valid || live.lo.pid !== lo.pid)) return c.refuse('That party has already set out. Ask the host to return to the lobby.');
    if (old) { dropClient(old); old.send({ t: 'no', why: 'You rejoined this game from another window.' }); setTimeout(() => old.close(), 600); }
    const a = net.away.get(tok); if (a && (!a.p.lo || (lo.valid && a.p.lo.pid === lo.pid))) return rejoinClient(c, a.p);
  }
  c.refuse('That party has already set out. Ask the host to return to the lobby.');
}
function rejoinClient(c, p) {
  net.away.delete(p.tok); c.pid = p.id; c.inGame = true; net.conns.push(c);
  net.lobby.push({ id: p.id, name: p.name, hero: p.hero, tok: p.tok, lo: p.lo });
  const mate = players.find(q => !q.down) || players[0];
  if (mate) { p.x = p.tx = clamp(mate.x + rand(-50, 50), 30, world.S - 30); p.y = p.ty = clamp(mate.y + rand(-50, 50), 30, world.S - 30); }
  p.tp++; p.dashT = 0; p.flurry = null; p.in = newPlayer(0, p.hero, '').in; p.iT = Math.max(p.iT, 2);
  players.push(p);
  c.send(worldMsg(p.id));
  for (const q of net.conns) if (q !== c && q.inGame) q.send({ t: 'roster', players: roster() });
  banner(p.name + ' rejoined the party', '', 2.5);
  // results they missed while away: same claims, so nothing is rolled again
  for (const r of net.claims.values()) if (r.id === p.id) deliverReward(r);
  if (game.rewards) c.send({ t: 'rewards', ch: game.chapter, list: game.rewards });
}
const roster = () => players.map(p => ({ id: p.id, name: p.name, hero: p.hero, x: p.x, y: p.y, tp: p.tp }));
function dropClient(c) {
  const i = net.conns.indexOf(c); if (i < 0) return; net.conns.splice(i, 1);
  const entry = net.lobby.find(q => q.id === c.pid); net.lobby = net.lobby.filter(q => q.id !== c.pid);
  if (game.state === 'lobby') { sendLobby(); showLobby(); }
  else if (game.state === 'play') {
    const p = players.find(q => q.id === c.pid); players = players.filter(q => q.id !== c.pid);
    // keep the hero (level, boons, gold) so they can come back to this run
    if (p && p.tok) { net.away.set(p.tok, { p, since: Date.now() }); banner(p.name + ' lost connection', 'They can rejoin with room code ' + net.code + ' within ' + Math.round(PARTY_SCALE.graceSeconds / 60) + ' min', 3.5); }
    else if (entry) banner(entry.name + ' left the party', '', 2.5);
    if (!game.over && players.every(q => q.down)) { game.over = 'dead'; showEnd(); }
  }
}
function sendLobby() { const pl = net.lobby.map(q => ({ id: q.id, name: q.name, hero: q.hero, unl: q.id === 1 ? PROFILE.unlocked : (q.lo && q.lo.unlocked) || ['normal'] })); for (const c of net.conns) c.send({ t: 'lobby', you: c.pid, code: net.code, diff: net.diff, players: pl }); }
function hostRecv(c, d) {
  if (!d || typeof d !== 'object') return;
  if (c.pending) { if (d.t === 'hello') greetClient(c, d); return; }
  if (!net.conns.includes(c)) return;
  if (d.t === 'hero') { const q = net.lobby.find(q => q.id === c.pid); if (q && HEROES[d.hero] && game.state === 'lobby') { q.hero = d.hero; const lo = sanitizeLoadout(d.lo, d.hero); if (lo.valid && q.lo && lo.pid === q.lo.pid) q.lo = lo; if (!partyDiffOk(net.diff)) net.diff = bestCommonDiff(); sendLobby(); showLobby(); } }
  else if (d.t === 'i' || d.t === 'pick') {
    const p = players.find(q => q.id === c.pid); if (!p || game.state !== 'play') return;
    if (d.t === 'pick') { if (d.q === p.choiceSeq) applyPick(p, d.i | 0); return; }
    const I = p.in; I.l = !!d.l; if (d.r) I.skill = true; I.aim = { x: num(d.ax), y: num(d.ay) };
    if (d.tp === p.tp && !p.down) { p.tx = clamp(num(d.x, p.x), 30, world.S - 30); p.ty = clamp(num(d.y, p.y), 30, world.S - 30); p.face = num(d.f); p.moving = !!d.m; }
    if (d.d != null) { I.dash = true; I.dashA = num(d.d); }
    if (d.q) I.ult = true; if (d.i) I.interact = true;
  }
}
function worldMsg(pid) {
  return {
    t: 'world', you: pid, ch: game.chapter, diff: game.diff, run: game.runId, S: world.S,
    obs: world.obs.map(o => [o.x | 0, o.y | 0, r1(o.r), r1(o.cr), o.tree ? 1 : 0, r2(o.v), o.tone]),
    pois: world.pois.map(o => [o.kind, o.x | 0, o.y | 0, o.r]),
    players: players.map(p => ({ id: p.id, name: p.name, hero: p.hero, x: p.x, y: p.y, tp: p.tp }))
  };
}
function sendWorld() { for (const c of net.conns) { c.inGame = true; c.send(worldMsg(c.pid)); } }
function snapPlayer(p) {
  return {
    id: p.id, x: r1(p.x), y: r1(p.y), f: r2(p.face), hp: r1(p.hp), mh: p.maxHp, lv: p.level, xp: r1(p.xp), g: p.gold, k: p.kills, em: p.embers,
    ta: r2(Math.max(0, p.tAtk)), ts: r2(Math.max(0, p.tSkill)), tu: r2(Math.max(0, p.tUlt)), d: p.dashes, dr: r2(p.dashRe), dm: p.dashMax, cds: p.cds.map(r2),
    it: p.iT > 0 ? 1 : 0, sw: r2(p.swing), ut: r1(Math.max(0, p.ultT)), mv: p.moving ? 1 : 0, dn: p.down ? 1 : 0, rv: r2(p.rev), dt: p.dashT > 0 ? 1 : 0, tp: p.tp,
    fl: p.flurry ? 1 : 0, sp: r1(p.spd * p.spdMul), pr: p.pickR | 0
  };
}
function sendSnaps() {
  if (!net.conns.length || !world) return;
  const b = game.boss, g = [r1(game.time), game.chapter, game.wasNight ? 1 : 0, b ? [b.x | 0, b.y | 0, r3(b.hp / b.maxHp)] : 0, game.over || 0];
  const P = players.map(snapPlayer), O = world.pois.map(o => [o.used ? 1 : 0, o.uses || 0]);
  for (const c of net.conns) {
    const cp = players.find(p => p.id === c.pid); if (!cp || !c.inGame) continue;
    const nr = o => Math.abs(o.x - cp.x) < 1150 && Math.abs(o.y - cp.y) < 850;
    c.send({
      t: 's', g, P, O,
      E: enemies.filter(e => !e.dead && nr(e)).map(e => [e.id, ETN.indexOf(e.type), e.x | 0, e.y | 0, r1(e.r), r3(Math.max(0, e.hp / e.maxHp)), e.elite ? 1 : 0, STN.indexOf(e.state), r2(e.a), e.flash > 0 ? 1 : 0, e.slowT > 0 ? 1 : 0, e.poisT > 0 ? 1 : 0, e.dir || 1]),
      Q: projs.filter(nr).map(q => [q.x | 0, q.y | 0, q.vx | 0, q.vy | 0, q.r, q.kind, q.color, r2(q.life)]),
      Z: zones.filter(nr).map(z => [z.x | 0, z.y | 0, z.r | 0, z.kind, r2(Math.max(0, z.delay)), r2(z.max), r2(z.life || 0), z.friendly ? 1 : 0, z.lantern ? 1 : 0, z.color]),
      K: pickups.filter(nr).map(k => [k.id, k.kind, k.x | 0, k.y | 0]),
      ev: evQ.filter(e => (!e.to || e.to === c.pid) && (e.x === undefined || Math.hypot(e.x - cp.x, e.y - cp.y) < 1200)).map(e => ({ k: e.k, a: e.a })),
      c: cp.choice ? { q: cp.choiceSeq, ids: cp.choice.map(t => t.id), title: cp.choiceTitle } : 0, tal: cp.talents
    });
  }
  evQ.length = 0;
}
// The host keeps simulating while its tab is hidden (requestAnimationFrame stops there).
function startTicker() {
  if (net.worker) return;
  try { net.worker = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),33)'], { type: 'text/javascript' }))); net.worker.onmessage = () => { if (document.hidden && net.mode === 'host') tick(performance.now()); }; } catch (e) { }
}

function joinGame(code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5) return showMenu('Enter the 5-character room code from your host.');
  if (!NetT.ok()) return showMenu(noNetMsg());
  initAudio(); leaveNet(); net.mode = 'client'; net.code = code; game.state = 'lobby';
  show('<h2>' + L('Joining ', '正在加入 ') + esc(code) + '…</h2><div class="sub">' + L('Reaching the host.', '正在連線至房主。') + '</div><button id="cancel">' + L('Cancel', '取消') + '</button>'); $('cancel').onclick = () => netFail('');
  const handle = net.handle = NetT.join(code, {
    open(c) {
      if (net.handle !== handle) return c.close();
      net.host = c; c.onData = d => { try { clientRecv(d); } catch (e) { console.error(e); } }; c.onClose = () => { if (net.handle === handle) netFail('Lost connection to the host. Tap Join to rejoin the game.'); };
      c.send({ t: 'hello', name: net.name, hero: net.hero, tok: rejoinSecret(code), lo: loadoutOf(PROFILE, net.hero) }); rememberRoom(code);
    },
    error(t) { if (net.handle === handle) netFail(t === 'peer-unavailable' ? 'No room found with code ' + code + '.' : netWhy(t) || 'Connection failed (' + t + ').'); }
  });
  setTimeout(() => { if (net.handle === handle && !net.host) netFail('Could not reach room ' + code + '.'); }, 22000);
}
function clientRecv(d) {
  if (!d || net.mode !== 'client') return;
  if (d.t === 'no') netFail(d.why);
  else if (d.t === 'secret' && /^[a-z0-9]{24}$/.test(d.s)) { try { localStorage.setItem('duskbound-rejoin', JSON.stringify({ code: d.code, s: d.s, t: Date.now() })); } catch (e) { } }
  else if (d.t === 'reward') receiveReward(d);
  else if (d.t === 'rewards' && Array.isArray(d.list)) { game.rewards = d.list.slice(0, 4); if (game.over) showEnd(); }
  else if (d.t === 'lobby') { players = []; net.myId = d.you; net.lobby = d.players; net.code = d.code; net.diff = DIFF(d.diff).id; game = newGame(); game.state = 'lobby'; me = null; showLobby(); }
  else if (d.t === 'world') {
    game = newGame(); game.chapter = d.ch; game.diff = DIFF(d.diff).id; game.runId = String(d.run || ''); night = 0; net.myId = d.you; net.out = {}; net.pickedSeq = -1; clearEntities();
    world = { S: d.S, pal: PAL[(d.ch - 1) % PAL.length], obs: d.obs.map(o => ({ x: o[0], y: o[1], r: o[2], cr: o[3], tree: !!o[4], v: o[5], tone: o[6] })), pois: d.pois.map(o => ({ kind: o[0], x: o[1], y: o[2], r: o[3], used: false, uses: 0, seen: o[0] === 'altar' })) };
    groundPat = makeGround(world.pal);
    players = d.players.map(q => { const p = newPlayer(q.id, q.hero, q.name); p.x = p.tx = q.x; p.y = p.ty = q.y; p.tp = q.tp; return p; });
    me = players.find(p => p.id === d.you); hide(); banner(world.pal.name, chapterSub(), 4);
  }
  else if (d.t === 'roster' && world && me && Array.isArray(d.players)) {
    for (const q of d.players) if (q && HEROES[q.hero] && !players.some(p => p.id === q.id)) { const p = newPlayer(q.id, q.hero, cleanName(q.name, q.id)); p.x = p.tx = num(q.x); p.y = p.ty = num(q.y); p.tp = q.tp; players.push(p); }
  }
  else if (d.t === 's' && world && me) applySnap(d);
}
function applySnap(s) {
  const g = s.g; game.time = g[0]; game.chapter = g[1]; game.wasNight = !!g[2];
  game.boss = g[3] ? { x: g[3][0], y: g[3][1], hp: g[3][2], maxHp: 1 } : null;
  if ((g[4] || null) !== game.over) { game.over = g[4] || null; if (game.over) showEnd(); else hide(); }
  players = players.filter(p => s.P.some(q => q.id === p.id));
  for (const q of s.P) {
    const p = players.find(o => o.id === q.id); if (!p) continue;
    p.hp = q.hp; p.maxHp = q.mh; p.level = q.lv; p.xp = q.xp; p.gold = q.g; p.kills = q.k; p.embers = q.em;
    p.tAtk = q.ta; p.tSkill = q.ts; p.tUlt = q.tu; p.dashRe = q.dr; p.dashMax = q.dm; p.cds = q.cds; if (!(p === me && p.dashLock > 0)) p.dashes = q.d;
    p.iT = q.it ? 0.2 : 0; p.swing = q.sw; p.ultT = q.ut; p.down = !!q.dn; p.rev = q.rv; p.flurry = q.fl ? 1 : null; p.spd = q.sp; p.spdMul = 1; p.pickR = q.pr;
    if (p === me) { if (q.tp !== p.tp) { p.x = q.x; p.y = q.y; p.tp = q.tp; p.dashT = 0; } }
    else { p.tx = q.x; p.ty = q.y; p.face = q.f; p.moving = !!q.mv; p.dashT = q.dt ? 0.05 : 0; if (dist(p, { x: q.x, y: q.y }) > 300) { p.x = q.x; p.y = q.y; } }
  }
  s.O.forEach((o, i) => { const w = world.pois[i]; if (w) { w.used = !!o[0]; w.uses = o[1]; } });
  const old = new Map(enemies.map(e => [e.id, e]));
  enemies = s.E.map(a => {
    const e = old.get(a[0]) || { id: a[0], x: a[2], y: a[3], ph: (a[0] * 1.7) % TAU, flash: 0, near: true };
    e.type = ETN[a[1]]; e.tx = a[2]; e.ty = a[3]; e.r = a[4]; e.hp = a[5]; e.maxHp = 1; e.elite = !!a[6]; e.state = STN[a[7]]; e.a = a[8];
    if (a[9]) e.flash = 0.1; e.slowT = a[10]; e.poisT = a[11]; e.dir = a[12]; return e;
  });
  projs = s.Q.map(a => ({ x: a[0], y: a[1], vx: a[2], vy: a[3], r: a[4], kind: a[5], color: a[6], life: a[7] }));
  zones = s.Z.map(a => ({ x: a[0], y: a[1], r: a[2], kind: a[3], delay: a[4], max: a[5], life: a[6], friendly: !!a[7], lantern: !!a[8], color: a[9] }));
  const oldK = new Map(pickups.map(k => [k.id, k]));
  pickups = s.K.map(a => { const k = oldK.get(a[0]) || { id: a[0], x: a[2], y: a[3], t: a[0] % 7 }; k.kind = a[1]; k.tx = a[2]; k.ty = a[3]; return k; });
  for (const e of s.ev) applyEv(e);
  me.talents = s.tal || {};
  if (s.c && s.c.q !== net.pickedSeq) { me.choice = s.c.ids.map(id => TALENTS.find(t => t.id === id)).filter(Boolean); me.choiceSeq = s.c.q; me.choiceTitle = s.c.title; } else me.choice = null;
}
function clientUpdate(dt) {
  game.t += dt; const p = me, inp = localInput(), o = net.out;
  night += ((game.wasNight ? 1 : 0) - night) * Math.min(1, dt * 1.3);
  p.tAtk -= dt; p.tSkill -= dt; p.tUlt -= dt; p.dashLock -= dt; p.swing = Math.max(0, p.swing - dt * 6);
  if (!p.down && !game.over) {
    p.aim = inp.aim; p.face = angTo(p, inp.aim); p.moving = !!(inp.mx || inp.my);
    if (!p.flurry) {
      if (inp.dash && p.dashes > 0 && p.dashT <= 0) { p.dashes--; p.dashLock = 0.4; const a = dashDir(p, inp); startDashMove(p, a); o.d = r2(a); }
      if (p.dashT > 0) { p.dashT -= dt; p.x += Math.cos(p.dashA) * 920 * dt; p.y += Math.sin(p.dashA) * 920 * dt; trail(p); } else walk(p, inp, dt);
      collideWorld(p, p.r);
    }
    if (inp.skill) { o.r = 1; net.skillHold = 0.2; } if (inp.ult) o.q = 1; if (inp.interact) o.i = 1;
  }
  const k = Math.min(1, dt * 14);
  for (const q of players) if (q !== p) { q.x += (q.tx - q.x) * k; q.y += (q.ty - q.y) * k; if (q.moving) q.walk += dt; if (q.dashT > 0) trail(q); }
  for (const e of enemies) { e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; e.flash -= dt; }
  for (const q of projs) { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; } projs = projs.filter(q => q.life > 0);
  for (const z of zones) {
    if (z.delay > 0) { z.delay = Math.max(0.001, z.delay - dt); continue; }
    if (z.kind === 'burn') { z.life -= dt; if (Math.random() < 0.5) parts.push({ x: z.x + rand(-z.r, z.r) * 0.7, y: z.y + rand(-z.r, z.r) * 0.7, vx: 0, vy: -50, life: 0.5, max: 0.5, color: z.color, size: 3 }); }
  }
  for (const q of pickups) { q.x += (q.tx - q.x) * k; q.y += (q.ty - q.y) * k; q.t += dt; }
  updFx(dt);
  net.inT -= dt; net.skillHold = (net.skillHold || 0) - dt;
  if (net.inT <= 0 && net.host) {
    net.inT = NetT.inIv || 1 / 30;
    net.host.send({ t: 'i', x: r1(p.x), y: r1(p.y), f: r2(p.face), m: p.moving ? 1 : 0, l: inp.l ? 1 : 0, r: o.r || (inp.skill || net.skillHold > 0 ? 1 : 0), ax: Math.round(inp.aim.x), ay: Math.round(inp.aim.y), tp: p.tp, d: o.d, q: o.q, i: o.i });
    net.out = {};
  }
}

// ---------- rendering ----------
function drawPlayer(p) {
  const c = ctx;
  if (p.down) {
    c.globalAlpha = 0.45; drawHero(c, p.hero, p.x, p.y, p.face, 0, {}); c.globalAlpha = 1;
    c.strokeStyle = 'rgba(255,90,90,.7)'; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y, 30, 0, TAU); c.stroke();
    if (p.rev > 0) { c.strokeStyle = '#8dff8a'; c.lineWidth = 5; c.beginPath(); c.arc(p.x, p.y, 30, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(p.rev / 3, 0, 1)); c.stroke(); }
    c.textAlign = 'center'; c.font = 'bold 12px Georgia'; c.fillStyle = '#ff8a8a'; c.fillText(p === me ? 'DOWN — an ally must reach you' : 'DOWN — stand close to revive', p.x, p.y + 50);
  } else {
    if (p.ultT > 0) { c.globalAlpha = 0.25 + Math.sin(game.t * 8) * 0.1; circ(c, p.x, p.y, 34, '#7bc96f'); c.globalAlpha = 1; }
    if (p.iT > 0 && Math.floor(game.t * 20) % 2 === 0 && p.dashT <= 0) c.globalAlpha = 0.45;
    drawHero(c, p.hero, p.x, p.y, p.face, p.walk, { moving: p.moving, swing: p.swing, scale: p.ultT > 0 ? 1.25 : 1 }); c.globalAlpha = 1;
  }
  if (p !== me) {
    c.textAlign = 'center'; c.font = '12px Georgia'; c.fillStyle = 'rgba(0,0,0,.7)'; c.fillText(p.name, p.x + 1, p.y - 43); c.fillStyle = HEROES[p.hero].color; c.fillText(p.name, p.x, p.y - 44);
    if (!p.down) { c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(p.x - 18, p.y - 39, 36, 4); c.fillStyle = '#6fdc7a'; c.fillRect(p.x - 18, p.y - 39, 36 * clamp(p.hp / p.maxHp, 0, 1), 4); }
  }
}
function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  if (!me || !world || game.state !== 'play') { ctx.fillStyle = '#0b0d14'; ctx.fillRect(0, 0, W, H); return; }
  const p = me, c = ctx;
  c.save(); c.scale(zoom, zoom);
  const sx = rand(-1, 1) * game.shake, sy = rand(-1, 1) * game.shake; c.translate(-cam.x + sx, -cam.y + sy);
  c.fillStyle = groundPat; c.fillRect(cam.x - 30, cam.y - 30, VW + 60, VH + 60);
  const inView = (o, m = 80) => o.x > cam.x - m && o.x < cam.x + VW + m && o.y > cam.y - m && o.y < cam.y + VH + m;
  for (const z of zones) {
    if (!inView(z, 150)) continue;
    if (z.kind === 'burn') { const a = Math.min(1, z.life / 0.5); c.globalAlpha = 0.28 * a; circ(c, z.x, z.y, z.r, z.color); c.globalAlpha = 0.7 * a; c.strokeStyle = z.color; c.lineWidth = 2; c.beginPath(); c.arc(z.x, z.y, z.r, 0, TAU); c.stroke(); c.globalAlpha = 1; if (z.lantern) { circ(c, z.x, z.y - 8, 7, '#fff1c2'); c.fillStyle = '#4a3a2a'; c.fillRect(z.x - 6, z.y - 18, 12, 3); c.fillRect(z.x - 6, z.y - 1, 12, 3); } }
    else { const k = 1 - clamp(z.delay / z.max, 0, 1), col = z.friendly ? '255,140,60' : '220,60,255'; c.fillStyle = 'rgba(' + col + ',.16)'; c.beginPath(); c.arc(z.x, z.y, z.r, 0, TAU); c.fill(); c.fillStyle = 'rgba(' + col + ',.35)'; c.beginPath(); c.arc(z.x, z.y, z.r * k, 0, TAU); c.fill(); c.strokeStyle = 'rgba(' + col + ',.9)'; c.lineWidth = 2; c.beginPath(); c.arc(z.x, z.y, z.r, 0, TAU); c.stroke(); }
  }
  for (const k of pickups) if (inView(k)) drawPickup(k);
  const list = [];
  for (const o of world.pois) if (inView(o, 120)) list.push([o.y, 0, o]);
  for (const o of world.obs) if (inView(o, 120)) list.push([o.y, 1, o]);
  for (const e of enemies) if (inView(e, 120)) list.push([e.y, 2, e]);
  for (const q of players) if (inView(q, 120)) list.push([q.y, 3, q]);
  list.sort((a, b) => a[0] - b[0]);
  for (const [, k, o] of list) { if (k === 0) drawPoi(o); else if (k === 1) drawObs(o); else if (k === 2) drawEnemy(o); else drawPlayer(o); }
  for (const q of projs) {
    if (!inView(q)) continue; c.save(); c.translate(q.x, q.y); c.rotate(Math.atan2(q.vy, q.vx));
    if (q.kind === 'blade') { c.fillStyle = q.color; c.beginPath(); c.moveTo(12, 0); c.lineTo(-8, -4); c.lineTo(-4, 0); c.lineTo(-8, 4); c.fill(); }
    else { const g = c.createRadialGradient(0, 0, 1, 0, 0, q.r * 2.4); g.addColorStop(0, '#fff'); g.addColorStop(0.35, q.color); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.beginPath(); c.ellipse(-q.r * 0.6, 0, q.r * 2.6, q.r * 1.7, 0, 0, TAU); c.fill(); }
    c.restore();
  }
  for (const f of fxs) {
    const k = clamp(f.life / f.max, 0, 1); c.globalAlpha = k;
    if (f.kind === 'arc') { c.strokeStyle = f.color; c.lineWidth = 10 * k + 2; c.lineCap = 'round'; c.beginPath(); c.arc(f.x, f.y, f.r * (0.72 + 0.28 * (1 - k)), f.a - f.arc / 2, f.a + f.arc / 2); c.stroke(); }
    else if (f.kind === 'ring') { c.strokeStyle = f.color; c.lineWidth = 6 * k + 1; c.beginPath(); c.arc(f.x, f.y, f.r * (1 - k * 0.7), 0, TAU); c.stroke(); }
    else { c.strokeStyle = f.color || '#9fd8ff'; c.lineWidth = 3; c.beginPath(); c.moveTo(f.x, f.y); c.lineTo((f.x + f.x2) / 2 + rand(-14, 14), (f.y + f.y2) / 2 + rand(-14, 14)); c.lineTo(f.x2, f.y2); c.stroke(); }
    c.globalAlpha = 1;
  }
  for (const q of parts) { c.globalAlpha = clamp(q.life / q.max, 0, 1); c.fillStyle = q.color; c.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size); } c.globalAlpha = 1;
  if (night > 0.01) {
    const g = c.createRadialGradient(p.x, p.y, 60, p.x, p.y, 520);
    g.addColorStop(0, 'rgba(12,14,48,' + 0.12 * night + ')'); g.addColorStop(1, 'rgba(5,6,26,' + 0.8 * night + ')');
    c.fillStyle = g; c.fillRect(cam.x - 40, cam.y - 40, VW + 80, VH + 80);
  }
  c.textAlign = 'center';
  for (const q of texts) { c.globalAlpha = clamp(q.life / 0.4, 0, 1); c.font = 'bold ' + q.size + 'px Georgia'; c.fillStyle = 'rgba(0,0,0,.7)'; const qs = T(q.s); c.fillText(qs, q.x + 1, q.y + 1); c.fillStyle = q.color; c.fillText(qs, q.x, q.y); } c.globalAlpha = 1;
  const np = !p.down && nearPoi(p), pr = np && T(poiPrompt(np));
  if (pr) { c.font = '15px Georgia'; const w = c.measureText(pr).width + 50; c.fillStyle = 'rgba(10,10,20,.8)'; rr(c, np.x - w / 2, np.y - 78, w, 26, 6); c.fill(); c.fillStyle = '#f3d48a'; c.fillText((touch.on ? '' : '[F]  ') + pr, np.x, np.y - 60); }
  c.restore();
  drawHUD();
}
function drawHUD() {
  const c = ctx, p = me, H2 = HEROES[p.hero], TU = touch.on;
  // On phones the HUD is scaled down, the health panel moves to the top-left and the key hints give way to touch buttons.
  const hs = hudScale(), W = (innerWidth - SA.l - SA.r) / hs, H = (innerHeight - SA.t - SA.b) / hs;
  c.save(); c.translate(SA.l, SA.t); c.scale(hs, hs);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const bx = 24, by = TU ? (W < 760 ? 132 : 88) : H - 74, bw = TU ? 220 : 300;
  c.fillStyle = 'rgba(8,8,16,.75)'; rr(c, bx - 8, by - 30, bw + 16, 88, 8); c.fill();
  c.font = '15px Georgia'; c.fillStyle = H2.color; c.fillText(T(H2.name) + ' · ' + L('Lv ', '等級 ') + p.level, bx, by - 10);
  c.textAlign = 'right'; c.fillStyle = '#f3c84a'; c.fillText('◈ ' + p.gold + '   ✦ ' + p.embers, bx + bw, by - 10); c.textAlign = 'left';
  c.fillStyle = '#2a1c22'; rr(c, bx, by, bw, 20, 4); c.fill(); c.fillStyle = '#d64545'; rr(c, bx, by, Math.max(6, bw * clamp(p.hp / p.maxHp, 0, 1)), 20, 4); c.fill();
  c.fillStyle = '#fff'; c.font = '13px Georgia'; c.textAlign = 'center'; c.fillText(Math.ceil(p.hp) + ' / ' + p.maxHp, bx + bw / 2, by + 15);
  c.fillStyle = '#1c2430'; rr(c, bx, by + 28, bw, 9, 3); c.fill(); c.fillStyle = '#7fe0ff'; rr(c, bx, by + 28, Math.max(4, bw * clamp(p.xp / xpNeed(p.level), 0, 1)), 9, 3); c.fill();
  const cd = p.cds, ab = [[T('LMB'), T(H2.names[0]), p.tAtk, cd[0], true], [T('RMB'), T(H2.names[1]), p.tSkill, cd[1], true], [T('SPACE'), T(H2.names[2]) + (p.dashMax > 1 ? ' ×' + p.dashes : ''), p.dashes > 0 ? 0 : p.dashRe, cd[2], true], ['Q', T(H2.names[3]), p.tUlt, cd[3], p.level >= 3]];
  const s = 58, gap = 12, ax = W / 2 - (s * 4 + gap * 3) / 2, ay = H - s - 30;
  if (!TU) ab.forEach((a, i) => {
    const x = ax + i * (s + gap); c.fillStyle = 'rgba(8,8,16,.8)'; rr(c, x, ay, s, s, 8); c.fill();
    const ready = a[2] <= 0 && a[4]; c.strokeStyle = ready ? H2.color : '#4a4370'; c.lineWidth = 2; rr(c, x, ay, s, s, 8); c.stroke();
    if (a[2] > 0 && a[3] > 0.5) { c.fillStyle = 'rgba(120,110,170,.45)'; c.beginPath(); c.moveTo(x + s / 2, ay + s / 2); c.arc(x + s / 2, ay + s / 2, s * 0.42, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(a[2] / a[3], 0, 1)); c.fill(); }
    c.textAlign = 'center'; c.font = 'bold 14px Georgia'; c.fillStyle = a[4] ? (ready ? '#fff' : '#8a84a8') : '#55506e'; c.fillText(a[4] ? a[0] : T('Lv 3'), x + s / 2, ay + s / 2 + 1);
    if (a[2] > 0.5 && a[3] > 0.5) { c.font = '12px Georgia'; c.fillStyle = '#f3d48a'; c.fillText(a[2].toFixed(0), x + s / 2, ay + s / 2 + 17); }
    c.font = '11px Georgia'; c.fillStyle = '#b9b3d4'; c.fillText(a[1], x + s / 2, ay + s + 14);
  });
  const cw = Math.min(460, W - 380), cx = W / 2 - cw / 2, cy = 22;
  c.fillStyle = 'rgba(8,8,16,.75)'; rr(c, cx - 12, cy - 12, cw + 24, 58, 8); c.fill();
  for (let i = 0; i < DAYS; i++) { const x0 = cx + cw * (i * CYCLE) / TOTAL, wd = cw * DAY / TOTAL, wn = cw * NIGHT / TOTAL; c.fillStyle = '#e0b75a'; c.fillRect(x0, cy, wd - 1, 8); c.fillStyle = '#4a4aa8'; c.fillRect(x0 + wd, cy, wn - 1, 8); }
  const mxp = cx + cw * clamp(game.time / TOTAL, 0, 1); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(mxp, cy + 10); c.lineTo(mxp - 6, cy + 19); c.lineTo(mxp + 6, cy + 19); c.fill(); c.fillRect(mxp - 1, cy - 3, 2, 14);
  c.textAlign = 'center'; c.font = '14px Georgia';
  const ct = game.time % CYCLE, isN = ct >= DAY;
  if (game.boss) { c.fillStyle = '#ff8ae0'; c.fillText(T('The Gloam Stag hunts you'), W / 2, cy + 36); }
  else { c.fillStyle = isN ? '#b6b6ff' : '#f3d48a'; c.fillText(LANG === 'zh' ? '第 ' + (dayIdx() + 1) + (isN ? ' 夜 · ' + fmtTime(CYCLE - ct) + ' 後黎明' : ' 天 · ' + fmtTime(DAY - ct) + ' 後入夜') + '   —   雄鹿將於 ' + fmtTime(TOTAL - game.time) + ' 後甦醒'
    : (isN ? 'Night ' : 'Day ') + (dayIdx() + 1) + ' · ' + (isN ? 'dawn in ' + fmtTime(CYCLE - ct) : 'dusk in ' + fmtTime(DAY - ct)) + '   —   the Stag wakes in ' + fmtTime(TOTAL - game.time), W / 2, cy + 36); }
  c.textAlign = 'left'; c.font = '13px Georgia'; c.fillStyle = '#a9a3c4'; c.fillText(T('Chapter ' + game.chapter) + '/' + CHAPTERS + ' · ' + T(world.pal.name) + ' · ' + T(DIFF(game.diff).name), 20, 28); c.fillText(L('Slain: ', '擊殺：') + p.kills, 20, 46);
  // party
  let py = TU ? (W < 760 ? 220 : 176) : 70;
  for (const q of players) {
    if (q === p) continue;
    c.fillStyle = 'rgba(8,8,16,.7)'; rr(c, 14, py - 14, 190, 34, 6); c.fill();
    c.font = '13px Georgia'; c.fillStyle = HEROES[q.hero].color; c.fillText(q.name + ' · ' + L('Lv ', '等級 ') + q.level, 22, py);
    c.fillStyle = '#2a1c22'; c.fillRect(22, py + 6, 174, 7); c.fillStyle = q.down ? '#777' : '#d64545'; c.fillRect(22, py + 6, 174 * (q.down ? clamp(q.rev / 3, 0, 1) : clamp(q.hp / q.maxHp, 0, 1)), 7);
    if (q.down) { c.fillStyle = '#ff8a8a'; c.textAlign = 'right'; c.fillText(T('DOWN'), 196, py); c.textAlign = 'left'; }
    py += 42;
  }
  if (game.boss) { const e = game.boss, w = Math.max(150, Math.min(620, W - (TU ? 560 : 80))), x = W / 2 - w / 2, y = TU && W < 700 ? 140 : 92; c.fillStyle = 'rgba(8,8,16,.8)'; rr(c, x - 4, y - 4, w + 8, 22, 5); c.fill(); c.fillStyle = e.hp < e.maxHp * 0.5 ? '#ff5ad6' : '#a66bff'; rr(c, x, y, Math.max(6, w * clamp(e.hp / e.maxHp, 0, 1)), 14, 4); c.fill(); }
  const ms = TU ? 112 : 160, mx = W - ms - 18, my = 18, k = ms / world.S;
  c.fillStyle = 'rgba(8,8,16,.75)'; rr(c, mx - 4, my - 4, ms + 8, ms + 8, 6); c.fill(); c.fillStyle = world.pal.base; c.globalAlpha = 0.6; c.fillRect(mx, my, ms, ms); c.globalAlpha = 1;
  const colr = { altar: '#c27bff', spring: '#4fb6e8', chest: '#f3c84a', shrine: '#e8e2d0', merchant: '#ff8a8a', camp: '#ff8a3a' };
  for (const o of world.pois) { if (!o.seen) continue; c.globalAlpha = o.used && o.kind !== 'altar' ? 0.3 : 1; c.fillStyle = colr[o.kind]; c.fillRect(mx + o.x * k - 3, my + o.y * k - 3, 6, 6); } c.globalAlpha = 1;
  for (const e of enemies) if (e.elite && e.near) { c.fillStyle = '#ff5a5a'; c.fillRect(mx + e.x * k - 2, my + e.y * k - 2, 4, 4); }
  if (game.boss) circ(c, mx + game.boss.x * k, my + game.boss.y * k, 5, '#ff5ad6');
  for (const q of players) if (q !== p) circ(c, mx + q.x * k, my + q.y * k, 3.5, HEROES[q.hero].color);
  circ(c, mx + p.x * k, my + p.y * k, 3.5, '#fff');
  c.font = '11px Georgia'; c.fillStyle = '#8e88ab'; c.textAlign = 'right'; c.fillText(TU ? (net.mode === 'solo' ? '' : L('Room ', '房間 ') + net.code) : L('F interact · ', 'F 互動 · ') + (net.mode === 'solo' ? L('P pause · ', 'P 暫停 · ') : L('Room ', '房間 ') + net.code + ' · ') + L('M mute', 'M 靜音'), W - 18, my + ms + 22);
  if (game.banner) { const b = game.banner, a = clamp(Math.min(b.t, b.max - b.t) / 0.4, 0, 1); c.globalAlpha = a; c.textAlign = 'center'; c.font = 'bold ' + Math.round(Math.min(44, W / 13)) + 'px Georgia'; c.fillStyle = 'rgba(0,0,0,.6)'; const bt = T(b.text), bs = T(b.sub); c.fillText(bt, W / 2 + 2, H * 0.27 + 2); c.fillStyle = '#f3d48a'; c.fillText(bt, W / 2, H * 0.27); c.font = 'italic 18px Georgia'; c.fillStyle = '#d8d2ee'; c.fillText(bs, W / 2, H * 0.27 + 30); c.globalAlpha = 1; }
  if (!p.down && p.hp < p.maxHp * 0.3) { const g = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8); g.addColorStop(0, 'rgba(160,0,0,0)'); g.addColorStop(1, 'rgba(160,0,0,' + (0.3 + Math.sin(game.t * 5) * 0.1) + ')'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
  c.restore();
  if (TU) drawTouchUI();
}
function drawTouchUI() {
  const c = ctx, p = me, u = touchU(), col = HEROES[p.hero].color;
  const stick = (s, hx, hy) => {
    const x = s ? s.x0 : hx, y = s ? s.y0 : hy; let kx = x, ky = y;
    if (s) { const dx = s.x - s.x0, dy = s.y - s.y0, l = Math.hypot(dx, dy), m = Math.min(l, 52 * u); if (l) { kx += dx / l * m; ky += dy / l * m; } }
    c.globalAlpha = s ? 0.55 : 0.25; c.strokeStyle = '#e8e2d0'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 52 * u, 0, TAU); c.stroke(); circ(c, kx, ky, 22 * u, '#e8e2d0'); c.globalAlpha = 1;
  };
  const B = H - Math.max(SA.b - 8, 0); stick(touch.move, SA.l + 100 * u, B - 95 * u); stick(touch.aim, W - SA.r - 100 * u, B - 90 * u);
  const np = !p.down && nearPoi(p), use = !!(np && poiPrompt(np));
  const info = { skill: ['SKILL', p.tSkill, p.cds[1], true], dash: ['DASH' + (p.dashMax > 1 ? ' ' + p.dashes : ''), p.dashes > 0 ? 0 : p.dashRe, p.cds[2], true], ult: [p.level >= 3 ? 'ULT' : 'Lv 3', p.tUlt, p.cds[3], p.level >= 3], f: ['USE', 0, 0, use], menu: [net.mode === 'solo' ? 'II' : (AU.muted ? '🔇' : '♪'), 0, 0, true] };
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const b of touchButtons()) {
    const [label, t, cd, on] = info[b.id], ready = on && t <= 0;
    c.globalAlpha = on ? 0.9 : 0.35; circ(c, b.x, b.y, b.r, 'rgba(8,8,16,.62)');
    if (t > 0 && cd > 0.5) { c.fillStyle = 'rgba(120,110,170,.5)'; c.beginPath(); c.moveTo(b.x, b.y); c.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(t / cd, 0, 1)); c.fill(); }
    c.strokeStyle = ready ? (b.id === 'f' ? '#f3d48a' : col) : '#4a4370'; c.lineWidth = 2.5; c.beginPath(); c.arc(b.x, b.y, b.r, 0, TAU); c.stroke();
    c.font = 'bold ' + Math.round(11 * u) + 'px Georgia'; c.fillStyle = ready ? '#fff' : '#8a84a8'; c.fillText(t > 0.5 && cd > 0.5 ? Math.ceil(t) : T(label), b.x, b.y);
  }
  c.globalAlpha = 1; c.textBaseline = 'alphabetic';
}

// ---------- screens ----------
const controlsHtml = () => touch.on
  ? L('<div class="controls"><b>Left thumb</b> move · <b>Right thumb</b> drag to aim and attack, or hold to auto-target · <b>Buttons</b> skill, dash, ultimate (Lv 3), use, <b>II</b> pause',
      '<div class="controls"><b>左手拇指</b> 移動 · <b>右手拇指</b> 拖曳瞄準並攻擊，或按住自動鎖定 · <b>按鈕</b> 技能、衝刺、絕招（3 級）、使用、<b>II</b> 暫停') +
    '</div>'
  : L('<div class="controls"><b>WASD</b> move · <b>Mouse</b> aim · <b>LMB</b> attack · <b>RMB</b>/<b>E</b> skill · <b>Space</b> dash · <b>Q</b> ultimate (Lv 3) · <b>F</b> interact · <b>1</b>-<b>3</b> pick boon · <b>M</b> mute</div>',
      '<div class="controls"><b>WASD</b> 移動 · <b>滑鼠</b> 瞄準 · <b>左鍵</b> 攻擊 · <b>右鍵</b>/<b>E</b> 技能 · <b>空白鍵</b> 衝刺 · <b>Q</b> 絕招（3 級） · <b>F</b> 互動 · <b>1</b>-<b>3</b> 選擇祝福 · <b>M</b> 靜音</div>');
// Full screen: Android and iPad browsers can do it for a page; iPhone Safari only does it for video, so there the way
// is to add the game to the Home Screen (manifest.webmanifest makes it open full screen, without browser bars).
const DE = document.documentElement, IPHONE = /iPhone|iPod/.test(navigator.userAgent);
const canFS = () => !IPHONE && !!(DE.requestFullscreen || DE.webkitRequestFullscreen);
const isFS = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
function goFull() {
  if (!touch.on || !canFS() || isFS()) return;
  try { const r = (DE.requestFullscreen || DE.webkitRequestFullscreen).call(DE); if (r && r.catch) r.catch(() => { }); } catch (e) { }
}
// Shown on the title screen when the game is not already full screen.
const fsButtonHtml = () => STANDALONE || isFS() || !(touch.on || IOS) || window.DUSK_NO_NET ? '' : '<button id="fsb" class="ghost fsbtn">⛶ ' + L('Full screen', '全螢幕') + '</button>';
function onFsButton(back) {
  if (canFS()) { goFull(); setTimeout(back, 300); return; }
  show('<h2>' + L('Full screen on iPhone', 'iPhone 全螢幕') + '</h2><div class="sub">' +
    L('<b>Quick:</b> on the title screen, swipe up once — Safari hides its bars. Tap the very top or bottom edge to bring them back.<br><b>Always full screen:</b> install it as an app —',
      '<b>快速：</b>在標題畫面向上滑動一次，Safari 就會隱藏工具列。點螢幕最上緣或最下緣可叫回工具列。<br><b>永遠全螢幕：</b>把遊戲安裝成 App —') + '</div><ol class="steps">' + L(
    '<li>Tap <b>Share</b> — in Safari it is in the bottom bar (or under <b>⋯</b>); in Chrome, at the top right.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open <b>Duskbound</b> from your Home Screen. It runs full screen, with no browser bars.</li>',
    '<li>點選<b>分享</b> — Safari 在下方工具列（或在 <b>⋯</b> 裡）；Chrome 在右上角。</li><li>選擇<b>加入主畫面</b>，再點<b>加入</b>。</li><li>從主畫面開啟 <b>Duskbound</b>，就會以全螢幕執行，沒有瀏覽器工具列。</li>') +
    '</ol><div class="sub">' + L('Your name and language need setting again there; co-op works the same.', '在主畫面版本中需要重新設定名字與語言；合作模式照常可用。') + '</div><button id="fsok">' + L('Got it', '知道了') + '</button>');
  $('fsok').onclick = back;
}
function show(html, soft) { overlay.className = soft ? 'soft' : ''; overlay.innerHTML = html; document.body.classList.toggle('menu', !!$('solo')); }
function hide() { overlay.className = 'hidden'; overlay.innerHTML = ''; document.body.classList.remove('menu'); }
function heroCards(sel, compact) {
  let h = '<div class="cards">';
  Object.keys(HEROES).forEach((id, i) => { const H2 = HEROES[id]; h += '<div class="card' + (id === sel ? ' sel' : '') + (compact ? ' compact' : '') + '" data-hero="' + id + '"><span class="key">' + (i + 1) + '</span><canvas width="170" height="' + (compact ? 96 : 120) + '" data-p="' + id + '"></canvas><div class="tag" style="color:' + H2.color + '">' + T(H2.title) + '</div><h3>' + T(H2.name) + '</h3>' + (compact ? '' : '<p><i>' + T(H2.blurb) + '</i></p>') + '<ul>' + H2.kit.map(k => '<li>' + T(k) + '</li>').join('') + '</ul></div>'; });
  return h + '</div>';
}
function bindHeroCards(cb) {
  overlay.querySelectorAll('canvas[data-p]').forEach(cn => { const g = cn.getContext('2d'), s = cn.height < 110 ? 2.1 : 2.6; drawHero(g, cn.dataset.p, 85, cn.height * 0.65, -0.5, 0, { scale: s }); });
  overlay.querySelectorAll('.card').forEach(cd => cd.onclick = () => cb(cd.dataset.hero));
}
function selectHero(id) {
  if (!HEROES[id]) return; net.hero = id;
  if (game.state === 'menu') { overlay.querySelectorAll('.card').forEach(cd => cd.classList.toggle('sel', cd.dataset.hero === id)); return; }
  if (game.state !== 'lobby') return;
  const q = net.lobby.find(q => q.id === net.myId); if (q) q.hero = id;
  if (net.mode === 'host') sendLobby(); else if (net.host) net.host.send({ t: 'hero', hero: id, lo: loadoutOf(PROFILE, id) });
  showLobby();
}
function saveName() { const el = $('nm'); if (el) { net.name = el.value.trim().slice(0, 14); try { localStorage.setItem('duskbound-name', net.name); } catch (e) { } } }
function showMenu(msg) {
  game.state = 'menu'; game.over = null; me = null; players = [];
  show('<h1>DUSKBOUND</h1><div class="sub">' + L('Three days. Three nights. Then the Gloam Stag wakes.<br>Roam the wood alone or with up to three friends, and be ready when it comes for you.', '三個白晝，三個黑夜，然後幽暮雄鹿將會甦醒。<br>獨自或與最多三位朋友一同漫遊森林，在它找上你之前做好準備。') + '</div>' + heroCards(net.hero) +
    '<div class="row"><input id="nm" maxlength="14" placeholder="' + L('Your name', '你的名字') + '" value="' + esc(net.name) + '"><button id="solo">' + L('Play solo', '單人遊玩') + '</button><button id="hostb">' + L('Host co-op', '開設合作房') + '</button><span class="sep"></span><input id="code" maxlength="5" placeholder="' + L('CODE', '代碼') + '" autocomplete="off" value="' + esc(lastRoom()) + '"><button id="joinb">' + L('Join', '加入') + '</button></div>' +
    '<div class="row">' + diffSelect('diffsel', d => PROFILE.unlocked.includes(d)) + '<button id="profb" class="ghost">' + L('Profile', '個人檔案') + '</button></div>' +
    '<div id="msg">' + esc(T(msg) || '') + '</div>' + controlsHtml() + '<button id="lang" class="ghost langbtn">' + (LANG === 'zh' ? '🌐 English' : '🌐 繁體中文') + '</button>' + fsButtonHtml());
  if ($('fsb')) $('fsb').onclick = () => { saveName(); onFsButton(() => showMenu(msg)); };
  $('lang').onclick = () => { saveName(); setLang(LANG === 'zh' ? 'en' : 'zh'); showMenu(msg); };
  $('swipehint').textContent = L('⇡ Swipe up to hide Safari’s bars', '⇡ 向上滑動即可隱藏 Safari 工具列');
  $('diffsel').onchange = e => setDiff(e.target.value);
  $('profb').onclick = () => { saveName(); showProfile(); };
  bindHeroCards(selectHero);
  $('solo').onclick = () => { saveName(); goFull(); startSolo(); };
  $('hostb').onclick = () => { saveName(); goFull(); hostGame(); };
  $('joinb').onclick = () => { saveName(); goFull(); joinGame($('code').value); };
  $('code').onkeydown = e => { if (e.key === 'Enter') $('joinb').onclick(); };
}
function showLobby() {
  const host = net.mode === 'host';
  let h = '<h2>' + L('Party', '隊伍') + '</h2><div class="sub">' + (host && !net.ready ? L('Opening a room…', '正在開設房間…') : L('Room code', '房間代碼') + ' <span class="code">' + esc(net.code) + '</span>' + (host ? '<br>' + L('Share this code — friends enter it under Join on the title screen' + (NetT.hint || '') + '.', '分享這組代碼 — 朋友在標題畫面的「加入」欄輸入即可' + (NetT.hint ? '（需開啟同一個頁面，且頁面已分享給他們）' : '') + '。') : '')) + '</div><div class="plist">';
  for (const q of net.lobby) h += '<div><span style="color:' + HEROES[q.hero].color + '">●</span> ' + esc(q.name) + (q.id === net.myId ? L(' (you)', '（你）') : '') + (q.id === 1 ? L(' — host', ' — 房主') : '') + ' <i>' + T(HEROES[q.hero].name) + '</i> · ' + L('up to ', '最高 ') + T(DIFF(unlocksOf(q).slice(-1)[0]).name) + '</div>';
  h += '</div><div class="row">' + (host ? diffSelect('diffsel', partyDiffOk) + '<span class="wait">' + L('Only difficulties every player has unlocked.', '只能選擇所有人都已解鎖的難度。') + '</span>'
    : '<span class="wait">' + L('Difficulty: ', '難度：') + T(DIFF(net.diff).name) + '</span>') + '</div>';
  h += heroCards(net.hero, true) + '<div class="row">' + (host ? '<button id="start">' + (net.lobby.length > 1 ? L('Set out (' + net.lobby.length + ' players)', '出發（' + net.lobby.length + ' 人）') : L('Set out alone', '獨自出發')) + '</button>' : '<span class="wait">' + L('Waiting for the host to set out…', '等待房主出發…') + '</span>') + '<button id="leave" class="ghost">' + L('Leave', '離開') + '</button></div>';
  show(h); bindHeroCards(selectHero);
  if (host) { $('start').onclick = startHosted; $('diffsel').onchange = e => { if (partyDiffOk(e.target.value)) { setDiff(e.target.value); sendLobby(); } showLobby(); }; }
  $('leave').onclick = () => { leaveNet(); showMenu(); };
}
const unlocksOf = q => q.id === net.myId ? PROFILE.unlocked : q.unl || (q.lo && q.lo.unlocked) || ['normal'];
function diffSelect(id, allowed) {
  return '<select id="' + id + '" class="diffsel">' + DIFFICULTIES.map(d => '<option value="' + d.id + '"' + (d.id === net.diff ? ' selected' : '') + (allowed(d.id) ? '' : ' disabled') + '>' +
    L('Difficulty: ', '難度：') + T(d.name) + (allowed(d.id) ? '' : ' 🔒') + '</option>').join('') + '</select>';
}
// Profile screen: unlocks, weapons (equip one per hero), upgrades, starting talents, reward history, backup code.
function showProfile(extra) {
  const P = PROFILE, rar = r => r ? '<span style="color:' + RARITY_COLORS[r] + '">' + T(RARITY_NAMES[r]) + '</span>' : L('No reward', '沒有獎勵');
  let h = '<h2>' + L('Profile', '個人檔案') + '</h2><div class="sub">' + L('Saved in this browser · ID ', '儲存在此瀏覽器 · ID ') + esc(P.id.slice(0, 10)) + '…</div><div class="stats prof">';
  h += '<b>' + L('Difficulties', '難度') + '</b><br>' + DIFFICULTIES.map(d => (P.unlocked.includes(d.id) ? '✓ ' : '🔒 ') + T(d.name) + (P.cleared[d.id] ? L(' (cleared ×' + P.cleared[d.id] + ')', '（通關 ×' + P.cleared[d.id] + '）') : '')).join(' · ');
  h += '<br><b>' + L('Weapons', '武器') + '</b><br>' + Object.keys(HEROES).map(hero => {
    const own = P.weapons.filter(w => WEAPONS[w].hero === hero);
    return T(HEROES[hero].name) + ': ' + (own.length ? '<select data-hero="' + hero + '" class="wsel"><option value="">' + L('(none)', '（無）') + '</option>' + own.map(w => '<option value="' + w + '"' + (P.equipped[hero] === w ? ' selected' : '') + '>' + T(WEAPONS[w].name) + ' — ' + T(WEAPONS[w].desc) + '</option>').join('') + '</select>' : '<i>' + L('none yet', '尚無') + '</i>');
  }).join('<br>');
  const ups = Object.entries(P.upgrades).filter(([, v]) => v > 0).map(([k, v]) => T(UPGRADES[k].name) + ' +' + v + UPGRADES[k].unit);
  h += '<br><b>' + L('Upgrades', '強化') + '</b> ' + (ups.join(' · ') || '<i>' + L('none yet', '尚無') + '</i>');
  const tal = Object.keys(P.talents).filter(k => P.talents[k] > 0).map(k => T((TALENTS.find(t => t.id === k) || { name: k }).name));
  h += '<br><b>' + L('Starting talents', '初始天賦') + '</b> ' + (tal.join(' · ') || '<i>' + L('none yet', '尚無') + '</i>');
  const rec = P.rewards.slice(-6).reverse();
  h += '<br><b>' + L('Recent chapter rewards', '最近的章節獎勵') + '</b><br>' + (rec.length ? rec.map(r => T('Chapter ' + r.chapter) + ' · ' + T(DIFF(r.diff).name) + ': ' + rar(r.rarity) + (r.item ? ' — ' + T(itemLabel(r.item)) : '')).join('<br>') : '<i>' + L('none yet', '尚無') + '</i>');
  h += '</div>' + (extra || '') + '<div class="row"><button id="pback">' + L('Back', '返回') + '</button><button id="pexp" class="ghost">' + L('Backup code', '備份代碼') + '</button><button id="pimp" class="ghost">' + L('Restore', '還原') + '</button></div>' +
    '<div class="wait">' + L('Clearing this site’s data, private browsing, another browser or the Home Screen app each start a new profile — use a backup code to move it.', '清除網站資料、私密瀏覽、換瀏覽器或使用主畫面 App 都會建立新的檔案 — 請用備份代碼搬移。') + '</div>';
  show(h);
  document.querySelectorAll('.wsel').forEach(s => s.onchange = () => { const hero = s.dataset.hero; if (s.value) PROFILE.equipped[hero] = s.value; else delete PROFILE.equipped[hero]; saveMe(); });
  $('pback').onclick = () => showMenu();
  $('pexp').onclick = () => { showProfile('<textarea id="pcode" readonly rows="3" class="pcode">' + exportProfile(PROFILE) + '</textarea>'); const t = $('pcode'); t.focus(); t.select(); };
  $('pimp').onclick = () => {
    showProfile('<textarea id="pcode" rows="3" class="pcode" placeholder="DB1.…"></textarea><div class="row"><button id="pdo">' + L('Replace this profile', '取代目前的檔案') + '</button></div>');
    $('pdo').onclick = () => { const p = importProfile($('pcode').value); if (!p) return showProfile('<div id="msg">' + L('That code is not valid.', '代碼無效。') + '</div>'); PROFILE = p; saveMe(); if (!PROFILE.unlocked.includes(net.diff)) setDiff('normal'); showProfile('<div class="wait">' + L('Profile restored.', '已還原檔案。') + '</div>'); };
  };
}
const chapterSub = () => 'Chapter ' + game.chapter + (world && world.pal.placeholder ? ' (preview)' : '');
function beginRun(diff) {
  game = newGame(); game.diff = DIFF(diff).id; game.runId = randId(12); night = 0; nextId = 1; net.claims = new Map(); net.rolled = new Set(); genWorld(); hide();
  banner(world.pal.name, 'Day 1 — find the camps, caches and shrines.', 4); sfx('dawn');
}
function startSolo() {
  initAudio(); leaveNet(); if (!PROFILE.unlocked.includes(net.diff)) net.diff = 'normal';
  players = [newPlayer(1, net.hero, cleanName(net.name, 1))]; me = players[0]; me.lo = loadoutOf(PROFILE, net.hero); applyLoadout(me, me.lo); beginRun(net.diff);
}
function startHosted() {
  const d = partyDiffOk(net.diff) ? net.diff : bestCommonDiff(); net.diff = d;
  net.away.clear(); players = net.lobby.map(q => { const p = newPlayer(q.id, q.hero, q.name); p.remote = q.id !== 1; p.tok = q.tok || ''; p.lo = q.id === 1 ? loadoutOf(PROFILE, q.hero) : q.lo; applyLoadout(p, p.lo); return p; });
  me = players.find(p => p.id === 1); beginRun(d); sendWorld(); net.snapT = 0;
}
// Phones only turn a tap into a click when no other finger is down, so a thumb on the move stick
// would swallow taps on cards. Act on the touch itself (finger lifted inside the element), and keep click for mice.
function onTap(el, fn) {
  let id = null, last = 0;
  const fire = () => { const n = Date.now(); if (n - last > 400) { last = n; fn(); } };
  el.onclick = fire;
  el.addEventListener('touchstart', e => { id = e.changedTouches[0].identifier; }, { passive: true });
  el.addEventListener('touchend', e => {
    for (const t of e.changedTouches) {
      if (t.identifier !== id) continue; id = null;
      const r = el.getBoundingClientRect();
      if (t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom) { e.preventDefault(); fire(); }
    }
  }, { passive: false });
  el.addEventListener('touchcancel', () => { id = null; });
}
let shownChoice = '';
function syncChoice() {
  const on = me && game.state === 'play' && !game.over && me.choice && me.choice.length;
  const key = on ? me.choiceSeq + ':' + me.choice.map(t => t.id).join(',') : '';
  if (key === shownChoice) return; shownChoice = key;
  if (!on) { choiceEl.className = 'hidden'; choiceEl.innerHTML = ''; return; }
  let h = '<h2>' + esc(T(me.choiceTitle || 'Choose')) + '</h2><div class="cards">';
  me.choice.forEach((t, i) => { const rk = me.talents[t.id] || 0; h += '<div class="card" data-i="' + i + '"><span class="key">' + (i + 1) + '</span><div class="tag"' + (t.hero ? ' style="color:' + HEROES[t.hero].color + '"' : '') + '>' + T(t.hero ? HEROES[t.hero].name : 'Boon') + '</div><h3>' + T(t.name) + '</h3><p>' + T(t.desc) + '</p><div class="pips">' + '●'.repeat(rk + 1) + '○'.repeat(Math.max(0, t.max - rk - 1)) + '</div></div>'; });
  choiceEl.className = net.mode === 'solo' ? 'solo' : 'coop'; choiceEl.innerHTML = h + '</div>';
  choiceEl.querySelectorAll('.card').forEach(cd => onTap(cd, () => chooseTalent(+cd.dataset.i)));
}
function chooseTalent(i) {
  if (!me || !me.choice || !me.choice[i] || game.state !== 'play') return;
  if (net.mode === 'client') { net.host.send({ t: 'pick', i, q: me.choiceSeq }); net.pickedSeq = me.choiceSeq; me.choice = null; playSfx('pick'); }
  else applyPick(me, i);
  mouse.l = mouse.r = false;
}
function showEnd() {
  if (!me) return;
  const st = '<div class="stats">' + players.map(p => esc(p.name) + ' — ' + T(HEROES[p.hero].name) + ' · ' + L('Lv ', '等級 ') + p.level + ' · ' + L(p.kills + ' slain', '擊殺 ' + p.kills)).join('<br>') + '<br>' + T('Chapter ' + game.chapter) + '</div>';
  const rw = game.rewards ? '<div class="stats"><b>' + L('Chapter reward', '章節獎勵') + '</b><br>' + game.rewards.map(r => esc(r.name) + ' — ' + (r.rarity ? '<span style="color:' + RARITY_COLORS[r.rarity] + '">' + T(RARITY_NAMES[r.rarity]) + '</span> · ' + esc(T(itemLabel(r.item))) : L('No reward', '沒有獎勵'))).join('<br>') + '</div>' : '';
  const guest = net.mode === 'client', wait = '<div class="wait">' + L('Waiting for the host…', '等待房主…') + '</div><button id="leave" class="ghost">' + L('Leave party', '離開隊伍') + '</button>';
  if (game.over === 'dead') show('<h2>' + L('The dusk takes you', '你被暮色吞沒') + '</h2><div class="sub">' + L('The wood closes over another lantern.', '森林又吞沒了一盞燈火。') + '</div>' + st + rw + (guest ? wait : '<button id="again">' + (net.mode === 'host' ? L('Back to the lobby', '回到大廳') : L('Try again', '再試一次')) + '</button>'), true);
  else if (game.over === 'win') show('<h2>' + L('The Stag falls', '雄鹿倒下了') + '</h2><div class="sub">' + L('…but its shadow runs ahead of you, deeper in. ' + PAL[game.chapter % PAL.length].name + ' awaits, and everything there is stronger.', '…但它的影子已先一步奔向更深處。' + T(PAL[game.chapter % PAL.length].name) + '在等著你，那裡的一切都更加強大。') + '</div>' + st + rw + (guest ? wait : '<button id="next">' + L('Press on', '繼續前進') + '</button>'), true);
  else show('<h1>' + L('DAWN', '黎明') + '</h1><div class="sub">' + L('The last Gloam Stag is ash on the wind. For the first time in an age, morning comes and stays.', '最後一頭幽暮雄鹿化為風中灰燼。漫長歲月以來，晨光第一次降臨並且留了下來。') + '</div>' + st + rw + (guest ? wait : '<button id="again">' + (net.mode === 'host' ? L('Back to the lobby', '回到大廳') : L('Play again', '再玩一次')) + '</button>'));
  if ($('again')) $('again').onclick = endRun;
  if ($('next')) $('next').onclick = nextChapter;
  if ($('leave')) $('leave').onclick = () => { leaveNet(); showMenu(); };
}
function endRun() {
  if (net.mode === 'host') { net.away.clear(); game.state = 'lobby'; game.over = null; me = null; players = []; for (const c of net.conns) c.inGame = false; sendLobby(); showLobby(); }
  else showMenu();
}
function nextChapter() {
  if (game.over !== 'win') return;
  const ch = game.chapter + 1, keep = { diff: game.diff, runId: game.runId }; game = newGame(); Object.assign(game, keep); game.chapter = ch; night = 0;
  for (const p of players) { p.down = false; p.rev = 0; p.flurry = null; p.dashT = 0; if (p.hp <= 0) p.hp = 1; }
  genWorld(); for (const p of players) heal(p, p.maxHp * 0.5);
  hide(); banner(world.pal.name, chapterSub(), 4); sfx('dawn');
  if (net.mode === 'host') sendWorld();
}
const muteLabel = () => AU.muted ? L('Unmute', '取消靜音') : L('Mute', '靜音');
function onKey(k) {
  if (k === 'm' && AU.ctx) { AU.muted = !AU.muted; AU.master.gain.value = AU.muted ? 0 : 0.55; }
  const n = '123'.indexOf(k);
  if (n >= 0 && (game.state === 'menu' || game.state === 'lobby')) selectHero(Object.keys(HEROES)[n]);
  else if (n >= 0 && game.state === 'play') chooseTalent(n);
  else if ((k === 'p' || k === 'escape') && game.state === 'play' && net.mode === 'solo' && !game.over && !(me && me.choice)) {
    game.paused = !game.paused;
    if (game.paused) {
      show('<h2>' + L('Paused', '暫停') + '</h2>' + controlsHtml() + '<div class="row"><button id="res">' + L('Resume', '繼續') + '</button>' + (touch.on ? '<button id="mute" class="ghost">' + muteLabel() + '</button><button id="quit" class="ghost">' + L('Quit run', '放棄本局') + '</button>' : '') + '</div>', true);
      $('res').onclick = () => { game.paused = false; hide(); };
      if ($('mute')) $('mute').onclick = () => { initAudio(); onKey('m'); $('mute').textContent = muteLabel(); };
      if ($('quit')) $('quit').onclick = () => { game.paused = false; showMenu(); };
    } else hide();
  }
}

// ---------- loop ----------
let last = 0;
function tick(ts) {
  const dt = clamp((ts - last) / 1000 || 0, 0, 0.05); last = Math.max(last, ts);
  if (game.state === 'play' && me) {
    if (net.mode === 'client') clientUpdate(dt);
    else if (game.over) updFx(dt);
    else if (!(net.mode === 'solo' && (game.paused || me.choice))) update(dt);
    if (net.mode === 'host') { net.snapT -= dt; if (net.snapT <= 0) { net.snapT = NetT.snapIv ? NetT.snapIv(net.conns.length) : 0.05; sendSnaps(); } }
  }
  for (const k in pressed) delete pressed[k];
  syncChoice();
}
function frame(ts) { tick(ts); music(); render(); requestAnimationFrame(frame); }
showMenu(); requestAnimationFrame(frame);
