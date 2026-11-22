'use strict';
// Procedural art: every sprite is drawn with canvas primitives.
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function circ(c, x, y, r, fill) { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
function ell(c, x, y, rx, ry, fill, rot = 0) { c.fillStyle = fill; c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU); c.fill(); }
function drawHero(c, id, x, y, face, t, o = {}) {
  c.save(); c.translate(x, y); const s = o.scale || 1; c.scale(s, s);
  const bob = Math.sin(t * 11) * (o.moving ? 1.6 : 0.4), fl = Math.cos(face) < 0 ? -1 : 1, sw = o.swing || 0, swOff = sw > 0 ? (0.5 - sw) * 2.4 : 0;
  if (!o.ghost) ell(c, 0, 13, 14, 5, 'rgba(0,0,0,.32)');
  if (id === 'rowan') {
    // The Thornwarden: bark armour, a moss cloak, a spear and a living-wood shield. As the Sentinel, a crown of boughs.
    c.fillStyle = '#4f6e34'; c.beginPath(); c.moveTo(-15, 13); c.quadraticCurveTo(-16, -6 + bob, -6, -10 + bob); c.lineTo(6, -10 + bob); c.quadraticCurveTo(16, -6 + bob, 15, 13); c.closePath(); c.fill();
    for (let i = 0; i < 5; i++) ell(c, -12 + i * 6, 12, 3.5, 2.5, i % 2 ? '#6f9a45' : '#86b25a');
    ell(c, 0, 1 + bob, 10, 11, '#6b4a2b'); c.strokeStyle = '#3e2a17'; c.lineWidth = 1.4; c.beginPath(); c.moveTo(-6, -6 + bob); c.lineTo(-4, 8 + bob); c.moveTo(2, -7 + bob); c.lineTo(4, 9 + bob); c.moveTo(-8, 2 + bob); c.lineTo(8, 0 + bob); c.stroke();
    circ(c, 0, -13 + bob, 8, '#7a5634'); c.fillStyle = '#3e2a17'; c.fillRect(-8, -12 + bob, 16, 3);
    c.fillStyle = '#e8f7a8'; c.fillRect(fl * 2 - 4, -12 + bob, 2.5, 2); c.fillRect(fl * 2 + 2, -12 + bob, 2.5, 2);
    ell(c, -4, -20 + bob, 5, 2.5, '#86b25a', -0.4); ell(c, 4, -21 + bob, 4, 2, '#a9c46c', 0.5);
    if (o.sentinel) { c.strokeStyle = '#5d4023'; c.lineWidth = 2.5; c.lineCap = 'round'; for (const sd of [-1, 1]) { c.beginPath(); c.moveTo(sd * 4, -19 + bob); c.lineTo(sd * 10, -30 + bob); c.lineTo(sd * 16, -32 + bob); c.moveTo(sd * 8, -26 + bob); c.lineTo(sd * 5, -34 + bob); c.stroke(); } ell(c, -12, -34 + bob, 6, 4, '#7da353'); ell(c, 12, -34 + bob, 6, 4, '#7da353'); ell(c, 0, -36 + bob, 5, 4, '#a9c46c'); }
    c.save(); c.rotate(face); const th = sw > 0 ? sw * 12 : 0;
    c.strokeStyle = '#6b4a2b'; c.lineWidth = 3.5; c.lineCap = 'round'; c.beginPath(); c.moveTo(-6 + th, 9); c.lineTo(40 + th, 9); c.stroke();
    c.fillStyle = '#d8e8c0'; c.beginPath(); c.moveTo(40 + th, 5); c.lineTo(52 + th, 9); c.lineTo(40 + th, 13); c.fill(); ell(c, 37 + th, 9, 3, 1.6, '#86b25a');
    c.fillStyle = '#7a5634'; c.beginPath(); c.ellipse(15, -6, 5, 12, 0, 0, TAU); c.fill(); c.strokeStyle = '#a9c46c'; c.lineWidth = 2; c.beginPath(); c.ellipse(15, -6, 5, 12, 0, 0, TAU); c.stroke();
    circ(c, 15, -6, 2.5, '#cfe89a'); ell(c, 17, -15, 3, 1.6, '#86b25a', 0.6); c.restore();
  } else if (id === 'mira') {
    // The Mirrorblade: a masked duelist with twin glass daggers and drifting mirror shards.
    c.fillStyle = '#25414a'; c.beginPath(); c.moveTo(-11, 13); c.lineTo(-7, -6 + bob); c.lineTo(7, -6 + bob); c.lineTo(11, 13); c.closePath(); c.fill();
    c.fillStyle = '#9ee7f2'; c.beginPath(); c.moveTo(-2, 13); c.lineTo(0, -4 + bob); c.lineTo(2, 13); c.fill();
    circ(c, 0, -12 + bob, 7, '#1d2a30'); ell(c, fl * 1.5, -12 + bob, 6, 6.5, '#eef8fb');
    c.strokeStyle = '#6f8f99'; c.lineWidth = 0.9; c.beginPath(); c.moveTo(fl * 1.5 - 3, -18 + bob); c.lineTo(fl * 1.5, -13 + bob); c.lineTo(fl * 1.5 + 4, -15 + bob); c.moveTo(fl * 1.5, -13 + bob); c.lineTo(fl * 1.5 + 1, -7 + bob); c.stroke();
    c.fillStyle = '#1d2a30'; c.fillRect(fl * 1.5 - 4, -13 + bob, 3, 1.6); c.fillRect(fl * 1.5 + 1.5, -13 + bob, 3, 1.6);
    for (let i = 0; i < 3; i++) { const q = t * 1.3 + i * 2.1, x = Math.cos(q) * 18, y = Math.sin(q) * 8 - 8 + bob; c.fillStyle = 'rgba(200,245,255,' + (0.5 + Math.sin(t * 4 + i) * 0.3) + ')'; c.beginPath(); c.moveTo(x, y - 4); c.lineTo(x + 3, y + 1); c.lineTo(x - 2, y + 3); c.fill(); }
    for (const sd of [-1, 1]) { c.save(); c.rotate(face + sd * 0.4 + swOff * sd); c.strokeStyle = 'rgba(210,250,255,.9)'; c.lineWidth = 3.2; c.lineCap = 'round'; c.beginPath(); c.moveTo(11, 0); c.lineTo(25, 0); c.stroke(); c.strokeStyle = '#ffffff'; c.lineWidth = 1; c.beginPath(); c.moveTo(13, -0.8); c.lineTo(23, -0.8); c.stroke(); c.strokeStyle = '#3d5a63'; c.lineWidth = 3; c.beginPath(); c.moveTo(8, 0); c.lineTo(11, 0); c.stroke(); c.restore(); }
  } else if (id === 'vespera') {
    // The Lanternkeeper: a hooded traveller, spectral flame in a lantern on a chain, and a few wandering spirits.
    c.fillStyle = '#2b3346'; c.beginPath(); c.moveTo(-14, 13); c.quadraticCurveTo(-12, -10 + bob, 0, -24 + bob); c.quadraticCurveTo(12, -10 + bob, 14, 13); c.closePath(); c.fill();
    c.fillStyle = '#3b4660'; c.beginPath(); c.moveTo(-5, 13); c.lineTo(0, -6 + bob); c.lineTo(5, 13); c.fill();
    ell(c, fl * 1.5, -12 + bob, 6, 6, '#0d1018'); c.fillStyle = '#86f0cf'; c.fillRect(fl * 3 - 4, -13 + bob, 2.2, 2.2); c.fillRect(fl * 3 + 1, -13 + bob, 2.2, 2.2);
    for (let i = 0; i < 2; i++) { const q = t * 1.7 + i * Math.PI, x = Math.cos(q) * 22, y = Math.sin(q * 1.3) * 7 - 16 + bob; c.fillStyle = 'rgba(200,255,240,.55)'; c.beginPath(); c.moveTo(x - 3, y + 3); c.quadraticCurveTo(x, y - 8, x + 3, y + 3); c.quadraticCurveTo(x, y + 6, x - 3, y + 3); c.fill(); }
    const sway = Math.sin(t * 5) * 0.25, ln = 22 + sw * 10, lx = Math.cos(face + sway) * ln, ly = Math.sin(face + sway) * ln + 4;
    c.strokeStyle = '#8a8f9e'; c.lineWidth = 1.2; c.setLineDash([2, 2]); c.beginPath(); c.moveTo(Math.cos(face) * 8, Math.sin(face) * 8 - 2 + bob); c.lineTo(lx, ly - 6); c.stroke(); c.setLineDash([]);
    const g = c.createRadialGradient(lx, ly, 1, lx, ly, 17); g.addColorStop(0, 'rgba(160,255,225,.9)'); g.addColorStop(1, 'rgba(90,220,190,0)'); c.fillStyle = g; c.beginPath(); c.arc(lx, ly, 17, 0, TAU); c.fill();
    c.fillStyle = '#3a3f4c'; c.fillRect(lx - 4.5, ly - 7, 9, 2); c.fillRect(lx - 4.5, ly + 5, 9, 2); c.fillStyle = '#e6fff7'; c.beginPath(); c.moveTo(lx - 3, ly + 4); c.quadraticCurveTo(lx, ly - 8 - Math.sin(t * 12) * 2, lx + 3, ly + 4); c.fill();
  } else if (id === 'bramble') {
    ell(c, 0, bob, 14, 14, '#4d7a3f'); ell(c, 0, 3 + bob, 9, 8, '#6b4a2b');
    ell(c, -11, -3 + bob, 6, 4, '#7bc96f', -0.5); ell(c, 11, -3 + bob, 6, 4, '#7bc96f', 0.5);
    circ(c, 0, -13 + bob, 9, '#8a6238'); c.fillStyle = '#5d4023'; c.fillRect(-9, -11 + bob, 18, 2);
    c.fillStyle = '#d8ff9a'; c.fillRect(fl * 2 - 5, -15 + bob, 3, 3); c.fillRect(fl * 2 + 2, -15 + bob, 3, 3);
    ell(c, -5, -22 + bob, 5, 3, '#7bc96f', -0.7); ell(c, 4, -23 + bob, 5, 3, '#9fe08a', 0.6); ell(c, 0, -24 + bob, 3, 5, '#5fae55');
    c.save(); c.rotate(face + swOff); c.strokeStyle = '#5a3d22'; c.lineWidth = 6; c.lineCap = 'round'; c.beginPath(); c.moveTo(10, 0); c.lineTo(36, 0); c.stroke();
    c.fillStyle = '#9fe08a'; for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(22 + i * 6, -3); c.lineTo(25 + i * 6, -9); c.lineTo(27 + i * 6, -3); c.fill(); c.beginPath(); c.moveTo(22 + i * 6, 3); c.lineTo(25 + i * 6, 9); c.lineTo(27 + i * 6, 3); c.fill(); } c.restore();
  } else if (id === 'wick') {
    c.fillStyle = '#5b3b7a'; c.beginPath(); c.moveTo(-14, 13); c.quadraticCurveTo(-10, -8 + bob, 0, -10 + bob); c.quadraticCurveTo(10, -8 + bob, 14, 13); c.closePath(); c.fill();
    c.fillStyle = '#7a52a3'; c.beginPath(); c.moveTo(-4, 13); c.lineTo(0, -4 + bob); c.lineTo(4, 13); c.fill();
    circ(c, 0, -10 + bob, 7, '#f0d9c0'); c.fillStyle = '#2a1a3a'; c.fillRect(fl * 2 - 4, -11 + bob, 2, 3); c.fillRect(fl * 2 + 2, -11 + bob, 2, 3);
    ell(c, 0, -15 + bob, 15, 4, '#3a2452'); c.fillStyle = '#3a2452'; c.beginPath(); c.moveTo(-9, -15 + bob); c.lineTo(9, -15 + bob); c.lineTo(-fl * 5, -36 + bob); c.closePath(); c.fill();
    c.fillStyle = '#ffb347'; c.fillRect(-8, -19 + bob, 16, 2.5);
    const lx = Math.cos(face) * (20 + sw * 6), ly = Math.sin(face) * (20 + sw * 6) - 2;
    const g = c.createRadialGradient(lx, ly, 1, lx, ly, 16); g.addColorStop(0, 'rgba(255,200,110,.9)'); g.addColorStop(1, 'rgba(255,150,50,0)'); c.fillStyle = g; c.beginPath(); c.arc(lx, ly, 16, 0, TAU); c.fill();
    c.fillStyle = '#4a3a2a'; c.fillRect(lx - 4, ly - 6, 8, 2); c.fillRect(lx - 4, ly + 4, 8, 2); circ(c, lx, ly, 3.5, '#fff1c2');
  } else {
    const fw = Math.sin(t * 16) * 0.25 + 0.5;
    c.save(); c.translate(0, -3 + bob); for (const sd of [-1, 1]) { c.save(); c.scale(sd, 1); c.rotate(-0.5 + fw * 0.5); ell(c, 13, -4, 13, 8, 'rgba(214,204,250,.85)', -0.3); ell(c, 10, 6, 8, 5, 'rgba(190,178,235,.85)', 0.4); circ(c, 16, -5, 2.5, '#6a5aa0'); c.restore(); } c.restore();
    ell(c, 0, 1 + bob, 7, 12, '#3b3550'); circ(c, 0, -13 + bob, 7, '#e9e4f7');
    c.fillStyle = '#1e1a2e'; c.beginPath(); c.ellipse(fl * 2 - 3, -13 + bob, 2, 3, 0, 0, TAU); c.ellipse(fl * 2 + 3, -13 + bob, 2, 3, 0, 0, TAU); c.fill();
    c.strokeStyle = '#e9e4f7'; c.lineWidth = 1.3; c.beginPath(); c.moveTo(-3, -19 + bob); c.quadraticCurveTo(-8, -28 + bob, -11, -25 + bob); c.moveTo(3, -19 + bob); c.quadraticCurveTo(8, -28 + bob, 11, -25 + bob); c.stroke();
    for (const sd of [-1, 1]) { c.save(); c.rotate(face + sd * 0.45 + swOff * sd); c.strokeStyle = '#dfe8ff'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(11, 0); c.lineTo(27, 0); c.stroke(); c.strokeStyle = '#6a5aa0'; c.beginPath(); c.moveTo(9, 0); c.lineTo(12, 0); c.stroke(); c.restore(); }
  }
  c.restore();
}
function drawEnemy(e) {
  const c = ctx, r = e.r, t = game.t + e.ph, fl = e.dir || 1;
  c.save(); c.translate(e.x, e.y);
  ell(c, 0, r * 0.8, r, r * 0.38, 'rgba(0,0,0,.3)');
  if (e.elite) { c.strokeStyle = 'rgba(243,212,138,' + (0.5 + Math.sin(t * 4) * 0.25) + ')'; c.lineWidth = 2.5; c.beginPath(); c.ellipse(0, r * 0.8, r * 1.4, r * 0.55, 0, 0, TAU); c.stroke(); }
  const wind = e.state === 'wind' || e.state === 'fuse' || e.state === 'bwind';
  if (wind && (e.type === 'ram' || e.type === 'boss')) { c.save(); c.rotate(e.a); c.fillStyle = 'rgba(255,70,70,.22)'; c.fillRect(0, -r, e.type === 'boss' ? 560 : 400, r * 2); c.restore(); }
  const sc = r / 14; c.scale(sc, sc); const bob = Math.sin(t * 6) * 1.2;
  switch (e.type) {
    case 'husk':
      ell(c, 0, bob, 13, 14, '#6d5a84'); ell(c, fl * 3, -8 + bob, 10, 9, '#8a74a6');
      c.fillStyle = wind ? '#ff5a5a' : '#ffe07a'; c.fillRect(fl * 5 - 5, -10 + bob, 3, 3); c.fillRect(fl * 5 + 1, -10 + bob, 3, 3);
      c.strokeStyle = '#3d3050'; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(fl * 9, 2 + bob); c.lineTo(fl * (17 + (wind ? 4 : 0)), 6 + bob); c.moveTo(fl * 6, 6 + bob); c.lineTo(fl * 14, 11 + bob); c.stroke();
      break;
    case 'spitter':
      ell(c, 0, 4, 9, 9, '#c9c2a0'); ell(c, 0, -5 + bob * 0.5, 15, 9, wind ? '#b6f25a' : '#5f9e4a'); circ(c, -6, -7, 2.5, '#d6f7a0'); circ(c, 5, -4, 2, '#d6f7a0'); circ(c, 1, -10, 1.8, '#d6f7a0');
      c.fillStyle = '#20301a'; c.fillRect(-4, 2, 2.5, 3); c.fillRect(2, 2, 2.5, 3);
      break;
    case 'ram':
      ell(c, 0, bob * 0.5, 14, 12, '#6b6660'); ell(c, fl * 8, -3, 8, 8, '#85807a');
      c.strokeStyle = '#e2d6b8'; c.lineWidth = 3.5; c.lineCap = 'round'; c.beginPath(); c.arc(fl * 10, -9, 6, fl > 0 ? Math.PI : 0, fl > 0 ? TAU * 0.9 : Math.PI * 1.1 - TAU, fl < 0); c.stroke();
      c.fillStyle = wind || e.state === 'charge' ? '#ff5a5a' : '#ffd27a'; c.fillRect(fl * 10 - 1.5, -5, 3, 3);
      c.fillStyle = '#4a4642'; c.fillRect(-9, 9, 4, 5); c.fillRect(5, 9, 4, 5);
      break;
    case 'bloat': {
      const pu = e.state === 'fuse' ? 1 + Math.sin(t * 40) * 0.12 : 1 + Math.sin(t * 5) * 0.05; c.scale(pu, pu);
      circ(c, 0, 0, 14, e.state === 'fuse' ? '#ffd27a' : '#d9793a'); circ(c, -4, -4, 5, 'rgba(255,230,160,.5)'); circ(c, 5, 4, 3, '#a8491f'); circ(c, -6, 6, 2, '#a8491f');
      c.fillStyle = '#3a1608'; c.fillRect(-5, -2, 3, 3); c.fillRect(2, -2, 3, 3);
      break;
    }
    case 'wisp': {
      const g = c.createRadialGradient(0, 0, 1, 0, 0, 20); g.addColorStop(0, 'rgba(190,235,255,.95)'); g.addColorStop(0.4, 'rgba(110,180,255,.6)'); g.addColorStop(1, 'rgba(80,120,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, 20, 0, TAU); c.fill(); c.fillStyle = '#eaf8ff'; c.beginPath(); c.moveTo(-6, 4); c.quadraticCurveTo(0, -18 - bob * 2, 6, 4); c.quadraticCurveTo(0, 10, -6, 4); c.fill();
      break;
    }
    case 'boss': {
      const rage = e.hp < e.maxHp * 0.5, col = rage ? '#ff5ad6' : '#c9a6ff';
      ell(c, 0, 2 + bob * 0.4, 14, 10, '#1b1626'); ell(c, fl * 9, -6 + bob * 0.4, 6, 7, '#272036');
      c.fillStyle = '#1b1626'; for (const lx of [-9, -3, 4, 10]) c.fillRect(lx - 1.2, 8, 2.4, 6);
      c.strokeStyle = col; c.lineWidth = 1.3; c.lineCap = 'round';
      for (const sd of [-1, 1]) { const bx = fl * 9 + sd * 2.5, by = -12; c.beginPath(); c.moveTo(bx, by); c.quadraticCurveTo(bx + sd * 5, by - 7, bx + sd * 4, by - 13); c.moveTo(bx + sd * 3.2, by - 5); c.lineTo(bx + sd * 8, by - 7); c.moveTo(bx + sd * 4.4, by - 9); c.lineTo(bx + sd * 8, by - 12); c.stroke(); }
      c.fillStyle = col; c.fillRect(fl * 10 - 2.5, -7.5, 1.6, 1.6); c.fillRect(fl * 10 + 1, -7.5, 1.6, 1.6);
      c.globalAlpha = 0.35; ell(c, 0, 2, 9, 5, col); c.globalAlpha = 1;
      break;
    }
  }
  if (e.flash > 0) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.55; circ(c, 0, -2, 15, '#fff'); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; }
  c.restore();
  if (e.type !== 'boss' && e.hp < e.maxHp) { const w = r * 2; ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(e.x - w / 2, e.y - r - 14, w, 4); ctx.fillStyle = e.elite ? '#f3d48a' : e.poisT > 0 ? '#a6e36a' : '#e25555'; ctx.fillRect(e.x - w / 2, e.y - r - 14, w * clamp(e.hp / e.maxHp, 0, 1), 4); }
  if (e.slowT > 0) { ctx.strokeStyle = '#7bc96f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y + r * 0.6, r * 0.9, 0, TAU); ctx.stroke(); }
  if (e.rootT > 0) {
    // Root Snare: roots curl up around the feet.
    ctx.strokeStyle = '#8a6238'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 5; i++) { const q = i * TAU / 5 + 0.4, bx = e.x + Math.cos(q) * r * 0.9, by = e.y + r * 0.6 + Math.sin(q) * r * 0.35; ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + Math.cos(q) * 6, by - r * 0.6, e.x + Math.cos(q) * r * 0.4, e.y - r * 0.2); ctx.stroke(); }
  }
}
function drawObs(o) {
  const c = ctx, T = world.pal.tree;
  if (o.tree) {
    ell(c, o.x, o.y + 6, o.r * 0.8, o.r * 0.3, 'rgba(0,0,0,.28)'); c.fillStyle = '#3d2c1e'; c.fillRect(o.x - 6, o.y - o.r * 0.7, 12, o.r * 0.7 + 6);
    const sw = Math.sin(game.t * 0.8 + o.v) * 2;
    circ(c, o.x - o.r * 0.35 + sw, o.y - o.r * 0.75, o.r * 0.62, T[0]); circ(c, o.x + o.r * 0.38 + sw, o.y - o.r * 0.8, o.r * 0.58, T[1]); circ(c, o.x + sw * 1.3, o.y - o.r * 1.2, o.r * 0.66, T[(o.tone + 1) % 3]); circ(c, o.x - o.r * 0.15 + sw * 1.3, o.y - o.r * 1.35, o.r * 0.3, T[2]);
  } else {
    ell(c, o.x, o.y + o.r * 0.5, o.r * 1.05, o.r * 0.45, 'rgba(0,0,0,.28)'); ell(c, o.x, o.y, o.r, o.r * 0.85, world.pal.rock, o.v);
    c.globalAlpha = 0.25; ell(c, o.x - o.r * 0.25, o.y - o.r * 0.3, o.r * 0.5, o.r * 0.35, '#fff', o.v); c.globalAlpha = 1;
  }
}
function drawPoi(o) {
  const c = ctx, t = game.t; c.save(); c.translate(o.x, o.y);
  ell(c, 0, 14, 30, 10, 'rgba(0,0,0,.3)');
  switch (o.kind) {
    case 'altar': {
      ell(c, 0, 8, 52, 20, '#3a3548'); ell(c, 0, 4, 40, 15, '#4c4660');
      for (let i = 0; i < 5; i++) { const a = i * TAU / 5 + 0.3, x = Math.cos(a) * 46, y = Math.sin(a) * 18 + 4; c.fillStyle = '#5a546e'; c.fillRect(x - 5, y - 30, 10, 32); }
      const g = c.createRadialGradient(0, -8, 2, 0, -8, 34); g.addColorStop(0, o.used ? 'rgba(120,120,140,.5)' : 'rgba(200,120,255,' + (0.6 + Math.sin(t * 3) * 0.2) + ')'); g.addColorStop(1, 'rgba(160,80,255,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, -8, 34, 0, TAU); c.fill();
      break;
    }
    case 'spring':
      ell(c, 0, 6, 30, 14, '#6b7078'); ell(c, 0, 4, 24, 10, o.used ? '#39424a' : '#4fb6e8'); if (!o.used) { c.strokeStyle = 'rgba(220,245,255,.7)'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(0, 4, 10 + Math.abs(t * 8 % 12), 4 + Math.abs(t * 3 % 5), 0, 0, TAU); c.stroke(); }
      break;
    case 'chest':
      c.fillStyle = '#6b4a2b'; rr(c, -15, -10, 30, 22, 3); c.fill(); c.fillStyle = o.used ? '#2a2018' : '#8a6238'; rr(c, -15, o.used ? -20 : -14, 30, 10, 4); c.fill(); c.fillStyle = '#f3d48a'; c.fillRect(-15, -2, 30, 2.5); if (!o.used) c.fillRect(-3, -6, 6, 8);
      break;
    case 'shrine':
      c.fillStyle = '#7a7684'; c.fillRect(-9, -26, 18, 38); c.fillStyle = '#918da0'; c.beginPath(); c.moveTo(-14, -26); c.lineTo(0, -40); c.lineTo(14, -26); c.fill();
      circ(c, 0, -12, 5, o.used ? '#4a4658' : 'rgba(243,212,138,' + (0.7 + Math.sin(t * 4) * 0.3) + ')');
      break;
    case 'merchant':
      c.fillStyle = '#7a3f3f'; c.beginPath(); c.moveTo(-26, -8); c.lineTo(0, -40); c.lineTo(26, -8); c.fill(); c.fillStyle = '#f3d48a'; c.beginPath(); c.moveTo(-9, -8); c.lineTo(0, -29); c.lineTo(9, -8); c.fill();
      c.fillStyle = '#4a3020'; c.fillRect(-22, -8, 44, 18); circ(c, 0, -14, 6, '#2a2233'); c.fillStyle = '#ffe07a'; c.fillRect(-3, -15, 2, 2); c.fillRect(1, -15, 2, 2);
      break;
    case 'camp':
      c.strokeStyle = '#4a3020'; c.lineWidth = 5; c.lineCap = 'round'; c.beginPath(); c.moveTo(-12, 8); c.lineTo(12, 0); c.moveTo(12, 8); c.lineTo(-12, 0); c.stroke();
      c.fillStyle = '#ff8a3a'; c.beginPath(); c.moveTo(-8, 2); c.quadraticCurveTo(0, -26 - Math.sin(t * 9) * 5, 8, 2); c.fill(); c.fillStyle = '#ffe07a'; c.beginPath(); c.moveTo(-4, 2); c.quadraticCurveTo(0, -14 - Math.sin(t * 11) * 3, 4, 2); c.fill();
      break;
  }
  c.restore();
}
function drawPickup(k) {
  const c = ctx, b = Math.sin(k.t * 5) * 2;
  if (k.kind === 'xp') { circ(c, k.x, k.y + b, 4, '#7fe0ff'); circ(c, k.x - 1, k.y - 1 + b, 1.6, '#fff'); }
  else if (k.kind === 'gold') { circ(c, k.x, k.y + b, 5, '#f3c84a'); circ(c, k.x, k.y + b, 2.5, '#fff0a8'); }
  else if (k.kind === 'lume') {
    // Lingering Light: a small spectral ember for the Lanternkeeper.
    const g = c.createRadialGradient(k.x, k.y + b, 1, k.x, k.y + b, 12); g.addColorStop(0, 'rgba(200,255,240,.9)'); g.addColorStop(1, 'rgba(134,240,207,0)'); c.fillStyle = g; c.beginPath(); c.arc(k.x, k.y + b, 12, 0, TAU); c.fill();
    c.fillStyle = '#eafff8'; c.beginPath(); c.moveTo(k.x - 3, k.y + 3 + b); c.quadraticCurveTo(k.x, k.y - 8 + b, k.x + 3, k.y + 3 + b); c.fill();
  }
  else if (k.kind === 'heart') { c.fillStyle = '#ff5a6e'; c.beginPath(); c.arc(k.x - 4, k.y - 2 + b, 5, 0, TAU); c.arc(k.x + 4, k.y - 2 + b, 5, 0, TAU); c.fill(); c.beginPath(); c.moveTo(k.x - 9, k.y + b); c.lineTo(k.x, k.y + 10 + b); c.lineTo(k.x + 9, k.y + b); c.fill(); }
  else { c.save(); c.translate(k.x, k.y + b); c.rotate(k.t); const g = c.createRadialGradient(0, 0, 1, 0, 0, 22); g.addColorStop(0, 'rgba(243,212,138,.8)'); g.addColorStop(1, 'rgba(243,212,138,0)'); c.fillStyle = g; c.beginPath(); c.arc(0, 0, 22, 0, TAU); c.fill(); c.fillStyle = '#f3d48a'; c.beginPath(); c.moveTo(0, -11); c.lineTo(8, 0); c.lineTo(0, 11); c.lineTo(-8, 0); c.fill(); c.restore(); }
}
