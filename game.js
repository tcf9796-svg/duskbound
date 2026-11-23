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
  if (IOS_BARS) { cv.style.width = W + 'px'; cv.style.height = H + 'px'; overlay.style.height = H + 'px'; document.body.classList.toggle('bars', barsShowing()); }
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
addEventListener('keyup', e => { const k = e.key.toLowerCase(); keys[k] = false; if (k === 'v') Voice.setTalking(false); });
addEventListener('keydown', e => { if (e.key.toLowerCase() === 'v' && !(e.target && e.target.tagName === 'INPUT') && !e.repeat) Voice.setTalking(true); });
cv.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
// Phones turn some taps into fake mouse events (a finger that lifts off an upgrade card, taps on page elements).
// Those must not switch the game to the desktop layout or fire attacks, so mouse presses shortly after any touch are
// ignored; a real mouse (no touch in the last second) still switches a touchscreen laptop to desktop controls.
let lastTouchT = -1e9;
for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) document.addEventListener(ev, () => { lastTouchT = performance.now(); }, { capture: true, passive: true });
const fakeMouse = e => performance.now() - lastTouchT < 1000 || !!(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents);
cv.addEventListener('mousedown', e => { if (fakeMouse(e)) return; initAudio();
  if (!touch.on && e.button === 0 && hudStats && e.clientX >= hudStats.x && e.clientX <= hudStats.x + hudStats.w && e.clientY >= hudStats.y && e.clientY <= hudStats.y + hudStats.h) { toggleStats(); return; }
  if (!touch.on && e.button === 0 && hudAuto && e.clientX >= hudAuto.x && e.clientX <= hudAuto.x + hudAuto.w && e.clientY >= hudAuto.y && e.clientY <= hudAuto.y + hudAuto.h) { toggleAuto(); return; } if (touch.on) { touch.on = false; touch.move = touch.aim = null; resize(); } if (e.button === 0) mouse.l = true; if (e.button === 2) { mouse.r = true; pressed.rmb = true; } });
addEventListener('mouseup', e => { if (e.button === 0) mouse.l = false; if (e.button === 2) mouse.r = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; });
const mouseWorld = () => ({ x: cam.x + mouse.x / zoom, y: cam.y + mouse.y / zoom });
const touchU = () => clamp(Math.min(W - SA.l - SA.r, H - SA.t - SA.b) / 400, 0.8, 1.25);
// HUD scale on phones, and the safe right/bottom edges the touch controls are laid out against.
const hudScale = () => touch.on ? clamp(Math.min((W - SA.l - SA.r) / 900, (H - SA.t - SA.b) / 480), 0.7, 1) : 1;
// Auto attack (local player only): while on, the normal attack fires by itself whenever an enemy is within AUTO_RANGE,
// aimed at the nearest one, unless the player is aiming by hand (aim stick dragged / mouse held). Remembered per device.
// It only sets this player's own input, so it works the same for the host, a guest and solo.
const AUTO_RANGE = 460;
let autoAtk = (() => { try { return localStorage.getItem('duskbound-auto') === '1'; } catch (e) { return false; } })();
let hudAuto = null; // where the desktop AUTO box was drawn (screen pixels), for clicks
// Stats panel (local player): the totals of every bonus on this hero (boons, weapon, upgrades, shrine blessings).
// The host computes them (it owns every hero's stats) and sends each guest their own in the snapshot (st).
let showStats = (() => { try { return localStorage.getItem('duskbound-stats') === '1'; } catch (e) { return false; } })();
let hudStats = null; // where the desktop STATS box was drawn (screen pixels), for clicks
function toggleStats() { showStats = !showStats; try { localStorage.setItem('duskbound-stats', showStats ? '1' : '0'); } catch (e) { } playSfx('pick'); }
// [maxHp, damage x, attack speed x, move speed x, crit chance, crit damage x, life leech, damage reduction, cooldown x,
//  pickup radius, xp x, dash charges, regen/s by day, night damage, spite, chain, venom, execute, embers]
const statsOf = p => [p.maxHp, r3(p.dmgMul), r3(p.asMul), r3(p.spdMul), r3(p.crit + (p.hero === 'vesper' ? 0.15 * night : 0)), r3(p.critMul), r3(p.lifesteal), r3(p.armor), r3(p.cdr), Math.round(p.pickR), r3(p.xpMul),
  p.dashMax, r2(p.dayRegen + (p.hero === 'bramble' ? 1.5 : 0)), r3(p.nightDmg), p.spite || 0, p.chain || 0, p.venom || 0, r3(p.exec || 0), p.embers];
// Rows to show: [label, value]; the core ones always, the rest once the hero has them.
function statRows(s) {
  if (!s) return [];
  const pct = v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%', rows = [
    ['Damage', pct(s[1] - 1)], ['Attack speed', pct(s[2] - 1)], ['Critical chance', Math.round(s[4] * 100) + '%'], ['Critical damage', Math.round(s[5] * 100) + '%'],
    ['Life leech', Math.round(s[6] * 100) + '%'], ['Damage reduction', Math.round(s[7] * 100) + '%'], ['Move speed', pct(s[3] - 1)], ['Cooldowns', pct(1 / s[8] - 1)],
    ['Max health', '' + s[0]], ['Dash charges', '' + s[11]]];
  if (s[13]) rows.push(['Night damage', pct(s[13])]);
  if (s[12]) rows.push(['Regen by day', s[12] + '/s']);
  if (s[14]) rows.push(['Spite', '×' + s[14]]);
  if (s[15]) rows.push(['Chain lightning', Math.round(s[15] * 20) + '%']);
  if (s[16]) rows.push(['Venom', s[16] * 5 + '/s']);
  if (s[17]) rows.push(['Execute', pct(s[17])]);
  if (s[10] !== 1) rows.push(['Experience', pct(s[10] - 1)]);
  if (s[9] !== 90) rows.push(['Pickup radius', '' + s[9]]);
  rows.push(['Embers', '' + s[18]]);
  return rows;
}
const myStats = () => net.mode === 'client' ? me.st : statsOf(me);
function toggleAuto() {
  autoAtk = !autoAtk; try { localStorage.setItem('duskbound-auto', autoAtk ? '1' : '0'); } catch (e) { }
  if (me) texts.push({ x: me.x, y: me.y - 46, s: autoAtk ? 'Auto attack on' : 'Auto attack off', color: '#f3d48a', size: 14, life: 1.2 }); // local only
  playSfx('pick');
}
const targetable = e => !e.dead && !e.invuln && !['rod', 'pillar', 'brazier'].includes(e.type) && !(e.type === 'boss' && game.boss && game.boss.hidden);
function autoTarget(p) { let best = null, bd = AUTO_RANGE; for (const e of enemies) { if (!targetable(e)) continue; const d = dist(e, p); if (d < bd) { bd = d; best = e; } } return best; }
function touchButtons() {
  const u = touchU(), R = W - SA.r, B = H - Math.max(SA.b - 8, 0), hs = hudScale();
  return [{ id: 'skill', key: 'e', x: R - 205 * u, y: B - 62 * u, r: 30 * u }, { id: 'dash', key: ' ', x: R - 190 * u, y: B - 140 * u, r: 30 * u },
  { id: 'ult', key: 'q', x: R - 118 * u, y: B - 196 * u, r: 30 * u }, { id: 'f', key: 'f', x: R - 42 * u, y: B - 210 * u, r: 26 * u },
  { id: 'auto', key: '', x: R - 272 * u, y: B - 112 * u, r: 24 * u }, { id: 'stats', key: '', x: R - 156 * hs, y: SA.t + 130 * hs, r: 18 * hs },
  // left of the minimap: pause in solo, mute in co-op
  { id: 'menu', key: '', x: R - 156 * hs, y: SA.t + 38 * hs, r: 18 * hs }].concat(fsAvailable() && !isFS() && (canFS() || barsShowing()) ? [{ id: 'fs', key: '', x: R - 156 * hs, y: SA.t + 84 * hs, r: 18 * hs }] : []).concat(Voice.micTrack && Voice.mode === 'ptt' && net.mode !== 'solo' ? [{ id: 'talk', key: '', x: SA.l + 44 * u, y: B - 205 * u, r: 28 * u }] : []);
}
// In-game ⛶ (on finger lift, which browsers accept for full screen): enter directly, or on iPhone show the help
// (a solo game pauses meanwhile; co-op keeps running).
function fsFromGame() {
  if (canFS()) { setKeepFS(true); goFull(true); return; }
  if (net.mode === 'solo') game.paused = true;
  onFsButton(() => { if (net.mode === 'solo') game.paused = false; hide(); });
}
function touchMenu() { if (net.mode === 'solo') onKey('p'); else if (game.state === 'play' && !game.over) showVoice(hide, true); }
cv.addEventListener('touchstart', e => {
  e.preventDefault(); initAudio(); if (!touch.on) { touch.on = true; resize(); }
  for (const t of e.changedTouches) {
    const x = t.clientX, y = t.clientY, b = touchButtons().find(b => Math.hypot(x - b.x, y - b.y) < b.r * 1.25);
    if (b) { if (b.id === 'menu') touchMenu(); else if (b.id === 'talk') { touch.talk = t.identifier; Voice.setTalking(true); } else if (b.id === 'fs') touch.fs = t.identifier; else if (b.id === 'auto') toggleAuto(); else if (b.id === 'stats') toggleStats(); else pressed[b.key] = true; }
    else if (x < W * 0.45) { if (!touch.move) touch.move = { id: t.identifier, x0: x, y0: y, x, y }; }
    else if (!touch.aim) touch.aim = { id: t.identifier, x0: x, y0: y, x, y };
  }
}, { passive: false });
cv.addEventListener('touchmove', e => {
  e.preventDefault();
  for (const t of e.changedTouches) for (const s of [touch.move, touch.aim]) if (s && s.id === t.identifier) { s.x = t.clientX; s.y = t.clientY; }
}, { passive: false });
function touchEnd(e) {
  for (const t of e.changedTouches) { if (touch.fs === t.identifier) { touch.fs = null; fsFromGame(); } if (touch.talk === t.identifier) { touch.talk = null; Voice.setTalking(false); } if (touch.move && touch.move.id === t.identifier) touch.move = null; if (touch.aim && touch.aim.id === t.identifier) touch.aim = null; }
}
cv.addEventListener('touchend', touchEnd); cv.addEventListener('touchcancel', touchEnd);
function touchInput() {
  const p = me, R = 52 * touchU(); let mx = 0, my = 0, aim = null;
  if (touch.move) { mx = (touch.move.x - touch.move.x0) / R; my = (touch.move.y - touch.move.y0) / R; const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; } else if (l < 0.18) mx = my = 0; }
  const s = touch.aim, dx = s ? s.x - s.x0 : 0, dy = s ? s.y - s.y0 : 0, dl = Math.hypot(dx, dy);
  if (s && dl > 12) { touch.aimA = Math.atan2(dy, dx); const d = 120 + 280 * clamp(dl / R, 0, 1); aim = { x: p.x + Math.cos(touch.aimA) * d, y: p.y + Math.sin(touch.aimA) * d }; }
  else {
    // not dragging the aim stick: lock on to the nearest enemy, else face the way we are walking
    let best = null, bd = 460; for (const e of enemies) { if (!targetable(e)) continue; const d = dist(e, p); if (d < bd) { bd = d; best = e; } }
    if (best) { touch.aimA = angTo(p, best); aim = { x: best.x, y: best.y }; }
    else { if (mx || my) touch.aimA = Math.atan2(my, mx); aim = { x: p.x + Math.cos(touch.aimA) * 200, y: p.y + Math.sin(touch.aimA) * 200 }; }
  }
  return { mx, my, l: !!s || (autoAtk && !!autoTarget(p)), skill: !!pressed.e, dash: !!pressed[' '], ult: !!pressed.q, interact: !!pressed.f, aim };
}
function localInput() {
  if (touch.on && me) return touchInput();
  let mx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0), my = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  const ml = Math.hypot(mx, my); if (ml) { mx /= ml; my /= ml; }
  const tgt = autoAtk && me && !mouse.l ? autoTarget(me) : null;
  return { mx, my, l: mouse.l || !!tgt, skill: !!(pressed.rmb || pressed.e || mouse.r), dash: !!pressed[' '], ult: !!pressed.q, interact: !!pressed.f, aim: tgt ? { x: tgt.x, y: tgt.y } : mouseWorld() };
}

