'use strict';
// Voice chat over PeerJS media calls (WebRTC), riding on the same peer connections the game already uses.
// Mesh: every pair of players has one call; the player with the lower id places it. Everyone sends a silent track
// until they turn their microphone on, so listening needs no permission. Push-to-talk toggles the mic track;
// changing microphone swaps the track in place. Each remote voice goes through its own gain (mute / volume) and
// analyser (speaking indicator). Not available where WebRTC is blocked (the claude.ai build).
const Voice = {
  peer: null, myId: 0, roster: [], calls: new Map(), // pid -> { call, stream, el, src, gain, an, muted, vol, name }
  micStream: null, micTrack: null, silent: null, micId: '', mode: 'ptt', talking: false, error: '',
  prefs: (() => { try { return JSON.parse(localStorage.getItem('duskbound-voice') || '{}') || {}; } catch (e) { return {}; } })(),
  supported: () => typeof RTCPeerConnection !== 'undefined' && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  savePrefs() { try { localStorage.setItem('duskbound-voice', JSON.stringify({ mode: this.mode, micId: this.micId, vols: this.prefs.vols || {} })); } catch (e) { } },
  ctx() { if (typeof initAudio === 'function') initAudio(); return typeof AU !== 'undefined' ? AU.ctx : null; },
  outStream() {
    if (this.micStream) return this.micStream;
    if (!this.silent) { const c = this.ctx(); this.silent = c ? c.createMediaStreamDestination().stream : new MediaStream(); }
    return this.silent;
  },
  // Called by the game whenever the set of players (and their PeerJS ids) changes.
  start(peer, myId) { if (this.peer !== peer) { this.stop(); this.peer = peer; peer.on('call', c => this.incoming(c)); } this.myId = myId; this.mode = this.prefs.mode === 'open' ? 'open' : 'ptt'; this.micId = this.prefs.micId || ''; },
  sync(roster) {
    if (!this.peer) return; this.roster = roster;
    const ids = new Set(roster.map(r => r.id));
    for (const [pid, v] of this.calls) if (!ids.has(pid) || roster.find(r => r.id === pid).peer !== v.call.peer) this.drop(pid);
    for (const r of roster) {
      if (r.id === this.myId || this.calls.has(r.id) || this.myId > r.id) continue; // the lower id calls
      try { const call = this.peer.call(r.peer, this.outStream(), { metadata: { pid: this.myId } }); if (call) this.track(r.id, call); } catch (e) { }
    }
  },
  incoming(call) {
    const pid = call.metadata && call.metadata.pid, r = this.roster.find(r => r.id === pid);
    if (!r || r.peer !== call.peer) { try { call.close(); } catch (e) { } return; } // only players in this session
    if (this.calls.has(pid)) this.drop(pid);
    try { call.answer(this.outStream()); } catch (e) { return; }
    this.track(pid, call);
  },
  track(pid, call) {
    const vols = this.prefs.vols || {}, v = { call, stream: null, el: null, gain: null, an: null, muted: false, vol: vols[pid] != null ? vols[pid] : 1 };
    this.calls.set(pid, v);
    call.on('stream', s => this.play(pid, s));
    call.on('close', () => { if (this.calls.get(pid) === v) this.drop(pid); });
    call.on('error', () => { if (this.calls.get(pid) === v) this.drop(pid); });
  },
  play(pid, s) {
    const v = this.calls.get(pid); if (!v || v.stream === s) return; v.stream = s;
    // Chrome only feeds a remote WebRTC stream into Web Audio while a media element plays it (muted here).
    v.el = document.createElement('audio'); v.el.srcObject = s; v.el.muted = true; v.el.autoplay = true; v.el.setAttribute('playsinline', ''); const pl = v.el.play(); if (pl && pl.catch) pl.catch(() => { });
    const c = this.ctx();
    if (c) { v.src = c.createMediaStreamSource(s); v.gain = c.createGain(); v.an = c.createAnalyser(); v.an.fftSize = 512; v.src.connect(v.gain); v.gain.connect(v.an); v.an.connect(c.destination); }
    else v.el.muted = false; // no Web Audio: play directly (volume via the element)
    this.applyVol(pid);
  },
  applyVol(pid) {
    const v = this.calls.get(pid); if (!v) return; const g = v.muted ? 0 : v.vol;
    if (v.gain) { const c = v.gain.context; v.gain.gain.cancelScheduledValues(c.currentTime); v.gain.gain.setTargetAtTime(g, c.currentTime, 0.015); } else if (v.el) { v.el.muted = v.muted; v.el.volume = Math.min(1, g); }
  },
  setMuted(pid, m) { const v = this.calls.get(pid); if (v) { v.muted = !!m; this.applyVol(pid); } },
  setVolume(pid, vol) { const v = this.calls.get(pid); if (!v) return; v.vol = Math.max(0, Math.min(2, vol)); this.applyVol(pid); (this.prefs.vols = this.prefs.vols || {})[pid] = v.vol; this.savePrefs(); },
  drop(pid) {
    const v = this.calls.get(pid); if (!v) return; this.calls.delete(pid);
    try { v.call.close(); } catch (e) { } try { if (v.src) v.src.disconnect(); if (v.an) v.an.disconnect(); } catch (e) { } if (v.el) { v.el.srcObject = null; }
  },
  stop() { for (const pid of [...this.calls.keys()]) this.drop(pid); this.peer = null; this.roster = []; this.setTalking(false); },
  // ---- microphone
  // iPhone: the game's audio session is 'playback' (plays through the silent switch) and that mode cannot record.
  session(t) { try { if (navigator.audioSession && navigator.audioSession.type !== t) navigator.audioSession.type = t; } catch (e) { } },
  async enableMic(deviceId) {
    this.error = ''; this.session('play-and-record');
    const ask = id => navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id }, echoCancellation: true, noiseSuppression: true } : { echoCancellation: true, noiseSuppression: true } });
    let s;
    try { s = await ask(deviceId); }
    catch (e) {
      // a remembered microphone may be gone (or ids changed): fall back to the default one
      if (deviceId && e && e.name !== 'NotAllowedError') { try { s = await ask(''); } catch (e2) { e = e2; } }
      if (!s) { this.error = (e && e.name) || 'Error'; if (!this.micStream) this.session('playback'); return false; }
    }
    try {
      const old = this.micStream; this.micStream = s; this.micTrack = s.getAudioTracks()[0];
      this.micId = (this.micTrack.getSettings && this.micTrack.getSettings().deviceId) || deviceId || ''; this.savePrefs();
      this.gate(); await this.swapTrack(this.micTrack);
      if (old) old.getTracks().forEach(t => t.stop());
      const c = this.ctx(); if (c) { this.myAn = c.createAnalyser(); this.myAn.fftSize = 512; c.createMediaStreamSource(s).connect(this.myAn); }
      return true;
    } catch (e) { this.error = 'setup:' + ((e && e.name) || 'Error'); return true; } // the mic is on even if the level meter failed
  },
  async disableMic() {
    const old = this.micStream; this.micStream = null; this.micTrack = null; this.myAn = null;
    await this.swapTrack(this.outStream().getAudioTracks()[0] || null); if (old) old.getTracks().forEach(t => t.stop());
    this.session('playback');
  },
  async swapTrack(track) {
    for (const v of this.calls.values()) { const pc = v.call.peerConnection; if (!pc) continue; for (const s of pc.getSenders()) if (!s.track || s.track.kind === 'audio') try { await s.replaceTrack(track); } catch (e) { } }
  },
  async devices() { try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch (e) { return []; } },
  setMode(m) { this.mode = m === 'open' ? 'open' : 'ptt'; this.savePrefs(); this.gate(); },
  setTalking(t) { this.talking = !!t; this.gate(); },
  gate() { if (this.micTrack) this.micTrack.enabled = this.mode === 'open' || this.talking; },
  transmitting() { return !!(this.micTrack && this.micTrack.enabled); },
  // speaking indicator: rough loudness 0..1 of a player's voice after their mute/volume (or my own mic)
  level(pid) {
    const an = pid === this.myId ? (this.transmitting() ? this.myAn : null) : this.calls.get(pid) && this.calls.get(pid).an;
    if (!an) return 0; const a = new Float32Array(an.fftSize); an.getFloatTimeDomainData(a); let s = 0; for (const x of a) s += x * x; return Math.sqrt(s / a.length);
  }
};
