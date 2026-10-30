// Location + CSV flows with a mocked network and mocked GPS. ~1,000,000 randomized scenarios (set N_SCEN to change).
const N_SCEN = Number(globalThis.N_SCEN_OVERRIDE) || 1000000, failures = {};
const note = (k, e) => { const f = failures[k] || (failures[k] = { count: 0, sample: '' }); f.count++; if (!f.sample) f.sample = String(e).slice(0, 120); };
const realSetTimeout = setTimeout; setTimeout = (fn, ms, ...a) => realSetTimeout(fn, 0, ...a);   // "hung" providers time out instantly
const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];
const rnd = (a, b) => a + Math.random() * (b - a);
let cfg = {};
const json = body => ({ ok: true, status: 200, json: async () => body });
const bad = status => ({ ok: false, status, json: async () => { throw new Error('no body'); } });
const providerBody = (mode, name, lat, lng) => {
  if (mode === 'ok') return name === 'ipapi' ? json({ latitude: lat, longitude: lng, city: 'Indore', region: 'MP' }) : json({ success: true, latitude: lat, longitude: lng, city: 'Indore', region: 'MP' });
  if (mode === 'http') return bad(pickOne([403, 429, 500]));
  if (mode === 'badjson') return { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } };
  if (mode === 'junk') return json(pickOne([null, {}, [], 'x', { latitude: 'abc', longitude: null }, { latitude: 0, longitude: 0 }, { latitude: 999, longitude: 5 }, { success: false }]));
  return null; // hang
};
fetch = (url, opts) => {
  const u = String(url);
  const ipIdx = u.includes('ipapi.co') ? 0 : u.includes('ipwho.is') ? 1 : u.includes('geojs.io') ? 2 : -1;
  if (ipIdx >= 0) { const mode = cfg.ip[ipIdx]; return mode === 'hang' ? new Promise(() => {}) : mode === 'throw' ? Promise.reject(new Error('net')) : Promise.resolve(providerBody(mode, ipIdx === 0 ? 'ipapi' : 'other', cfg.ipLat, cfg.ipLng)); }
  if (u.includes('nominatim') && u.includes('/reverse')) return cfg.rev === 'ok' ? Promise.resolve(json({ display_name: 'Full name', address: { house_number: '12', road: 'MG Road', suburb: 'Vijay Nagar', city: 'Indore', state: 'Madhya Pradesh' } })) : cfg.rev === 'noaddr' ? Promise.resolve(json({ error: 'Unable to geocode' })) : cfg.rev === 'hang' ? new Promise(() => {}) : Promise.reject(new Error('net'));
  if (u.includes('photon.komoot.io/reverse')) return cfg.photon === 'ok' ? Promise.resolve(json({ features: [{ geometry: { coordinates: [75.9, 22.7] }, properties: { name: 'Photon Place', city: 'Indore', state: 'MP' } }] })) : cfg.photon === 'empty' ? Promise.resolve(json({ features: [] })) : Promise.reject(new Error('net'));
  if (u.includes('nominatim') && u.includes('/search')) return cfg.search === 'ok' ? Promise.resolve(json([{ lat: '22.7196', lon: '75.8577', display_name: 'Indore, MP, India', address: { city: 'Indore', state: 'Madhya Pradesh' } }, { lat: 'zz', lon: '1', display_name: 'junk' }])) : cfg.search === 'junk' ? Promise.resolve(json({ not: 'an array' })) : cfg.search === 'empty' ? Promise.resolve(json([])) : cfg.search === 'http' ? Promise.resolve(bad(429)) : Promise.reject(new Error('net'));
  if (u.includes('photon.komoot.io/api')) return cfg.photon === 'ok' ? Promise.resolve(json({ features: [{ geometry: { coordinates: [75.9, 22.7] }, properties: { name: 'Photon Place', city: 'Indore', state: 'MP' } }, { geometry: { coordinates: ['a', 'b'] } }] })) : Promise.reject(new Error('net'));
  return Promise.reject(new Error('unexpected url ' + u));
};
const geo = () => {
  const mode = cfg.gps; if (mode === 'absent') return undefined;
  return { getCurrentPosition(ok, fail, options) {
    cfg.gpsCalls++;
    const err = code => fail({ code, message: 'x' });
    if (mode === 'ok') return ok({ coords: { latitude: cfg.gpsLat, longitude: cfg.gpsLng, accuracy: cfg.acc } });
    if (mode === 'denied') return err(1);
    if (mode === 'unavailable') return err(2);
    if (mode === 'timeout') return err(3);
    if (mode === 'timeout-then-ok') return options.enableHighAccuracy ? err(3) : ok({ coords: { latitude: cfg.gpsLat, longitude: cfg.gpsLng, accuracy: 900 } });
    if (mode === 'junk') return ok({ coords: { latitude: pickOne([NaN, null, 0, 'x', 500]), longitude: pickOne([NaN, undefined, 0, 'y', 999]), accuracy: 5 } });
    if (mode === 'throws') throw new Error('boom');
    if (mode === 'no-callback') return;      // never answers -> not part of the random mix (would hang); kept for documentation
  } };
};
const validLoc = l => l && Number.isFinite(l.lat) && Number.isFinite(l.lng) && Math.abs(l.lat) <= 90 && Math.abs(l.lng) <= 180 && !(l.lat === 0 && l.lng === 0) && ['gps', 'ip', 'manual', 'pin'].includes(l.source);
const newCfg = () => ({
  gps: pickOne(['ok', 'ok', 'ok', 'denied', 'unavailable', 'timeout', 'timeout-then-ok', 'junk', 'throws', 'absent']), gpsLat: rnd(-80, 80), gpsLng: rnd(-170, 170), acc: rnd(3, 1500), gpsCalls: 0,
  secure: Math.random() < 0.85, ip: [0, 1, 2].map(() => pickOne(['ok', 'ok', 'http', 'badjson', 'junk', 'throw', 'throw', 'hang'])), ipLat: rnd(-80, 80), ipLng: rnd(-170, 170),
  rev: pickOne(['ok', 'ok', 'noaddr', 'fail', 'hang']), photon: pickOne(['ok', 'empty', 'fail']), search: pickOne(['ok', 'ok', 'junk', 'empty', 'http', 'fail'])
});
const gpsWorks = c => c.secure && ['ok', 'timeout-then-ok'].includes(c.gps);
const ipWorks = c => c.ip.includes('ok');
const reset = () => { currentLocation = null; reportLocation = null; for (const k in maps) delete maps[k]; localStorage.removeItem(LOCATION_KEY); };

