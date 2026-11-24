'use strict';
// Game data: heroes, enemies, boons, palettes, clock.
const HEROES = {
  bramble: {
    name: 'Bramble', title: 'The Thorn Warden', color: '#7bc96f', hp: 150, spd: 215, dmg: 15, atkCd: 0.46, skillCd: 7, dashes: 1,
    blurb: 'A walking hedgerow in a bark mask. Slow to anger, impossible to uproot.',
    kit: ['<b>Attack</b> — wide cudgel sweep', '<b>Skill</b> — Briar Ring: thorns burst out, slowing foes', '<b>Dash</b> — Shoulder charge that batters enemies', '<b>Ultimate</b> — Overgrowth: +50% damage, thorn pulses, hits heal', '<b>Trait</b> — Daybloom: regenerates under the sun'],
    names: ['Sweep', 'Briar Ring', 'Charge', 'Overgrowth']
  },
  wick: {
    name: 'Wick', title: 'The Lantern Witch', color: '#ffb347', hp: 95, spd: 225, dmg: 11, atkCd: 0.36, skillCd: 8, dashes: 1,
    blurb: 'She bottled the last honest flame and has been lighting fools on fire ever since.',
    kit: ['<b>Attack</b> — hurls cinder bolts', '<b>Skill</b> — Hang a lantern that scorches the ground', '<b>Dash</b> — Blink, leaving embers behind', '<b>Ultimate</b> — Cinderfall: a rain of burning stars', '<b>Trait</b> — Nightflame: +1 bolt after dark'],
    names: ['Cinder Bolt', 'Lantern', 'Blink', 'Cinderfall']
  },
  vesper: {
    name: 'Vesper', title: 'The Moth Duelist', color: '#cdbcff', hp: 110, spd: 250, dmg: 9, atkCd: 0.24, skillCd: 5, dashes: 2,
    blurb: 'Dust-winged and needle-quick. Drawn to the dark, not the light.',
    kit: ['<b>Attack</b> — rapid twin cuts; every third throws a blade', '<b>Skill</b> — Fan of piercing blades', '<b>Dash</b> — Two charges; cuts through foes', '<b>Ultimate</b> — Eclipse: blink-strike up to 8 enemies', '<b>Trait</b> — Moonlit: +15% crit and speed at night'],
    names: ['Twin Cuts', 'Blade Fan', 'Flit', 'Eclipse']
  },
  // Unlockable heroes. `rarity` names their character reward pool (see RARITY); `alt` heroes cast a second skill
  // from the dash slot (Space / DASH button) instead of dashing; `dashCd` overrides that slot's recharge; `ultTime` (Lumen, id `vespera`) is Midnight Procession's base duration in seconds.
  rowan: {
    name: 'Rowan', title: 'The Thornwarden', color: '#a9c46c', hp: 170, spd: 205, dmg: 14, atkCd: 0.5, skillCd: 9, dashes: 1, dashCd: 14, alt: true, rarity: 'green',
    blurb: 'Bark armour, a moss-heavy cloak and a shield that is still growing. Where Rowan plants a foot, the line holds.',
    kit: ['<b>Attack</b> — Briar Thrust: a long spear jab', '<b>Skill</b> — Root Snare: roots nearby foes in place', '<b>Space</b> — Shelterwood: a grove where allies take 35% less damage', '<b>Ultimate</b> — Ancient Sentinel: become a tree guardian; +35% armour, foes are drawn to you', '<b>Trait</b> — Deep Roots: frontal hits are blocked by the shield (half damage) and store up to 5 charges for the next Root Snare'],
    names: ['Briar Thrust', 'Root Snare', 'Shelterwood', 'Ancient Sentinel']
  },
  mira: {
    name: 'Mira', title: 'The Mirrorblade', color: '#9ee7f2', hp: 100, spd: 245, dmg: 8, atkCd: 0.2, skillCd: 6, dashes: 1, dashCd: 3.2, rarity: 'blue',
    blurb: 'A masked duelist in a coat of cracked mirror. Whatever you think you are fighting, it is not quite her.',
    kit: ['<b>Attack</b> — Shattered Cuts: a fast three-strike dagger combo', '<b>Skill</b> — Mirror Exchange: swap places with your decoy, then shatter it', '<b>Dash</b> — Reflection Step: dash through foes, leaving a decoy that draws them', '<b>Ultimate</b> — Hall of Mirrors: three reflections repeat your cuts at 40% damage', '<b>Trait</b> — Blind Spot: +40% damage to foes distracted by an ally or decoy'],
    names: ['Shattered Cuts', 'Mirror Exchange', 'Reflection Step', 'Hall of Mirrors']
  },
  vespera: {
    name: 'Lumen', title: 'The Lanternkeeper', color: '#86f0cf', hp: 100, spd: 225, dmg: 12, atkCd: 0.38, skillCd: 10, dashes: 1, dashCd: 12, alt: true, rarity: 'purple', ultTime: 10,
    blurb: 'A cloaked traveller swinging a haunted lantern on a chain. The lost follow her light; so does everything else.',
    kit: ['<b>Attack</b> — Ghostlight: a spectral bolt', '<b>Skill</b> — Guiding Wisp: shield the ally nearest your aim (yourself when solo). 30 energy', '<b>Space</b> — Soul Tether: link up to 4 foes; 40% of direct damage to one spreads to the rest. 30 energy', '<b>Ultimate</b> — Midnight Procession: spirits set out toward your aim and hunt down the nearest foes, harming them and healing allies they pass', '<b>Trait</b> — Lingering Light: the fallen leave embers that restore lantern energy'],
    names: ['Ghostlight', 'Guiding Wisp', 'Soul Tether', 'Midnight Procession']
  }
};
// Character reward pools. Completing chapter `chapter` puts the pool's heroes into the reward roll, starting with that
// completion. Each completion is one roll: the rarest eligible locked hero whose `chance` beats the roll is unlocked.
// Unlockable heroes' reward tier and the first chapter they can be won from. They are won through the single
// chapter reward roll in meta.js (REWARD_POOLS); `chance` is unused (kept from the earlier separate roll).
const RARITY = {
  green: { name: 'Green', color: '#6fdc7a', chance: 0.6, chapter: 1 },
  blue: { name: 'Blue', color: '#6fb6ff', chance: 0.35, chapter: 2 },
  purple: { name: 'Purple', color: '#c38bff', chance: 0.2, chapter: 3 }
};
const LANTERN_MAX = 100, LANTERN_COST = 30;
const ET = {
  husk: { r: 14, hp: 34, spd: 108, dmg: 9, xp: 5 },
  spitter: { r: 13, hp: 24, spd: 82, dmg: 8, xp: 6 },
  ram: { r: 18, hp: 62, spd: 74, dmg: 16, xp: 10 },
  bloat: { r: 16, hp: 28, spd: 128, dmg: 22, xp: 7 },
  wisp: { r: 9, hp: 10, spd: 172, dmg: 5, xp: 2 },
  boss: { r: 46, hp: 1500, spd: 120, dmg: 24, xp: 150 }, // chapter bosses override these (bosses.js BOSSES)
  // boss arena objects (bosses.js): health and damage are set when they appear
  sapling: { r: 14, hp: 1, spd: 0, dmg: 0, xp: 0 }, orb: { r: 18, hp: 1, spd: 0, dmg: 0, xp: 0 }, vcore: { r: 16, hp: 1, spd: 0, dmg: 0, xp: 0 },
  pillar: { r: 18, hp: 1, spd: 0, dmg: 0, xp: 0 }, split: { r: 26, hp: 1, spd: 110, dmg: 0, xp: 0 }, mask: { r: 20, hp: 1, spd: 0, dmg: 0, xp: 0 },
  cage: { r: 24, hp: 1, spd: 0, dmg: 0, xp: 0 }, bind: { r: 20, hp: 1, spd: 0, dmg: 0, xp: 0 }, rod: { r: 10, hp: 1, spd: 0, dmg: 0, xp: 0 }, brazier: { r: 18, hp: 1, spd: 0, dmg: 0, xp: 0 }
};
const TALENTS = [
  { id: 'keen', name: 'Keen Edge', desc: '+15% damage.', max: 5, f: p => p.dmgMul += 0.15 },
  { id: 'quick', name: 'Quick Hands', desc: '+12% attack speed.', max: 5, f: p => p.asMul += 0.12 },
  { id: 'fleet', name: 'Fleet Foot', desc: '+8% movement speed.', max: 3, f: p => p.spdMul += 0.08 },
  { id: 'hearty', name: 'Hearty', desc: '+25 max health and heal 25.', max: 5, f: p => { p.maxHp += 25; heal(p, 25); } },
  { id: 'eye', name: 'Sharp Eye', desc: '+10% critical chance.', max: 4, f: p => p.crit += 0.10 },
  { id: 'cruel', name: 'Cruel Twist', desc: '+40% critical damage.', max: 3, f: p => p.critMul += 0.4 },
  { id: 'leech', name: 'Sapdrinker', desc: 'Heal for 3% of damage dealt.', max: 3, f: p => p.lifesteal += 0.03 },
  { id: 'bark', name: 'Ironbark', desc: 'Take 10% less damage.', max: 4, f: p => p.armor += 0.10 },
  { id: 'tinker', name: 'Restless', desc: 'Cooldowns recover 12% faster.', max: 4, f: p => p.cdr *= 0.88 },
  { id: 'magnet', name: 'Magpie', desc: '+60% pickup radius, +15% experience.', max: 2, f: p => { p.pickR *= 1.6; p.xpMul += 0.15; } },
  { id: 'step', dash: true, name: 'Second Step', desc: '+1 dash charge.', max: 1, f: p => { p.dashMax++; p.dashes++; } },
  { id: 'nightborn', name: 'Nightborn', desc: '+20% damage after dark.', max: 3, f: p => p.nightDmg += 0.2 },
  { id: 'sun', name: 'Sunkissed', desc: 'Regenerate 1.2 health per second by day.', max: 3, f: p => p.dayRegen += 1.2 },
  { id: 'spite', name: 'Spite', desc: 'When struck, lash out at everything nearby.', max: 3, f: p => p.spite++ },
  { id: 'chain', name: 'Stormtongue', desc: 'Hits have a 20% chance to arc to 2 nearby foes.', max: 3, f: p => p.chain++ },
  { id: 'venom', name: 'Nettle Venom', desc: 'Hits poison for 5 damage/sec over 3s.', max: 3, f: p => p.venom++ },
  { id: 'exec', name: 'Mercy Stroke', desc: '+30% damage to foes below 30% health.', max: 3, f: p => p.exec += 0.3 },
  { id: 'ember', name: 'Banked Ember', desc: '+1 Ember (revives you on death).', max: 2, f: p => p.embers++ },
  { id: 'wide', hero: 'bramble', name: 'Long Bough', desc: 'Sweep reach +30%.', max: 2, f: p => p.h.wide = (p.h.wide || 0) + 1 },
  { id: 'ring', hero: 'bramble', name: 'Barbed Ring', desc: 'Briar Ring: +50% damage, +20% radius.', max: 3, f: p => p.h.ring = (p.h.ring || 0) + 1 },
  { id: 'bulwark', hero: 'bramble', name: 'Bulwark', desc: 'Charge heals 4 per enemy struck.', max: 2, f: p => p.h.bulwark = (p.h.bulwark || 0) + 1 },
  { id: 'fork', hero: 'wick', name: 'Forked Flame', desc: '+1 cinder bolt per cast.', max: 2, f: p => p.h.fork = (p.h.fork || 0) + 1 },
  { id: 'pierce', hero: 'wick', name: 'White Heat', desc: 'Bolts pierce +1 enemy.', max: 3, f: p => p.h.pierce = (p.h.pierce || 0) + 1 },
  { id: 'lantern', hero: 'wick', name: 'Great Lantern', desc: 'Lantern: +25% radius, +2s duration.', max: 2, f: p => p.h.lantern = (p.h.lantern || 0) + 1 },
  { id: 'fan', hero: 'vesper', name: 'Blade Storm', desc: 'Blade Fan throws +2 blades.', max: 3, f: p => p.h.fan = (p.h.fan || 0) + 1 },
  { id: 'ghost', hero: 'vesper', name: 'Ghoststep', desc: 'Dash damage doubled; kills refund a dash.', max: 1, f: p => p.h.ghost = 1 },
  { id: 'lunar', hero: 'vesper', name: 'Lunar Edge', desc: 'Cut reach +15%, +20% critical damage.', max: 2, f: p => { p.h.lunar = (p.h.lunar || 0) + 1; p.critMul += 0.2; } },
  { id: 'thicket', hero: 'rowan', name: 'Thicket', desc: 'Shelterwood: +25% radius, +2s duration.', max: 2, f: p => p.h.thicket = (p.h.thicket || 0) + 1 },
  { id: 'taproot', hero: 'rowan', name: 'Taproot', desc: 'Root Snare roots 0.5s longer and deals +40% damage.', max: 2, f: p => p.h.taproot = (p.h.taproot || 0) + 1 },
  { id: 'facets', hero: 'mira', name: 'Many Facets', desc: 'Decoys last +2s; their shatter deals +40% damage.', max: 2, f: p => p.h.facets = (p.h.facets || 0) + 1 },
  { id: 'glint', hero: 'mira', name: 'Cold Glint', desc: 'Blind Spot bonus +20%.', max: 2, f: p => p.h.glint = (p.h.glint || 0) + 1 },
  { id: 'deepwick', hero: 'vespera', name: 'Deep Wick', desc: '+25 maximum lantern energy, +1 energy per second.', max: 2, f: p => { p.h.deepwick = (p.h.deepwick || 0) + 1; p.lanMax += 25; } },
  { id: 'kindred', hero: 'vespera', name: 'Kindred Flame', desc: 'Guiding Wisp shields are 50% stronger.', max: 2, f: p => p.h.kindred = (p.h.kindred || 0) + 1 }
];
const PAL = [
  { name: 'The Thornwood', base: '#2f4a33', spk: ['#3a5a3c', '#284029', '#466b45'], tree: ['#1c3522', '#2a4f31', '#3a6a40'], rock: '#6b7078' },
  { name: 'The Drowned Mire', base: '#27404a', spk: ['#31525a', '#1f343c', '#3f6a66'], tree: ['#1f3040', '#2c4c5a', '#467478'], rock: '#5a5f73' },
  { name: 'The Ashen Reach', base: '#43322f', spk: ['#54403a', '#352624', '#6a4a3c'], tree: ['#251a1a', '#472823', '#70392a'], rock: '#7a6c62' },
  // Chapters 4-5: PLACEHOLDER biomes. New palettes only; they reuse the existing enemies and the Gloam Stag boss.
  { name: 'The Storm Heights', placeholder: true, base: '#2e3148', spk: ['#3b3f5c', '#232638', '#4b4f72'], tree: ['#1d2033', '#2f3350', '#4a4f78'], rock: '#8a8fa8' },
  { name: 'The Ember Court', placeholder: true, base: '#46261f', spk: ['#5a3026', '#331a15', '#6e3a28'], tree: ['#2a1410', '#4a2218', '#7a3420'], rock: '#7a6258' }
];
const DAY = 65, NIGHT = 45, CYCLE = DAY + NIGHT, DAYS = 3, TOTAL = CYCLE * DAYS;
// Unsealing the boss early: a living player must stand inside the altar ring (UNSEAL_RADIUS) for UNSEAL_TIME seconds.
// Progress drains at UNSEAL_DRAIN x speed while nobody stands in the ring.
const UNSEAL_TIME = 5, UNSEAL_RADIUS = 58, UNSEAL_DRAIN = 1.5;


