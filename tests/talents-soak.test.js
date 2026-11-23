// Run: node tests/talents-soak.test.js   (no dependencies; uses tests/sim-harness.js)
const vm = require('vm'); const { makeWorld } = require('./sim-harness.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
for (const hero of ['bramble', 'wick', 'vesper', 'rowan', 'mira', 'vespera']) {
  const w = makeWorld({});
  const r = vm.runInContext(`(() => {
    initAudio = () => {}; PROFILE.characters.push('rowan', 'mira', 'vespera');
    const mk = () => { players = [newPlayer(1, '${hero}', 'T')]; me = players[0]; beginRun('normal'); me.level = 6; me.embers = 99; me.ct = HERO_TALENTS['${hero}'].map(t => t.id); if (me.ct.includes('coven')) me.lanCh = 2; };
    mk(); const errs = []; let frames = 0, maxP = 0, maxZ = 0;
    for (let i = 0; i < 7000; i++) {
      try {
        if (i % 200 === 0) for (let k = 0; k < 7; k++) { const e = spawnEnemy(pick(['husk', 'spitter', 'ram', 'bloat', 'wisp']), me.x + rand(-320, 320), me.y + rand(-320, 320)); e.aggro = true; }
        if (i === 3500) game.time = DAY + 1; // night half
        if (i === 5000) spawnBoss();
        mouse.l = true; const a = i * 0.05; mouse.x = 640 + Math.cos(a) * 200; mouse.y = 360 + Math.sin(a) * 200;
        keys.d = (i % 200) < 100; keys.a = !keys.d;
        if (i % 37 === 0) pressed.e = true; if (i % 53 === 0) pressed[' '] = true; if (i % 400 === 0) pressed.q = true;
        if (me.choice) applyPick(me, 0);
        if (game.over) { if (game.over === 'dead') mk(); else break; }
        update(1 / 60); render();
        for (const k in pressed) delete pressed[k];
        for (const v of [me.x, me.y, me.hp, me.shield, me.barrier, me.ultT, me.dashRe]) if (!Number.isFinite(v)) throw new Error('non-finite player value');
        if (me.shield > 200 || me.barrier > 30.001 || me.dashes > me.dashMax) throw new Error('cap broken: shield ' + me.shield + ' barrier ' + me.barrier + ' dashes ' + me.dashes);
        for (const e of enemies) if (!Number.isFinite(e.x) || !Number.isFinite(e.hp)) throw new Error('non-finite enemy');
        maxP = Math.max(maxP, projs.length); maxZ = Math.max(maxZ, zones.length); frames++;
      } catch (e) { errs.push(e.stack.split('\\n').slice(0, 3).join(' | ')); if (errs.length > 2) break; }
    }
    return { errs, frames, kills: me.kills, maxP, maxZ };
  })()`, w);
  ok(r.errs.length === 0, hero + ' with all 5 talents: ' + r.frames + ' frames, ' + r.kills + ' kills, peak ' + r.maxP + ' projectiles / ' + r.maxZ + ' zones' + (r.errs.length ? ' ERR ' + r.errs.join(' || ') : ''));
}
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
