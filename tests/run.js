// Usage: node tests/run.js [fuzz|admin|location]   (no argument = run all three)
// Runs app.js against ~2 million randomized operations with a stubbed DOM and mocked network/GPS.
const fs = require('fs'), vm = require('vm'), path = require('path');
const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function makeContext() {
  const store = {}; const ls = { fail: false, getItem: k => (k in store ? store[k] : null), setItem(k, v) { if (ls.fail) throw new Error('QuotaExceeded'); store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const cache = {};
  const mk = () => { const o = {}; const p = new Proxy(function () {}, {
    get: (t, k) => { if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'style' || k === 'dataset') return o[k] || (o[k] = {}); if (k === 'querySelectorAll') return () => []; if (k in o) return o[k];
      if (k === Symbol.toPrimitive) return () => ''; if (['value', 'textContent', 'innerHTML', 'href', 'src', 'title'].includes(k)) return ''; return p; },
    set: (t, k, v) => { o[k] = v; return true; }, apply: () => p }); return p; };
  const doc = { querySelector: s => cache[s] || (cache[s] = mk()), querySelectorAll: () => [], addEventListener() {}, head: mk(), body: mk(), createElement: () => mk() };
  const win = { addEventListener() {}, scrollTo() {}, isSecureContext: true, localStorage: ls };
  return vm.createContext({ document: doc, window: win, localStorage: ls, location: { hash: '', pathname: '/', search: '' }, history: { replaceState() {} }, navigator: {}, console, setTimeout, clearTimeout, Intl, TextDecoder, atob, Uint8Array, JSON, Math, Date, AbortController, fetch: () => Promise.reject(new Error('offline')), URL: Object.assign(function () {}, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }), Blob: class {}, confirm: () => true });
}

async function runSuite(name) {
  const inner = fs.readFileSync(path.join(__dirname, `${name}.inner.js`), 'utf8');
  const ctx = makeContext(); if (process.env.N_SCEN) ctx.N_SCEN_OVERRIDE = process.env.N_SCEN;
  await vm.runInContext(appSource + '\n' + inner, ctx, { timeout: 240000 });
  if (ctx.__failed) { process.exitCode = 1; console.log(`FAILED: ${name}`); }
}

(async () => {
  const wanted = process.argv[2] ? [process.argv[2].replace(/\.inner\.js$/, '')] : ['fuzz', 'admin', 'location'];
  for (const name of wanted) { console.log(`\n=== ${name} ===`); await runSuite(name); }
  try { vm.runInContext(appSource + "\ngenerateId(Array.from({length:90000},(_, i)=>({id:'CAI-'+(10000+i)})))", makeContext(), { timeout: 3000 }); console.log('\ngenerateId with all 90,000 IDs used: OK'); }
  catch (e) { console.log('BUG: generateId hangs when all 90,000 IDs are used (' + e.message + ')'); process.exitCode = 1; }
})().catch(e => { console.error('TEST HARNESS ERROR', e); process.exitCode = 1; });
