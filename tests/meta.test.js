// Run: node tests/meta.test.js   (no dependencies)
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { console, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'), escape, unescape, crypto: require('crypto').webcrypto, heal: () => { } };
vm.createContext(ctx);
for (const f of ['data.js', 'meta.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace("if (typeof module !== 'undefined')", 'if (false)'), ctx, { filename: f });
const M = new Proxy({}, { get: (_, k) => vm.runInContext(k, ctx) });
let fails = 0, n = 0;
const ok = (cond, msg) => { n++; if (!cond) { fails++; console.log('FAIL', msg); } };
const store = () => { const d = {}; return { getItem: k => k in d ? d[k] : null, setItem: (k, v) => { d[k] = String(v); }, raw: d }; };

// --- odds: total 100%, no-reward share is 51.5%
const { sum, none } = M.checkOdds();
ok(sum === 4850 && none === 5150 && sum + none === 10000, 'odds total 10000 bp with 5150 bp for no reward');
const pct = Object.fromEntries(M.REWARD_ODDS.map(([r, bp]) => [r, bp / 100]));
ok(pct.green === 30 && pct.blue === 10 && pct.purple === 5 && pct.yellow === 2.5 && pct.red === 1, 'exact table 30/10/5/2.5/1');
// --- roll boundaries (one draw 0..9999)
const B = [[0, 'green'], [2999, 'green'], [3000, 'blue'], [3999, 'blue'], [4000, 'purple'], [4499, 'purple'], [4500, 'yellow'], [4749, 'yellow'], [4750, 'red'], [4849, 'red'], [4850, null], [9999, null]];
for (const [x, want] of B) ok(M.rarityFor(x) === want, 'boundary ' + x + ' -> ' + want);
// exhaustive count over every draw
const count = {}; for (let x = 0; x < 10000; x++) { const r = M.rarityFor(x) || 'none'; count[r] = (count[r] || 0) + 1; }
ok(count.green === 3000 && count.blue === 1000 && count.purple === 500 && count.yellow === 250 && count.red === 100 && count.none === 5150, 'exhaustive draw counts ' + JSON.stringify(count));
// rng edge: 0 and just under 1
ok(M.rollRarity(() => 0) === 'green' && M.rollRarity(() => 0.9999999) === null, 'rng edges');
// --- one roll -> at most one item, from that rarity's pool
const inv = { weapons: [], talents: {}, upgrades: {}, characters: [] };
for (let i = 0; i < 2000; i++) {
  let calls = 0; const rng = () => { calls++; return Math.random(); };
  const r = M.rollReward(inv, rng);
  ok(r.rarity === null ? r.item === null && calls === 1 : (typeof r.item === 'string' && calls === 2), 'single roll, single item');
  if (r.rarity && r.item !== 'keepsake') ok(M.REWARD_POOLS[r.rarity].concat(M.REWARD_FALLBACK[r.rarity]).includes(r.item), 'item from its rarity pool ' + r.rarity + ' ' + r.item);
}
// owned items are skipped; fully owned pool falls back to an upgrade of the same rarity
const own = { weapons: Object.keys(M.WEAPONS), talents: { step: 1, exec: 1 }, upgrades: {}, characters: [] };
const y = M.rollReward(own, (() => { const s = [0.46, 0.5]; return () => s.shift(); })());
ok(y.rarity === 'yellow' && M.REWARD_FALLBACK.yellow.includes(y.item), 'yellow with everything owned -> fallback upgrade, got ' + JSON.stringify(y));
// --- profiles survive restart; ids are stable
const st = store(); const p1 = M.loadProfile(st); const p2 = M.loadProfile(st);
ok(/^p_[a-z0-9]{20}$/.test(p1.id) && p1.id === p2.id, 'profile id persists across loads');
ok(JSON.stringify(p1.unlocked) === '["normal"]', 'new profile starts with Normal only');
// --- reward grants are idempotent per claim
ok(M.grantReward(p1, 'run1:1:' + p1.id, 'purple', 'w:thornmaul', { chapter: 1 }) === true, 'first grant applies');
ok(M.grantReward(p1, 'run1:1:' + p1.id, 'purple', 'w:mothfang', { chapter: 1 }) === false, 'duplicate claim ignored');
ok(p1.weapons.length === 1 && p1.weapons[0] === 'thornmaul' && p1.equipped.bramble === 'thornmaul' && p1.rewards.length === 1, 'exactly one reward stored');
M.grantReward(p1, 'run1:2:' + p1.id, null, null, { chapter: 2 });
ok(p1.rewards.length === 2 && p1.rewards[1].item === null, 'no-reward result recorded (so it is not rerolled)');
M.saveProfile(st, p1); const p3 = M.loadProfile(st);
ok(p3.weapons[0] === 'thornmaul' && p3.claims['run1:1:' + p1.id] && p3.rewards.length === 2, 'rewards and claims survive restart');
// --- difficulty unlocks: each full clear unlocks only the next one
const q = M.newProfile();
ok(M.recordCampaignClear(q, 'nightmare', 'r0') === null && q.unlocked.length === 1, 'cannot clear a locked difficulty');
ok(M.recordCampaignClear(q, 'normal', 'r1') === 'nightmare' && JSON.stringify(q.unlocked) === '["normal","nightmare"]', 'Normal clear unlocks Nightmare only');
ok(M.recordCampaignClear(q, 'normal', 'r1') === null && q.cleared.normal === 1, 'same run cannot count twice');
ok(M.recordCampaignClear(q, 'normal', 'r2') === null && q.unlocked.length === 2, 'Normal again unlocks nothing new');
ok(M.recordCampaignClear(q, 'nightmare', 'r3') === 'hell' && M.recordCampaignClear(q, 'hell', 'r4') === 'inferno' && M.recordCampaignClear(q, 'inferno', 'r5') === null, 'chain Nightmare->Hell->Inferno, nothing after');
const st2 = store(); M.saveProfile(st2, q); ok(JSON.stringify(M.loadProfile(st2).unlocked) === '["normal","nightmare","hell","inferno"]', 'unlocks survive restart');
// --- tampered saves and loadouts are repaired / capped
const bad = M.sanitizeProfile({ id: 'p_abcdefgh12', unlocked: ['inferno'], upgrades: { dmg: 9999, hp: -5, bogus: 3 }, weapons: ['nope', 'mothfang'], equipped: { bramble: 'mothfang' }, talents: { keen: 7, fake: 1 } });
ok(JSON.stringify(bad.unlocked) === '["normal","inferno"]', 'unlock list keeps only known ids, Normal always first');
ok(bad.upgrades.dmg === 30 && bad.upgrades.hp === 0 && !('bogus' in bad.upgrades) && bad.weapons.join() === 'mothfang' && !bad.equipped.bramble && bad.talents.keen === 1 && !('fake' in bad.talents), 'caps and validation ' + JSON.stringify(bad));
const lo = M.sanitizeLoadout({ pid: 'p_abcdefgh12', weapon: 'thornmaul', weapons: [], upgrades: { dmg: 500 } }, 'bramble');
ok(lo.weapon === null && lo.upgrades.dmg === 30, 'loadout: unowned weapon dropped, upgrades capped');
// --- backup codes round-trip
const code = M.exportProfile(p3), back = M.importProfile(code);
ok(back && back.id === p3.id && back.weapons[0] === 'thornmaul', 'backup code round trip');
ok(M.importProfile('garbage') === null, 'bad backup code rejected');
console.log((fails ? 'FAILED ' + fails : 'all passed') + ' (' + n + ' checks)'); process.exit(fails ? 1 : 0);
