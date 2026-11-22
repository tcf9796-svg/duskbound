// Microphone start-up, including iPhone's audio session: navigator.audioSession.type 'playback' (which the game
// uses so sound plays through the silent switch) cannot record. This test fakes that iPhone rule in Chromium.
// Run: sh build.sh <peerjs.min.js> && node tests/e2e/mic.test.js
const { launch, checker } = require('./harness');
const IOS_SESSION = `(() => {
  navigator.audioSession = { type: 'auto' };
  const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = c => {
    if (window.__deny) return Promise.reject(new DOMException('denied', 'NotAllowedError'));
    if (navigator.audioSession.type === 'playback') return Promise.reject(new DOMException('session cannot record', 'InvalidStateError'));
    if (c && c.audio && c.audio.deviceId) return Promise.reject(new DOMException('gone', 'OverconstrainedError'));
    return real(c);
  };
})();`;
(async () => {
  const ok = checker();
  const H = await launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const o = { build: 'duskbound.html', fake: 'fake-peer.js', init: IOS_SESSION, contextOptions: { permissions: ['microphone'] } };
  const A = await H.player('Ann', o), B = await H.player('Ben', o);
  await H.hostAndJoin(A, B);
  ok(await A.evaluate(() => navigator.audioSession.type) === 'playback', 'game sound uses the iPhone playback session');
  // the panel's button, as a player would tap it
  await A.evaluate(() => showVoice(showLobby)); await A.click('#vmic'); await A.waitForFunction(() => !!$('vmic') && !!Voice.micStream, null, { timeout: 8000 }).catch(() => { });
  ok(await A.evaluate(() => !!Voice.micStream), 'microphone turns on even though the game was in playback mode');
  ok(await A.evaluate(() => navigator.audioSession.type) === 'play-and-record', 'session switched to play-and-record while the mic is on');
  await A.mouse.click(5, 5); // any tap calls initAudio again: it must not switch back to playback while recording
  ok(await A.evaluate(() => navigator.audioSession.type) === 'play-and-record', 'taps keep play-and-record while the mic is on');
  ok(!(await A.evaluate(() => overlay.textContent)).includes('無法') && !(await A.evaluate(() => overlay.textContent)).includes('not available'), 'no error shown once the mic works');
  await A.evaluate(() => Voice.disableMic());
  ok(await A.evaluate(() => navigator.audioSession.type) === 'playback', 'back to playback when the mic is turned off');
  // remembered microphone no longer exists -> falls back to the default one
  ok(await A.evaluate(() => Voice.enableMic('stale-device-id')) && await A.evaluate(() => !!Voice.micStream), 'stale saved microphone: falls back to the default microphone');
  await A.evaluate(() => Voice.disableMic());
  // permission denied: clear iPhone instructions
  await A.evaluate(() => { window.__deny = true; }); await A.evaluate(() => showVoice(showLobby)); await A.click('#vmic'); await A.waitForTimeout(400);
  const t = await A.evaluate(() => overlay.textContent);
  ok(/Website Settings/.test(t) && /Microphone/.test(t) && await A.evaluate(() => navigator.audioSession.type) === 'playback', 'denied: explains how to allow the microphone on iPhone; session back to playback');
  const errs = H.pages.flatMap(p => p.errors || []); ok(errs.length === 0, 'no page errors ' + JSON.stringify(errs));
  await H.close(); process.exit(ok.done() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