// ---------- chapter talents ----------
// Five per hero. A player picks ONE when they earn a chapter talent choice (when that happens is set by
// CHAPTER_TALENT in meta.js) and keeps it for the rest of the run, like boons; nothing is saved to the profile.
// `ab`: the abilities it changes (shown on the card). `v`: every tunable number of the effect (initial balance).
const HERO_TALENTS = {
  bramble: [
    { id: 'splinter', name: 'Splintering Impact', ab: ['Sweep'], desc: 'A foe your Sweep knocks into a wall or another foe sets off a small thorn explosion.', limits: 'One explosion per foe per Sweep. Explosions never cause more explosions.', v: { window: 0.35, radius: 70, dmg: 0.6 } },
    { id: 'territory', name: 'Briar Territory', ab: ['Briar Ring'], desc: 'Briar Ring leaves a thorn field for 4 s that damages and slows foes inside it.', limits: 'Damages every 0.5 s. Bosses are slowed for less time.', v: { life: 4, radius: 0.85, tick: 0.5, dmg: 0.35, slow: 0.8 } },
    { id: 'rampart', name: 'Living Rampart', ab: ['Charge'], desc: 'Each foe your Charge strikes gives you a small shield. Charging into a caged or bound ally breaks them free.', limits: '+8 shield per foe, at most 30 shield from this talent. Shield lasts 6 s.', v: { per: 8, cap: 30, time: 6 } },
    { id: 'growth', name: 'Unstoppable Growth', ab: ['Overgrowth'], desc: 'Each Sweep that hits during Overgrowth extends it by 0.5 s.', limits: 'Up to +3 s per Overgrowth (11 s in all). Thorn pulses and other effects do not extend it.', v: { per: 0.5, max: 3 } },
    { id: 'sunseed', name: 'Sunseed Reserve', ab: ['Daybloom'], desc: 'At full health, Daybloom’s healing builds a barrier instead. The barrier stays after nightfall.', limits: 'Barrier holds at most 30.', v: { cap: 30 } }
  ],
  wick: [
    { id: 'forked', name: 'Forked Cinders', ab: ['Cinder Bolt'], desc: 'A Cinder Bolt’s first hit throws two weaker sparks at two other nearby foes.', limits: 'Sparks never split. At most 4 sparks per attack, night bolts included.', v: { n: 2, cap: 4, dmg: 0.4, range: 260 } },
    { id: 'coven', name: 'Lantern Coven', ab: ['Lantern'], desc: 'Lantern has two charges and two can burn at once, joined by a burning thread that hurts foes crossing it.', limits: 'Two lanterns at most (a third replaces the oldest). Thread damages every 0.5 s.', v: { charges: 2, recharge: 8, tick: 0.5, dmg: 0.5, width: 18, maxLen: 650 } },
    { id: 'passage', name: 'Ember Passage', ab: ['Blink'], desc: 'Blink leaves a burning trail between where you left and where you land. Allies crossing it move faster.', limits: 'Trail lasts 3 s. Speed +25% for 1.5 s; crossing again refreshes it, never stacks.', v: { life: 3, tick: 0.5, dmg: 0.4, width: 26, haste: 0.25, hasteT: 1.5 } },
    { id: 'constellation', name: 'Falling Constellation', ab: ['Cinderfall', 'Lantern'], desc: 'Cinderfall’s last star detonates your lanterns inside its area, consuming them in a burst of fire.', limits: 'Only your own lanterns; each detonates once.', v: { reach: 300, dmg: 3 } },
    { id: 'midnight', name: 'Borrowed Midnight', ab: ['Blink', 'Nightflame'], desc: 'By day, Blink turns on Nightflame’s extra bolt for 5 s. At night, Blink makes your next attack’s extra bolt home in on a foe.', limits: 'Blinking again refreshes it; never more than one extra bolt.', v: { time: 5, turn: 6, range: 420 } }
  ],
  vesper: [
    { id: 'returning', name: 'Returning Edge', ab: ['Twin Cuts'], desc: 'The blade thrown on every third attack flies back to you, cutting again at reduced damage.', limits: 'Each foe is hit at most once going out and once coming back. Returning blades don’t count as attacks.', v: { dmg: 0.6, speed: 760 } },
    { id: 'silk', name: 'Silken Crossfire', ab: ['Blade Fan'], desc: 'Blade Fan leaves silk trails for 3 s that slow foes crossing them.', limits: 'At most 14 trails at once. Bosses are slowed for less time.', v: { life: 3, len: 440, width: 16, slow: 0.7, cap: 14 } },
    { id: 'wingbeat', name: 'Wingbeat Riposte', ab: ['Flit', 'Twin Cuts'], desc: 'Flitting through a foe empowers your next attack to throw an extra piercing blade.', limits: 'Stores one empowered attack. The extra blade doesn’t count as an attack.', v: { dmg: 1.3 } },
    { id: 'total', name: 'Total Eclipse', ab: ['Eclipse'], desc: 'Eclipse always strikes 8 times while foes remain, finding new targets when one falls. Repeat strikes on a foe deal reduced damage.', limits: '8 strikes at most. Ends if no foes are left.', v: { strikes: 8, repeat: 0.6, range: 520 } },
    { id: 'lunar', name: 'Lunar Rhythm', ab: ['Moonlit', 'Flit'], desc: 'At night your critical hits speed up Flit’s recharge by 0.5 s. By day, every third attack does instead.', limits: 'At most once per second. Never more than two Flit charges.', v: { cut: 0.5, cd: 1 } }
  ],
  rowan: [
    { id: 'reprisal', name: 'Thorn Reprisal', ab: ['Deep Roots', 'Briar Thrust'], desc: 'Blocking a hit empowers your next attack to send out a piercing wave of roots.', limits: 'Stores one empowered attack. The wave can’t empower another.', v: { dmg: 1.2, speed: 520, life: 0.6 } },
    { id: 'grove', name: 'Walking Grove', ab: ['Shelterwood'], desc: 'Shelterwood moves with you instead of staying put, with a smaller radius.', limits: 'Radius 70% of normal.', v: { radius: 0.7 } },
    { id: 'spreading', name: 'Spreading Roots', ab: ['Root Snare'], desc: 'When a rooted foe dies, its roots spread to up to two nearby foes.', limits: 'Once per Root Snare. Spread roots don’t spread again. Bosses are rooted for less time.', v: { n: 2, range: 220, time: 1.5 } },
    { id: 'heartwood', name: 'Heartwood Bond', ab: ['Deep Roots'], desc: 'Reaching full Deep Roots charges shields the most wounded nearby ally, or you if no ally is near.', limits: '25 shield for 6 s. Once every 8 s.', v: { shield: 25, time: 6, cd: 8, range: 450 } },
    { id: 'aftergrowth', name: 'Ancient Aftergrowth', ab: ['Ancient Sentinel'], desc: 'When Ancient Sentinel ends, a sapling grows for 6 s that heals nearby allies, you included, and reduces the damage they take.', limits: 'Heals every 0.5 s. Damage reduction 15% (doesn’t stack with Shelterwood; the stronger applies).', v: { life: 6, radius: 130, tick: 0.5, heal: 2, healPct: 0.015, dr: 0.15 } }
  ],
  mira: [
    { id: 'echoing', name: 'Echoing Step', ab: ['Reflection Step'], desc: 'Your decoy repeats one Shattered Cuts combo at reduced damage.', limits: 'Copied cuts can’t make decoys or more copies.', v: { dmg: 0.4, gap: 0.25, range: 110 } },
    { id: 'relay', name: 'Mirror Relay', ab: ['Mirror Exchange'], desc: 'Mirror Exchange leaves a second reflection, allowing one more swap before it fades.', limits: 'Two swaps at most in a row. The second reflection lasts 3 s.', v: { life: 3 } },
    { id: 'splintered', name: 'Splintered Edge', ab: ['Blind Spot'], desc: 'Blind Spot hits make foes bleed.', limits: 'Up to 3 stacks for 3 s. Bleeding can’t add stacks.', v: { stacks: 3, time: 3, tick: 0.5, dmg: 0.12 } },
    { id: 'opening', name: 'Shared Opening', ab: ['Mirror Exchange'], desc: 'Shattering a decoy marks nearby foes. A teammate’s next hit on a marked foe deals extra damage (your own, when playing solo).', limits: '+30% once per mark. Marks last 6 s.', v: { bonus: 0.3, time: 6 } },
    { id: 'curtain', name: 'Final Curtain', ab: ['Hall of Mirrors'], desc: 'When Hall of Mirrors ends, each reflection bursts into glass shards.', limits: 'Each reflection bursts once, only when the ultimate runs out.', v: { radius: 90, dmg: 2 } }
  ],
  vespera: [
    { id: 'wandering', name: 'Wandering Flame', ab: ['Ghostlight'], desc: 'Ghostlight passes through its first target and hits one more foe at reduced damage.', limits: 'Never hits the same foe twice.', v: { dmg: 0.6 } },
    { id: 'merciful', name: 'Merciful Wisp', ab: ['Guiding Wisp'], desc: 'When a Guiding Wisp shield runs out, half of what’s left heals the protected player.', limits: 'Only when it expires on its own; a used-up shield heals nothing.', v: { pct: 0.5 } },
    { id: 'succession', name: 'Soul Succession', ab: ['Soul Tether'], desc: 'When a tethered foe dies, its link passes to another nearby foe for the time left.', limits: 'Once per Soul Tether. Shared damage still never spreads again.', v: { range: 260 } },
    { id: 'communion', name: 'Ember Communion', ab: ['Lingering Light'], desc: 'Collecting an ember also releases a small healing pulse for you and nearby allies.', limits: 'Each ember heals once. Energy is restored as usual.', v: { radius: 170, heal: 3, healPct: 0.02 } },
    { id: 'rprocession', name: 'Returning Procession', ab: ['Midnight Procession'], desc: 'Midnight Procession comes back along its path for a second, weaker pass of damage and healing.', limits: 'Half strength on the way back; each foe is hit at most 3 times on it. Comes back only once.', v: { str: 0.5, hits: 3, step: 0.2 } }
  ]
};
const heroTalent = (hero, id) => (HERO_TALENTS[hero] || []).find(t => t.id === id) || null;
