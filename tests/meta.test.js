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

// --- odds: total 100% (45/30/15/7/3), no 'no reward' share
const { sum, none } = M.checkOdds();
ok(sum === 10000 && none === 0, 'odds total exactly 10000 bp (100%), no "no reward" share');
const pct = Object.fromEntries(M.REWARD_ODDS.map(([r, bp]) => [r, bp / 100]));
ok(pct.green === 45 && pct.blue === 30 && pct.purple === 15 && pct.yellow === 7 && pct.red === 3, 'exact table 45/30/15/7/3');
// --- roll boundaries (one draw 0..9999)
const B = [[0, 'green'], [4499, 'green'], [4500, 'blue'], [7499, 'blue'], [7500, 'purple'], [8999, 'purple'], [9000, 'yellow'], [9699, 'yellow'], [9700, 'red'], [9999, 'red']];
for (const [x, want] of B) ok(M.rarityFor(x) === want, 'boundary ' + x + ' -> ' + want);
// exhaustive count over every draw
const count = {}; for (let x = 0; x < 10000; x++) { const r = M.rarityFor(x) || 'none'; count[r] = (count[r] || 0) + 1; }
ok(count.green === 4500 && count.blue === 3000 && count.purple === 1500 && count.yellow === 700 && count.red === 300 && !count.none, 'exhaustive draw counts ' + JSON.stringify(count));
// rng edge: 0 and just under 1
ok(M.rollRarity(() => 0) === 'green' && M.rollRarity(() => 0.9999999) === 'red', 'rng edges');
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
const y = M.rollReward(own, (() => { const s = [0.95, 0.5]; return () => s.shift(); })());
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
// --- unlockable heroes are character rewards inside the single roll, gated by their first chapter
ok(M.REWARD_POOLS.green.includes('c:rowan') && M.REWARD_POOLS.blue.includes('c:mira') && M.REWARD_POOLS.purple.includes('c:vespera'), 'heroes sit in the Green/Blue/Purple pools');
const ci = ch => ({ weapons: [], talents: {}, upgrades: {}, characters: [], chapter: ch });
ok(M.itemAvailable('c:rowan', ci(1)) && !M.itemAvailable('c:mira', ci(1)) && M.itemAvailable('c:mira', ci(2)) && !M.itemAvailable('c:vespera', ci(2)) && M.itemAvailable('c:vespera', ci(3)), 'each hero only from its first chapter (Rowan 1, Mira 2, Vespera 3)');
ok(!M.itemAvailable('c:rowan', { ...ci(5), characters: ['rowan'] }) && !M.itemAvailable('c:nobody', ci(5)), 'owned or unknown heroes are never offered');
{ let got = null; for (let i = 0; i < 400 && got !== 'c:rowan'; i++) got = M.rollReward(ci(1), (() => { const s = [0.1, Math.random()]; return () => s.shift(); })()).item; ok(got === 'c:rowan', 'a Green roll can award Rowan'); }
const hp = M.newProfile(); M.grantReward(hp, 'r:1:' + hp.id, 'green', 'c:rowan', { chapter: 1 });
ok(hp.characters.includes('rowan') && M.itemLabel('c:rowan') === 'Character: Rowan', 'hero reward unlocks the character for the profile');
ok(M.sanitizeProfile({ ...hp }).characters.includes('rowan'), 'unlocked hero survives a reload');
// --- online profiles: merging this device's profile with the online copy never loses progress
{
  const A = M.newProfile(), B = M.newProfile();
  M.grantReward(A, 'ra:1:' + A.id, 'green', 'u:hp:4', { chapter: 1 }); M.grantReward(A, 'ra:2:' + A.id, 'green', 'c:rowan', { chapter: 2 });
  M.grantReward(B, 'rb:1:' + B.id, 'green', 'u:hp:4', { chapter: 1 }); M.grantReward(B, 'rb:2:' + B.id, 'purple', 'w:thornmaul', { chapter: 2 });
  M.recordCampaignClear(B, 'normal', 'runB');
  const m = M.mergeProfiles(A, B);
  ok(m.id === B.id, 'merge keeps the id of the online copy');
  ok(m.upgrades.hp === 8, 'upgrades earned on two devices both count (' + m.upgrades.hp + ')');
  ok(m.characters.includes('rowan') && m.weapons.includes('thornmaul') && m.unlocked.includes('nightmare') && m.cleared.normal === 1, 'characters, weapons, difficulties and clears combine');
  ok(m.rewards.length === 4 && ['ra:1:' + A.id, 'ra:2:' + A.id, 'rb:1:' + B.id, 'rb:2:' + B.id].every(c => m.claims[c]), 'reward history and claims combine');
  const again = M.mergeProfiles(m, m);
  ok(again.upgrades.hp === 8 && again.rewards.length === 4, 'merging an already merged profile changes nothing (no double counting)');
  const m2 = M.mergeProfiles(A, m);
  ok(m2.upgrades.hp === 8 && m2.characters.includes('rowan'), 'syncing the first device again adds nothing twice');
  ok(M.mergeProfiles(A, null).id === A.id && M.mergeProfiles(A, { junk: 1 }).id === A.id, 'no or unreadable online copy: keep the profile on this device');
  const capped = M.newProfile(); capped.upgrades.hp = 60; const c2 = M.newProfile(); M.grantReward(c2, 'x:1:' + c2.id, 'red', 'u:hp:20', { chapter: 1 });
  ok(M.mergeProfiles(c2, capped).upgrades.hp === 60, 'merged upgrades stay within their cap');
  const old = M.newProfile(); old.upgrades.dmg = 10; // earned long ago, no longer in the 60-entry history
  ok(M.mergeProfiles(old, M.newProfile()).upgrades.dmg === 10, 'upgrades older than the reward history are not lost');
}
// --- chapter talents: when a pick is earned (policy is an unresolved design decision; default must not add a reward)
ok(M.CHAPTER_TALENT.policy === 'every' && M.CHAPTER_TALENT.cards === 3, 'a pick of 3 cards after every chapter');
ok(M.CHAPTER_REWARDS.roll === false, 'chapter reward rolls are switched off');
ok(M.earnsChapterTalent('t:keen', 1, 'reward') && M.earnsChapterTalent('t:exec', 4, 'reward'), '(reward policy) a roll landing on a talent reward earns a pick');
ok(!M.earnsChapterTalent('u:hp:4', 1, 'reward') && !M.earnsChapterTalent('w:thornmaul', 2, 'reward') && !M.earnsChapterTalent('c:rowan', 1, 'reward') && !M.earnsChapterTalent(null, 1, 'reward') && M.earnsChapterTalent(null, 1), '(reward policy) other rewards (or none) earn no pick');
ok(!M.earnsChapterTalent('t:keen', M.CHAPTERS) && !M.earnsChapterTalent('t:keen', 0), 'never after the final chapter');
ok(M.earnsChapterTalent('u:hp:4', 3, 'every') && !M.earnsChapterTalent('t:keen', 3, 'off'), 'the "every" and "off" settings');
{ const inv = { weapons: [], talents: {}, upgrades: {}, characters: [], chapter: 2 }; let picks = 0, rolls = 0; for (let i = 0; i < 4000; i++) { const r = M.rollReward(inv); rolls++; if (M.earnsChapterTalent(r.item, 2, 'reward')) picks++; } ok(rolls === 4000 && picks > 0 && picks < rolls, 'picks ride on the existing single roll (one reward per roll, ' + (100 * picks / rolls).toFixed(1) + '% of rolls)'); }
console.log((fails ? 'FAILED ' + fails : 'all passed') + ' (' + n + ' checks)'); process.exit(fails ? 1 : 0);
