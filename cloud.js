'use strict';
// Online profiles (optional). Signs in with email + password (no email is sent, so it also works inside the iPhone
// Home Screen app) and keeps the player's profile in a Supabase table, so the same profile is used everywhere.
// Plain fetch against Supabase's REST API, no library. Setup: DESIGN.md "Online profiles" and server/supabase.sql.
// With url/key empty the feature is off and the game keeps profiles in this browser only, exactly as before.
// `key` is the project's publishable (public) key; never put a secret / service_role key here.
const CLOUD_CONFIG = { url: 'https://ojsjccqugdnuhhmewtqy.supabase.co', key: 'sb_publishable_uNDD9_9wWTcUE6gttWSLQQ_5rcocNfJ' };

const Cloud = {
  SESSION_KEY: 'duskbound-cloud',
  session: null, // { access, refresh, exp (ms), uid, email }
  lastSync: 0, error: '', busy: false,
  // Off without a config, and on the claude.ai page (it cannot reach other servers).
  enabled: () => !!(CLOUD_CONFIG.url && CLOUD_CONFIG.key && typeof fetch === 'function' && !window.DUSK_NO_NET),
  signedIn() { return !!(this.session && this.session.uid); },
  load() {
    try { const s = JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); if (s && typeof s.refresh === 'string' && typeof s.uid === 'string') this.session = s; } catch (e) { }
  },
  store() { try { if (this.session) localStorage.setItem(this.SESSION_KEY, JSON.stringify(this.session)); else localStorage.removeItem(this.SESSION_KEY); } catch (e) { } },
  async call(path, opt = {}, auth = true) {
    const h = { apikey: CLOUD_CONFIG.key, 'Content-Type': 'application/json' };
    if (auth && this.session) h.Authorization = 'Bearer ' + this.session.access;
    const r = await fetch(CLOUD_CONFIG.url.replace(/\/+$/, '') + path, { method: opt.method || 'GET', headers: Object.assign(h, opt.headers || {}), body: opt.body ? JSON.stringify(opt.body) : undefined });
    const txt = await r.text(); let data = null; try { data = txt ? JSON.parse(txt) : null; } catch (e) { }
    if (!r.ok) { const e = new Error((data && (data.msg || data.message || data.error_description || data.error)) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return data;
  },
  setSession(d) {
    if (!d || !d.access_token || !d.refresh_token || !d.user) throw new Error('bad session');
    this.session = { access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (d.expires_in || 3600) * 1000, uid: d.user.id, email: d.user.email || '' };
    this.store();
  },
  async signIn(email, password) { this.setSession(await this.call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }, false)); },
  // New account: signed in straight away (the project skips email confirmation).
  async signUp(email, password) {
    const d = await this.call('/auth/v1/signup', { method: 'POST', body: { email, password } }, false);
    if (d && d.access_token) this.setSession(d); else throw new Error('confirm-email');
  },
  // Forgotten password: Supabase emails a link back to the game, which then asks for a new password.
  async recover(email) { await this.call('/auth/v1/recover?redirect_to=' + encodeURIComponent(location.href.split('#')[0].split('?')[0]), { method: 'POST', body: { email } }, false); },
  async setPassword(password) { await this.fresh(); await this.call('/auth/v1/user', { method: 'PUT', body: { password } }); },
  // Arriving from an emailed link (#access_token=...&type=recovery): sign in from it and tidy the address bar.
  async fromLink() {
    const q = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    if (!q.get('access_token') || !q.get('refresh_token')) return null;
    try { history.replaceState(null, '', location.href.split('#')[0]); } catch (e) { }
    this.session = { access: q.get('access_token'), refresh: q.get('refresh_token'), exp: Date.now() + (Number(q.get('expires_in')) || 3600) * 1000, uid: '', email: '' };
    try { const u = await this.call('/auth/v1/user'); this.session.uid = u.id; this.session.email = u.email || ''; this.store(); return q.get('type') || 'link'; }
    catch (e) { this.session = null; return null; }
  },
  async fresh() {
    if (!this.session) throw new Error('signed out');
    if (Date.now() < this.session.exp - 60000) return;
    try { this.setSession(await this.call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: this.session.refresh } }, false)); }
    catch (e) { if (e.status === 400 || e.status === 401) this.signOut(); throw e; }
  },
  signOut() { this.session = null; this.store(); },
  async pull() {
    await this.fresh();
    const rows = await this.call('/rest/v1/profiles?select=data&user_id=eq.' + encodeURIComponent(this.session.uid));
    return Array.isArray(rows) && rows[0] ? rows[0].data : null;
  },
  async push(data) {
    await this.fresh();
    await this.call('/rest/v1/profiles?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: [{ user_id: this.session.uid, data, updated_at: new Date().toISOString() }] });
  }
};
Cloud.load();