// ---------- state ----------
const newGame = () => ({ state: 'play', diff: 'normal', runId: '', rewards: null, chapter: 1, time: 0, boss: null, banner: null, shake: 0, winT: 0, ambT: 5, wasNight: false, t: 0, over: null, paused: false });
let game = newGame(); game.state = 'menu';
let players = [], me = null, world = null, enemies = [], projs = [], zones = [], pickups = [], parts = [], texts = [], fxs = [], tethers = [];
let night = 0, cam = { x: 0, y: 0 }, groundPat = null, nextId = 1, evQ = [];
const net = { mode: 'solo', away: new Map(), claims: new Map(), rolled: new Set(), conns: [], host: null, handle: null, lobby: [], myId: 1, nextPid: 2, name: '', hero: 'bramble', code: '', ready: false, snapT: 0, inT: 0, out: {}, pickedSeq: -1, worker: null };
try { net.name = localStorage.getItem('duskbound-name') || ''; } catch (e) { }
// Saved profile (meta.js): identified by a random installation id kept in this browser's storage.
const STORE = (() => { try { localStorage.setItem('duskbound-probe', '1'); localStorage.removeItem('duskbound-probe'); return localStorage; } catch (e) { const d = {}; return { getItem: k => k in d ? d[k] : null, setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; } }; } })();
let PROFILE = loadProfile(STORE);
// Online profile (cloud.js): every save is also merged into the online copy, a moment later.
let cloudT = 0, cloudAgain = false;
const saveMe = () => { saveProfile(STORE, PROFILE); if (Cloud.enabled() && Cloud.signedIn()) { clearTimeout(cloudT); cloudT = setTimeout(cloudSync, 1500); } };
// Pull the online copy, merge it with this device's (mergeProfiles never loses progress), save both. The profile id
// only changes on the title or profile screens, never mid-run (reward claims and co-op use it).
async function cloudSync() {
  if (!Cloud.enabled() || !Cloud.signedIn()) return false;
  if (Cloud.busy) { cloudAgain = true; return false; }
  Cloud.busy = true; cloudAgain = false; let changed = false;
  try {
    const remote = await Cloud.pull(), merged = mergeProfiles(PROFILE, remote);
    if (merged.id !== PROFILE.id && game.state !== 'menu') { cloudAgain = true; return false; }
    changed = JSON.stringify(merged) !== JSON.stringify(PROFILE);
    PROFILE = merged; saveProfile(STORE, PROFILE);
    if (!PROFILE.unlocked.includes(net.diff)) setDiff('normal');
    await Cloud.push(PROFILE); Cloud.lastSync = Date.now(); Cloud.error = '';
  } catch (e) { Cloud.error = String(e && e.message || e); }
  finally { Cloud.busy = false; if (cloudAgain) setTimeout(cloudSync, 3000); }
  // show what arrived if the player is looking at the title or profile screen
  if (game.state === 'menu') { if ($('pback')) showProfile(); else if (changed && $('solo')) { saveName(); showMenu(); } }
  return true;
}
const DIFF = id => DIFFICULTIES.find(d => d.id === id) || DIFFICULTIES[0];
// The difficulty this player wants (remembered), never above what their profile has unlocked.
net.diff = (() => { let d = ''; try { d = localStorage.getItem('duskbound-diff') || ''; } catch (e) { } return PROFILE.unlocked.includes(d) ? d : 'normal'; })();
const setDiff = d => { if (!PROFILE.unlocked.includes(d)) return; net.diff = d; try { localStorage.setItem('duskbound-diff', d); } catch (e) { } };
// Players counted for scaling: everyone in the session, including disconnected players whose slot is still held.
const partyN = () => Math.max(1, players.length + (net.mode === 'host' ? net.away.size : 0));
const partyMul = per => 1 + per * (partyN() - 1);
const ETN = ['husk', 'spitter', 'ram', 'bloat', 'wisp', 'boss', 'sapling', 'orb', 'vcore', 'pillar', 'split', 'mask', 'cage', 'bind', 'rod', 'brazier'], STN = ['b_tel', 'b_act', 'b_rec', 'b_hide', 'chase', 'wind', 'rest', 'charge', 'fuse', 'bwind', 'bcharge', 'ring', 'slam'];
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
    aim: { x: 0, y: 0 }, in: { mx: 0, my: 0, l: false, skill: false, dash: false, ult: false, interact: false, aim: { x: 0, y: 0 } }, cds: [0, 0, 0, 0],
    roots: 0, lan: LANTERN_MAX, lanMax: LANTERN_MAX, shield: 0, shieldT: 0, decoy: null, decoyOn: false,
    // chapter talents (talents.js): picked ids, earned picks, the open offer; plus their effect state
    ct: [], ctPending: 0, ctChoice: null, ctSeq: 0, barrier: 0, hasteT: 0, hasteMul: 1, bmT: 0, bmHome: false, wingbeat: false, reprisal: false,
    lrCd: 0, hbCd: 0, ultExt: 0, lanCh: 0, lanRe: 0, mercy: null, threadT: 0
  };
}
const dashCdOf = p => (HEROES[p.hero].dashCd || DASH_CD) * p.cdr;
const ROOTS_MAX = 5;
// Why an ability slot (1 = skill, 2 = dash slot) cannot be used right now, as a short HUD label; null when it can.
function slotBlock(p, slot) {
  if (slot === 1 && p.hero === 'mira' && !p.decoyOn) return 'NO DECOY';
  if (p.hero === 'vespera' && p.lan < LANTERN_COST) return 'LOW';
  return null;
}
const xpNeed = l => 25 + l * 20 + l * l * 2;
const dayIdx = () => Math.min(DAYS - 1, Math.floor(game.time / CYCLE));
const dmgOf = e => e.dmg * (1 + 0.15 * dayIdx()) * (1 + 0.5 * (game.chapter - 1)) * (1 + 0.25 * night);
const alive = () => players.filter(p => !p.down);
function nearestPlayer(o, f) { let b = null, bd = 1e9; for (const p of players) { if (p.down || (f && !f(p))) continue; const d = dist(p, o); if (d < bd) { bd = d; b = p; } } return b; }
// Who an enemy goes after: a Sentinel Rowan taunts first, then Mira's decoys distract, else the nearest player.
function enemyTarget(e) {
  let best = null, bd = 1e9;
  for (const q of players) if (!q.down && q.hero === 'rowan' && q.ultT > 0) { const d = dist(q, e); if (d < 650 && d < bd) { bd = d; best = q; } }
  if (best) return best;
  for (const z of zones) if (z.kind === 'decoy' && z.life > 0) { const d = dist(z, e); if (d < 400 && d < bd) { bd = d; best = z; } }
  return best || nearestPlayer(e);
}
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
function clearEntities() { hazards = []; game.arena = null; enemies = []; projs = []; zones = []; pickups = []; parts = []; texts = []; fxs = []; evQ = []; tethers = []; for (const p of players) { p.decoy = null; p.decoyOn = false; } }
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
    flash: 0, slowT: 0, rootT: 0, tid: 0, tgt: null, kbx: 0, kby: 0, poisT: 0, poisD: 0, poisTick: 0, poisBy: null, a: 0, dead: false, ph: rand(TAU), n: 0, near: false
  };
  enemies.push(e); return e;
}
function spawnBoss() {
  if (game.boss || game.winT > 0) return;
  const p = pick(alive()) || players[0], a = rand(TAU);
  const e = spawnEnemy('boss', p.x + Math.cos(a) * 520, p.y + Math.sin(a) * 520);
  e.aggro = true; game.boss = e; world.pois[0].used = true; hazards = []; makeBoss(e);
  banner(e.cfg.name, e.cfg.title, 4); sfx('boss'); shake(14);
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
// o.flat: dmg is final (no multipliers or crits). o.shared: damage spread by a Soul Tether, which never spreads again.
function hitEnemy(p, e, dmg, o = {}) {
  if (e.dead) return 0;
  let d = dmg, crit = false;
  if (!o.flat) {
    d *= p.dmgMul * (1 + p.nightDmg * night) * (p.ultT > 0 && p.hero === 'bramble' ? 1.5 : 1);
    if (p.exec && e.hp < e.maxHp * 0.3) d *= 1 + p.exec;
    // Blind Spot: the foe is busy with an ally or a decoy.
    if (p.hero === 'mira' && e.aggro && e.tgt && e.tgt !== p) { d *= 1.4 + 0.2 * (p.h.glint || 0); o = Object.assign({}, o, { color: '#bff6ff' }); blindSpotHit(p, e, o); }
    d *= markBonus(p, e, o); // Shared Opening
    crit = !o.noCrit && Math.random() < p.crit + (p.hero === 'vesper' ? 0.15 * night : 0);
    if (crit) d *= p.critMul;
    if (crit && p.hero === 'vesper' && night > 0.5 && hasT(p, 'lunar')) lunarCut(p);
  }
  if (e.invuln) { if (!o.quiet) floatText(e.x, e.y - e.r - 4, T('Immune'), '#9a96b8', 12); return 0; }
  if (e.armor) d *= 1 - e.armor; if (e.vuln) d *= BOSS_VULN;
  d = Math.max(1, Math.round(d)); if (bossLinkHit(e, d)) { e.flash = 0.1; floatText(e.x, e.y - e.r - 4, d, '#9ff0ff', 15); return d; } e.hp -= d; e.flash = 0.1;
  if (!o.shared && !o.dot && e.tid) shareTether(p, e, d); // direct damage only
  if (!e.aggro) alertPack(e);
  if (o.kb && e.type !== 'boss' && !e.anchor) { const a = angTo(p, e); e.kbx += Math.cos(a) * o.kb; e.kby += Math.sin(a) * o.kb; }
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
// Soul Tether: part of a direct hit on one linked foe lands on the others, flagged so it cannot spread again.
function shareTether(p, e, d) {
  const g = tethers.find(g => g.id === e.tid); if (!g || g.t <= 0) return;
  for (const q of g.list) if (q !== e && !q.dead) { addFx({ kind: 'bolt', x: e.x, y: e.y, x2: q.x, y2: q.y, life: 0.15, max: 0.15, color: '#86f0cf' }); hitEnemy(p, q, d * 0.4, { flat: true, shared: true, proc: true, quiet: true, color: '#86f0cf' }); }
}
function killEnemy(e, p) {
  if (e.dead) return; e.dead = true;
  if (e.noDrop) { burst(e.x, e.y, '#d9c8a0', 14, 220, 4); sfx('die', e); return; } // boss arena objects: no loot, no kill credit, never end the chapter
  if (p) p.kills++;
  talentKill(e);
  // Lingering Light: while a Lanternkeeper is in the party, the fallen leave embers for her lantern.
  if (players.some(q => q.hero === 'vespera')) pickups.push({ id: nextId++, kind: 'lume', x: e.x, y: e.y, val: e.elite || e.type === 'boss' ? 20 : 6, vx: 0, vy: 0, t: rand(TAU), life: 8 });
  burst(e.x, e.y, e.type === 'wisp' ? '#8fd0ff' : '#b79bd6', e.elite || e.type === 'boss' ? 40 : 12, 240, 4); sfx('die', e);
  if (e.type === 'boss') { banner(T(e.cfg ? e.cfg.name : 'boss') + ' ' + L('is defeated', '已被擊敗'), e.cfg ? e.cfg.title : '', 2.4); hazards = []; game.arena = null; game.boss = null; game.winT = 2.2; shake(20); sfx('boom'); projs = projs.filter(q => q.friendly); zones = zones.filter(z => z.friendly); for (const q of enemies) if (!q.dead) { q.dead = true; burst(q.x, q.y, '#b79bd6', 8); } }
  const n = e.type === 'boss' ? 30 : e.elite ? 8 : 1 + (e.xp > 6 ? 1 : 0);
  for (let i = 0; i < n; i++) drop('xp', e.x, e.y, e.xp / n);
  if (e.elite || Math.random() < 0.35) drop('gold', e.x, e.y, e.elite ? 15 : randi(1, 4));
  if (Math.random() < 0.04 || e.elite) drop('heart', e.x, e.y, 20);
  if (e.elite) drop('sigil', e.x, e.y, 1);
  if (p && p.h.ghost && p.dashes < p.dashMax) p.dashes++;
}
function drop(kind, x, y, val) { const a = rand(TAU), v = rand(40, 170); pickups.push({ id: nextId++, kind, x, y, val, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: rand(TAU) }); }
function alertPack(e) { e.aggro = true; for (const q of enemies) if (!q.aggro && dist(q, e) < 240) q.aggro = true; }
const inShelter = p => zones.some(z => z.kind === 'shelter' && z.life > 0 && dist(z, p) < z.r + p.r);
// src: where the blow came from (lets Rowan's shield block frontal hits).
function hurtPlayer(p, dmg, src) {
  if (p.down || p.iT > 0 || p.hp <= 0 || game.winT > 0 || game.over) return;
  let raw = dmg; const sentinel = p.hero === 'rowan' && p.ultT > 0;
  if (p.hero === 'rowan' && src && Math.abs(angDiff(angTo(p, src), p.face)) < 1.05) {
    raw *= 0.5; ring(p.x + Math.cos(p.face) * 18, p.y + Math.sin(p.face) * 18, 26, '#d8c08a'); sfx('block', p);
    let reached = false;
    if (p.roots < ROOTS_MAX) { p.roots++; reached = p.roots === ROOTS_MAX; floatText(p.x, p.y - 44, 'Blocked · root ' + p.roots, '#d8c08a', 13); } else floatText(p.x, p.y - 44, 'Blocked', '#d8c08a', 13);
    rowanBlock(p, reached);
  }
  raw *= 1 - zoneDR(p); // Shelterwood or an Aftergrowth sapling, the stronger
  let d = Math.max(1, Math.round(raw * (1 - Math.min(sentinel ? 0.8 : 0.6, p.armor + (sentinel ? 0.35 : 0)))));
  if (p.barrier > 0) { const a = Math.min(p.barrier, d); p.barrier -= a; d -= a; } // Sunseed Reserve
  if (d > 0 && p.shield > 0) {
    const a = Math.min(p.shield, d); p.shield -= a; d -= a;
    if (d <= 0) { p.iT = 0.55; floatText(p.x, p.y - 30, 'Absorbed', '#86f0cf', 14); burst(p.x, p.y, '#86f0cf', 8, 160); sfx('shield', null, p.id); return; }
  }
  if (d <= 0) { p.iT = 0.55; floatText(p.x, p.y - 30, 'Absorbed', '#d8f0a0', 14); return; }
  p.hp -= d; p.iT = 0.55; shake(9, null, p.id); sfx('hurt', null, p.id);
  floatText(p.x, p.y - 30, '-' + d, '#ff6b6b', 17); burst(p.x, p.y, '#ff6b6b', 10, 200);
  if (p.spite) { ring(p.x, p.y, 130, '#ff9b6b'); for (const e of enemies) if (!e.dead && dist(e, p) < 130 + e.r) hitEnemy(p, e, 14 * p.spite + p.dmg, { proc: true, kb: 250, color: '#ff9b6b' }); }
  if (p.hp <= 0) {
    if (p.embers > 0) {
      p.embers--; p.hp = p.maxHp * 0.5; p.iT = 2.5; banner('An Ember rekindles you', p.embers + ' remaining', 2.5, p.id); sfx('ult', p); ring(p.x, p.y, 260, '#ffb347');
      for (const e of enemies) if (!e.dead && dist(e, p) < 260) hitEnemy(p, e, 40, { proc: true, kb: 600 });
    } else {
      p.hp = 0; p.down = true; p.rev = 0; p.flurry = null; p.dashT = 0; p.ultT = 0; p.shield = 0; p.mercy = null;
      if (players.every(q => q.down)) { game.over = 'dead'; showEnd(); }
      else banner(p.name + ' has fallen', 'Stand beside them to revive.', 3);
    }
  }
}
function hurtNear(x, y, R, dmg) { for (const q of players) if (!q.down && Math.hypot(q.x - x, q.y - y) < R + q.r) hurtPlayer(q, dmg, { x, y }); }
// o.from: swing from this point instead of the player (Mira's reflections).
function meleeArc(p, range, arc, dmg, o = {}) {
  let n = 0; const s = o.from || p, fa = o.face ?? p.face;
  addFx({ kind: 'arc', x: s.x, y: s.y, a: fa, r: range, arc, color: o.color || '#fff', life: 0.14, max: 0.14 });
  for (const e of enemies) {
    if (e.dead || !e.near) continue;
    if (dist(e, s) < range + e.r && Math.abs(angDiff(angTo(s, e), fa)) < arc / 2 + 0.15) { hitEnemy(p, e, dmg, o); n++; if (o.hits) o.hits.push(e); }
  }
  return n;
}
// Hall of Mirrors: three reflections stand beside and behind Mira, placed from her facing so every machine agrees.
const mirrorSpots = p => [-1.7, 1.7, Math.PI].map(o => ({ x: p.x + Math.cos(p.face + o) * 44, y: p.y + Math.sin(p.face + o) * 44 }));
function shoot(x, y, a, speed, o) { projs.push(Object.assign({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, a, r: 6, life: 1, pierce: 0, hit: new Set(), friendly: true, owner: null, color: '#fff', kind: 'bolt' }, o)); }

function doAttack(p) {
  const H = p.hero; p.tAtk = p.atkCd / p.asMul; p.swing = 1;
  const cg = cageOn(p); if (cg && cg.type === 'cage') { hitEnemy(p, cg, p.dmg * 1.2, { color: '#d9b26a' }); sfx('hit', p); return; }
  if (H === 'bramble') {
    const hits = [], n = meleeArc(p, 98 * (1 + 0.3 * (p.h.wide || 0)) * (p.ultT > 0 ? 1.25 : 1), 2.3, p.dmg, { kb: 170, color: '#9fe08a', hits }); talentSweep(p, hits);
    if (p.ultT > 0 && n) heal(p, 2 * n); sfx('slash', p);
  } else if (H === 'wick') {
    const vl = wickVolley(p), n = 1 + (p.h.fork || 0) + vl.bonus, hm = vl.home ? tv(p, 'midnight') : null;
    for (let i = 0; i < n; i++) shoot(p.x + Math.cos(p.face) * 18, p.y + Math.sin(p.face) * 18, p.face + (i - (n - 1) / 2) * 0.13, 640, { owner: p, dmg: p.dmg, life: 0.85, pierce: p.h.pierce || 0, color: '#ffb347', kind: 'fire', fork: vl.fork, home: hm && i === n - 1 ? { turn: hm.turn, range: hm.range } : null });
    sfx('bolt', p);
  } else if (H === 'rowan') {
    meleeArc(p, 118 * (p.ultT > 0 ? 1.25 : 1), 0.75, p.dmg * (p.ultT > 0 ? 1.3 : 1), { kb: 140, color: '#d8c08a' }); sfx('slash', p); rowanThrust(p);
  } else if (H === 'mira') {
    // Shattered Cuts: cut, cut, then a wider finishing slash.
    const fin = ++p.combo % 3 === 0, col = fin ? '#ffffff' : '#bff6ff';
    meleeArc(p, fin ? 84 : 72, fin ? 2.2 : 1.4, p.dmg * (fin ? 1.8 : 1), { kb: fin ? 120 : 30, color: col }); sfx('blade', p);
    if (p.ultT > 0) for (const s of mirrorSpots(p)) meleeArc(p, fin ? 84 : 72, fin ? 2.2 : 1.4, p.dmg * (fin ? 1.8 : 1) * 0.4, { from: s, quiet: true, proc: true, color: '#9ee7f2' });
  } else if (H === 'vespera') {
    const wf = hasT(p, 'wandering') ? tv(p, 'wandering').dmg : 0; // Wandering Flame: one more target, weaker
    shoot(p.x + Math.cos(p.face) * 18, p.y + Math.sin(p.face) * 18, p.face, 600, { owner: p, dmg: p.dmg, life: 0.9, r: 7, color: '#86f0cf', kind: 'ghost', pierce: wf ? 1 : 0, falloff: wf }); sfx('bolt', p);
  } else {
    meleeArc(p, 80 * (1 + 0.15 * (p.h.lunar || 0)), 1.7, p.dmg, { kb: 60, color: '#d9ccff' }); sfx('blade', p);
    const third = ++p.combo % 3 === 0;
    if (third) shoot(p.x, p.y, p.face, 780, { owner: p, dmg: p.dmg * 1.3, life: 0.6, pierce: 2, color: '#e6dcff', kind: 'blade', ret: hasT(p, 'returning') });
    vesperCut(p, third);
  }
}
// Guiding Wisp's target: the living ally nearest the aim point. Only a solo Lanternkeeper may shield herself.
function wispTarget(p) {
  if (players.length < 2) return p;
  let best = null, bd = 1e9;
  for (const q of players) { if (q === p || q.down || dist(q, p) > 700) continue; const d = dist(q, p.aim); if (d < bd) { bd = d; best = q; } }
  return best;
}
function doSkill(p) {
  const H = p.hero, m = p.aim;
  if (slotBlock(p, 1)) return;
  if (H === 'vespera') {
    const t = wispTarget(p); if (!t) { floatText(p.x, p.y - 34, 'No ally to guide', '#aaa', 13); p.tSkill = 0.6; return; }
    p.lan -= LANTERN_COST; p.tSkill = HEROES[H].skillCd * p.cdr; sfx('shield', p);
    const amt = (30 + 3 * p.level) * (1 + 0.5 * (p.h.kindred || 0)); t.shield = Math.max(t.shield, amt); t.shieldT = 6; wispGiven(p, t, amt);
    addFx({ kind: 'bolt', x: p.x, y: p.y, x2: t.x, y2: t.y, life: 0.3, max: 0.3, color: '#86f0cf' }); ring(t.x, t.y, 40, '#86f0cf'); burst(t.x, t.y, '#c9fff0', 14, 160);
    return;
  }
  if (H === 'wick' && !covenReady(p)) return; // Lantern Coven: out of charges
  p.tSkill = HEROES[H].skillCd * p.cdr; sfx('skill', p);
  if (H === 'rowan') {
    // Root Snare, strengthened by every Deep Roots charge.
    const k = p.roots, tr = p.h.taproot || 0, R = 170 * (1 + 0.12 * k), T = 1.6 + 0.3 * k + 0.5 * tr;
    ring(p.x, p.y, R, '#8a6238'); burst(p.x, p.y, '#a9c46c', 24, 340, 4); shake(5, p); sfx('root', p);
    if (k) floatText(p.x, p.y - 44, 'Deep Roots ×' + k, '#d8c08a', 15);
    const cast = hasT(p, 'spreading') ? { p, spread: false } : null; // Spreading Roots: once per cast
    for (const e of enemies) if (!e.dead && dist(e, p) < R + e.r) { e.rootT = e.type === 'boss' ? T * 0.4 : T; e.rootCast = cast; hitEnemy(p, e, p.dmg * 1.3 * (1 + 0.2 * k) * (1 + 0.4 * tr), { color: '#d8c08a' }); }
    p.roots = 0;
    return;
  }
  if (H === 'mira') {
    // Mirror Exchange: trade places with the decoy, then shatter it where Mira stood.
    const z = p.decoy, ox = p.x, oy = p.y;
    addFx({ kind: 'bolt', x: ox, y: oy, x2: z.x, y2: z.y, life: 0.2, max: 0.2, color: '#9ee7f2' });
    p.x = p.tx = z.x; p.y = p.ty = z.y; p.tp++; collideWorld(p, p.r);
    z.life = 0; p.decoy = null; p.decoyOn = false; sfx('shatter', { x: ox, y: oy });
    const R = 125; ring(ox, oy, R, '#9ee7f2'); burst(ox, oy, '#e8fbff', 26, 320, 4); shake(4, p);
    for (const e of enemies) if (!e.dead && dist(e, { x: ox, y: oy }) < R + e.r) hitEnemy(p, e, p.dmg * 3.2 * (1 + 0.4 * (p.h.facets || 0)), { kb: 200, color: '#bff6ff' });
    miraExchange(p, z, ox, oy, R);
    return;
  }
  if (H === 'bramble') {
    const k = p.h.ring || 0, R = 150 * (1 + 0.2 * k); ring(p.x, p.y, R, '#7bc96f'); burst(p.x, p.y, '#7bc96f', 30, 380, 4); shake(5, p);
    for (const e of enemies) if (!e.dead && dist(e, p) < R + e.r) { hitEnemy(p, e, p.dmg * 2.4 * (1 + 0.5 * k), { kb: 220, color: '#9fe08a' }); e.slowT = 2.5; }
    if (hasT(p, 'territory')) briarTerritory(p, R);
  } else if (H === 'wick') {
    const k = p.h.lantern || 0, a = angTo(p, m), d = Math.min(420, dist(p, m));
    const z = { kind: 'burn', friendly: true, owner: p, oid: p.id, x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, r: 110 * (1 + 0.25 * k), delay: 0, life: 5 + 2 * k, max: 5 + 2 * k, dmg: p.dmg * 1.9, tickT: 0, color: '#ffb347', lantern: true };
    zones.push(z); if (hasT(p, 'coven')) covenUse(p, z);
  } else {
    const n = 5 + 2 * (p.h.fan || 0), angs = [];
    for (let i = 0; i < n; i++) angs.push(p.face + (i - (n - 1) / 2) * (1.0 / n));
    if (hasT(p, 'silk')) silkTrails(p, angs);
    for (let i = 0; i < n; i++) shoot(p.x, p.y, angs[i], 720, { owner: p, dmg: p.dmg * 1.6, life: 0.65, pierce: 3, color: '#e6dcff', kind: 'blade' });
  }
}
// Movement half of a dash; runs on whichever machine owns the player's position.
function startDashMove(p, a) {
  if (HEROES[p.hero].alt) return;
  p.dashA = a;
  if (p.hero === 'wick') { p.x += Math.cos(a) * 190; p.y += Math.sin(a) * 190; collideWorld(p, p.r); } else p.dashT = 0.18;
}
// The dash slot: a second skill for `alt` heroes, otherwise a dash.
function doDash(p, a) {
  if (HEROES[p.hero].alt && slotBlock(p, 2)) return;
  p.dashes--; if (p.dashRe <= 0) p.dashRe = dashCdOf(p);
  if (HEROES[p.hero].alt) return doAlt(p);
  const x0 = p.x, y0 = p.y;
  sfx('dash', p); p.dashHit = new Set(); p.iT = Math.max(p.iT, 0.3);
  if (p.hero === 'mira') {
    // Reflection Step leaves a decoy where Mira stood; only one per Mira.
    if (p.decoy) p.decoy.life = 0;
    const T = 4 + 2 * (p.h.facets || 0);
    p.decoy = { kind: 'decoy', dec: true, friendly: true, owner: p, x: p.x, y: p.y, r: 15, life: T, max: T, color: HEROES.mira.color };
    zones.push(p.decoy); p.decoyOn = true; burst(p.x, p.y, '#e8fbff', 10, 160); miraDecoy(p, p.decoy);
  }
  if (p.hero === 'wick') {
    burst(p.x, p.y, '#ffb347', 14, 200);
    zones.push({ kind: 'burn', friendly: true, owner: p, x: p.x, y: p.y, r: 55, delay: 0, life: 2, max: 2, dmg: p.dmg * 1.5, tickT: 0, color: '#ffb347' });
  }
  if (p.remote) { p.dashA = a; if (p.hero === 'wick') { p.x = p.tx; p.y = p.ty; } else p.dashT = 0.18; } else startDashMove(p, a);
  if (p.hero === 'wick') { burst(p.x, p.y, '#ffb347', 14, 200); wickBlink(p, x0, y0); }
}
function doAlt(p) {
  const m = p.aim; sfx('skill', p);
  if (p.hero === 'rowan') {
    // Shelterwood: a grove at Rowan's feet where allies take less damage.
    const k = p.h.thicket || 0, T = 6 + 2 * k;
    const z = { kind: 'shelter', friendly: true, owner: p, oid: p.id, x: p.x, y: p.y, r: 150 * (1 + 0.25 * k), delay: 0, life: T, max: T, color: '#a9c46c' };
    if (hasT(p, 'grove')) { z.follow = true; z.r *= tv(p, 'grove').radius; } // Walking Grove
    zones.push(z); ring(p.x, p.y, z.r, '#a9c46c'); burst(p.x, p.y, '#cfe89a', 20, 260, 4);
  } else if (p.hero === 'vespera') {
    // Soul Tether: link the foes nearest the aim point.
    const a = angTo(p, m), d = Math.min(500, dist(p, m)), c = { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
    const list = enemies.filter(e => !e.dead && e.near && dist(e, c) < 220 + e.r).sort((x, y) => dist(x, c) - dist(y, c)).slice(0, 4);
    if (list.length < 2) { floatText(p.x, p.y - 34, 'Needs two foes to tether', '#aaa', 13); p.dashes++; p.dashRe = p.dashes < p.dashMax ? p.dashRe : 0; return; }
    p.lan -= LANTERN_COST; sfx('tether', p);
    const g = { id: nextId++, list, t: 6, owner: p, moved: false };
    for (const e of list) { if (e.tid) { const o = tethers.find(o => o.id === e.tid); if (o) o.list = o.list.filter(q => q !== e); } e.tid = g.id; ring(e.x, e.y, e.r + 14, '#86f0cf'); }
    tethers.push(g);
  }
}
function doUlt(p) {
  const H = p.hero, m = p.aim; p.tUlt = ULT_CD * p.cdr; sfx('ult', p); shake(8, p);
  if (H === 'bramble') { p.ultT = 8; p.pulse = 0; p.ultExt = 0; ring(p.x, p.y, 180, '#7bc96f'); }
  else if (H === 'rowan') { p.ultT = 8; p.pulse = 0; ring(p.x, p.y, 220, '#a9c46c'); burst(p.x, p.y, '#cfe89a', 30, 300, 5); banner('Ancient Sentinel', 'The wood rallies to you.', 2, p.id); }
  else if (H === 'mira') { p.ultT = 7; ring(p.x, p.y, 90, '#9ee7f2'); for (const s of mirrorSpots(p)) burst(s.x, s.y, '#e8fbff', 12, 180); sfx('shatter', p); }
  else if (H === 'vespera') {
    // Midnight Procession: a march of spirits, launched toward the aim point, that then hunts the nearest foes.
    const a = angTo(p, m), sp = 260;
    zones.push({ kind: 'proc', friendly: true, owner: p, x: p.x, y: p.y, r: 80, delay: 0, life: HEROES.vespera.ultTime, max: HEROES.vespera.ultTime, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, tickT: 0, color: '#86f0cf' });
  }
  else if (H === 'wick') {
    for (let i = 0; i < 12; i++) { const a = rand(TAU), d = i === 0 ? 0 : rand(40, 210); zones.push({ kind: 'blast', friendly: true, owner: p, x: m.x + Math.cos(a) * d, y: m.y + Math.sin(a) * d, r: 88, delay: 0.5 + i * 0.2, max: 0.5 + i * 0.2, dmg: p.dmg * 4.2, color: '#ff7a2f', final: i === 11, cx: m.x, cy: m.y }); }
  } else {
    if (hasT(p, 'total')) { if (!eclipseStart(p)) p.tUlt = 1; return; } // Total Eclipse
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
  const sp = p.spd * p.spdMul * (p.hero === 'vesper' ? 1 + 0.15 * night : 1) * (inp.l && p.hero !== 'vesper' && p.hero !== 'mira' ? 0.8 : 1) * (p.hero === 'rowan' && p.ultT > 0 ? 0.85 : 1);
  const sl = bindSlow(p) * hasteMul(p); p.x += inp.mx * sp * sl * dt; p.y += inp.my * sp * sl * dt; if (inp.mx || inp.my) p.walk += dt;
}
const trail = p => parts.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.25, max: 0.25, color: HEROES[p.hero].color, size: 9 });
// One Eclipse blink-strike on e (mult: Total Eclipse's reduced repeat damage).
function eclipseStrike(p, e, mult) {
  const a = rand(TAU); burst(p.x, p.y, '#cdbcff', 8); addFx({ kind: 'bolt', x: p.x, y: p.y, x2: e.x, y2: e.y, life: 0.2, max: 0.2, color: '#cdbcff' });
  p.x = p.tx = e.x + Math.cos(a) * (e.r + 20); p.y = p.ty = e.y + Math.sin(a) * (e.r + 20); p.tp++; p.face = a + Math.PI; p.swing = 1;
  hitEnemy(p, e, p.dmg * 3.6 * mult, { color: '#e6dcff' }); sfx('blade', p);
}
function updPlayer(p, inp, dt) {
  p.tAtk -= dt; p.tSkill -= dt; p.tUlt -= dt; p.iT -= dt; p.swing = Math.max(0, p.swing - dt * 6);
  if (p.dashes < p.dashMax) { p.dashRe -= dt; if (p.dashRe <= 0) { p.dashes++; p.dashRe = p.dashes < p.dashMax ? dashCdOf(p) : 0; } }
  p.cds = [p.atkCd / p.asMul, HEROES[p.hero].skillCd * p.cdr, dashCdOf(p), ULT_CD * p.cdr];
  if (p.shieldT > 0) { p.shieldT -= dt; if (p.shieldT <= 0) { shieldExpired(p); p.shield = 0; } }
  talentPlayerTick(p, dt);
  if (p.hero === 'vespera') p.lan = Math.min(p.lanMax, p.lan + (4 + (p.h.deepwick || 0)) * dt);
  if (p.decoy && p.decoy.life <= 0) p.decoy = null;
  p.decoyOn = !!p.decoy;
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
    trail(p); rampartFree(p);
    for (const e of enemies) if (!e.dead && e.near && !p.dashHit.has(e) && dist(e, p) < p.r + e.r + 14) {
      p.dashHit.add(e); hitEnemy(p, e, p.dmg * (p.hero === 'bramble' ? 1.6 : 1.2 * (p.h.ghost ? 2 : 1)), { kb: p.hero === 'bramble' ? 380 : 0, color: HEROES[p.hero].color }); talentDashHit(p, e);
      if (p.h.bulwark) heal(p, 4 * p.h.bulwark);
    }
  } else if (!p.remote) walk(p, inp, dt);
  if (!p.remote) bossLocalMove(p, dt);
  if (p.flurry) {
    const f = p.flurry; p.iT = Math.max(p.iT, 0.25); f.t -= dt;
    if (f.t <= 0 && f.total) {
      const e = f.left > 0 ? eclipseNext(p) : null;
      if (e) { const k = f.struck.get(e) || 0; f.struck.set(e, k + 1); f.left--; eclipseStrike(p, e, k ? tv(p, 'total').repeat : 1); f.t = 0.1; }
      if (!e || f.left <= 0) p.flurry = null;
    } else if (f.t <= 0) {
      let e = f.list.shift(); while (e && e.dead) e = f.list.shift();
      if (e) { eclipseStrike(p, e, 1); f.t = 0.1; }
      if (!f.list.length || !e) p.flurry = null;
    }
  } else {
    if (inp.l && p.tAtk <= 0 && p.dashT <= 0) doAttack(p);
    if (inp.skill && p.tSkill <= 0) doSkill(p);
    if (inp.ult && p.tUlt <= 0) { if (p.level >= 3) doUlt(p); else floatText(p.x, p.y - 34, 'Ultimate unlocks at level 3', '#aaa', 13); }
  }
  if (!p.remote) collideWorld(p, p.r);
  if (p.ultT > 0) {
    p.ultT -= dt; p.pulse -= dt; if (p.ultT <= 0 && !p.down) talentUltEnd(p); // ran out on its own
    if (p.pulse <= 0 && p.hero === 'bramble') { p.pulse = 1; ring(p.x, p.y, 125, '#7bc96f'); for (const e of enemies) if (!e.dead && dist(e, p) < 125 + e.r) hitEnemy(p, e, p.dmg * 1.2, { proc: true, color: '#9fe08a', quiet: true }); }
    else if (p.pulse <= 0 && p.hero === 'rowan') { p.pulse = 1.2; ring(p.x, p.y, 220, '#d8c08a'); for (const e of enemies) if (!e.dead && dist(e, p) < 650) e.aggro = true; }
  }
  const regen = p.dayRegen * (1 - night) + (p.hero === 'bramble' ? 1.5 * (1 - night) : 0); if (regen > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + regen * dt);
  else if (p.hero === 'bramble' && p.hp >= p.maxHp) sunseed(p, 1.5 * (1 - night), dt); // Daybloom's excess
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
  // boss altar: stand in the ring to unseal the Gloam Stag early
  const alt = world.pois[0];
  if (alt && alt.kind === 'altar' && !alt.used && !game.boss && game.winT <= 0) {
    const before = alt.unseal || 0, on = players.some(p => !p.down && dist(p, alt) < UNSEAL_RADIUS);
    alt.unseal = on ? before + dt : Math.max(0, before - dt * UNSEAL_DRAIN);
    if (on && Math.floor(alt.unseal) > Math.floor(before)) sfx('warn', alt); // a tick each second
    if (alt.unseal >= UNSEAL_TIME) { alt.unseal = 0; spawnBoss(); }
  }
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
    const d = Math.hypot(dx, dy) || 0.01; if (d < mm) { const push = (mm - d) / 2, wa = a.type === 'boss' || a.anchor ? 0 : 1, wb = b.type === 'boss' || b.anchor ? 0 : 1; a.x -= dx / d * push * wa; a.y -= dy / d * push * wa; b.x += dx / d * push * wb; b.y += dy / d * push * wb; }
  }
  // projectiles
  for (const q of projs) {
    if (q.friendly && (q.back || q.home)) talentProjSteer(q, dt);
    q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.x < 0 || q.y < 0 || q.x > world.S || q.y > world.S) q.life = 0;
    if (!q.back) for (const b of world.obs) if (Math.abs(q.x - b.x) < b.cr && Math.abs(q.y - b.y) < b.cr && dist(q, b) < b.cr) { q.life = 0; burst(q.x, q.y, q.color, 4, 100, 2); break; }
    if (q.life <= 0) { if (q.friendly) talentProjEnd(q); continue; } // a Returning Edge blade turns back
    if (q.friendly) {
      for (const e of enemies) if (!e.dead && e.near && !q.hit.has(e) && dist(e, q) < e.r + q.r) { q.hit.add(e); hitEnemy(q.owner, e, q.dmg, { kb: 60, color: q.color }); talentProjHit(q, e); if (q.pierce-- <= 0) { q.life = 0; break; } }
    } else for (const p of players) if (!p.down && dist(q, p) < p.r + q.r - 2) { if (p.iT <= 0) { hurtPlayer(p, q.dmg, { x: q.x - q.vx, y: q.y - q.vy }); q.life = 0; } break; }
  }
  projs = projs.filter(q => q.life > 0);
  // zones
  for (const z of zones) {
    talentZonePre(z, dt);
    if (z.tal && talentZone(z, dt)) continue;
    if (z.delay > 0) {
      z.delay -= dt;
      if (z.delay <= 0 && z.kind === 'blast') {
        sfx('boom', z); burst(z.x, z.y, z.color, 22, 320, 5); ring(z.x, z.y, z.r, z.color); shake(5, z);
        if (z.friendly) { for (const e of enemies) if (!e.dead && dist(e, z) < z.r + e.r) hitEnemy(z.owner, e, z.dmg, { kb: 200, color: z.color }); constellation(z); }
        else hurtNear(z.x, z.y, z.r - 4, z.dmg);
        z.life = 0;
      }
      continue;
    }
    if (z.kind === 'burn') {
      z.life -= dt; z.tickT -= dt;
      if (Math.random() < 0.5) parts.push({ x: z.x + rand(-z.r, z.r) * 0.7, y: z.y + rand(-z.r, z.r) * 0.7, vx: 0, vy: -50, life: 0.5, max: 0.5, color: z.color, size: 3 });
      if (z.tickT <= 0) { z.tickT = 0.25; for (const e of enemies) if (!e.dead && dist(e, z) < z.r + e.r) hitEnemy(z.owner, e, z.dmg * 0.25, { proc: true, color: '#ffb347', quiet: true }); }
    } else if (z.kind === 'shelter' || z.kind === 'decoy') z.life -= dt;
    else if (z.kind === 'proc') {
      // Guided: locks on to the nearest foe (within 700) and turns toward it, picking the next one when it falls.
      // With nothing to chase it keeps flying straight. Guests just follow the velocity in the snapshots.
      if (z.back) procBackStep(z, dt); // Returning Procession: follows its path back, no hunting
      else if (!z.tgt || !targetable(z.tgt)) { let b = null, bd = 700; for (const e of enemies) { if (!targetable(e)) continue; const d = dist(e, z); if (d < bd) { bd = d; b = e; } } z.tgt = b; }
      if (z.tgt && !z.back) { const sp = Math.hypot(z.vx, z.vy) || 260, cur = Math.atan2(z.vy, z.vx), na = cur + clamp(angDiff(angTo(z, z.tgt), cur), -4.5 * dt, 4.5 * dt); z.vx = Math.cos(na) * sp; z.vy = Math.sin(na) * sp; }
      z.life -= dt; z.tickT -= dt; z.x += z.vx * dt; z.y += z.vy * dt;
      if (z.tickT <= 0) {
        z.tickT = 0.3; const o = z.owner, s = z.str || 1;
        for (const e of enemies) if (!e.dead && dist(e, z) < z.r + e.r) { if (z.hits) { const k = z.hits.get(e) || 0; if (k >= z.hitCap) continue; z.hits.set(e, k + 1); } hitEnemy(o, e, o.dmg * 0.9 * s, { proc: true, quiet: true, color: '#86f0cf' }); }
        for (const q of players) if (!q.down && dist(q, z) < z.r + q.r) heal(q, (2 + 0.03 * q.maxHp) * s);
      }
      if (z.life <= 0) procEnded(z);
    }
  }
  covenThreads(dt);
  zones = zones.filter(z => z.kind === 'blast' ? z.life !== 0 : z.life > 0);
  updHazards(dt, true);
  // pickups — experience, gold and sigils are shared by the whole party
  for (const g of tethers) { g.t -= dt; g.list = g.list.filter(e => !e.dead && e.tid === g.id); if (g.t <= 0 || g.list.length < 2) { for (const e of g.list) e.tid = 0; g.list = []; } }
  tethers = tethers.filter(g => g.list.length);
  for (const k of pickups) {
    k.t += dt; k.x += k.vx * dt; k.y += k.vy * dt; k.vx *= Math.pow(0.02, dt); k.vy *= Math.pow(0.02, dt);
    if (k.kind === 'lume' && (k.life -= dt) <= 0) { k.dead = true; continue; }
    // Lantern embers only answer a Lanternkeeper; everything else goes to whoever is nearest.
    const p = k.kind === 'lume' ? nearestPlayer(k, q => q.hero === 'vespera') : nearestPlayer(k); if (!p) continue; const d = dist(k, p);
    if (k.kind === 'lume' && p.lan >= p.lanMax) continue;
    if (k.kind === 'heart' && p.hp >= p.maxHp) continue;
    if (d < p.pickR) { const a = angTo(k, p), v = 520 * (1 - d / (p.pickR * 1.4)) + 120; k.x += Math.cos(a) * v * dt; k.y += Math.sin(a) * v * dt; }
    if (d < 20) {
      k.dead = true;
      if (k.kind === 'xp') { for (const q of players) gainXp(q, k.val); sfx('xp', p); }
      else if (k.kind === 'gold') { for (const q of players) q.gold += k.val; sfx('gold', p); }
      else if (k.kind === 'heart') { heal(p, k.val); sfx('heal', p); }
      else if (k.kind === 'lume') { p.lan = Math.min(p.lanMax, p.lan + k.val); sfx('xp', p); emberCollected(p); }
      else if (k.kind === 'sigil') { for (const q of players) { q.pending++; q.choiceTitle = 'Sigil claimed'; } sfx('level'); }
    }
  }
  pickups = pickups.filter(k => !k.dead);
  enemies = enemies.filter(e => !e.dead);
  for (const p of players) if (p.pending > 0 && !p.choice) rollChoice(p);
  for (const p of players) if (p.ctPending > 0 && !p.ctChoice) offerChapterTalent(p);
  updFx(dt);
}
function gainXp(p, v) {
  p.xp += v * p.xpMul;
  while (p.xp >= xpNeed(p.level)) { p.xp -= xpNeed(p.level); p.level++; p.pending++; p.choiceTitle = 'Level ' + p.level; sfx('level', null, p.id); ring(p.x, p.y, 120, '#f3d48a'); if (p.level === 3) banner('Ultimate unlocked', 'Press Q', 3, p.id); }
}
function updEnemy(e, dt) {
  e.flash -= dt;
  talentEnemyTick(e, dt); if (e.dead) return; // bleed, marks
  if (e.poisT > 0) { e.poisT -= dt; e.poisTick -= dt; if (e.poisTick <= 0) { e.poisTick = 0.5; e.hp -= e.poisD * 0.5; floatText(e.x, e.y - e.r, Math.round(e.poisD * 0.5), '#a6e36a', 12); if (e.hp <= 0) { killEnemy(e, e.poisBy); return; } } }
  // p may be a player or one of Mira's decoys (p.dec); decoys draw attacks but cannot be hurt.
  const p = enemyTarget(e); e.tgt = p; if (!p) return;
  const d = dist(e, p);
  if (!e.aggro) { if (d < 380 + 110 * night) alertPack(e); else return; }
  if (e.rootT > 0) e.rootT -= dt;
  e.t -= dt; e.cd -= dt;
  const slow = e.slowT > 0 ? 0.45 : 1; if (e.slowT > 0) e.slowT -= dt;
  const sp = e.spd * slow * (1 + 0.15 * night), a = angTo(e, p), ca = Math.cos(a), sa = Math.sin(a), dm = dmgOf(e);
  let mx = 0, my = 0;
  switch (e.type) {
    case 'husk':
      if (e.state === 'wind') {
        if (e.t <= 0) {
          e.state = 'rest'; e.t = 0.55; e.kbx += Math.cos(e.a) * 380; e.kby += Math.sin(e.a) * 380; addFx({ kind: 'arc', x: e.x, y: e.y, a: e.a, r: e.r + 34, arc: 1.6, color: '#d9a6ff', life: 0.14, max: 0.14 });
          for (const q of players) if (!q.down && dist(e, q) < e.r + q.r + 38 && Math.abs(angDiff(angTo(e, q), e.a)) < 1.1) hurtPlayer(q, dm, e);
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
      if (d < e.r + p.r + 2 && e.cd <= 0 && !p.dec) { hurtPlayer(p, dm, e); e.cd = 0.9; }
      break;
    }
    case 'boss': { [mx, my] = bossThink(e, dt, p); break; }
    case 'sapling': case 'orb': case 'vcore': case 'pillar': case 'split': case 'mask': case 'cage': case 'bind': case 'rod': case 'brazier': [mx, my] = summonThink(e, dt, p); break;
    case 'oldboss': {
      const rage = e.hp < e.maxHp * 0.5;
      if (e.state === 'chase') {
        if (d > 80) { mx = ca * sp * (rage ? 1.25 : 1); my = sa * sp * (rage ? 1.25 : 1); }
        if (d < e.r + p.r && e.cd <= 0 && !p.dec) { hurtPlayer(p, dm, e); e.cd = 0.8; }
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
  if (e.anchor || e.hidden) mx = my = 0, e.kbx = e.kby = 0;
  if (e.rootT > 0) mx = my = 0; // Root Snare: rooted foes still swing and spit, but cannot move
  e.x += (mx + e.kbx) * dt; e.y += (my + e.kby) * dt;
  if (mx || my) e.dir = mx < 0 ? -1 : 1;
  const bx = e.x, by = e.y; collideWorld(e, e.type === 'boss' ? 20 : e.r);
  if (e.splint) splinterCheck(e, dt, bx, by); // Splintering Impact
  const f = Math.pow(0.003, dt); e.kbx *= f; e.kby *= f;
}
function nearPoi(p) { let best = null, bd = 80; for (const o of world.pois) { if (o.kind === 'camp') continue; const d = dist(o, p); if (d < bd) { bd = d; best = o; } } return best; }
const merchCost = o => 40 + 30 * o.uses;
function poiPrompt(o) {
  switch (o.kind) {
    case 'altar': return o.used ? null : 'Stand in the ring for ' + UNSEAL_TIME + ' s to unseal ' + bossCfg(game.chapter).name;
    case 'spring': return o.used ? null : 'Drink from the spring';
    case 'chest': return o.used ? null : 'Open cache';
    case 'shrine': return o.used ? null : 'Pray at the wayshrine';
    case 'merchant': return 'Buy a boon — ' + merchCost(o) + ' gold';
  }
}
function interact(p) {
  const o = nearPoi(p); if (!o || !poiPrompt(o) || o.kind === 'altar') return;
  if (o.kind === 'spring') { o.used = true; for (const q of players) heal(q, q.maxHp * 0.6); sfx('heal'); ring(o.x, o.y, 90, '#7fd6ff'); }
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
  const pool = TALENTS.filter(t => (!t.hero || t.hero === p.hero) && !(t.dash && HEROES[p.hero].alt) && (p.talents[t.id] || 0) < t.max);
  if (!pool.length) { p.pending = 0; p.gold += 30; return; }
  const list = [];
  while (list.length < 3 && pool.length) { const w = pool.map(t => t.hero ? 2 : 1), tot = w.reduce((a, b) => a + b, 0); let r = rand(tot), i = 0; while (i < w.length - 1 && r > w[i]) r -= w[i++]; list.push(pool.splice(i, 1)[0]); }
  p.choice = list; p.choiceSeq++;
}
// ---------- character unlocks ----------
// Unlockable heroes (data.js: `rarity`) are won as character rewards in the single chapter roll (meta.js REWARD_POOLS)
// and saved in the profile. Unlocks from the earlier per-device save ('duskbound-unlocks') are carried over once.
try {
  const old = JSON.parse(localStorage.getItem('duskbound-unlocks') || 'null');
  if (old && Array.isArray(old.heroes)) { for (const h of old.heroes) if (HEROES[h] && HEROES[h].rarity && !PROFILE.characters.includes(h)) PROFILE.characters.push(h); saveMe(); localStorage.removeItem('duskbound-unlocks'); }
} catch (e) { }
const unlocked = id => !!HEROES[id] && (!HEROES[id].rarity || PROFILE.characters.includes(id));
const ownsHero = (lo, id) => !!HEROES[id] && (!HEROES[id].rarity || !!(lo && lo.characters && lo.characters.includes(id)));
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
    if (!r) {
      const roll = CHAPTER_REWARDS.roll ? rollReward({ ...(p.lo || {}), chapter: game.chapter }) : { rarity: null, item: null }; r = { claim, pid, id: p.id, name: p.name, rarity: roll.rarity, item: roll.item, ch: game.chapter, diff: game.diff, run: game.runId, final: game.over === 'final' }; net.claims.set(claim, r);
      // chapter talent pick: earned with this roll's result (CHAPTER_TALENT in meta.js); once per claim, never rerolled
      if (earnsChapterTalent(r.item, game.chapter)) { r.ct = 1; p.ctPending = (p.ctPending || 0) + 1; }
    }
    list.push(r); deliverReward(r);
  }
  game.rewards = list.map(r => ({ id: r.id, name: r.name, rarity: r.rarity, item: r.item, ct: r.ct ? 1 : 0 }));
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
  const valid = m.rarity === null || (RARITIES.includes(m.rarity) && typeof m.item === 'string' && (m.item === 'keepsake' || itemAvailable(m.item, { weapons: [], talents: {}, upgrades: {}, characters: [], chapter: 99 }) || /^u:/.test(m.item)));
  if (!valid) return;
  if (grantReward(PROFILE, m.claim, m.rarity, m.rarity ? m.item : null, { chapter: m.ch, diff: m.diff })) {
    if (m.rarity) banner(rarityName(m.rarity) + ' reward', itemLabel(m.item), 4, me && me.id);
  }
  if (m.final) {
    const had = PROFILE.characters.slice(), un = recordCampaignClear(PROFILE, m.diff, m.run);
    if (un) setTimeout(() => banner(DIFF(un).name + ' unlocked', 'Campaign cleared on ' + DIFF(m.diff).name, 5), 4200);
    const hero = PROFILE.characters.find(h => !had.includes(h));
    if (hero) setTimeout(() => banner('Character: ' + HEROES[hero].name, 'Campaign cleared on ' + DIFF(m.diff).name, 5), un ? 9400 : 4200);
  }
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
const PEER_PREFIX = 'duskbound-v8-'; // bump whenever messages change, so mismatched versions never meet
const noNetMsg = () => window.DUSK_NO_NET ? 'Online co-op is not available on this page. Solo works here; for co-op, open the downloaded duskbound.html file or a copy on your own website.' : 'Online play needs an internet connection (the networking library did not load).';
function wrapConn(c) {
  const w = { peerId: c.peer, send: d => { try { c.send(d); } catch (e) { } }, onData: null, onClose: null, close: () => { try { c.close(); } catch (e) { } } };
  c.on('data', d => w.onData && w.onData(d)); c.on('close', () => w.onClose && w.onClose()); c.on('error', () => w.onClose && w.onClose());
  return w;
}
// The PeerJS server only introduces players; once connected, game data flows directly. If the link to the server
// drops (mobile networks, switching apps), reconnect to it so new players can still join and voice calls can start.
function keepSignal(peer) {
  peer.on('disconnected', () => { let n = 0; const retry = () => { if (peer.destroyed || !peer.disconnected || n++ > 20) return; try { peer.reconnect(); } catch (e) { } setTimeout(retry, 3000); }; setTimeout(retry, 1000); });
}
// Transport: WebRTC data channels brokered by the public PeerJS signalling server. Replaceable for tests.
let NetT = {
  ok: () => typeof Peer !== 'undefined' && !window.DUSK_NO_NET,
  voice: true,
  host(code, h) {
    const peer = new Peer(PEER_PREFIX + code); keepSignal(peer);
    peer.on('open', () => h.open()); peer.on('connection', c => c.on('open', () => h.conn(wrapConn(c)))); peer.on('error', e => h.error(e.type || 'error'));
    return { close: () => peer.destroy(), peer, peerId: PEER_PREFIX + code };
  },
  join(code, h) {
    const peer = new Peer(); keepSignal(peer);
    peer.on('open', () => { const c = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' }); c.on('open', () => h.open(wrapConn(c))); });
    peer.on('error', e => h.error(e.type || 'error'));
    return { close: () => peer.destroy(), peer };
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
  Voice.stop();
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
  upstream_error: 'The live connection did not answer. Try again.',
  network: 'Could not reach the matchmaking server. Check your internet connection and try again.', 'server-error': 'Could not reach the matchmaking server. Check your internet connection and try again.',
  'socket-error': 'Could not reach the matchmaking server. Check your internet connection and try again.', 'socket-closed': 'Could not reach the matchmaking server. Check your internet connection and try again.',
  'browser-incompatible': 'This browser can’t make direct connections for co-op. Try Safari or Chrome.', webrtc: 'The direct connection to the host failed. Both players should be on the internet (not only local Wi-Fi) and try again.'
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
    error(t) { if (net.handle !== handle) return; if (t === 'unavailable-id') hostGame(); else if (!net.ready || t === 'not-allowed-to-host') netFail(netWhy(t) || 'Could not open a room (' + t + '). Check your connection and try again.'); else console.warn('network (non-fatal):', t); }
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
  const tok = typeof d.tok === 'string' ? d.tok.slice(0, 40) : '', name = cleanName(d.name, net.nextPid);
  let hero = HEROES[d.hero] ? d.hero : 'bramble';
  let lo = sanitizeLoadout(d.lo, hero);
  if (!ownsHero(lo.valid ? lo : null, hero)) { hero = 'bramble'; lo = sanitizeLoadout(d.lo, hero); }
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
  banner(p.name + ' rejoined the party', '', 2.5); sendVoice();
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
    sendVoice();
    if (!game.over && players.every(q => q.down)) { game.over = 'dead'; showEnd(); }
  }
}
function voiceRoster() { return NetT.voice && net.handle && net.handle.peerId ? [{ id: 1, peer: net.handle.peerId }].concat(net.conns.filter(c => c.peerId && (c.inGame || game.state === 'lobby')).map(c => ({ id: c.pid, peer: c.peerId }))) : []; }
function sendVoice() {
  if (net.mode !== 'host' || !NetT.voice || !net.handle) return; const list = voiceRoster();
  Voice.start(net.handle.peer, 1); Voice.sync(list); for (const c of net.conns) c.send({ t: 'vroster', list });
}
function sendLobby() { setTimeout(sendVoice, 0); const pl = net.lobby.map(q => ({ id: q.id, name: q.name, hero: q.hero, unl: q.id === 1 ? PROFILE.unlocked : (q.lo && q.lo.unlocked) || ['normal'] })); for (const c of net.conns) c.send({ t: 'lobby', you: c.pid, code: net.code, diff: net.diff, players: pl }); }
function hostRecv(c, d) {
  if (!d || typeof d !== 'object') return;
  if (c.pending) { if (d.t === 'hello') greetClient(c, d); return; }
  if (!net.conns.includes(c)) return;
  if (d.t === 'hero') { const q = net.lobby.find(q => q.id === c.pid); if (q && HEROES[d.hero] && game.state === 'lobby' && ownsHero(sanitizeLoadout(d.lo, d.hero), d.hero)) { q.hero = d.hero; const lo = sanitizeLoadout(d.lo, d.hero); if (lo.valid && q.lo && lo.pid === q.lo.pid) q.lo = lo; if (!partyDiffOk(net.diff)) net.diff = bestCommonDiff(); sendLobby(); showLobby(); } }
  else if (d.t === 'i' || d.t === 'pick' || d.t === 'ctpick') {
    const p = players.find(q => q.id === c.pid); if (!p || game.state !== 'play') return;
    if (d.t === 'pick') { if (d.q === p.choiceSeq) applyPick(p, d.i | 0); return; }
    if (d.t === 'ctpick') { applyChapterTalent(p, String(d.id || ''), d.q); return; } // validated there
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
    fl: p.flurry ? 1 : 0, sp: r1(p.spd * p.spdMul * hasteMul(p)), pr: p.pickR | 0,
    rc: p.roots, ln: r1(p.lan), lm: p.lanMax, sh: r1(p.shield), dc: p.decoyOn ? 1 : 0, br: r1(p.barrier || 0), tl: p.ct
  };
}
function sendSnaps() {
  if (!net.conns.length || !world) return;
  const b = game.boss, g = [r1(game.time), game.chapter, game.wasNight ? 1 : 0, b ? [b.x | 0, b.y | 0, r3(b.hp / b.maxHp), b.phase || 1, r2(b.armor || 0), b.hidden ? 1 : 0, game.arena ? game.arena.x | 0 : 0, game.arena ? game.arena.y | 0 : 0, b.state === 'b_rec' ? 1 : 0] : 0, game.over || 0];
  const P = players.map(snapPlayer), O = world.pois.map(o => [o.used ? 1 : 0, o.uses || 0, r2(o.unseal || 0)]);
  for (const c of net.conns) {
    const cp = players.find(p => p.id === c.pid); if (!cp || !c.inGame) continue;
    const nr = o => Math.abs(o.x - cp.x) < 1150 && Math.abs(o.y - cp.y) < 850;
    c.send({
      t: 's', g, P, O,
      E: enemies.filter(e => !e.dead && nr(e)).map(e => [e.id, ETN.indexOf(e.type), e.x | 0, e.y | 0, r1(e.r), r3(Math.max(0, e.hp / e.maxHp)), e.elite ? 1 : 0, STN.indexOf(e.state), r2(e.a), e.flash > 0 ? 1 : 0, e.slowT > 0 ? 1 : 0, e.poisT > 0 ? 1 : 0, e.dir || 1, e.rootT > 0 ? 1 : 0, e.tid || 0, e.bleed ? 1 : 0, e.mark ? 1 : 0]),
      Q: projs.filter(nr).map(q => [q.x | 0, q.y | 0, q.vx | 0, q.vy | 0, q.r, q.kind, q.color, r2(q.life)]),
      X: hazards.filter(h => Math.abs(h.x - cp.x) < 1700 && Math.abs(h.y - cp.y) < 1400 || h.k === 'tsunami' || h.k === 'wall' || h.k === 'beam').map(hzSnap),
      Z: zones.filter(nr).map(z => [z.x | 0, z.y | 0, z.r | 0, z.kind, r2(Math.max(0, z.delay || 0)), r2(z.max), r2(z.life || 0), z.friendly ? 1 : 0, z.lantern ? 1 : 0, z.color, z.vx | 0, z.vy | 0, z.x2 | 0, z.y2 | 0, z.oid || 0, z.coven ? 1 : 0]),
      K: pickups.filter(nr).map(k => [k.id, k.kind, k.x | 0, k.y | 0]),
      ev: evQ.filter(e => (!e.to || e.to === c.pid) && (e.x === undefined || Math.hypot(e.x - cp.x, e.y - cp.y) < 1200)).map(e => ({ k: e.k, a: e.a })),
      c: cp.choice ? { q: cp.choiceSeq, ids: cp.choice.map(t => t.id), title: cp.choiceTitle } : 0, tal: cp.talents, st: statsOf(cp),
      ct: cp.ctChoice ? { q: cp.ctSeq, ids: cp.ctChoice } : 0
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
    error(t) { if (net.handle !== handle) return; if (net.host) { console.warn('network (non-fatal):', t); return; } netFail(t === 'peer-unavailable' ? 'No room found with code ' + code + '.' : netWhy(t) || 'Connection failed (' + t + ').'); }
  });
  setTimeout(() => { if (net.handle === handle && !net.host) netFail('Could not reach room ' + code + '.'); }, 22000);
}
function clientRecv(d) {
  if (!d || net.mode !== 'client') return;
  if (d.t === 'no') netFail(d.why);
  else if (d.t === 'secret' && /^[a-z0-9]{24}$/.test(d.s)) { try { localStorage.setItem('duskbound-rejoin', JSON.stringify({ code: d.code, s: d.s, t: Date.now() })); } catch (e) { } }
  else if (d.t === 'reward') receiveReward(d);
  else if (d.t === 'vroster' && Array.isArray(d.list) && NetT.voice && net.handle && net.handle.peer) { Voice.start(net.handle.peer, net.myId); Voice.sync(d.list.filter(r => r && Number.isInteger(r.id) && typeof r.peer === 'string').slice(0, 4)); }
  else if (d.t === 'rewards' && Array.isArray(d.list)) { game.rewards = d.list.slice(0, 4); if (game.over) showEnd(); }
  else if (d.t === 'lobby') { players = []; net.myId = d.you; net.lobby = d.players; net.code = d.code; net.diff = DIFF(d.diff).id; game = newGame(); game.state = 'lobby'; me = null; showLobby(); }
  else if (d.t === 'world') {
    game = newGame(); game.chapter = d.ch; game.diff = DIFF(d.diff).id; game.runId = String(d.run || ''); night = 0; net.myId = d.you; net.out = {}; net.pickedSeq = -1; net.ctPicked = -1; clearEntities();
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
  game.boss = g[3] ? { x: g[3][0], y: g[3][1], hp: g[3][2], maxHp: 1, phase: g[3][3], armor: g[3][4], hidden: !!g[3][5], vuln: !!g[3][8] } : null;
  game.arena = g[3] ? { x: g[3][6], y: g[3][7] } : null;
  hazards = (s.X || []).map(hzFromSnap);
  if ((g[4] || null) !== game.over) { game.over = g[4] || null; if (game.over) showEnd(); else hide(); }
  players = players.filter(p => s.P.some(q => q.id === p.id));
  for (const q of s.P) {
    const p = players.find(o => o.id === q.id); if (!p) continue;
    p.hp = q.hp; p.maxHp = q.mh; p.level = q.lv; p.xp = q.xp; p.gold = q.g; p.kills = q.k; p.embers = q.em;
    p.tAtk = q.ta; p.tSkill = q.ts; p.tUlt = q.tu; p.dashRe = q.dr; p.dashMax = q.dm; p.cds = q.cds; if (!(p === me && p.dashLock > 0)) p.dashes = q.d;
    p.iT = q.it ? 0.2 : 0; p.swing = q.sw; p.ultT = q.ut; p.down = !!q.dn; p.rev = q.rv; p.flurry = q.fl ? 1 : null; p.spd = q.sp; p.spdMul = 1; p.pickR = q.pr;
    p.roots = q.rc | 0; p.lan = num(q.ln); p.lanMax = num(q.lm, LANTERN_MAX); p.shield = num(q.sh); p.decoyOn = !!q.dc;
    p.barrier = num(q.br); p.ct = Array.isArray(q.tl) ? q.tl.filter(id => heroTalent(p.hero, id)) : [];
    if (p === me) { if (q.tp !== p.tp) { p.x = q.x; p.y = q.y; p.tp = q.tp; p.dashT = 0; } }
    else { p.tx = q.x; p.ty = q.y; p.face = q.f; p.moving = !!q.mv; p.dashT = q.dt ? 0.05 : 0; if (dist(p, { x: q.x, y: q.y }) > 300) { p.x = q.x; p.y = q.y; } }
  }
  s.O.forEach((o, i) => { const w = world.pois[i]; if (w) { w.used = !!o[0]; w.uses = o[1]; w.unseal = num(o[2]); } });
  const old = new Map(enemies.map(e => [e.id, e]));
  enemies = s.E.map(a => {
    const e = old.get(a[0]) || { id: a[0], x: a[2], y: a[3], ph: (a[0] * 1.7) % TAU, flash: 0, near: true };
    e.type = ETN[a[1]]; e.tx = a[2]; e.ty = a[3]; e.r = a[4]; e.hp = a[5]; e.maxHp = 1; e.elite = !!a[6]; e.state = STN[a[7]]; e.a = a[8];
    if (a[9]) e.flash = 0.1; e.slowT = a[10]; e.poisT = a[11]; e.dir = a[12]; e.rootT = a[13]; e.tid = a[14]; e.bleedOn = !!a[15]; e.markOn = !!a[16]; return e;
  });
  projs = s.Q.map(a => ({ x: a[0], y: a[1], vx: a[2], vy: a[3], r: a[4], kind: a[5], color: a[6], life: a[7] }));
  zones = s.Z.map(a => ({ x: a[0], y: a[1], r: a[2], kind: a[3], delay: a[4], max: a[5], life: a[6], friendly: !!a[7], lantern: !!a[8], color: a[9], vx: a[10], vy: a[11], x2: a[12], y2: a[13], oid: a[14], coven: !!a[15] }));
  const oldK = new Map(pickups.map(k => [k.id, k]));
  pickups = s.K.map(a => { const k = oldK.get(a[0]) || { id: a[0], x: a[2], y: a[3], t: a[0] % 7 }; k.kind = a[1]; k.tx = a[2]; k.ty = a[3]; return k; });
  for (const e of s.ev) applyEv(e);
  me.talents = s.tal || {}; me.st = s.st || null;
  // chapter talent offer: shown until the player picks; the pick only takes effect once the host accepts it (tl)
  if (s.ct && s.ct.q !== net.ctPicked && Array.isArray(s.ct.ids)) { me.ctChoice = s.ct.ids.filter(id => heroTalent(me.hero, id)); me.ctSeq = s.ct.q; } else me.ctChoice = null;
  if (s.c && s.c.q !== net.pickedSeq) { me.choice = s.c.ids.map(id => TALENTS.find(t => t.id === id)).filter(Boolean); me.choiceSeq = s.c.q; me.choiceTitle = s.c.title; } else me.choice = null;
}
function clientUpdate(dt) {
  game.t += dt; const p = me, inp = localInput(), o = net.out;
  night += ((game.wasNight ? 1 : 0) - night) * Math.min(1, dt * 1.3);
  p.tAtk -= dt; p.tSkill -= dt; p.tUlt -= dt; p.dashLock -= dt; p.swing = Math.max(0, p.swing - dt * 6);
  if (!p.down && !game.over) {
    p.aim = inp.aim; p.face = angTo(p, inp.aim); p.moving = !!(inp.mx || inp.my);
    if (!p.flurry) {
      if (inp.dash && p.dashes > 0 && p.dashT <= 0 && !(HEROES[p.hero].alt && slotBlock(p, 2))) { p.dashes--; p.dashLock = 0.4; const a = dashDir(p, inp); startDashMove(p, a); o.d = r2(a); }
      if (p.dashT > 0) { p.dashT -= dt; p.x += Math.cos(p.dashA) * 920 * dt; p.y += Math.sin(p.dashA) * 920 * dt; trail(p); } else walk(p, inp, dt);
      bossLocalMove(p, dt); collideWorld(p, p.r);
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
    else if (z.kind !== 'blast') { z.life -= dt; z.x += (z.vx || 0) * dt; z.y += (z.vy || 0) * dt; }
  }
  for (const q of pickups) { q.x += (q.tx - q.x) * k; q.y += (q.ty - q.y) * k; q.t += dt; }
  updHazards(dt, false); // keep warnings and moving hazards smooth between snapshots
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
    c.textAlign = 'center'; c.font = 'bold 12px Georgia'; c.fillStyle = '#ff8a8a'; c.fillText(T(p === me ? 'DOWN — an ally must reach you' : 'DOWN — stand close to revive'), p.x, p.y + 50);
    if (p !== me) { // pulsing beacon so a fallen teammate stands out in a fight
      const k = 0.5 + 0.5 * Math.sin(game.t * 6), y0 = p.y - 58 - k * 6;
      const g = c.createRadialGradient(p.x, p.y, 10, p.x, p.y, 70); g.addColorStop(0, 'rgba(255,60,60,' + (0.18 + 0.14 * k) + ')'); g.addColorStop(1, 'rgba(255,60,60,0)'); c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, 70, 0, TAU); c.fill();
      c.fillStyle = '#ff5a5a'; c.beginPath(); c.moveTo(p.x - 11, y0 - 14); c.lineTo(p.x + 11, y0 - 14); c.lineTo(p.x, y0); c.closePath(); c.fill();
      c.font = 'bold 13px Georgia'; c.fillStyle = '#ffd0d0'; c.fillText(p.name, p.x, y0 - 20);
    }
  } else {
    const big = p.ultT > 0 && (p.hero === 'bramble' || p.hero === 'rowan');
    if (big) { c.globalAlpha = 0.25 + Math.sin(game.t * 8) * 0.1; circ(c, p.x, p.y, p.hero === 'rowan' ? 40 : 34, HEROES[p.hero].color); c.globalAlpha = 1; }
    if (p.ultT > 0 && p.hero === 'mira') for (const s of mirrorSpots(p)) { c.globalAlpha = 0.4 + Math.sin(game.t * 9 + s.x) * 0.1; drawHero(c, 'mira', s.x, s.y, p.face, p.walk, { moving: p.moving, swing: p.swing, ghost: true }); c.globalAlpha = 1; }
    if (p.iT > 0 && Math.floor(game.t * 20) % 2 === 0 && p.dashT <= 0) c.globalAlpha = 0.45;
    drawHero(c, p.hero, p.x, p.y, p.face, p.walk, { moving: p.moving, swing: p.swing, scale: big ? (p.hero === 'rowan' ? 1.4 : 1.25) : 1, sentinel: big && p.hero === 'rowan' }); c.globalAlpha = 1;
    if (p.shield > 0) { c.globalAlpha = 0.35 + Math.sin(game.t * 6) * 0.1; c.strokeStyle = '#86f0cf'; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y - 4, 28, 0, TAU); c.stroke(); c.globalAlpha = 0.1; circ(c, p.x, p.y - 4, 28, '#86f0cf'); c.globalAlpha = 1; }
  }
  if (p !== me) {
    c.textAlign = 'center'; c.font = '12px Georgia'; c.fillStyle = 'rgba(0,0,0,.7)'; c.fillText(p.name, p.x + 1, p.y - 43); c.fillStyle = HEROES[p.hero].color; c.fillText(p.name, p.x, p.y - 44);
    if (!p.down) { c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(p.x - 18, p.y - 39, 36, 4); c.fillStyle = '#6fdc7a'; c.fillRect(p.x - 18, p.y - 39, 36 * clamp(p.hp / p.maxHp, 0, 1), 4); }
  }
}
function drawZone(c, z) {
  const a = clamp(z.life / 0.5, 0, 1), t = game.t;
  if (z.kind === 'shelter') {
    // Shelterwood: a ring of saplings around a mossy floor.
    c.globalAlpha = 0.18 * a; circ(c, z.x, z.y, z.r, z.color); c.globalAlpha = 0.6 * a; c.strokeStyle = z.color; c.lineWidth = 2; c.setLineDash([10, 8]); c.beginPath(); c.arc(z.x, z.y, z.r, t * 0.2, t * 0.2 + TAU); c.stroke(); c.setLineDash([]);
    for (let i = 0; i < 8; i++) { const q = i * TAU / 8, x = z.x + Math.cos(q) * z.r * 0.92, y = z.y + Math.sin(q) * z.r * 0.92; c.fillStyle = '#5d4023'; c.fillRect(x - 2, y - 12, 4, 12); ell(c, x, y - 15, 8, 6, i % 2 ? '#a9c46c' : '#7da353'); }
    c.globalAlpha = 1;
  } else if (z.kind === 'decoy') {
    c.globalAlpha = 0.55 * a; drawHero(c, 'mira', z.x, z.y, -0.5, t, { ghost: true }); c.globalAlpha = 0.5 * a;
    c.strokeStyle = '#e8fbff'; c.lineWidth = 1; c.beginPath(); c.moveTo(z.x - 10, z.y - 22); c.lineTo(z.x - 2, z.y - 8); c.lineTo(z.x + 7, z.y - 14); c.moveTo(z.x - 2, z.y - 8); c.lineTo(z.x + 1, z.y + 6); c.stroke(); c.globalAlpha = 1;
  } else {
    // Midnight Procession: a slow ring of lantern spirits.
    c.globalAlpha = 0.14 * a; circ(c, z.x, z.y, z.r, z.color);
    for (let i = 0; i < 7; i++) {
      const q = t * 2.2 + i * TAU / 7, x = z.x + Math.cos(q) * z.r * 0.7, y = z.y + Math.sin(q) * z.r * 0.5 - 8;
      c.globalAlpha = 0.85 * a; const g = c.createRadialGradient(x, y, 1, x, y, 13); g.addColorStop(0, 'rgba(220,255,245,.95)'); g.addColorStop(1, 'rgba(134,240,207,0)'); c.fillStyle = g; c.beginPath(); c.arc(x, y, 13, 0, TAU); c.fill();
      c.fillStyle = '#eafff8'; c.beginPath(); c.moveTo(x - 4, y + 3); c.quadraticCurveTo(x, y - 12, x + 4, y + 3); c.fill();
    }
    c.globalAlpha = 1;
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
    if (TALENT_ZONES.has(z.kind)) drawTalentZone(c, z);
    else if (z.kind === 'shelter' || z.kind === 'decoy' || z.kind === 'proc') drawZone(c, z);
    else if (z.kind === 'burn') { const a = Math.min(1, z.life / 0.5); c.globalAlpha = 0.28 * a; circ(c, z.x, z.y, z.r, z.color); c.globalAlpha = 0.7 * a; c.strokeStyle = z.color; c.lineWidth = 2; c.beginPath(); c.arc(z.x, z.y, z.r, 0, TAU); c.stroke(); c.globalAlpha = 1; if (z.lantern) { circ(c, z.x, z.y - 8, 7, '#fff1c2'); c.fillStyle = '#4a3a2a'; c.fillRect(z.x - 6, z.y - 18, 12, 3); c.fillRect(z.x - 6, z.y - 1, 12, 3); } }
    else { const k = 1 - clamp(z.delay / z.max, 0, 1), col = z.friendly ? '255,140,60' : '220,60,255'; c.fillStyle = 'rgba(' + col + ',.16)'; c.beginPath(); c.arc(z.x, z.y, z.r, 0, TAU); c.fill(); c.fillStyle = 'rgba(' + col + ',.35)'; c.beginPath(); c.arc(z.x, z.y, z.r * k, 0, TAU); c.fill(); c.strokeStyle = 'rgba(' + col + ',.9)'; c.lineWidth = 2; c.beginPath(); c.arc(z.x, z.y, z.r, 0, TAU); c.stroke(); }
  }
  drawThreads(c); // Lantern Coven
  drawArena(c); drawHazards(c); // boss arena outline, warnings and active hazards
  for (const k of pickups) if (inView(k)) drawPickup(k);
  const list = [];
  for (const o of world.pois) if (inView(o, 120)) list.push([o.y, 0, o]);
  for (const o of world.obs) if (inView(o, 120)) list.push([o.y, 1, o]);
  for (const e of enemies) if (inView(e, 120)) list.push([e.y, 2, e]);
  for (const q of players) if (inView(q, 120)) list.push([q.y, 3, q]);
  list.sort((a, b) => a[0] - b[0]);
  for (const [, k, o] of list) { if (k === 0) drawPoi(o); else if (k === 1) drawObs(o); else if (k === 2) drawEnemy(o); else drawPlayer(o); }
  // Soul Tethers: a chain of spectral light through each linked group.
  const groups = {}; for (const e of enemies) if (e.tid && !e.dead) (groups[e.tid] = groups[e.tid] || []).push(e);
  c.strokeStyle = '#86f0cf'; c.lineWidth = 2; c.globalAlpha = 0.55 + Math.sin(game.t * 7) * 0.2;
  for (const id in groups) { const g = groups[id]; if (g.length < 2) continue; c.beginPath(); c.moveTo(g[0].x, g[0].y); for (let i = 1; i < g.length; i++) c.lineTo(g[i].x, g[i].y); c.stroke(); }
  c.globalAlpha = 1;
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
  const np = !p.down && nearPoi(p), pr = np && !(np.kind === 'altar' && np.unseal > 0) && T(poiPrompt(np)); // while unsealing, the countdown replaces the hint
  if (pr) { c.font = '15px Georgia'; const w = c.measureText(pr).width + 50; c.fillStyle = 'rgba(10,10,20,.8)'; rr(c, np.x - w / 2, np.y - 78, w, 26, 6); c.fill(); c.fillStyle = '#f3d48a'; c.fillText((touch.on || np.kind === 'altar' ? '' : '[F]  ') + pr, np.x, np.y - 60); }
  c.restore();
  drawHUD();
}
// Fallen teammates who are off screen: a marker on the screen edge pointing at them, with name, distance and
// revive progress. (On screen they get a beacon in drawPlayer instead.)
// Edge positions (screen pixels) for fallen teammates who are off screen.
function downMarkers() {
  const out = [], m = 46, L = SA.l + m, R = innerWidth - SA.r - m, Tp = SA.t + m, B = innerHeight - SA.b - m, cx = innerWidth / 2, cy = innerHeight / 2;
  if (!me) return out;
  const avoid = touch.on ? touchButtons() : [], hs = hudScale(), mini = { x: innerWidth - SA.r - ((touch.on ? 112 : 160) + 22) * hs, y: SA.t + ((touch.on ? 112 : 160) + 26) * hs };
  for (const q of players) {
    if (q === me || !q.down) continue;
    const sx = (q.x - cam.x) * zoom, sy = (q.y - cam.y) * zoom;
    if (sx > 0 && sx < innerWidth && sy > 0 && sy < innerHeight) continue; // visible: beacon drawn in the world
    // where the line from the screen centre to them crosses the inset edge
    const dx = sx - cx, dy = sy - cy, s = Math.min(dx ? Math.abs(((dx > 0 ? R : L) - cx) / dx) : 1e9, dy ? Math.abs(((dy > 0 ? B : Tp) - cy) / dy) : 1e9);
    let x = cx + dx * s, y = cy + dy * s;
    // slide along the edge to the nearest spot clear of touch buttons, the minimap and other markers
    const clear = (x, y) => avoid.every(b => Math.hypot(x - b.x, y - b.y) > b.r + 30) && !(x > mini.x - 26 && y < mini.y + 26) && out.every(o => Math.hypot(o.x - x, o.y - y) > 60);
    if (!clear(x, y)) {
      const side = x <= L + 1 || x >= R - 1;
      search: for (let i = 1; i < 60; i++) for (const sg of [-1, 1]) {
        const nx = side ? x : clamp(x + sg * i * 8, L, R), ny = side ? clamp(y + sg * i * 8, Tp, B) : y;
        if (clear(nx, ny)) { x = nx; y = ny; break search; }
      }
    }
    out.push({ q, x, y, a: Math.atan2(sy - y, sx - x), below: y > cy });
  }
  return out;
}
function drawDownMarkers() {
  const c = ctx, cy = innerHeight / 2;
  for (const { q, x, y, a } of downMarkers()) {
    const k = 0.5 + 0.5 * Math.sin(game.t * 6), r = 20 + 3 * k;
    c.save(); c.translate(x, y);
    c.fillStyle = 'rgba(8,8,16,.75)'; c.beginPath(); c.arc(0, 0, r + 5, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,59,59,' + (0.75 + 0.25 * k) + ')'; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fill();
    if (q.rev > 0) { c.strokeStyle = '#8dff8a'; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, r + 4, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(q.rev / 3, 0, 1)); c.stroke(); }
    c.save(); c.rotate(a); c.fillStyle = '#ff3b3b'; c.beginPath(); c.moveTo(r + 16, 0); c.lineTo(r + 5, -8); c.lineTo(r + 5, 8); c.closePath(); c.fill(); c.restore();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 20px Georgia'; c.fillText('!', 0, 1);
    c.textBaseline = 'alphabetic'; c.font = 'bold 12px Georgia'; const lab = q.name + ' · ' + Math.round(dist(q, me) / 32) + ' m', ty = y > cy ? -r - 10 : r + 18;
    c.fillStyle = 'rgba(0,0,0,.7)'; c.fillText(lab, 1, ty + 1); c.fillStyle = '#ffd0d0'; c.fillText(lab, 0, ty);
    c.restore();
  }
}
function drawStatsPanel(c, W, TU) {
  const rows = statRows(myStats()); if (!rows.length) return;
  const H2 = HEROES[me.hero], cols = 2, per = Math.ceil(rows.length / cols), lh = 17, pw = Math.min(440, W - 40), colW = pw / cols;
  const x0 = W / 2 - pw / 2, y0 = game.boss ? (TU && W < 700 ? 182 : 134) : 92, ph = per * lh + 30;
  c.fillStyle = 'rgba(8,8,16,.82)'; rr(c, x0, y0, pw, ph, 8); c.fill(); c.strokeStyle = 'rgba(243,212,138,.35)'; c.lineWidth = 1; rr(c, x0, y0, pw, ph, 8); c.stroke();
  c.textAlign = 'left'; c.font = 'bold 12px Georgia'; c.fillStyle = H2.color;
  c.fillText(T(H2.name) + ' · ' + T('Hero stats') + (me.weapon ? ' · ' + T(WEAPONS[me.weapon].name) : ''), x0 + 10, y0 + 16);
  c.font = '12px Georgia';
  rows.forEach(([k, v], i) => { const cx = x0 + 10 + Math.floor(i / per) * colW, cy = y0 + 34 + (i % per) * lh;
    c.textAlign = 'left'; c.fillStyle = '#b9b3d4'; c.fillText(T(k), cx, cy); c.textAlign = 'right'; c.fillStyle = '#fff'; c.fillText(v, cx + colW - 20, cy); });
  c.textAlign = 'left';
}
function drawHUD() {
  const c = ctx, p = me, H2 = HEROES[p.hero], TU = touch.on;
  // On phones the HUD is scaled down, the health panel moves to the top-left and the key hints give way to touch buttons.
  const hs = hudScale(), W = (innerWidth - SA.l - SA.r) / hs, H = (innerHeight - SA.t - SA.b) / hs;
  c.save(); c.translate(SA.l, SA.t); c.scale(hs, hs);
  c.textAlign = 'left'; c.textBaseline = 'alphabetic';
  const bx = 24, by = TU ? (W < 760 ? 132 : 88) : H - 74, bw = TU ? 220 : 300;
  c.fillStyle = 'rgba(8,8,16,.75)'; rr(c, bx - 8, by - 30, bw + 16, 88, 8); c.fill();
  c.font = '15px Georgia'; c.fillStyle = H2.color; c.fillText((Voice.transmitting() ? '🎙 ' : '') + T(H2.name) + ' · ' + L('Lv ', '等級 ') + p.level, bx, by - 10);
  c.textAlign = 'right'; c.fillStyle = '#f3c84a'; c.fillText('◈ ' + p.gold + '   ✦ ' + p.embers, bx + bw, by - 10); c.textAlign = 'left';
  c.fillStyle = '#2a1c22'; rr(c, bx, by, bw, 20, 4); c.fill(); c.fillStyle = '#d64545'; rr(c, bx, by, Math.max(6, bw * clamp(p.hp / p.maxHp, 0, 1)), 20, 4); c.fill();
  c.fillStyle = '#fff'; c.font = '13px Georgia'; c.textAlign = 'center'; c.fillText(Math.ceil(p.hp) + ' / ' + p.maxHp, bx + bw / 2, by + 15);
  c.fillStyle = '#1c2430'; rr(c, bx, by + 28, bw, 9, 3); c.fill(); c.fillStyle = '#7fe0ff'; rr(c, bx, by + 28, Math.max(4, bw * clamp(p.xp / xpNeed(p.level), 0, 1)), 9, 3); c.fill();
  // Hero resources, under the experience bar.
  c.textAlign = 'left'; c.font = '12px Georgia';
  if (p.hero === 'rowan') { c.fillStyle = '#d8c08a'; c.fillText(T('Deep Roots') + ' ' + '●'.repeat(p.roots) + '○'.repeat(Math.max(0, ROOTS_MAX - p.roots)), bx, by + 52); }
  else if (p.hero === 'vespera') { c.fillStyle = '#86f0cf'; c.fillText(T('Lantern'), bx, by + 52); c.fillStyle = '#16302a'; rr(c, bx + 52, by + 44, bw - 52, 8, 3); c.fill(); c.fillStyle = '#86f0cf'; rr(c, bx + 52, by + 44, Math.max(4, (bw - 52) * clamp(p.lan / p.lanMax, 0, 1)), 8, 3); c.fill(); }
  else if (p.hero === 'mira') { c.fillStyle = p.decoyOn ? '#bff6ff' : '#6d7f86'; c.fillText(T(p.decoyOn ? 'Decoy standing' : 'No decoy — dash to leave one'), bx, by + 52); }
  if (p.shield + (p.barrier || 0) > 0) { c.fillStyle = '#86f0cf'; c.textAlign = 'right'; c.fillText(T('Shield') + ' ' + Math.ceil(p.shield + (p.barrier || 0)), bx + bw, by + 52); c.textAlign = 'left'; }
  const b1 = slotBlock(p, 1), b2 = H2.alt ? slotBlock(p, 2) : null;
  const cd = p.cds, ab = [[T('LMB'), T(H2.names[0]), p.tAtk, cd[0], true], [T('RMB'), T(H2.names[1]), p.tSkill, cd[1], !b1, b1 && T(b1)], [T('SPACE'), T(H2.names[2]) + (p.dashMax > 1 ? ' ×' + p.dashes : ''), p.dashes > 0 ? 0 : p.dashRe, cd[2], !b2, b2 && T(b2)], ['Q', T(H2.names[3]), p.tUlt, cd[3], p.level >= 3, T('Lv 3')]];
  const s = 58, gap = 12, ax = W / 2 - (s * 4 + gap * 3) / 2, ay = H - s - 30;
  if (!TU) ab.forEach((a, i) => {
    const x = ax + i * (s + gap); c.fillStyle = 'rgba(8,8,16,.8)'; rr(c, x, ay, s, s, 8); c.fill();
    const ready = a[2] <= 0 && a[4]; c.strokeStyle = ready ? H2.color : '#4a4370'; c.lineWidth = 2; rr(c, x, ay, s, s, 8); c.stroke();
    if (a[2] > 0 && a[3] > 0.5) { c.fillStyle = 'rgba(120,110,170,.45)'; c.beginPath(); c.moveTo(x + s / 2, ay + s / 2); c.arc(x + s / 2, ay + s / 2, s * 0.42, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(a[2] / a[3], 0, 1)); c.fill(); }
    const lab = a[4] ? a[0] : a[5]; c.textAlign = 'center'; c.font = 'bold ' + (lab.length > 5 ? 10 : 14) + 'px Georgia'; c.fillStyle = a[4] ? (ready ? '#fff' : '#8a84a8') : '#55506e'; c.fillText(lab, x + s / 2, ay + s / 2 + 1);
    if (a[2] > 0.5 && a[3] > 0.5) { c.font = '12px Georgia'; c.fillStyle = '#f3d48a'; c.fillText(a[2].toFixed(0), x + s / 2, ay + s / 2 + 17); }
    c.font = '11px Georgia'; c.fillStyle = '#b9b3d4'; c.fillText(a[1], x + s / 2, ay + s + 14);
  });
  hudAuto = null;
  if (!TU) {
    const x = ax + 4 * (s + gap); c.fillStyle = autoAtk ? 'rgba(60,48,20,.85)' : 'rgba(8,8,16,.8)'; rr(c, x, ay, s, s, 8); c.fill();
    c.strokeStyle = autoAtk ? '#f3d48a' : '#4a4370'; c.lineWidth = 2; rr(c, x, ay, s, s, 8); c.stroke();
    c.textAlign = 'center'; c.font = 'bold 13px Georgia'; c.fillStyle = autoAtk ? '#f3d48a' : '#8a84a8'; c.fillText(T('AUTO'), x + s / 2, ay + s / 2 - 2);
    c.font = '11px Georgia'; c.fillText(autoAtk ? T('on') + ' · R' : T('off') + ' · R', x + s / 2, ay + s / 2 + 14);
    c.fillStyle = '#b9b3d4'; c.fillText(T('Auto attack'), x + s / 2, ay + s + 14);
    hudAuto = { x: SA.l + x * hs, y: SA.t + ay * hs, w: s * hs, h: s * hs };
    const x2 = x + s + gap; c.fillStyle = showStats ? 'rgba(60,48,20,.85)' : 'rgba(8,8,16,.8)'; rr(c, x2, ay, s, s, 8); c.fill();
    c.strokeStyle = showStats ? '#f3d48a' : '#4a4370'; c.lineWidth = 2; rr(c, x2, ay, s, s, 8); c.stroke();
    c.font = '20px Georgia'; c.fillStyle = '#fff'; c.fillText('📊', x2 + s / 2, ay + s / 2 + 2); c.font = '11px Georgia'; c.fillStyle = showStats ? '#f3d48a' : '#8a84a8'; c.fillText('C', x2 + s / 2, ay + s / 2 + 18);
    c.fillStyle = '#b9b3d4'; c.fillText(T('Stats'), x2 + s / 2, ay + s + 14);
    hudStats = { x: SA.l + x2 * hs, y: SA.t + ay * hs, w: s * hs, h: s * hs };
  } else hudStats = null;
  if (showStats) drawStatsPanel(c, W, TU);
  const cw = Math.min(460, W - 380), cx = W / 2 - cw / 2, cy = 22;
  c.fillStyle = 'rgba(8,8,16,.75)'; rr(c, cx - 12, cy - 12, cw + 24, 58, 8); c.fill();
  for (let i = 0; i < DAYS; i++) { const x0 = cx + cw * (i * CYCLE) / TOTAL, wd = cw * DAY / TOTAL, wn = cw * NIGHT / TOTAL; c.fillStyle = '#e0b75a'; c.fillRect(x0, cy, wd - 1, 8); c.fillStyle = '#4a4aa8'; c.fillRect(x0 + wd, cy, wn - 1, 8); }
  const mxp = cx + cw * clamp(game.time / TOTAL, 0, 1); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(mxp, cy + 10); c.lineTo(mxp - 6, cy + 19); c.lineTo(mxp + 6, cy + 19); c.fill(); c.fillRect(mxp - 1, cy - 3, 2, 14);
  c.textAlign = 'center'; c.font = '14px Georgia';
  const ct = game.time % CYCLE, isN = ct >= DAY;
  if (game.boss) { c.fillStyle = '#ff8ae0'; c.fillText(L(bossCfg(game.chapter).name + ' hunts you', T(bossCfg(game.chapter).name) + '正在獵殺你'), W / 2, cy + 36); }
  else { c.fillStyle = isN ? '#b6b6ff' : '#f3d48a'; c.fillText(LANG === 'zh' ? '第 ' + (dayIdx() + 1) + (isN ? ' 夜 · ' + fmtTime(CYCLE - ct) + ' 後黎明' : ' 天 · ' + fmtTime(DAY - ct) + ' 後入夜') + '   —   ' + T(bossCfg(game.chapter).name) + '將於 ' + fmtTime(TOTAL - game.time) + ' 後甦醒'
    : (isN ? 'Night ' : 'Day ') + (dayIdx() + 1) + ' · ' + (isN ? 'dawn in ' + fmtTime(CYCLE - ct) : 'dusk in ' + fmtTime(DAY - ct)) + '   —   ' + bossCfg(game.chapter).name + ' wakes in ' + fmtTime(TOTAL - game.time), W / 2, cy + 36); }
  c.textAlign = 'left'; c.font = '13px Georgia'; c.fillStyle = '#a9a3c4'; c.fillText(T('Chapter ' + game.chapter) + '/' + CHAPTERS + ' · ' + T(world.pal.name) + ' · ' + T(DIFF(game.diff).name), 20, 28); c.fillText(L('Slain: ', '擊殺：') + p.kills, 20, 46);
  // party
  let py = TU ? (W < 760 ? 220 : 176) : 70;
  for (const q of players) {
    if (q === p) continue;
    c.fillStyle = 'rgba(8,8,16,.7)'; rr(c, 14, py - 14, 190, 34, 6); c.fill();
    c.font = '13px Georgia'; c.fillStyle = HEROES[q.hero].color; c.fillText(q.name + ' · ' + L('Lv ', '等級 ') + q.level + (Voice.level(q.id) > 0.02 ? '  🔊' : ''), 22, py);
    c.fillStyle = '#2a1c22'; c.fillRect(22, py + 6, 174, 7); c.fillStyle = q.down ? '#777' : '#d64545'; c.fillRect(22, py + 6, 174 * (q.down ? clamp(q.rev / 3, 0, 1) : clamp(q.hp / q.maxHp, 0, 1)), 7);
    if (q.down) { c.fillStyle = '#ff8a8a'; c.textAlign = 'right'; c.fillText(T('DOWN'), 196, py); c.textAlign = 'left'; }
    py += 42;
  }
  if (game.boss) {
    const e = game.boss, C = bossCfg(game.chapter), w = Math.max(150, Math.min(620, W - (TU ? 560 : 80))), x = W / 2 - w / 2, y = TU && W < 700 ? 140 : 92, f = clamp(e.hp / e.maxHp, 0, 1);
    c.fillStyle = 'rgba(8,8,16,.8)'; rr(c, x - 4, y - 18, w + 8, 36, 5); c.fill();
    c.fillStyle = e.phase === 2 ? '#ff5ad6' : C.color; rr(c, x, y, Math.max(6, w * f), 14, 4); c.fill();
    c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(x + w * BOSS_PHASE2 - 1, y - 2, 2, 18); // phase 2 threshold
    if (e.armor > 0) { c.fillStyle = 'rgba(200,220,255,.35)'; rr(c, x, y, Math.max(6, w * f), 5, 2); c.fill(); }
    c.font = 'bold 12px Georgia'; c.textAlign = 'left'; c.fillStyle = '#f3d48a'; c.fillText(T(C.name) + ' · ' + T(C.title), x, y - 5);
    c.textAlign = 'right'; c.fillStyle = e.vuln ? '#ffe07a' : '#d8d2ee';
    c.fillText((e.vuln ? T('VULNERABLE') + ' · ' : e.armor > 0 ? T('Armor') + ' ' + Math.round(e.armor * 100) + '% · ' : '') + T('Phase') + ' ' + (e.phase || 1) + '/2', x + w, y - 5); c.textAlign = 'left';
    // arena-wide warnings always show on screen, under the health bar
    const ts = hazards.find(h => h.k === 'tsunami' && h.tel > 0);
    if (ts) { const k = 0.5 + 0.5 * Math.sin(game.t * 10); c.textAlign = 'center'; c.font = 'bold 20px Georgia'; c.fillStyle = 'rgba(0,0,0,.65)'; c.fillText(T('Reach a raised platform!') + ' ' + ts.tel.toFixed(1), W / 2 + 1, y + 41); c.fillStyle = 'rgba(' + (180 + 60 * k | 0) + ',240,255,1)'; c.fillText(T('Reach a raised platform!') + ' ' + ts.tel.toFixed(1), W / 2, y + 40); c.textAlign = 'left'; }
  }
  const ms = TU ? 112 : 160, mx = W - ms - 18, my = 18, k = ms / world.S;
  c.fillStyle = 'rgba(8,8,16,.75)'; rr(c, mx - 4, my - 4, ms + 8, ms + 8, 6); c.fill(); c.fillStyle = world.pal.base; c.globalAlpha = 0.6; c.fillRect(mx, my, ms, ms); c.globalAlpha = 1;
  const colr = { altar: '#c27bff', spring: '#4fb6e8', chest: '#f3c84a', shrine: '#e8e2d0', merchant: '#ff8a8a', camp: '#ff8a3a' };
  for (const o of world.pois) { if (!o.seen) continue; c.globalAlpha = o.used && o.kind !== 'altar' ? 0.3 : 1; c.fillStyle = colr[o.kind]; c.fillRect(mx + o.x * k - 3, my + o.y * k - 3, 6, 6); } c.globalAlpha = 1;
  for (const e of enemies) if (e.elite && e.near) { c.fillStyle = '#ff5a5a'; c.fillRect(mx + e.x * k - 2, my + e.y * k - 2, 4, 4); }
  if (game.boss) circ(c, mx + game.boss.x * k, my + game.boss.y * k, 5, '#ff5ad6');
  for (const q of players) if (q !== p) { if (q.down) { const bl = Math.sin(game.t * 8) > -0.3; circ(c, mx + q.x * k, my + q.y * k, bl ? 6 : 4, '#ff3b3b'); if (bl) { c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.beginPath(); c.arc(mx + q.x * k, my + q.y * k, 6, 0, TAU); c.stroke(); } } else circ(c, mx + q.x * k, my + q.y * k, 3.5, HEROES[q.hero].color); }
  circ(c, mx + p.x * k, my + p.y * k, 3.5, '#fff');
  if (!TU && p.ct && p.ct.length) {
    const names = p.ct.map(id => T((heroTalent(p.hero, id) || { name: id }).name)), bh = 22 + names.length * 16, by0 = my + ms + 32;
    c.fillStyle = 'rgba(8,8,16,.75)'; rr(c, mx - 4, by0, ms + 8, bh, 6); c.fill(); c.textAlign = 'left'; c.font = '12px Georgia'; c.fillStyle = '#f3d48a'; c.fillText(L('Talents', '天賦'), mx + 4, by0 + 15);
    c.fillStyle = HEROES[p.hero].color; names.forEach((nm, i) => c.fillText('• ' + nm, mx + 4, by0 + 31 + i * 16));
  }
  c.font = '11px Georgia'; c.fillStyle = '#8e88ab'; c.textAlign = 'right'; c.fillText(TU ? (net.mode === 'solo' ? '' : L('Room ', '房間 ') + net.code) : L('F interact · ', 'F 互動 · ') + (net.mode === 'solo' ? L('P pause · ', 'P 暫停 · ') : L('Room ', '房間 ') + net.code + ' · ') + L('M mute', 'M 靜音'), W - 18, my + ms + 22);
  if (game.banner) { const b = game.banner, a = clamp(Math.min(b.t, b.max - b.t) / 0.4, 0, 1); c.globalAlpha = a; c.textAlign = 'center'; c.font = 'bold ' + Math.round(Math.min(44, W / 13)) + 'px Georgia'; c.fillStyle = 'rgba(0,0,0,.6)'; const bt = T(b.text), bs = T(b.sub); c.fillText(bt, W / 2 + 2, H * 0.27 + 2); c.fillStyle = '#f3d48a'; c.fillText(bt, W / 2, H * 0.27); c.font = 'italic 18px Georgia'; c.fillStyle = '#d8d2ee'; c.fillText(bs, W / 2, H * 0.27 + 30); c.globalAlpha = 1; }
  if (!p.down && p.hp < p.maxHp * 0.3) { const g = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.8); g.addColorStop(0, 'rgba(160,0,0,0)'); g.addColorStop(1, 'rgba(160,0,0,' + (0.3 + Math.sin(game.t * 5) * 0.1) + ')'); c.fillStyle = g; c.fillRect(0, 0, W, H); }
  c.restore();
  drawDownMarkers();
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
  const np = !p.down && nearPoi(p), use = !!(np && np.kind !== 'altar' && poiPrompt(np));
  const b1 = slotBlock(p, 1), alt = HEROES[p.hero].alt, b2 = alt ? slotBlock(p, 2) : null;
  const info = { skill: [b1 || 'SKILL', p.tSkill, p.cds[1], !b1], dash: [b2 || (alt ? 'SKILL 2' : 'DASH') + (p.dashMax > 1 ? ' ' + p.dashes : ''), p.dashes > 0 ? 0 : p.dashRe, p.cds[2], !b2], ult: [p.level >= 3 ? 'ULT' : 'Lv 3', p.tUlt, p.cds[3], p.level >= 3], f: ['USE', 0, 0, use],
    menu: [net.mode === 'solo' ? 'II' : '🎙', 0, 0, true], fs: ['⛶', 0, 0, true], auto: [autoAtk ? 'AUTO ✓' : 'AUTO', 0, 0, autoAtk], stats: ['📊', 0, 0, true], talk: [Voice.transmitting() ? '● ' + T('TALK') : T('TALK'), 0, 0, true] };
  c.textAlign = 'center'; c.textBaseline = 'middle';
  const warnUp = hazards.some(h => h.tel > 0);
  for (const b of touchButtons()) {
    const [label, t, cd, on] = info[b.id], ready = on && t <= 0;
    c.globalAlpha = (on ? 0.9 : 0.35) * (warnUp ? 0.55 : 1); circ(c, b.x, b.y, b.r, 'rgba(8,8,16,.62)');
    if (t > 0 && cd > 0.5) { c.fillStyle = 'rgba(120,110,170,.5)'; c.beginPath(); c.moveTo(b.x, b.y); c.arc(b.x, b.y, b.r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(t / cd, 0, 1)); c.fill(); }
    if (b.id === 'auto') c.globalAlpha = autoAtk ? 0.95 : 0.6;
    c.strokeStyle = ready ? (b.id === 'f' || b.id === 'auto' ? '#f3d48a' : col) : '#4a4370'; c.lineWidth = 2.5; c.beginPath(); c.arc(b.x, b.y, b.r, 0, TAU); c.stroke();
    c.font = 'bold ' + Math.round(11 * u) + 'px Georgia'; c.fillStyle = ready ? '#fff' : '#8a84a8'; c.fillText(t > 0.5 && cd > 0.5 ? Math.ceil(t) : T(label), b.x, b.y);
  }
  c.globalAlpha = 1; c.textBaseline = 'alphabetic';
}

// ---------- screens ----------
const controlsHtml = () => touch.on
  ? L('<div class="controls"><b>Left thumb</b> move · <b>Right thumb</b> drag to aim and attack, or hold to auto-target · <b>Buttons</b> skill, dash (Rowan, Vespera: second skill), ultimate (Lv 3), use, <b>AUTO</b> automatic attacks, <b>📊</b> stats, <b>II</b> pause',
      '<div class="controls"><b>左手拇指</b> 移動 · <b>右手拇指</b> 拖曳瞄準並攻擊，或按住自動鎖定 · <b>按鈕</b> 技能、衝刺（羅文、薇斯佩拉：第二技能）、絕招（3 級）、使用、<b>自動</b> 自動攻擊、<b>📊</b> 屬性、<b>II</b> 暫停') +
    '</div>'
  : L('<div class="controls"><b>WASD</b> move · <b>Mouse</b> aim · <b>LMB</b> attack · <b>RMB</b>/<b>E</b> skill · <b>Space</b> dash (Rowan, Vespera: second skill) · <b>Q</b> ultimate (Lv 3) · <b>F</b> interact · <b>R</b> auto attack · <b>C</b> stats · <b>1</b>-<b>3</b> pick boon · <b>M</b> mute</div>',
      '<div class="controls"><b>WASD</b> 移動 · <b>滑鼠</b> 瞄準 · <b>左鍵</b> 攻擊 · <b>右鍵</b>/<b>E</b> 技能 · <b>空白鍵</b> 衝刺（羅文、薇斯佩拉：第二技能） · <b>Q</b> 絕招（3 級） · <b>F</b> 互動 · <b>R</b> 自動攻擊 · <b>C</b> 屬性 · <b>1</b>-<b>3</b> 選擇祝福 · <b>M</b> 靜音</div>');
// Full screen: Android and iPad browsers can do it for a page; iPhone Safari only does it for video, so there the way
// is to add the game to the Home Screen (manifest.webmanifest makes it open full screen, without browser bars).
const DE = document.documentElement, IPHONE = /iPhone|iPod/.test(navigator.userAgent);
const canFS = () => !IPHONE && !!(DE.requestFullscreen || DE.webkitRequestFullscreen);
const isFS = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
// "Keep full screen": remembered once the player turns it on; any later tap goes back into full screen after a
// notification, rotation or app switch knocked it out. Turned off with "Exit full screen".
let keepFS = (() => { try { return localStorage.getItem('duskbound-fs') === '1'; } catch (e) { return false; } })();
const setKeepFS = v => { keepFS = v; try { localStorage.setItem('duskbound-fs', v ? '1' : '0'); } catch (e) { } };
function goFull(force) {
  if (!canFS() || isFS() || !(force || keepFS || touch.on)) return;
  try { const r = (DE.requestFullscreen || DE.webkitRequestFullscreen).call(DE); if (r && r.then) r.then(lockLandscape, () => { }); else lockLandscape(); } catch (e) { }
}
function lockLandscape() { try { const r = screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape'); if (r && r.catch) r.catch(() => { }); } catch (e) { } }
function exitFull() { setKeepFS(false); try { const f = document.exitFullscreen || document.webkitExitFullscreen; if (f && isFS()) { const r = f.call(document); if (r && r.catch) r.catch(() => { }); } } catch (e) { } }
// taps re-enter full screen when it's kept on (touchend/click count as the user gesture browsers require)
for (const ev of ['touchend', 'click']) document.addEventListener(ev, () => { if (keepFS && !isFS() && canFS()) goFull(true); }, { passive: true });
document.addEventListener('fullscreenchange', () => { resize(); if (overlay.className !== 'hidden') document.querySelectorAll('.fsrow,.fsbtn').forEach(b => b.textContent = fsLabel()); });
// Where the game can't go full screen by itself (the claude.ai page, an already installed app) there is no button.
const fsAvailable = () => !STANDALONE && !window.DUSK_NO_NET;
const fsLabel = () => '⛶ ' + (isFS() ? L('Exit full screen', '離開全螢幕') : L('Full screen', '全螢幕'));
const fsButtonHtml = () => fsAvailable() ? '<button id="fsb" class="ghost fsbtn">' + fsLabel() + '</button>' : '';
const fsRowHtml = () => fsAvailable() ? '<button class="ghost fsrow">' + fsLabel() + '</button>' : '';
// back: what to show after the iPhone help screen
function bindFs(back) { document.querySelectorAll('.fsrow,.fsbtn').forEach(b => b.onclick = () => { if (typeof saveName === 'function' && $('nm')) saveName(); onFsButton(back); }); }
// "Install app" screen, opened by the app QR code (?a): on iPhone/iPad the Add to Home Screen steps, on Android
// Chrome's own install prompt when it offers one, otherwise its menu steps. The installed app opens full screen.
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
function showInstall(back0) {
  if (STANDALONE) return back0();
  // readable with the phone upright: the 'turn sideways' prompt waits until they choose
  document.body.classList.add('installing'); const back = () => { document.body.classList.remove('installing'); back0(); };
  const ios = IOS || /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  let h = '<h2>' + L('Install Duskbound', '安裝 Duskbound') + '</h2><div class="sub">' + L('Free, no App Store needed. It opens full screen from your Home Screen, with its own icon.', '免費，不需要 App Store。從主畫面開啟即為全螢幕，並有專屬圖示。') + '</div>';
  if (ios) h += '<ol class="steps">' + L('<li>Tap <b>Share</b> — in Safari it is in the bottom bar (or under <b>⋯</b>); in Chrome, at the top right.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li><li>Open <b>Duskbound</b> from your Home Screen.</li>',
    '<li>點選<b>分享</b> — Safari 在下方工具列（或在 <b>⋯</b> 裡）；Chrome 在右上角。</li><li>選擇<b>加入主畫面</b>，再點<b>加入</b>。</li><li>從主畫面開啟 <b>Duskbound</b>。</li>') + '</ol>';
  else if (installEvt) h += '<div class="row"><button id="instb">📲 ' + L('Install app', '安裝 App') + '</button></div>';
  else h += '<ol class="steps">' + L('<li>Open the browser menu <b>⋮</b> (top right in Chrome).</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Open <b>Duskbound</b> from your Home screen.</li>',
    '<li>開啟瀏覽器選單 <b>⋮</b>（Chrome 右上角）。</li><li>選擇<b>安裝應用程式</b>或<b>加到主畫面</b>。</li><li>從主畫面開啟 <b>Duskbound</b>。</li>') + '</ol>';
  h += '<div class="row"><button id="instok"' + (installEvt && !ios ? ' class="ghost"' : '') + '>' + L('Play in the browser', '直接在瀏覽器遊玩') + '</button></div>';
  show(h);
  $('instok').onclick = back;
  if ($('instb')) $('instb').onclick = async () => { const e = installEvt; installEvt = null; try { e.prompt(); await e.userChoice; } catch (x) { } back(); };
}
function onFsButton(back) {
  if (isFS()) { exitFull(); setTimeout(back, 300); return; }
  if (canFS()) { setKeepFS(true); goFull(true); setTimeout(back, 300); return; }
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
  Object.keys(HEROES).forEach((id, i) => {
    const H2 = HEROES[id], R = H2.rarity && RARITY[H2.rarity], open = unlocked(id);
    const rar = R ? '<span class="rar" style="color:' + R.color + ';border-color:' + R.color + '">' + T(RARITY_NAMES[H2.rarity]) + '</span>' : '';
    const body = open ? (compact ? '' : '<p><i>' + T(H2.blurb) + '</i></p>') + '<ul>' + H2.kit.map(k => '<li>' + T(k) + '</li>').join('') + '</ul>'
      : clearHeroOf(id) ? '<p class="lock">' + L('Locked. Clear all five chapters on ' + DIFF(clearHeroOf(id)).name + ' to unlock.', '未解鎖。在' + T(DIFF(clearHeroOf(id)).name) + '難度通關全部五章即可解鎖。') + '</p>'
      : '<p class="lock">' + L('Locked. Can be won as a ' + RARITY_NAMES[H2.rarity] + ' chapter reward from Chapter ' + R.chapter + ' on.', '未解鎖。從第 ' + R.chapter + ' 章起，可在章節獎勵中以' + T(RARITY_NAMES[H2.rarity]) + '獎勵獲得。') + '</p>';
    h += '<div class="card' + (id === sel ? ' sel' : '') + (compact ? ' compact' : '') + (open ? '' : ' locked') + '" data-hero="' + id + '"><span class="key">' + (open ? i + 1 : '🔒') + '</span><canvas width="170" height="' + (compact ? 96 : 120) + '" data-p="' + id + '"></canvas><div class="tag" style="color:' + H2.color + '">' + T(H2.title) + '</div><h3>' + T(H2.name) + rar + '</h3>' + body + '</div>';
  });
  return h + '</div>';
}
function bindHeroCards(cb) {
  overlay.querySelectorAll('canvas[data-p]').forEach(cn => { const g = cn.getContext('2d'), s = cn.height < 110 ? 2.1 : 2.6; drawHero(g, cn.dataset.p, 85, cn.height * 0.65, -0.5, 0, { scale: s, ghost: !unlocked(cn.dataset.p) }); });
  overlay.querySelectorAll('.card').forEach(cd => cd.onclick = () => cb(cd.dataset.hero));
}
function selectHero(id) {
  if (!unlocked(id)) return; net.hero = id;
  if (game.state === 'menu') { overlay.querySelectorAll('.card').forEach(cd => cd.classList.toggle('sel', cd.dataset.hero === id)); return; }
  if (game.state !== 'lobby') return;
  const q = net.lobby.find(q => q.id === net.myId); if (q) q.hero = id;
  if (net.mode === 'host') sendLobby(); else if (net.host) net.host.send({ t: 'hero', hero: id, lo: loadoutOf(PROFILE, id) });
  showLobby();
}
function saveName() { const el = $('nm'); if (el) { net.name = el.value.trim().slice(0, 14); try { localStorage.setItem('duskbound-name', net.name); } catch (e) { } } }
function showMenu(msg) {
  game.state = 'menu'; game.over = null; me = null; players = [];
  show('<h1>DUSKBOUND</h1><div class="sub">' + L('Three days. Three nights. Then the guardian of each land wakes.<br>Roam the wood alone or with up to three friends, and be ready when it comes for you.', '三個白晝，三個黑夜，然後每片土地的守護者將會甦醒。<br>獨自或與最多三位朋友一同漫遊森林，在它找上你之前做好準備。') + '</div>' + heroCards(net.hero) +
    '<div class="row"><input id="nm" maxlength="14" placeholder="' + L('Your name', '你的名字') + '" value="' + esc(net.name) + '"><button id="solo">' + L('Play solo', '單人遊玩') + '</button><button id="hostb">' + L('Host co-op', '開設合作房') + '</button><span class="sep"></span><input id="code" maxlength="5" placeholder="' + L('CODE', '代碼') + '" autocomplete="off" value="' + esc(lastRoom()) + '"><button id="joinb">' + L('Join', '加入') + '</button></div>' +
    '<div class="row">' + diffSelect('diffsel', d => PROFILE.unlocked.includes(d)) + '<button id="profb" class="ghost">' + L('Profile', '個人檔案') + '</button></div>' +
    '<div id="msg">' + esc(T(msg) || '') + '</div>' + controlsHtml() + '<button id="lang" class="ghost langbtn">' + (LANG === 'zh' ? '🌐 English' : '🌐 繁體中文') + '</button>' + fsButtonHtml());
  bindFs(() => showMenu(msg));
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
  h += heroCards(net.hero, true) + '<div class="row">' + (host ? '<button id="start">' + (net.lobby.length > 1 ? L('Set out (' + net.lobby.length + ' players)', '出發（' + net.lobby.length + ' 人）') : L('Set out alone', '獨自出發')) + '</button>' : '<span class="wait">' + L('Waiting for the host to set out…', '等待房主出發…') + '</span>') + (NetT.voice ? '<button id="voiceb" class="ghost">🎙 ' + L('Voice', '語音') + '</button>' : '') + '<button id="leave" class="ghost">' + L('Leave', '離開') + '</button></div>';
  h = h.replace(/<button id="leave"/, fsRowHtml() + '<button id="leave"');
  show(h); bindHeroCards(selectHero); bindFs(showLobby); if ($('voiceb')) $('voiceb').onclick = () => showVoice(showLobby);
  if (host) { $('start').onclick = startHosted; $('diffsel').onchange = e => { if (partyDiffOk(e.target.value)) { setDiff(e.target.value); sendLobby(); } showLobby(); }; }
  $('leave').onclick = () => { leaveNet(); showMenu(); };
}
const unlocksOf = q => q.id === net.myId ? PROFILE.unlocked : q.unl || (q.lo && q.lo.unlocked) || ['normal'];
function diffSelect(id, allowed) {
  return '<select id="' + id + '" class="diffsel">' + DIFFICULTIES.map(d => '<option value="' + d.id + '"' + (d.id === net.diff ? ' selected' : '') + (allowed(d.id) ? '' : ' disabled') + '>' +
    L('Difficulty: ', '難度：') + T(d.name) + (allowed(d.id) ? '' : ' 🔒') + '</option>').join('') + '</select>';
}
// Profile screen: unlocks, weapons (equip one per hero), upgrades, starting talents, reward history, backup code.
// Online profile panel on the Profile screen: email + password (sign in or create an account), then synced
// automatically. A forgotten password is reset through an emailed link that brings the player back to set a new one.
const cloudUI = { email: '', mode: '', msg: '' }; // mode: '' | 'newpw' (arrived from a reset link)
const cloudErr = e => {
  const m = String(e && e.message || e);
  if (/invalid login credentials/i.test(m)) return L('Wrong email or password.', '電子郵件或密碼錯誤。');
  if (/already (been )?registered|already exists/i.test(m)) return L('That email already has an account — use Sign in.', '這個電子郵件已有帳號，請按「登入」。');
  if (/password should be|at least 6|weak/i.test(m)) return L('Use a password of at least 6 characters.', '密碼至少需要 6 個字元。');
  if (/rate limit|too many|security purposes/i.test(m)) return L('Too many tries — wait a minute and try again.', '嘗試次數過多，請稍候一分鐘再試。');
  if (/failed to fetch|network|load failed/i.test(m)) return L('Could not reach the server. Check your internet connection.', '無法連上伺服器，請檢查網路連線。');
  return m;
};
function cloudHtml() {
  if (!Cloud.enabled()) return '';
  let h = '<div class="stats prof"><b>☁ ' + L('Online profile', '線上檔案') + '</b><br>';
  if (Cloud.signedIn() && cloudUI.mode === 'newpw') {
    h += L('Choose a new password for ', '請為以下帳號設定新密碼：') + esc(Cloud.session.email) +
      '<div class="row"><input id="cpw" type="password" autocomplete="new-password" style="width:200px" placeholder="' + L('New password', '新密碼') + '"><button id="cnew">' + L('Save password', '儲存密碼') + '</button></div>';
  } else if (Cloud.signedIn()) {
    const t = Cloud.lastSync ? new Date(Cloud.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    h += L('Signed in as ', '已登入：') + esc(Cloud.session.email) + ' · ' + (Cloud.busy ? L('syncing…', '同步中…') : Cloud.error ? '<span style="color:#ff9b8a">' + L('could not sync (', '無法同步（') + esc(cloudErr(Cloud.error)) + L(') — your progress is kept here and sent later', '）— 進度已保留在此，稍後再上傳') + '</span>' : t ? L('synced at ', '同步於 ') + t : L('not synced yet', '尚未同步')) +
      '<div class="row"><button id="csync" class="ghost">' + L('Sync now', '立即同步') + '</button><button id="cout" class="ghost">' + L('Sign out', '登出') + '</button></div>';
  } else {
    h += L('Sign in to keep one profile across browsers, devices and the Home Screen app. New here? Pick an email and password, then Create account.', '登入後，不同瀏覽器、裝置和主畫面 App 都能使用同一個檔案。第一次使用？輸入電子郵件和密碼，再按「建立帳號」。') +
      '<div class="row"><input id="cem" type="email" autocomplete="email" style="width:210px" placeholder="' + L('Email', '電子郵件') + '" value="' + esc(cloudUI.email) + '">' +
      '<input id="cpw" type="password" autocomplete="current-password" style="width:150px" placeholder="' + L('Password', '密碼') + '"></div>' +
      '<div class="row"><button id="cin">' + L('Sign in', '登入') + '</button><button id="cup" class="ghost">' + L('Create account', '建立帳號') + '</button><button id="cfor" class="ghost">' + L('Forgot password', '忘記密碼') + '</button></div>';
  }
  return h + (cloudUI.msg ? '<div id="msg">' + esc(cloudUI.msg) + '</div>' : '') + '</div>';
}
function bindCloud() {
  const msg = m => { cloudUI.msg = m; showProfile(); };
  const creds = () => { const em = ($('cem').value || '').trim(), pw = $('cpw').value || ''; cloudUI.email = em; return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em) ? { em, pw } : null; };
  const go = async (fn, btn) => {
    const c = creds(); if (!c) return msg(L('Enter your email address.', '請輸入電子郵件地址。'));
    if (c.pw.length < 6) return msg(L('Use a password of at least 6 characters.', '密碼至少需要 6 個字元。'));
    btn.disabled = true;
    try { await fn(c.em, c.pw); cloudUI.msg = ''; showProfile(); await cloudSync(); } catch (e) { msg(e.message === 'confirm-email' ? L('Check your email to confirm the account, then sign in.', '請到信箱確認帳號後再登入。') : cloudErr(e)); }
  };
  if ($('cin')) $('cin').onclick = () => go((e, p) => Cloud.signIn(e, p), $('cin'));
  if ($('cup')) $('cup').onclick = () => go((e, p) => Cloud.signUp(e, p), $('cup'));
  if ($('cpw') && $('cin')) $('cpw').onkeydown = e => { if (e.key === 'Enter') $('cin').onclick(); };
  if ($('cfor')) $('cfor').onclick = async () => {
    const em = ($('cem').value || '').trim(); cloudUI.email = em;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return msg(L('Enter your email address first.', '請先輸入電子郵件地址。'));
    try { await Cloud.recover(em); msg(L('If that email has an account, a reset link is on its way. Open it on this device; it brings you back here to choose a new password.', '若此電子郵件有帳號，重設連結已寄出。請在這台裝置開啟連結，它會帶你回到這裡設定新密碼。')); } catch (e) { msg(cloudErr(e)); }
  };
  if ($('cnew')) $('cnew').onclick = async () => {
    const pw = $('cpw').value || ''; if (pw.length < 6) return msg(L('Use a password of at least 6 characters.', '密碼至少需要 6 個字元。'));
    try { await Cloud.setPassword(pw); cloudUI.mode = ''; msg(L('Password saved.', '密碼已儲存。')); cloudSync(); } catch (e) { msg(cloudErr(e)); }
  };
  if ($('csync')) $('csync').onclick = () => { cloudSync(); showProfile(); };
  if ($('cout')) $('cout').onclick = () => { Cloud.signOut(); cloudUI.mode = ''; cloudUI.msg = L('Signed out. This browser keeps a copy of the profile.', '已登出。此瀏覽器仍保留一份檔案。'); showProfile(); };
}
function showProfile(extra) {
  const P = PROFILE, rar = r => r ? '<span style="color:' + RARITY_COLORS[r] + '">' + T(RARITY_NAMES[r]) + '</span>' : L('No reward', '沒有獎勵');
  const online = Cloud.enabled() && Cloud.signedIn();
  let h = '<h2>' + L('Profile', '個人檔案') + '</h2><div class="sub">' + (online ? L('Saved online and in this browser · ID ', '已儲存在線上及此瀏覽器 · ID ') : L('Saved in this browser · ID ', '儲存在此瀏覽器 · ID ')) + esc(P.id.slice(0, 10)) + '…</div>' + cloudHtml() + '<div class="stats prof">';
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
    '<div class="wait">' + (online ? L('Sign in with the same email in any browser or the Home Screen app to use this profile there.', '在任何瀏覽器或主畫面 App 用同一個電子郵件登入，即可使用這個檔案。')
      : L('Clearing this site’s data, private browsing, another browser or the Home Screen app each start a new profile — ' + (Cloud.enabled() ? 'sign in above, or ' : '') + 'use a backup code to move it.',
        '清除網站資料、私密瀏覽、換瀏覽器或使用主畫面 App 都會建立新的檔案 — ' + (Cloud.enabled() ? '請在上方登入，或' : '請') + '用備份代碼搬移。')) + '</div>';
  show(h); bindCloud();
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
// One chapter-talent card: name, the abilities it changes, what it does and its limits.
function talentCard(hero, t, i, key) {
  return '<div class="card ctc" tabindex="0" role="button" data-i="' + i + '">' + (key ? '<span class="key">' + (i + 1) + '</span>' : '') + '<div class="tag" style="color:' + HEROES[hero].color + '">' + t.ab.map(T).join(' · ') + '</div><h3>' + T(t.name) + '</h3><p>' + T(t.desc) + '</p><p class="lim">' + T(t.limits) + '</p></div>';
}
// The build panel: a player's chapter talents this run (pause screen, co-op menu, chapter end).
function buildHtml(p) {
  if (!p || !HERO_TALENTS[p.hero]) return '';
  const got = (p.ct || []).map(id => heroTalent(p.hero, id)).filter(Boolean);
  return '<div class="stats prof build"><b>' + L('Chapter talents', '章節天賦') + '</b> <i>' + L('(this run)', '（本局）') + '</i><br>' + (got.length ? got.map(t => '<span style="color:' + HEROES[p.hero].color + '">' + T(t.name) + '</span> — ' + t.ab.map(T).join(' · ') + ': ' + T(t.desc) + ' <i class="lim">' + T(t.limits) + '</i>').join('<br>') : '<i>' + L('none yet', '尚無') + '</i>') + '</div>';
}
function syncChoice() {
  const ct = me && game.state === 'play' && !game.over && me.ctChoice && me.ctChoice.length;
  if (ct) {
    const key = 'ct' + me.ctSeq + ':' + me.ctChoice.join(','); if (key === shownChoice) return; shownChoice = key;
    let h = '<h2>' + L('Chapter talent — choose one', '章節天賦 — 選擇一項') + '</h2><div class="sub ctsub">' + L('It lasts for the rest of this run. Tap or click a card, or press its number.', '效果持續到本局結束。點選卡片，或按下對應的數字鍵。') + '</div><div class="cards ctcards">';
    me.ctChoice.forEach((id, i) => { const t = heroTalent(me.hero, id); if (t) h += talentCard(me.hero, t, i, true); });
    choiceEl.className = net.mode === 'solo' ? 'solo' : 'coop'; choiceEl.innerHTML = h + '</div>';
    choiceEl.querySelectorAll('.card').forEach(cd => { onTap(cd, () => chooseChapterTalent(+cd.dataset.i)); cd.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); chooseChapterTalent(+cd.dataset.i); } }; });
    return;
  }
  const on = me && game.state === 'play' && !game.over && me.choice && me.choice.length;
  const key = on ? me.choiceSeq + ':' + me.choice.map(t => t.id).join(',') : '';
  if (key === shownChoice) return; shownChoice = key;
  if (!on) { choiceEl.className = 'hidden'; choiceEl.innerHTML = ''; return; }
  let h = '<h2>' + esc(T(me.choiceTitle || 'Choose')) + '</h2><div class="cards">';
  me.choice.forEach((t, i) => { const rk = me.talents[t.id] || 0; h += '<div class="card" data-i="' + i + '"><span class="key">' + (i + 1) + '</span><div class="tag"' + (t.hero ? ' style="color:' + HEROES[t.hero].color + '"' : '') + '>' + T(t.hero ? HEROES[t.hero].name : 'Boon') + '</div><h3>' + T(t.name) + '</h3><p>' + T(t.desc) + '</p><div class="pips">' + '●'.repeat(rk + 1) + '○'.repeat(Math.max(0, t.max - rk - 1)) + '</div></div>'; });
  choiceEl.className = net.mode === 'solo' ? 'solo' : 'coop'; choiceEl.innerHTML = h + '</div>';
  choiceEl.querySelectorAll('.card').forEach(cd => onTap(cd, () => chooseTalent(+cd.dataset.i)));
}
// Solo / host: applied at once (applyChapterTalent validates). Guest: sent to the host; the effect starts when the host accepts.
function chooseChapterTalent(i) {
  if (!me || !me.ctChoice || !me.ctChoice[i] || game.state !== 'play') return;
  const id = me.ctChoice[i];
  if (net.mode === 'client') { net.host.send({ t: 'ctpick', id, q: me.ctSeq }); net.ctPicked = me.ctSeq; me.ctChoice = null; playSfx('pick'); }
  else applyChapterTalent(me, id, me.ctSeq);
  mouse.l = mouse.r = false;
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
  const rws = game.rewards && (CHAPTER_REWARDS.roll ? game.rewards : game.rewards.filter(r => r.ct));
  const rw = rws && rws.length ? '<div class="stats"><b>' + (CHAPTER_REWARDS.roll ? L('Chapter reward', '章節獎勵') : L('Chapter talent', '章節天賦')) + '</b><br>' + rws.map(r => esc(r.name) + ' — ' + (r.rarity ? '<span style="color:' + RARITY_COLORS[r.rarity] + '">' + T(RARITY_NAMES[r.rarity]) + '</span> · ' + esc(T(itemLabel(r.item))) : CHAPTER_REWARDS.roll ? L('No reward', '沒有獎勵') : '') + (r.ct ? (r.rarity || CHAPTER_REWARDS.roll ? ' · ' : '') + '<b>' + L('choose a hero talent next chapter', '下一章選擇英雄天賦') + '</b>' : '')).join('<br>') + '</div>' : '';
  const bl = game.over === 'win' ? buildHtml(me) : '';
  const guest = net.mode === 'client', wait = '<div class="wait">' + L('Waiting for the host…', '等待房主…') + '</div><button id="leave" class="ghost">' + L('Leave party', '離開隊伍') + '</button>';
  if (game.over === 'dead') show('<h2>' + L('The dusk takes you', '你被暮色吞沒') + '</h2><div class="sub">' + L('The wood closes over another lantern.', '森林又吞沒了一盞燈火。') + '</div>' + st + rw + (guest ? wait : '<button id="again">' + (net.mode === 'host' ? L('Back to the lobby', '回到大廳') : L('Try again', '再試一次')) + '</button>'), true);
  else if (game.over === 'win') show('<h2>' + L(bossCfg(game.chapter).name + ' falls', T(bossCfg(game.chapter).name) + '倒下了') + '</h2><div class="sub">' + L('The path runs deeper. ' + PAL[game.chapter % PAL.length].name + ' awaits — and ' + bossCfg(game.chapter + 1).name + ', who is stronger still.', '道路通往更深處。' + T(PAL[game.chapter % PAL.length].name) + '在等著你，還有更加強大的' + T(bossCfg(game.chapter + 1).name) + '。') + '</div>' + st + rw + bl + (guest ? wait : '<button id="next">' + L('Press on', '繼續前進') + '</button>'), true);
  else show('<h1>' + L('DAWN', '黎明') + '</h1><div class="sub">' + L('Nezha lowers his spear: the divine trial is won. For the first time in an age, morning comes and stays.', '哪吒放下火尖槍：神之試煉已經通過。漫長歲月以來，晨光第一次降臨並且留了下來。') + '</div>' + st + rw + (guest ? wait : '<button id="again">' + (net.mode === 'host' ? L('Back to the lobby', '回到大廳') : L('Play again', '再玩一次')) + '</button>'));
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
  for (const p of players) { p.down = false; p.rev = 0; p.flurry = null; p.dashT = 0; p.ultT = 0; if (p.hp <= 0) p.hp = 1; } // cleanup: no Final Curtain / Aftergrowth
  genWorld(); for (const p of players) heal(p, p.maxHp * 0.5);
  hide(); banner(world.pal.name, chapterSub(), 4); sfx('dawn');
  if (net.mode === 'host') sendWorld();
}
// What to do about a microphone error (DOMException names from getUserMedia).
function micErrorText(name) {
  if (name === 'NotAllowedError') return L('Microphone permission is off for this site. iPhone Safari: tap <b>aA</b> (or <b>⋯</b>) → <b>Website Settings</b> → <b>Microphone</b> → <b>Allow</b>, then try again. Home Screen app: iPhone <b>Settings</b> → <b>Apps</b> → <b>Safari</b> → <b>Microphone</b>.',
    '此網站的麥克風權限已關閉。iPhone Safari：點 <b>aA</b>（或 <b>⋯</b>）→ <b>網站設定</b> → <b>麥克風</b> → <b>允許</b>，再試一次。主畫面 App：iPhone <b>設定</b> → <b>App</b> → <b>Safari</b> → <b>麥克風</b>。');
  if (name === 'NotReadableError' || name === 'AbortError') return L('The microphone is busy — end any call or app using it (or a Bluetooth headset switching), then try again.', '麥克風正被使用中 — 請結束通話或其他使用麥克風的 App（或藍牙耳機切換中），再試一次。');
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return L('No microphone was found.', '找不到麥克風。');
  if (name === 'SecurityError') return L('The microphone needs the secure (https) game link.', '麥克風需要使用安全（https）的遊戲連結。');
  return L('Microphone not available (' + esc(name) + '). Try again, or reload the page.', '無法使用麥克風（' + esc(name) + '）。請再試一次或重新整理頁面。');
}
// Voice & sound panel. In co-op play it opens over the running game (soft) and does not pause.
async function showVoice(back, soft) {
  const nameOf = pid => { const q = players.find(p => p.id === pid) || net.lobby.find(q => q.id === pid); return q ? q.name : '#' + pid; };
  let h = '<h2>' + L('Voice & sound', '語音與音效') + '</h2>' + (soft && game.state === 'play' ? buildHtml(me) : '');
  if (!NetT.voice || !Voice.supported()) h += '<div class="sub">' + L('Voice chat needs the GitHub Pages version of the game (direct connections). It is not available on this page.', '語音聊天需要 GitHub Pages 版本（直接連線），此頁面無法使用。') + '</div>';
  else {
    const devs = Voice.micStream ? await Voice.devices() : [];
    h += '<div class="row"><button id="vmic"' + (Voice.micStream ? ' class="ghost"' : '') + '>' + (Voice.micStream ? L('Turn microphone off', '關閉麥克風') : L('Turn microphone on', '開啟麥克風')) + '</button>' +
      '<select id="vmode"><option value="ptt"' + (Voice.mode === 'ptt' ? ' selected' : '') + '>' + L('Push to talk', '按住說話') + '</option><option value="open"' + (Voice.mode === 'open' ? ' selected' : '') + '>' + L('Open mic', '持續開麥') + '</option></select>' +
      (devs.length ? '<select id="vdev">' + devs.map((d, i) => '<option value="' + esc(d.deviceId) + '"' + (d.deviceId === Voice.micId ? ' selected' : '') + '>' + esc(d.label || L('Microphone ', '麥克風 ') + (i + 1)) + '</option>').join('') + '</select>' : '') + '</div>';
    h += '<div class="wait">' + (!Voice.micStream && Voice.error ? micErrorText(Voice.error) :
      Voice.micStream ? (Voice.mode === 'ptt' ? L('Hold V (keyboard) or the TALK button (touch) to talk.', '按住 V 鍵（鍵盤）或 TALK 按鈕（觸控）說話。') : L('Everyone hears you while the mic is on.', '麥克風開啟時大家都聽得到你。')) : L('You can hear others without a microphone.', '不開麥克風也能聽到其他人。')) + '</div>';
    const others = Voice.roster.filter(r => r.id !== Voice.myId);
    h += '<div class="stats prof">' + (others.length ? others.map(r => { const v = Voice.calls.get(r.id); return '<div class="vrow">' + esc(nameOf(r.id)) + ' <i>' + (v && v.stream ? L('connected', '已連線') : L('connecting…', '連線中…')) + '</i> ' +
      '<button class="ghost vmute" data-pid="' + r.id + '">' + (v && v.muted ? L('Unmute', '取消靜音') : L('Mute', '靜音')) + '</button> <input type="range" class="vvol" data-pid="' + r.id + '" min="0" max="2" step="0.05" value="' + (v ? v.vol : 1) + '"></div>'; }).join('') : '<i>' + L('No one else here yet.', '目前沒有其他人。') + '</i>') + '</div>';
  }
  h += '<div class="row"><button id="vsfx" class="ghost">' + L('Game sound: ', '遊戲音效：') + (AU.muted ? L('off', '關') : L('on', '開')) + '</button>' + langBtnHtml() + fsRowHtml() + '<button id="vback">' + L('Close', '關閉') + '</button></div>';
  show(h, soft); bindFs(() => showVoice(back, soft)); bindLang(() => showVoice(back, soft));
  $('vback').onclick = () => back(); $('vsfx').onclick = () => { initAudio(); onKey('m'); showVoice(back, soft); };
  if ($('vmic')) $('vmic').onclick = async () => { if (Voice.micStream) await Voice.disableMic(); else await Voice.enableMic(Voice.micId); showVoice(back, soft); };
  if ($('vmode')) $('vmode').onchange = e => { Voice.setMode(e.target.value); showVoice(back, soft); };
  if ($('vdev')) $('vdev').onchange = async e => { await Voice.enableMic(e.target.value); showVoice(back, soft); };
  document.querySelectorAll('.vmute').forEach(b => b.onclick = () => { const pid = +b.dataset.pid, v = Voice.calls.get(pid); Voice.setMuted(pid, !(v && v.muted)); showVoice(back, soft); });
  document.querySelectorAll('.vvol').forEach(r => r.oninput = () => Voice.setVolume(+r.dataset.pid, +r.value));
}
// In-game language switch (pause screen, and the co-op Voice & sound screen): the HUD redraws in the new language at once.
const langBtnHtml = () => '<button id="plang" class="ghost">' + (LANG === 'zh' ? '🌐 English' : '🌐 繁體中文') + '</button>';
function bindLang(redraw) { if ($('plang')) $('plang').onclick = () => { setLang(LANG === 'zh' ? 'en' : 'zh'); redraw(); }; }
const muteLabel = () => AU.muted ? L('Unmute', '取消靜音') : L('Mute', '靜音');
function onKey(k) {
  if (k === 'r' && game.state === 'play' && me && !game.over) toggleAuto();
  if (k === 'c' && game.state === 'play' && me && !game.over) toggleStats();
  if (k === 'm' && AU.ctx) { AU.muted = !AU.muted; AU.master.gain.value = AU.muted ? 0 : 0.55; }
  const n = '123456789'.indexOf(k);
  if (n >= 0 && (game.state === 'menu' || game.state === 'lobby')) selectHero(Object.keys(HEROES)[n]);
  else if (n >= 0 && n < 5 && game.state === 'play' && me && me.ctChoice) chooseChapterTalent(n);
  else if (n >= 0 && n < 3 && game.state === 'play') chooseTalent(n);
  else if ((k === 'p' || k === 'escape') && game.state === 'play' && net.mode !== 'solo' && !game.over && overlay.className === 'hidden') showVoice(hide, true);
  else if ((k === 'p' || k === 'escape') && game.state === 'play' && net.mode === 'solo' && !game.over && !(me && (me.choice || me.ctChoice))) {
    game.paused = !game.paused;
    if (game.paused) {
      show('<h2>' + L('Paused', '暫停') + '</h2>' + buildHtml(me) + controlsHtml() + '<div class="row"><button id="res">' + L('Resume', '繼續') + '</button>' + (touch.on ? '<button id="mute" class="ghost">' + muteLabel() + '</button><button id="quit" class="ghost">' + L('Quit run', '放棄本局') + '</button>' : '') + langBtnHtml() + fsRowHtml() + '</div>', true);
      $('res').onclick = () => { game.paused = false; hide(); };
      bindFs(() => { game.paused = true; onKey('p'); onKey('p'); });
      bindLang(() => { game.paused = true; onKey('p'); onKey('p'); });
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
    else if (!(net.mode === 'solo' && (game.paused || me.choice || me.ctChoice))) update(dt);
    if (net.mode === 'host') { net.snapT -= dt; if (net.snapT <= 0) { net.snapT = NetT.snapIv ? NetT.snapIv(net.conns.length) : 0.05; sendSnaps(); } }
  }
  for (const k in pressed) delete pressed[k];
  syncChoice();
}
function frame(ts) { tick(ts); music(); render(); requestAnimationFrame(frame); }
showMenu(); requestAnimationFrame(frame);
// online profile: finish a password-reset link if we arrived from one, then sync
if (Cloud.enabled()) Cloud.fromLink().then(t => { if (t === 'recovery') { cloudUI.mode = 'newpw'; showProfile(); } cloudSync(); });
if (/[?&]a(=|&|$)/.test(location.search) && !STANDALONE && !window.DUSK_NO_NET) showInstall(() => showMenu());
