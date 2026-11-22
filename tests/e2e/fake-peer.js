// Test stand-in for the PeerJS library (the public PeerJS signalling server is unreachable from the test machine).
// Data connections travel through the test runner's relay (window.__busSend); media calls are REAL
// RTCPeerConnections whose offers/answers/ICE candidates are relayed the same way. Implements the subset of the
// PeerJS API the game uses: new Peer([id]), on(open|connection|call|error), connect, call, destroy;
// DataConnection: on(open|data|close|error), send, close, peer; MediaConnection: on(stream|close|error), answer, close,
// peer, metadata, peerConnection.
(() => {
  const subs = [];
  window.__busDeliver = (ch, s) => { if (ch === 'peer') { const m = JSON.parse(s); subs.forEach(f => f(m)); } };
  const post = m => window.__busSend && window.__busSend('peer', JSON.stringify(m));
  const ee = () => { const h = {}; return { on(e, f) { (h[e] = h[e] || []).push(f); return this; }, emit(e, ...a) { (h[e] || []).slice().forEach(f => f(...a)); } }; };
  const rid = () => Math.random().toString(36).slice(2, 12);
  class FakePeer {
    constructor(id) {
      Object.assign(this, ee()); this.id = id || 'peer-' + rid(); this.conns = new Map(); this.calls = new Map(); this.seen = new Map(); this.dead = false;
      this.unsub = m => this.recv(m); subs.push(this.unsub);
      this.hb = setInterval(() => { if (this.dead) return; post({ t: 'alive', from: this.id });
        for (const c of this.conns.values()) if (c.open && Date.now() - (this.seen.get(c.peer) || 0) > 2000) c.shut(); }, 400);
      setTimeout(() => { post({ t: 'alive', from: this.id }); this.emit('open', this.id); }, 30);
    }
    recv(m) {
      if (this.dead) return;
      if (m.from) this.seen.set(m.from, Date.now());
      if (m.to !== this.id) return;
      if (m.t === 'conn') { const c = this.mkConn(m.from, m.cid); this.emit('connection', c); c.opened(); post({ t: 'conn-ok', from: this.id, to: m.from, cid: m.cid }); }
      else if (m.t === 'conn-ok') { const c = this.conns.get(m.cid); if (c) c.opened(); }
      else if (m.t === 'data') { const c = this.conns.get(m.cid); if (c && c.open) c.emit('data', m.d); }
      else if (m.t === 'close') { const c = this.conns.get(m.cid); if (c) c.shut(true); const k = this.calls.get(m.cid); if (k) k.shut(true); }
      else if (m.t === 'offer') { const k = this.mkCall(m.from, m.cid, m.meta); k.offer = m.sdp; this.emit('call', k); }
      else if (m.t === 'answer') { const k = this.calls.get(m.cid); if (k) k.pc.setRemoteDescription(m.sdp).then(() => k.flush()); }
      else if (m.t === 'ice') { const k = this.calls.get(m.cid); if (k) { if (k.pc.remoteDescription) k.pc.addIceCandidate(m.c).catch(() => { }); else k.pending.push(m.c); } }
    }
    mkConn(peer, cid) {
      const me = this, c = Object.assign(ee(), { peer, cid, open: false,
        opened() { if (!c.open) { c.open = true; me.seen.set(peer, Date.now()); c.emit('open'); } },
        send(d) { if (c.open) post({ t: 'data', from: me.id, to: peer, cid, d }); },
        shut(remote) { if (!c.open && !remote) return; c.open = false; me.conns.delete(cid); if (!remote) post({ t: 'close', from: me.id, to: peer, cid }); c.emit('close'); },
        close() { c.shut(false); } });
      this.conns.set(cid, c); return c;
    }
    connect(peer) { const cid = rid(), c = this.mkConn(peer, cid); post({ t: 'conn', from: this.id, to: peer, cid }); return c; }
    mkCall(peer, cid, meta) {
      const me = this, pc = new RTCPeerConnection({ iceServers: [] });
      const k = Object.assign(ee(), { peer, cid, metadata: meta, peerConnection: pc, pc, pending: [], open: true,
        flush() { for (const c of k.pending.splice(0)) pc.addIceCandidate(c).catch(() => { }); },
        answer(stream) { stream.getTracks().forEach(t => pc.addTrack(t, stream)); pc.setRemoteDescription(k.offer).then(() => { k.flush(); return pc.createAnswer(); }).then(a => pc.setLocalDescription(a)).then(() => post({ t: 'answer', from: me.id, to: peer, cid, sdp: pc.localDescription.toJSON() })); },
        shut(remote) { if (!k.open) return; k.open = false; me.calls.delete(cid); try { pc.close(); } catch (e) { } if (!remote) post({ t: 'close', from: me.id, to: peer, cid }); k.emit('close'); },
        close() { k.shut(false); } });
      pc.onicecandidate = e => { if (e.candidate) post({ t: 'ice', from: me.id, to: peer, cid, c: e.candidate.toJSON() }); };
      pc.ontrack = e => k.emit('stream', e.streams[0] || new MediaStream([e.track]));
      this.calls.set(cid, k); return k;
    }
    call(peer, stream, opts = {}) {
      const cid = rid(), k = this.mkCall(peer, cid, opts.metadata);
      stream.getTracks().forEach(t => k.pc.addTrack(t, stream));
      k.pc.createOffer().then(o => k.pc.setLocalDescription(o)).then(() => post({ t: 'offer', from: this.id, to: peer, cid, sdp: k.pc.localDescription.toJSON(), meta: opts.metadata }));
      return k;
    }
    destroy() { if (this.dead) return; for (const c of [...this.conns.values()]) c.close(); for (const k of [...this.calls.values()]) k.close(); this.dead = true; clearInterval(this.hb); const i = subs.indexOf(this.unsub); if (i >= 0) subs.splice(i, 1); }
  }
  // the real PeerJS bundle in the page assigns window.Peer later; keep this one
  Object.defineProperty(window, 'Peer', { get: () => FakePeer, set() { }, configurable: false });
})();
