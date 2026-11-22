// PeerJS build (GitHub Pages): co-op over the PeerJS transport, and resilience to the error events real PeerJS
// sends after players are connected (signalling server lost, a voice call failing). Uses tests/e2e/fake-peer.js.
// Run: sh build.sh <peerjs.min.js> && node tests/e2e/peer.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker(), H = await launch();
  const opt = { build: 'duskbound.html', fake: 'fake-peer.js' };
  const A = await H.player('Ann', opt), B = await H.player('Ben', opt);
  await H.hostAndJoin(A, B);
  ok(await B.evaluate(() => net.mode === 'client' && game.state === 'lobby' && net.lobby.length === 2), 'guest joined the lobby over PeerJS');
  await A.click('#start'); await B.waitForFunction(() => game.state === 'play' && me && world, null, { timeout: 15000 });
  ok(true, 'game started for the guest');
  // what real PeerJS can emit mid-game
  for (const t of ['disconnected', 'peer-unavailable', 'network', 'webrtc', 'server-error']) {
    await B.evaluate(t => { const p = net.handle.peer; if (t === 'disconnected') p.emit('disconnected'); else p.emit('error', { type: t }); }, t);
    await A.evaluate(t => { const p = net.handle.peer; if (t === 'disconnected') p.emit('disconnected'); else p.emit('error', { type: t }); }, t);
  }
  await B.waitForTimeout(1500);
  ok(await B.evaluate(() => game.state === 'play' && net.mode === 'client' && !!net.host), 'guest still in the game after server-lost / call-failed errors');
  ok(await A.evaluate(() => game.state === 'play' && net.mode === 'host' && net.conns.length === 1), 'host still hosting with the guest connected');
  const t0 = await B.evaluate(() => game.time); await B.waitForTimeout(800);
  ok((await B.evaluate(() => game.time)) > t0, 'snapshots keep arriving');
  await A.evaluate(() => { game.winT = 0.001; }); await B.waitForFunction(() => game.over && game.rewards, null, { timeout: 8000 }).catch(() => { });
  ok(await B.evaluate(() => PROFILE.rewards.length) === 1, 'chapter reward still reaches the guest');
  // a join attempt to a room that doesn't exist fails with a clear message
  const C = await H.player('Cat', opt); await C.fill('#code', 'ZZZZZ'); await C.click('#joinb');
  await C.waitForFunction(() => game.state === 'menu' && $('msg') && $('msg').textContent, null, { timeout: 30000 });
  ok(/ZZZZZ|reach/.test(await C.textContent('#msg')), 'unknown room code: clear message (' + await C.textContent('#msg') + ')');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
