// Auto-update on the website / Home Screen app: an old cached index.html reloads itself to the newer ?v= once the
// server has it — on the main menu only, never during a run, and only once per version.
// Run: node tests/e2e/update.test.js   (serves the repo files from a fake origin; no build needed)
const { chromium } = require('playwright'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..'); let fails = 0, n = 0;
const ok = (c, m) => { n++; console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(), page = await (await b.newContext()).newPage();
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8'), cur = +html.match(/game\.js\?v=(\d+)/)[1];
  let served = cur, loads = 0; const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.route('http://dusk.test/**', r => {
    const u = new URL(r.request().url()); let p = u.pathname.replace(/^\/duskbound\//, '') || 'index.html';
    if (p === 'index.html') { if (r.request().resourceType() === 'document') loads++; return r.fulfill({ contentType: 'text/html', body: html.replace(/\?v=\d+"/g, '?v=' + served + '"'), headers: { 'cache-control': 'max-age=600' } }); }
    const f = path.join(root, p); if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
    r.fulfill({ body: fs.readFileSync(f), contentType: p.endsWith('.js') ? 'text/javascript' : p.endsWith('.png') ? 'image/png' : 'application/octet-stream' });
  });
  await page.goto('http://dusk.test/duskbound/'); await page.waitForTimeout(2500);
  ok(loads === 1, 'same version on the server: no reload');
  // a run is going when the new version lands: no reload mid-run
  await page.click('#solo'); await page.waitForTimeout(300); served = cur + 1;
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(1500);
  ok(loads === 1 && await page.evaluate(() => game.state === 'play'), 'newer version while playing: the run is left alone');
  // back on the main menu: comes back to the front -> reloads to the new version
  await page.evaluate(() => showMenu()); await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(v => (document.querySelector('script[src*="game.js?v="]') || {}).src?.includes('v=' + v), cur + 1, { timeout: 8000 }).catch(() => { });
  ok(loads === 2 && await page.evaluate(v => document.querySelector('script[src*="game.js?v="]').getAttribute('src').endsWith('v=' + v), cur + 1), 'on the menu: reloads to the new version');
  await page.waitForTimeout(2500); ok(loads === 2, 'up to date afterwards: no further reloads');
  ok(errors.length === 0, 'no page errors ' + JSON.stringify(errors));
  await b.close(); console.log((fails ? 'FAILED ' + fails : 'all passed') + ' (' + n + ' checks)'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
