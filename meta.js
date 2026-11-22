'use strict';
// Meta progression: campaign length, difficulties, party scaling, chapter rewards and saved player profiles.
// Everything tunable lives in the CONFIG blocks at the top. Pure functions (no DOM) so tests can run it in Node.

// ---------- CONFIG ----------
const CHAPTERS = 5;

// Difficulty order. hp/dmg multiply enemy health and damage; ambush multiplies how often night ambushes come.
const DIFFICULTIES = [
  { id: 'normal', name: 'Normal', hp: 1, dmg: 1, ambush: 1 },
  { id: 'nightmare', name: 'Nightmare', hp: 1.6, dmg: 1.35, ambush: 1.2 },
  { id: 'hell', name: 'Hell', hp: 2.4, dmg: 1.75, ambush: 1.4 },
  { id: 'inferno', name: 'Inferno', hp: 3.5, dmg: 2.2, ambush: 1.6 }
];

// Player-count scaling, applied to an enemy once, when it spawns (existing enemies are never re-scaled).
// n = players in the session, counting disconnected players whose slot is still held (see graceSeconds).
//   enemy health x (1 + hpPerExtra    * (n - 1))
//   enemy damage x (1 + dmgPerExtra   * (n - 1))
//   ambush rate  x (1 + ambushPerExtra * (n - 1))
// Defaults reproduce the game's original balance (it already scaled health and ambushes this way).
const PARTY_SCALE = { hpPerExtra: 0.6, dmgPerExtra: 0, ambushPerExtra: 0.35, graceSeconds: 120 };

// Chapter reward odds in basis points (1/100 of a percent): one roll per player per chapter, mutually exclusive.
// Whatever is left over up to 10000 is "no reward" (here 5150 = 51.5%).
const REWARD_ODDS = [['green', 3000], ['blue', 1000], ['purple', 500], ['yellow', 250], ['red', 100]];
const RARITIES = ['green', 'blue', 'purple', 'yellow', 'red'];
const RARITY_NAMES = { green: 'Green', blue: 'Blue', purple: 'Purple', yellow: 'Yellow', red: 'Red' };
const RARITY_COLORS = { green: '#7bd96f', blue: '#6fb6ff', purple: '#c27bff', yellow: '#f3d048', red: '#ff5a5a' };

