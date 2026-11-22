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
  // from the dash slot (Space / DASH button) instead of dashing; `dashCd` overrides that slot's recharge.
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
    name: 'Vespera', title: 'The Lanternkeeper', color: '#86f0cf', hp: 100, spd: 225, dmg: 12, atkCd: 0.38, skillCd: 10, dashes: 1, dashCd: 12, alt: true, rarity: 'purple',
    blurb: 'A cloaked traveller swinging a haunted lantern on a chain. The lost follow her light; so does everything else.',
    kit: ['<b>Attack</b> — Ghostlight: a spectral bolt', '<b>Skill</b> — Guiding Wisp: shield the ally nearest your aim (yourself when solo). 30 energy', '<b>Space</b> — Soul Tether: link up to 4 foes; 40% of direct damage to one spreads to the rest. 30 energy', '<b>Ultimate</b> — Midnight Procession: spirits march toward your aim, harming foes and healing allies', '<b>Trait</b> — Lingering Light: the fallen leave embers that restore lantern energy'],
    names: ['Ghostlight', 'Guiding Wisp', 'Soul Tether', 'Midnight Procession']
  }
};
// Character reward pools. Completing chapter `chapter` puts the pool's heroes into the reward roll, starting with that
// completion. Each completion is one roll: the rarest eligible locked hero whose `chance` beats the roll is unlocked.
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
  boss: { r: 46, hp: 1500, spd: 120, dmg: 24, xp: 150 }
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
  { name: 'The Ashen Reach', base: '#43322f', spk: ['#54403a', '#352624', '#6a4a3c'], tree: ['#251a1a', '#472823', '#70392a'], rock: '#7a6c62' }
];
const DAY = 65, NIGHT = 45, CYCLE = DAY + NIGHT, DAYS = 3, TOTAL = CYCLE * DAYS;