(async () => {
  for (let i = 0; i < N_SCEN; i++) {
    cfg = newCfg(); navigator = { geolocation: geo() }; window.isSecureContext = cfg.secure; reset();
    const kind = i % 10;
    try {
      if (kind <= 4) {                                   // 50%: full detect flow
        const out = await detectLocation({ silent: Math.random() < 0.5, fillAddress: Math.random() < 0.3 });
        if (gpsWorks(cfg)) { if (!out || out.source !== 'gps') note('GPS worked but result is not GPS', JSON.stringify(out)); else if (Math.abs(out.lat - cfg.gpsLat) > 1e-4 || Math.abs(out.lng - cfg.gpsLng) > 1e-4) note('GPS coordinates changed', JSON.stringify(out)); }
        else if (ipWorks(cfg)) { if (!out || out.source !== 'ip') note('GPS unusable but IP fallback not used', cfg.gps + ' ' + cfg.ip + ' -> ' + JSON.stringify(out)); }
        else if (out) note('got a location although everything failed', JSON.stringify(out));
        if (out) { if (!validLoc(out)) note('invalid location returned', JSON.stringify(out)); if (JSON.stringify(currentLocation) !== JSON.stringify(out)) note('currentLocation not applied', ''); const saved = readSavedLocation(); if (!saved || saved.lat !== out.lat) note('location not persisted', ''); }
        else if (currentLocation) note('failed detect still changed currentLocation', '');
        if (cfg.gps === 'timeout-then-ok' && cfg.secure && cfg.gpsCalls !== 2) note('low-accuracy retry not attempted', cfg.gpsCalls);
        if (cfg.gps === 'denied' && cfg.secure && cfg.gpsCalls !== 1) note('retried GPS after permission denied', cfg.gpsCalls);
      } else if (kind === 5) {                            // stale detection must lose to a manual choice
        const pending = detectLocation({ silent: true });
        chooseManually({ lat: 19.076, lng: 72.8777, city: 'Mumbai', state: 'Maharashtra', address: 'Mumbai' });
        await pending;
        if (!currentLocation || currentLocation.city !== 'Mumbai' || currentLocation.source !== 'manual') note('stale auto-detect overwrote manual choice', JSON.stringify(currentLocation));
      } else if (kind === 6) {                            // auto-detect never overrides manual/pin; offline never throws
        currentLocation = cleanLoc({ lat: 12.97, lng: 77.59, city: 'Bengaluru', source: pickOne(['manual', 'pin']) });
        const before = JSON.stringify(currentLocation); await autoDetectLocation();
        if (JSON.stringify(currentLocation) !== before) note('autoDetect overrode a manual location', JSON.stringify(currentLocation));
      } else if (kind === 7) {                            // search: never throws, only valid places
        const q = pickOne(['indore', 'vijay nagar', 'ab', '22.7196, 75.8577', ' ', 'लाल बाग']);
        const res = await searchPlaces(q);
        if (!Array.isArray(res) || res.some(p => !validLoc(p))) note('searchPlaces returned invalid data', JSON.stringify(res).slice(0, 100));
        if (q === '22.7196, 75.8577' && (res.length !== 1 || res[0].lat !== 22.7196)) note('coordinate search wrong', JSON.stringify(res));
        if (q.trim().length < 3 && res.length) note('short query returned results', q);
        const g = await geocodeAddress('12 MG Road Indore'); if (g && !validLoc(g)) note('geocodeAddress invalid', JSON.stringify(g));
      } else if (kind === 8) {                            // map pin: reverse geocode failure still keeps the pin
        const lat = rnd(-80, 80), lng = rnd(-170, 170);
        await onPin('home', { lat, lng });
        if (!currentLocation || Math.abs(currentLocation.lat - lat) > 1e-4 || currentLocation.source !== 'pin') note('pin not applied', JSON.stringify(currentLocation));
        if (currentLocation && !currentLocation.address) note('pin has no address text', '');
        document.querySelector('#address').value = ''; await onPin('report', { lat, lng });
        if (!reportLocation || Math.abs(reportLocation.lat - lat) > 1e-4) note('report pin not applied', JSON.stringify(reportLocation));
        await onPin('home', { lat: pickOne([NaN, 999, null]), lng: pickOne([NaN, 999, undefined]) }); // junk click is ignored
      } else {                                           // corrupted saved location must be ignored, not crash
        localStorage.setItem(LOCATION_KEY, pickOne(['{', 'null', '"x"', '{"lat":"a","lng":1}', '{"lat":0,"lng":0}', '[]', '{"lat":28.6,"lng":77.2,"city":{"a":1},"source":"hack"}']));
        const saved = readSavedLocation(); if (saved && !validLoc(saved)) note('corrupt saved location accepted', JSON.stringify(saved));
        if (saved) applyLocation(saved, { persist: false });
      }
    } catch (e) { note(`throws in kind ${kind}`, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e); }
  }
  console.log(JSON.stringify({ scenarios: N_SCEN, failures }, null, 1));
  if (Object.keys(failures).length) globalThis.__failed = true;
})();