// Permanent stat upgrades (stack up to cap). Applied when a run starts.
const UPGRADES = {
  hp: { name: 'Max health', unit: '', cap: 60, f: (p, v) => { p.maxHp += v; p.hp += v; } },
  dmg: { name: 'Damage', unit: '%', cap: 30, f: (p, v) => { p.dmgMul += v / 100; } },
  spd: { name: 'Move speed', unit: '%', cap: 15, f: (p, v) => { p.spdMul += v / 100; } },
  crit: { name: 'Critical chance', unit: '%', cap: 10, f: (p, v) => { p.crit += v / 100; } },
  gold: { name: 'Starting gold', unit: '', cap: 100, f: (p, v) => { p.gold += v; } }
};
// Hero weapons: one equipped per hero. Effects use the same player fields as boons.
const WEAPONS = {
  thornmaul: { hero: 'bramble', rarity: 'purple', name: 'Thornmaul', desc: '+15% damage, -8% attack speed', f: p => { p.dmgMul += 0.15; p.asMul -= 0.08; } },
  elderbough: { hero: 'bramble', rarity: 'yellow', name: 'Elder Bough', desc: 'Sweep reach +30%, +10% damage', f: p => { p.h.wide = (p.h.wide || 0) + 1; p.dmgMul += 0.1; } },
  gloamantler: { hero: 'bramble', rarity: 'red', name: 'Gloam Antler', desc: '+25% damage, +10% critical chance', f: p => { p.dmgMul += 0.25; p.crit += 0.1; } },
  cinderglass: { hero: 'wick', rarity: 'purple', name: 'Cinderglass Lantern', desc: 'Bolts pierce +1 enemy', f: p => { p.h.pierce = (p.h.pierce || 0) + 1; } },
  sunlantern: { hero: 'wick', rarity: 'yellow', name: 'Sun Lantern', desc: '+1 cinder bolt per cast', f: p => { p.h.fork = (p.h.fork || 0) + 1; } },
  starwick: { hero: 'wick', rarity: 'red', name: 'Starwick', desc: '+20% damage, cooldowns 15% faster', f: p => { p.dmgMul += 0.2; p.cdr *= 0.85; } },
  mothfang: { hero: 'vesper', rarity: 'purple', name: 'Mothfang Blades', desc: '+8% critical chance', f: p => { p.crit += 0.08; } },
  duskneedles: { hero: 'vesper', rarity: 'yellow', name: 'Dusk Needles', desc: '+1 dash charge, +10% move speed', f: p => { p.dashMax++; p.dashes++; p.spdMul += 0.1; } },
  eclipseedge: { hero: 'vesper', rarity: 'red', name: 'Eclipse Edge', desc: '+20% damage, +40% critical damage', f: p => { p.dmgMul += 0.2; p.critMul += 0.4; } }
};
// Starting talents: begin every run with 1 rank of this boon (ids from TALENTS in data.js).
const START_TALENT_CAP = 1;
// Reward pools per rarity. Item ids: 'u:<upgrade>:<amount>', 'w:<weapon>', 't:<talent>', 'c:<character>'.
// Characters: no heroes beyond the three starters exist yet, so the character pools are empty (see DESIGN notes).
const REWARD_POOLS = {
  green: ['u:hp:4', 'u:dmg:2', 'u:spd:2', 'u:gold:10'],
  blue: ['u:hp:8', 'u:dmg:4', 'u:crit:2', 't:keen', 't:quick', 't:fleet', 't:hearty'],
  purple: ['w:thornmaul', 'w:cinderglass', 'w:mothfang', 't:eye', 't:leech', 't:tinker', 't:chain', 't:ember'],
  yellow: ['w:elderbough', 'w:sunlantern', 'w:duskneedles', 't:step', 't:exec'],
  red: ['w:gloamantler', 'w:starwick', 'w:eclipseedge', 'u:dmg:10', 'u:hp:20']
};
// If everything in a rarity's pool is already owned or capped, the player gets this upgrade instead (still one reward).
const REWARD_FALLBACK = { green: ['u:hp:4', 'u:gold:10'], blue: ['u:dmg:4', 'u:hp:8'], purple: ['u:dmg:5', 'u:hp:12'], yellow: ['u:dmg:6', 'u:hp:15'], red: ['u:dmg:10', 'u:hp:20'] };

// ---------- reward rolls ----------
const ODDS_TOTAL = 10000;
function checkOdds() {
  const sum = REWARD_ODDS.reduce((s, [, bp]) => s + bp, 0);
  if (REWARD_ODDS.some(([, bp]) => !(Number.isInteger(bp) && bp >= 0)) || sum > ODDS_TOTAL) throw new Error('REWARD_ODDS must be whole basis points totalling at most 10000');
  return { sum, none: ODDS_TOTAL - sum };
}
// n: integer 0..9999. Returns a rarity or null (no reward). Boundaries: [0,3000) green, [3000,4000) blue, ...
function rarityFor(n) {
  let edge = 0;
  for (const [rarity, bp] of REWARD_ODDS) { edge += bp; if (n < edge) return rarity; }
  return null;
}
const rollRarity = (rng = Math.random) => rarityFor(Math.min(ODDS_TOTAL - 1, Math.floor(rng() * ODDS_TOTAL)));

// Can this player still use the item? (Weapons not owned, talents below cap, upgrades below cap, characters not owned.)
function itemAvailable(id, inv) {
  const [k, a, b] = id.split(':');
  if (k === 'w') return !!WEAPONS[a] && !(inv.weapons || []).includes(a);
  if (k === 't') return (inv.talents && inv.talents[a] || 0) < START_TALENT_CAP;
  if (k === 'u') return !!UPGRADES[a] && (inv.upgrades && inv.upgrades[a] || 0) + Number(b) <= UPGRADES[a].cap;
  if (k === 'c') return !(inv.characters || []).includes(a);
  return false;
}
// The single reward for one player: a rarity from one roll, then one item from that rarity's pool.
function rollReward(inv, rng = Math.random) {
  const rarity = rollRarity(rng);
  if (!rarity) return { rarity: null, item: null };
  let pool = REWARD_POOLS[rarity].filter(id => itemAvailable(id, inv));
  if (!pool.length) pool = REWARD_FALLBACK[rarity].filter(id => itemAvailable(id, inv));
  return { rarity, item: pool.length ? pool[Math.floor(rng() * pool.length)] : 'keepsake' };
}

