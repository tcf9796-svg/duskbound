// Shared helpers for the end-to-end tests: launches Chromium, gives every player its own context (own profile),
// and relays the fake room's messages between all pages.
const { chromium, devices } = require('playwright'); const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
async function launch(opts = {}) {
  const browser = await chromium.launch({ args: opts.args || [] }); const pages = [];
  const relay = async (src, ch, s) => { for (const p of pages) if (p !== src && !p.isClosed()) p.evaluate(([c, x]) => window.__busDeliver && window.__busDeliver(c, x), [ch, s]).catch(() => { }); };
  async function player(name, o = {}) {
    const ctx = o.ctx || await browser.newContext({ viewport: { width: 1000, height: 560 }, ...(o.device ? devices[o.device] : {}), ...(o.contextOptions || {}) });
    if (!o.ctx) { await ctx.exposeBinding('__busSend', ({ page }, ch, s) => relay(page, ch, s)); if (o.init) await ctx.addInitScript(o.init); if (!o.real) await ctx.addInitScript({ path: path.join(__dirname, o.fake || 'fake-room.js') }); }
    const page = await ctx.newPage(); page.errors = []; page.on('pageerror', e => page.errors.push(name + ': ' + e.message));
    pages.push(page); await page.goto('file://' + path.join(ROOT, 'dist', o.build || 'artifact.html')); await page.waitForTimeout(250);
    if (o.name !== false) await page.fill('#nm', name);
    page.ctx = ctx; return page;
  }
  async function hostAndJoin(host, ...guests) {
    await host.click('#hostb'); await host.waitForFunction(() => net.ready, null, { timeout: 10000 });
    const code = await host.evaluate(() => net.code);
    for (const g of guests) { await g.fill('#code', code); await g.click('#joinb'); }
    await host.waitForFunction(n => net.lobby.length === n, guests.length + 1, { timeout: 15000 });
    return code;
  }
  return { browser, player, hostAndJoin, pages, close: () => browser.close() };
}
function checker() { let fails = 0, n = 0; const ok = (c, m) => { n++; console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; }; ok.done = () => { console.log((fails ? 'FAILED ' + fails : 'all passed') + ' (' + n + ' checks)'); return fails; }; return ok; }
module.exports = { launch, checker, ROOT };
