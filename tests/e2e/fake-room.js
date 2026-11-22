// Test stand-in for claude.ai's `room` capability (used by the claude.ai build's co-op).
// Messages travel through window.__busSend, a binding the test runner relays to every other page,
// so players can live in separate browser contexts (separate storage = separate profiles).
(() => {
  const peer = Math.random().toString(36).slice(2, 10), subs = {};
  window.__busDeliver = (ch, s) => (subs[ch] || []).forEach(f => f(JSON.parse(s)));
  const bus = { on: (ch, f) => (subs[ch] = subs[ch] || []).push(f), post: (ch, d) => window.__busSend && window.__busSend(ch, JSON.stringify(d)) };
  function mkRoom(name) {
    const ch = 'room:' + name, peers = new Map(), evs = {}, ps = []; let mine = {}, snap = Object.freeze([]), closed = false;
    const view = (id, p) => ({ peer: id, by: null, isMe: id === peer, sameTab: id === peer, kind: 'viewer', guest: false, presence: Object.freeze({ ...p }), updatedAt: Date.now() });
    const fire = ch2 => { snap = Object.freeze([...peers.values()].map(x => x.v)); ch2.peers = snap; ps.forEach(f => f(ch2)); };
    peers.set(peer, { v: view(peer, mine), seen: Infinity });
    bus.on(ch, m => {
      if (closed || m.peer === peer) return;
      if (m.t === 'pres') { const had = peers.has(m.peer); const v = view(m.peer, m.p); peers.set(m.peer, { v, seen: Date.now() }); fire({ joined: had ? [] : [v], left: [], updated: had ? [v] : [] }); if (m.hello) bus.post(ch, { t: 'pres', peer, p: mine }); }
      else if (m.t === 'ev' && Math.random() >= (window.__dropRate || 0)) (evs[m.topic] || []).forEach(f => f({ topic: m.topic, data: m.data, peer: m.peer, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false }));
    });
    // heartbeat: peers that go quiet (closed or crashed tab) leave the room
    const hb = setInterval(() => { if (closed) return; bus.post(ch, { t: 'pres', peer, p: mine });
      for (const [id, x] of peers) if (id !== peer && Date.now() - x.seen > 1500) { peers.delete(id); fire({ joined: [], left: [x.v], updated: [] }); } }, 400);
    bus.post(ch, { t: 'pres', peer, p: mine, hello: 1 });
    let presT = 0;
    return {
      name,
      emit(topic, data) { if (JSON.stringify(data).length > 4096) return Promise.reject({ code: 'invalid_argument' }); bus.post(ch, { t: 'ev', topic, data, peer }); return Promise.resolve(); },
      on(topic, f) { (evs[topic] = evs[topic] || []).push(f); return () => { }; },
      presence(patch) { const nx = { ...mine }; for (const k in patch) { if (patch[k] === null) delete nx[k]; else nx[k] = patch[k]; }
        if (JSON.stringify(nx).length > 4096) return Promise.reject({ code: 'invalid_argument' }); mine = nx; peers.set(peer, { v: view(peer, mine), seen: Infinity }); snap = Object.freeze([...peers.values()].map(x => x.v));
        if (!presT) presT = setTimeout(() => { presT = 0; bus.post(ch, { t: 'pres', peer, p: mine }); }, 33); return Promise.resolve(); },
      peers: () => snap,
      onPeers(f) { ps.push(f); setTimeout(() => f({ peers: snap, joined: snap, left: [], updated: [] }), 0); return () => { }; },
      connected: () => true, onConnection: () => () => { },
      leave() { closed = true; clearInterval(hb); return Promise.resolve(); }
    };
  }
  window.claude = { use: n => new Promise(r => setTimeout(() => r(n === 'room' ? { join: name => new Promise(rr => setTimeout(() => rr(mkRoom(name)), 50)) } : null), 100)) };
})();
