// End-to-end voice chat with three players (separate browsers, fake microphones that play a test tone).
// Uses the PeerJS build with tests/e2e/fake-peer.js: real WebRTC audio, signalling relayed by the test runner.
// Run: sh build.sh <peerjs.min.js> && node tests/e2e/voice.test.js
const { launch, checker } = require('./harness');
(async () => {
  const ok = checker();
  const H = await launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const opt = { build: 'duskbound.html', fake: 'fake-peer.js', contextOptions: { permissions: ['microphone'] } };
  const A = await H.player('Ann', opt), B = await H.player('Ben', opt), C = await H.player('Cat', opt);
  await H.hostAndJoin(A, B, C);
  const allConnected = P => P.waitForFunction(() => Voice.calls.size === 2 && [...Voice.calls.values()].every(v => v.stream && v.gain), null, { timeout: 20000 }).then(() => true, () => false);
  ok(await allConnected(A) && await allConnected(B) && await allConnected(C), 'lobby: every player has a voice call with both others (3-way mesh)');
  ok(await A.evaluate(() => [...Voice.calls.keys()].sort().join()) === '2,3' && await C.evaluate(() => [...Voice.calls.keys()].sort().join()) === '1,2', 'calls map to the right players');
  // Peak level heard from player `pid` over a window (the fake mic beeps about once a second).
  const peak = (P, pid, ms = 2600) => P.evaluate(async ([pid, ms]) => { let m = 0; const t0 = performance.now(); while (performance.now() - t0 < ms) { m = Math.max(m, Voice.level(pid)); await new Promise(r => setTimeout(r, 30)); } return m; }, [pid, ms]);
  ok(await peak(B, 1) < 0.005, 'nobody has a mic on yet: silence (' + (await peak(B, 1, 1200)).toFixed(4) + ')');
  for (const P of [A, B, C]) ok(await P.evaluate(() => Voice.enableMic()), 'microphone turned on (' + await P.evaluate(() => net.name) + ')');
  await A.evaluate(() => Voice.setMode('open')); await C.evaluate(() => Voice.setMode('open')); // Ben stays on push-to-talk
  const hearsA = await peak(B, 1); ok(hearsA > 0.02, 'Ben hears Ann (open mic), level ' + hearsA.toFixed(3));
  ok(await peak(C, 1) > 0.02, 'Cat hears Ann too');
  ok(await peak(A, 2) < 0.005, 'push-to-talk: Ben is silent while not holding the key');
  await B.keyboard.down('v'); const ptt = await peak(A, 2); await B.keyboard.up('v');
  ok(ptt > 0.02, 'push-to-talk: Ann hears Ben while he holds V, level ' + ptt.toFixed(3));
  ok(await peak(A, 2, 1200) < 0.005, 'push-to-talk: silent again after releasing V');
  // individual mute / volume (Ann's controls for Cat only)
  await A.evaluate(() => Voice.setMuted(3, true)); await A.waitForTimeout(200); // let audio already in flight drain
  const muted = await peak(A, 3); ok(muted === 0, 'Ann mutes Cat: nothing from Cat (level ' + muted + ')');
  ok(await peak(B, 3) > 0.02, '…while Ben still hears Cat (mute is per listener)');
  await A.evaluate(() => Voice.setMuted(3, false)); await A.evaluate(() => Voice.setVolume(3, 0.5)); await A.waitForTimeout(200);
  const half = await A.evaluate(() => Math.round(Voice.calls.get(3).gain.gain.value * 1000) / 1000), heardHalf = await peak(A, 3);
  ok(half === 0.5 && heardHalf > 0.01, 'volume 50% applied to Cat only (gain ' + half + ', level ' + heardHalf.toFixed(3) + ')');
  ok(await A.evaluate(() => Math.round(Voice.calls.get(2).gain.gain.value * 1000) / 1000) === 1, 'Ben’s volume unchanged');
  ok(await A.evaluate(() => JSON.parse(localStorage.getItem('duskbound-voice')).vols['3']) === 0.5, 'volume preference saved');
  // microphone selection
  const devs = await A.evaluate(async () => (await Voice.devices()).map(d => d.deviceId));
  ok(devs.length >= 1, 'microphone list available (' + devs.length + ' device(s))');
  const pickDev = devs[devs.length - 1];
  ok(await A.evaluate(id => Voice.enableMic(id), pickDev) && await A.evaluate(() => Voice.micId) !== '', 'switched microphone to ' + pickDev.slice(0, 12) + '…');
  ok(await peak(B, 1) > 0.02, 'Ben still hears Ann after the switch (track replaced in the live call)');
  // the in-game panel renders with the controls
  await A.evaluate(() => showVoice(showLobby)); await A.waitForTimeout(200);
  ok(await A.evaluate(() => !!$('vmode') && !!$('vdev') && document.querySelectorAll('.vmute').length === 2 && document.querySelectorAll('.vvol').length === 2), 'voice panel: mode, microphone list, per-player mute + volume');
  // start the game: calls carry on; Cat leaves: everyone's call to Cat ends
  await A.evaluate(() => showLobby()); await A.click('#start'); await B.waitForFunction(() => game.state === 'play' && me, null, { timeout: 15000 });
  ok(await peak(B, 1) > 0.02, 'voice continues in game');
  await C.close();
  ok(await A.waitForFunction(() => !Voice.calls.has(3), null, { timeout: 10000 }).then(() => true, () => false) && await B.waitForFunction(() => !Voice.calls.has(3), null, { timeout: 10000 }).then(() => true, () => false), 'Cat disconnects: her calls end for Ann and Ben');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
