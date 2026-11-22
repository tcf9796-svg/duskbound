'use strict';
// Synthesized audio: all sound effects and music are generated with WebAudio.
const AU = { ctx: null, master: null, muted: false, nbuf: null, last: {} };
function initAudio() {
  if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; }
  try {
    AU.ctx = new (window.AudioContext || window.webkitAudioContext)();
    AU.master = AU.ctx.createGain(); AU.master.gain.value = 0.55; AU.master.connect(AU.ctx.destination);
    const n = AU.ctx.sampleRate; AU.nbuf = AU.ctx.createBuffer(1, n, n);
    const d = AU.nbuf.getChannelData(0); for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AU.ctx = null; }
}
function tone(f, dur, type = 'sine', vol = 0.15, slide = 0, delay = 0, atk = 0.005) {
  if (!AU.ctx) return;
  const t = AU.ctx.currentTime + delay, o = AU.ctx.createOscillator(), g = AU.ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(AU.master); o.start(t); o.stop(t + dur + 0.05);
}
function hiss(dur, vol = 0.2, freq = 1500, q = 1, delay = 0) {
  if (!AU.ctx) return;
  const t = AU.ctx.currentTime + delay, s = AU.ctx.createBufferSource(), f = AU.ctx.createBiquadFilter(), g = AU.ctx.createGain();
  s.buffer = AU.nbuf; s.loop = true; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(AU.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function playSfx(name) {
  if (!AU.ctx) return;
  const now = performance.now(); if (now - (AU.last[name] || 0) < 45) return; AU.last[name] = now;
  switch (name) {
    case 'slash': hiss(0.11, 0.22, 2600, 0.8); tone(340, 0.09, 'triangle', 0.06, -180); break;
    case 'bolt': tone(620, 0.14, 'sawtooth', 0.05, -380); hiss(0.08, 0.08, 4000, 2); break;
    case 'blade': hiss(0.07, 0.16, 5200, 3); tone(1100, 0.05, 'square', 0.025, -500); break;
    case 'hit': tone(180, 0.07, 'square', 0.07, -90); hiss(0.05, 0.12, 900, 1); break;
    case 'crit': tone(880, 0.1, 'triangle', 0.09, 400); hiss(0.07, 0.15, 3000, 1); break;
    case 'die': tone(220, 0.22, 'sawtooth', 0.06, -170); hiss(0.18, 0.12, 500, 0.7); break;
    case 'hurt': tone(140, 0.25, 'sawtooth', 0.16, -80); hiss(0.2, 0.25, 300, 0.6); break;
    case 'dash': hiss(0.2, 0.2, 1800, 0.5); tone(300, 0.15, 'sine', 0.05, 500); break;
    case 'boom': hiss(0.5, 0.4, 180, 0.5); tone(90, 0.4, 'sine', 0.25, -55); break;
    case 'xp': tone(900 + rand(300), 0.07, 'sine', 0.04, 300); break;
    case 'gold': tone(1320, 0.08, 'square', 0.03); tone(1760, 0.1, 'square', 0.03, 0, 0.05); break;
    case 'heal': tone(520, 0.2, 'sine', 0.09, 260); tone(780, 0.3, 'sine', 0.07, 0, 0.1); break;
    case 'level': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.35, 'triangle', 0.09, 0, i * 0.08)); break;
    case 'pick': tone(660, 0.12, 'triangle', 0.09); tone(990, 0.25, 'triangle', 0.08, 0, 0.08); break;
    case 'skill': tone(220, 0.3, 'sawtooth', 0.08, 300); hiss(0.3, 0.2, 1200, 0.6); break;
    case 'ult': [110, 165, 220, 330].forEach((f, i) => tone(f, 0.8, 'sawtooth', 0.07, f, i * 0.05)); hiss(0.9, 0.3, 700, 0.4); break;
    case 'night': tone(196, 1.6, 'sine', 0.14, -60, 0, 0.3); tone(233, 1.6, 'sine', 0.1, -70, 0.2, 0.3); break;
    case 'dawn': tone(392, 1.2, 'sine', 0.1, 130, 0, 0.2); tone(587, 1.4, 'sine', 0.08, 0, 0.25, 0.2); break;
    case 'boss': tone(55, 2.2, 'sawtooth', 0.22, -15, 0, 0.4); hiss(2, 0.3, 150, 0.4); break;
    case 'warn': tone(440, 0.12, 'square', 0.04); break;
    case 'spit': tone(300, 0.15, 'sine', 0.06, -150); break;
    case 'block': tone(150, 0.12, 'square', 0.06, -40); hiss(0.08, 0.15, 600, 1.2); break;
    case 'root': tone(80, 0.45, 'sawtooth', 0.12, 40); hiss(0.35, 0.2, 260, 0.6); break;
    case 'shatter': hiss(0.25, 0.22, 6500, 2); [1760, 2350, 2960].forEach((f, i) => tone(f, 0.18, 'triangle', 0.035, -300, i * 0.03)); break;
    case 'shield': tone(660, 0.3, 'sine', 0.07, 330); tone(990, 0.35, 'sine', 0.05, 0, 0.08); break;
    case 'tether': tone(440, 0.4, 'sine', 0.06, -220); tone(445, 0.4, 'sine', 0.06, -222, 0.02); break;
    case 'unlock': [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.5, 'triangle', 0.09, 0, i * 0.1)); break;
  }
}
const MUS = { next: 0, step: 0 };
const mf = n => 440 * Math.pow(2, (n - 69) / 12);
function music() {
  if (!AU.ctx || !me || game.state !== "play") return;
  const t = AU.ctx.currentTime;
  if (MUS.next < t - 0.5) MUS.next = t + 0.1;
  while (MUS.next < t + 0.3) {
    const s = MUS.step++, bar = Math.floor(s / 8) % 4, st = s % 8, d = MUS.next - t;
    const dark = night > 0.5 || !!game.boss;
    const root = (dark ? [45, 41, 43, 40] : [45, 48, 43, 41])[bar];
    const scale = [0, 3, 5, 7, 10, 12, 15];
    if (st === 0) [0, 7, 12, 15].forEach(n => tone(mf(root + n), game.boss ? 1.9 : 2.6, 'sine', 0.035, 0, d, 0.5));
    if (Math.random() < (dark ? 0.4 : 0.6)) tone(mf(root + 12 + pick(scale) + (dark ? 0 : 12)), 0.55, 'triangle', 0.028, 0, d);
    if (game.boss) { if (st % 2 === 0) tone(mf(root - 12), 0.18, 'sawtooth', 0.07, 0, d); if (st % 4 === 2) hiss(0.06, 0.08, 6000, 2, d); }
    MUS.next += game.boss ? 0.22 : 0.32;
  }
}