// ---------- profiles ----------
const PROFILE_KEY = 'duskbound-profile', PROFILE_VERSION = 1;
const randId = n => { let s = ''; const A = 'abcdefghijklmnopqrstuvwxyz0123456789'; const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(n)) : null; for (let i = 0; i < n; i++) s += A[(c ? c[i] : Math.floor(Math.random() * 256)) % 36]; return s; };
function newProfile() {
  return { v: PROFILE_VERSION, id: 'p_' + randId(20), created: Date.now(), unlocked: ['normal'], cleared: {}, characters: ['bramble', 'wick', 'vesper'],
    weapons: [], equipped: {}, upgrades: {}, talents: {}, rewards: [], claims: {} };
}
// Repairs anything missing or invalid, so an old or hand-edited save can't break the game.
function sanitizeProfile(p) {
  const d = newProfile();
  if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^p_[a-z0-9]{8,40}$/.test(p.id)) return d;
  const out = { ...d, id: p.id, created: Number(p.created) || d.created };
  const ids = DIFFICULTIES.map(x => x.id);
  out.unlocked = ids.filter((id, i) => i === 0 || (Array.isArray(p.unlocked) && p.unlocked.includes(id)));
  for (const id of ids) if (p.cleared && Number.isInteger(p.cleared[id])) out.cleared[id] = Math.max(0, Math.min(99999, p.cleared[id]));
  out.characters = [...new Set(d.characters.concat(Array.isArray(p.characters) ? p.characters.filter(c => typeof HEROES === 'undefined' || HEROES[c]) : []))];
  out.weapons = [...new Set((Array.isArray(p.weapons) ? p.weapons : []).filter(w => WEAPONS[w]))];
  for (const [h, w] of Object.entries(p.equipped || {})) if (WEAPONS[w] && WEAPONS[w].hero === h && out.weapons.includes(w)) out.equipped[h] = w;
  for (const [k, v] of Object.entries(p.upgrades || {})) if (UPGRADES[k]) out.upgrades[k] = Math.max(0, Math.min(UPGRADES[k].cap, Number(v) || 0));
  for (const [k, v] of Object.entries(p.talents || {})) if (typeof TALENTS === 'undefined' || TALENTS.some(t => t.id === k)) out.talents[k] = Math.max(0, Math.min(START_TALENT_CAP, v | 0));
  out.rewards = (Array.isArray(p.rewards) ? p.rewards : []).slice(-60);
  if (p.claims && typeof p.claims === 'object') for (const k of Object.keys(p.claims).slice(-500)) out.claims[k] = 1;
  return out;
}
function loadProfile(store) {
  let p = null; try { p = JSON.parse(store.getItem(PROFILE_KEY) || 'null'); } catch (e) { }
  const out = sanitizeProfile(p); saveProfile(store, out); return out;
}
function saveProfile(store, p) { try { store.setItem(PROFILE_KEY, JSON.stringify(p)); return true; } catch (e) { return false; } }

// Applies one awarded reward. Idempotent: a claim id that was already applied is ignored (returns false).
function grantReward(prof, claim, rarity, item, meta = {}) {
  if (!claim || prof.claims[claim]) return false;
  prof.claims[claim] = 1;
  if (rarity && item) {
    const [k, a, b] = item.split(':');
    if (k === 'w' && WEAPONS[a] && !prof.weapons.includes(a)) { prof.weapons.push(a); if (!prof.equipped[WEAPONS[a].hero]) prof.equipped[WEAPONS[a].hero] = a; }
    else if (k === 't') prof.talents[a] = Math.min(START_TALENT_CAP, (prof.talents[a] || 0) + 1);
    else if (k === 'u' && UPGRADES[a]) prof.upgrades[a] = Math.min(UPGRADES[a].cap, (prof.upgrades[a] || 0) + Number(b));
    else if (k === 'c' && !prof.characters.includes(a)) prof.characters.push(a);
  }
  prof.rewards.push({ claim, rarity: rarity || null, item: item || null, chapter: meta.chapter || 0, diff: meta.diff || 'normal', t: Date.now() });
  if (prof.rewards.length > 60) prof.rewards.shift();
  return true;
}
// Records a full five-chapter clear on a difficulty. Unlocks only the next difficulty. Idempotent per run id.
function recordCampaignClear(prof, diff, runId) {
  const claim = 'clear:' + runId;
  if (!runId || prof.claims[claim]) return null;
  const i = DIFFICULTIES.findIndex(d => d.id === diff); if (i < 0 || !prof.unlocked.includes(diff)) return null;
  prof.claims[claim] = 1; prof.cleared[diff] = (prof.cleared[diff] || 0) + 1;
  const next = DIFFICULTIES[i + 1];
  if (next && !prof.unlocked.includes(next.id)) { prof.unlocked.push(next.id); return next.id; }
  return null;
}
const highestUnlocked = prof => DIFFICULTIES.filter(d => prof.unlocked.includes(d.id)).pop().id;

