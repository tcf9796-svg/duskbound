'use strict';
// Online profiles (optional). Signs in with an emailed 6-digit code and keeps the player's profile in a Supabase
// table, so the same profile is used in every browser and in the Home Screen app. Plain fetch against Supabase's REST
// API, no library. Setup: DESIGN.md "Online profiles" and server/supabase.sql.
// Left empty, the feature is off and the game keeps profiles in this browser only, exactly as before.
const CLOUD_CONFIG = { url: '', key: '' }; // e.g. { url: 'https://abcd1234.supabase.co', key: '<anon public key>' }

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
    const h = { apikey: CLOUD_CONFIG.key, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (auth && this.session ? this.session.access : CLOUD_CONFIG.key) };
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
  // Step 1: email a sign-in code (an account is created on first use).
  async sendCode(email) { await this.call('/auth/v1/otp', { method: 'POST', body: { email, create_user: true } }, false); },
  // Step 2: the 6-digit code from that email.
  async verify(email, code) { this.setSession(await this.call('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token: String(code).trim() } }, false)); },
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
