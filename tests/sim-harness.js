// Headless simulation harness for Node tests: loads the game's real scripts (in index.html order) into vm contexts
// with stubbed browser APIs, so game logic can be exercised without a browser. No dependencies.
const vm = require('vm'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const FILES = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/<script src="([a-z0-9]+\.js)(\?v=\d+)?"><\/script>/g).map(t => t.match(/src="([a-z0-9]+\.js)/)[1]);
const SRC = FILES.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');

function makeCtx2d() {
  return new Proxy({}, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop() { } });
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createPattern') return () => ({});
      return () => { };
    },
    set(t, k, v) {
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('ctx.' + String(k) + ' set to ' + v);
      t[k] = v; return true;
    }
  });
}
const cl = () => ({ add() { }, remove() { }, toggle() { }, contains: () => false });
function el() { return { addEventListener() { }, style: {}, classList: cl(), getContext: () => makeCtx2d(), querySelectorAll: () => [], querySelector: () => null, value: '', className: '', innerHTML: '', textContent: '', dataset: {}, focus() { }, blur() { } }; }

function makeWorld(store) {
  const els = {};
  const sandbox = {
    console, setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false, addEventListener() { } }), addEventListener() { },
    requestAnimationFrame() { }, performance: { now: () => 0 },
    navigator: { userAgent: 'node', languages: ['en'], language: 'en', maxTouchPoints: 0, platform: 'node' },
    screen: { width: 1280, height: 720 },
    crypto: require('crypto').webcrypto, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    document: { getElementById: id => els[id] || (els[id] = el()), createElement: () => el(), documentElement: { style: {}, lang: 'en' }, body: { classList: cl(), style: {} }, hidden: false, addEventListener() { }, querySelectorAll: () => [], querySelector: () => null },
    URL: { createObjectURL: () => '' }, Blob: function () { }, location: { search: '', href: 'file:///x', hash: '' }, history: { replaceState() { } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC + '\n;globalThis.__g = { setNetT(v) { NetT = v; } };', sandbox, { filename: 'duskbound' });
  return sandbox;
}
module.exports = { makeWorld, FILES };
