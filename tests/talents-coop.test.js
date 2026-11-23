// Run: node tests/talents-coop.test.js   (no dependencies; uses tests/sim-harness.js)
const vm = require('vm'); const { makeWorld } = require('./sim-harness.js');
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const run = (w, code) => vm.runInContext(code, w);
const H = makeWorld({}), C = makeWorld({});
const q = [];
const pipe = () => { const w = { onData: null, onClose: null, peer: null, send(d) { q.push([w.peer, JSON.parse(JSON.stringify(d))]); }, close() { } }; return w; };
const hs = pipe(), cs = pipe(); hs.peer = cs; cs.peer = hs; let hostH;
run(H, 'globalThis.__setNetT = v => { NetT = v; }'); run(C, 'globalThis.__setNetT = v => { NetT = v; }');
H.__setNetT({ ok: () => true, host(code, h) { hostH = h; setImmediate(() => h.open()); return { close() { } }; }, join() { } });
C.__setNetT({ ok: () => true, host() { }, join(code, h) { setImmediate(() => { hostH.conn(hs); h.open(cs); }); return { close() { } }; } });
const flush = () => { let n = 0; while (q.length && n++ < 10000) { const [to, d] = q.shift(); to.onData && to.onData(d); } };
run(H, `initAudio = () => {}; net.hero = 'bramble'; hostGame();`);
run(C, `initAudio = () => {}; selectHero('wick'); joinGame('ABCDE');`);
setImmediate(() => setImmediate(() => {
  try {
    flush(); run(H, `startHosted(); world.pois[0].used = true;`); flush();
    // both players' chapter-1 rolls land on a talent reward
    run(H, `const R = Math.random; const s = [0.5, 3.5 / 8, 0.5, 3.5 / 8]; Math.random = () => s.length ? s.shift() : 0.5; game.over = 'win'; chapterComplete(); Math.random = R; sendSnaps();`); flush();
    const pend = run(H, `players.map(p => p.ctPending).join()`);
    ok(pend === '1,1', 'both players earn a pick from their own talent-reward roll (' + pend + ')');
    run(H, `nextChapter(); world.pois[0].used = true; update(1 / 60); sendSnaps();`); flush();
    const offer = run(C, `me.ctChoice ? me.ctChoice.join() : 'none'`);
    ok(offer === 'forked,coven,passage,constellation,midnight', 'guest sees their own hero\'s five talents (' + offer + ')');
    run(C, `syncChoice();`); ok(/Forked Cinders/.test(run(C, `choiceEl.innerHTML`)), 'guest\'s cards rendered');
    // cheating attempts are refused by the host
    run(C, `net.host.send({ t: 'ctpick', id: 'territory', q: me.ctSeq }); net.host.send({ t: 'ctpick', id: 'coven', q: me.ctSeq + 5 });`); flush();
    ok(run(H, `players.find(p => p.id !== 1).ct.length`) === 0, 'host refuses another hero\'s talent and a stale offer');
    // a real pick: effect only after the host accepts
    run(C, `chooseChapterTalent(1);`); const before = run(C, `me.ct.length`); flush();
    const hostSide = run(H, `players.find(p => p.id !== 1).ct.join() + ' ' + players.find(p => p.id !== 1).lanCh`);
    run(H, `sendSnaps();`); flush();
    ok(before === 0 && hostSide === 'coven 2', 'host applies the guest\'s pick (Lantern Coven, 2 charges)');
    ok(run(C, `me.ct.join()`) === 'coven' && !run(C, `me.ctChoice`), 'guest sees it as selected once accepted; offer closed');
    // the host's own offer is independent
    ok(run(H, `!!me.ctChoice && me.ctChoice.length === 5`), 'host still has their own open offer');
    run(H, `applyChapterTalent(me, 'growth', me.ctSeq); sendSnaps();`); flush();
    ok(run(C, `players.find(p => p.id === 1).ct.join()`) === 'growth', 'everyone sees each player\'s picks in snapshots');
    // co-op game keeps running while the cards are open (no pause)
    run(H, `me.ctPending = 1; update(1/60);`); const t0 = run(H, `game.time`); run(H, `tick(5000); tick(5016);`);
    ok(run(H, `game.time`) > t0, 'co-op keeps running while a player chooses');
    // the build panel
    ok(/Lantern Coven/.test(run(C, `buildHtml(me)`)) && /Unstoppable Growth/.test(run(H, `buildHtml(me)`)), 'build panel lists selected talents');
  } catch (e) { fails++; console.log('CRASH', e.stack); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
}));