// What a player brings into a session: sent to the host, which validates it and applies it to their hero.
// (There is no server, so this is self-reported; the host caps and validates every value.)
function loadoutOf(prof, hero) {
  const w = prof.equipped[hero];
  return { pid: prof.id, unlocked: prof.unlocked.slice(), weapon: w && WEAPONS[w] && WEAPONS[w].hero === hero ? w : null,
    weapons: prof.weapons.slice(), upgrades: { ...prof.upgrades }, talents: { ...prof.talents }, characters: prof.characters.slice() };
}
function sanitizeLoadout(l, hero) {
  const p = sanitizeProfile({ id: l && typeof l.pid === 'string' ? l.pid : '', unlocked: l && l.unlocked, weapons: l && l.weapons, upgrades: l && l.upgrades, talents: l && l.talents, characters: l && l.characters,
    equipped: l && l.weapon ? { [hero]: l.weapon } : {} });
  return { pid: p.id, unlocked: p.unlocked, weapon: p.equipped[hero] || null, weapons: p.weapons, upgrades: p.upgrades, talents: p.talents, characters: p.characters, valid: !!(l && typeof l.pid === 'string' && p.id === l.pid) };
}
// Host side: applies a validated loadout to a freshly created hero.
function applyLoadout(p, lo) {
  if (!lo) return;
  for (const [k, v] of Object.entries(lo.upgrades || {})) if (UPGRADES[k] && v > 0) UPGRADES[k].f(p, v);
  if (typeof TALENTS !== 'undefined') for (const [id, r] of Object.entries(lo.talents || {})) {
    const t = TALENTS.find(t => t.id === id); if (!t || (t.hero && t.hero !== p.hero)) continue;
    for (let i = 0; i < r && (p.talents[id] || 0) < t.max; i++) { p.talents[id] = (p.talents[id] || 0) + 1; t.f(p); }
  }
  const w = lo.weapon && WEAPONS[lo.weapon]; if (w && w.hero === p.hero) { w.f(p); p.weapon = lo.weapon; }
}
// Backup codes move a profile between browsers or devices.
const exportProfile = prof => 'DB1.' + btoa(unescape(encodeURIComponent(JSON.stringify(prof))));
function importProfile(code) {
  const m = /^DB1\.([A-Za-z0-9+/=]+)$/.exec(String(code || '').trim()); if (!m) return null;
  try { const p = JSON.parse(decodeURIComponent(escape(atob(m[1])))); return p && p.id ? sanitizeProfile(p) : null; } catch (e) { return null; }
}
// Display label for a reward item.
function itemLabel(item) {
  if (!item) return 'No reward';
  if (item === 'keepsake') return 'Keepsake (everything already owned)';
  const [k, a, b] = item.split(':');
  if (k === 'w') return 'Weapon: ' + WEAPONS[a].name;
  if (k === 't') { const t = typeof TALENTS !== 'undefined' && TALENTS.find(t => t.id === a); return 'Starting talent: ' + (t ? t.name : a); }
  if (k === 'u') return 'Upgrade: ' + UPGRADES[a].name + ' +' + b + UPGRADES[a].unit;
  if (k === 'c') return 'Character: ' + a;
  return item;
}
if (typeof module !== 'undefined') module.exports = { CHAPTERS, DIFFICULTIES, PARTY_SCALE, REWARD_ODDS, REWARD_POOLS, REWARD_FALLBACK, RARITIES, UPGRADES, WEAPONS, START_TALENT_CAP,
  checkOdds, rarityFor, rollRarity, rollReward, itemAvailable, newProfile, sanitizeProfile, loadProfile, saveProfile, grantReward, recordCampaignClear, highestUnlocked,
  loadoutOf, sanitizeLoadout, applyLoadout, exportProfile, importProfile, itemLabel, ODDS_TOTAL };
