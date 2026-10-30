const N = 1000000, fails = {};
const note = (k, e) => { const f = fails[k] || (fails[k] = { count: 0, sample: '' }); f.count++; if (!f.sample) f.sample = String(e).slice(0, 90); };
const POOL = ['a','b','Z','9','@','.','_','-',' ','<','>','"',"'",'&','é','इ','ं','द','ौ','र','😀','\n','/','=','+','\\'];
const rs = (n = 1 + Math.floor(Math.random() * 12)) => Array.from({ length: n }, () => POOL[Math.floor(Math.random() * POOL.length)]).join('');
const dev = n => Array.from({ length: n }, () => 'कखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह'[Math.floor(Math.random() * 33)]).join('');
const junk = () => [null, undefined, 0, 'x', [], {}, { issue: rs(), address: rs(), status: rs(), createdAt: rs() }, { address: 5 }, { issue: 'Pothole' }][Math.floor(Math.random() * 9)];
function parseCsv(text) { const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\r') { /* record separator, handled at \n */ } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); } return rows; }
for (let i = 0; i < N; i++) {
  const t = i % 19;
  try { switch (t) {
    case 0: { const s = rs(40); if (/[<>"']/.test(escapeHtml(s))) note('escapeHtml leaks HTML chars', s); break; }
    case 1: { const e = rs(8) + '@' + rs(5), n = nameFromEmail(e); if (!n || /[\d@]/.test(n)) note('nameFromEmail bad output', e); break; }
    case 2: { const n = firstNameOf({ name: rs(), email: rs() }); if (!n) note('firstNameOf empty', ''); break; }
    case 3: { const a = 'इंदौर ' + dev(6), b = 'इंदौर ' + dev(6); if (a !== b && analyzeDuplicate('Pothole', b, [{ issue: 'Pothole', address: a, status: 'Under Review' }])) note('non-English addresses wrongly flagged duplicate', a + ' | ' + b); break; }
    case 4: analyzeDuplicate('Pothole', rs(), [junk(), junk(), junk()]); break;
    case 5: { const r = [{ id: 'CAI-12345' }], id = generateId(r); if (!/^CAI-\d{5,}$/.test(id) || id === 'CAI-12345') note('generateId bad', id); break; }
    case 6: { const s = shortDate(Math.random() < .5 ? rs() : NaN); if (typeof s !== 'string') note('shortDate', s); break; }
    case 7: { localStorage.setItem(STORAGE_KEY, ['{', '[1,null,"x"]', '{"a":1}', JSON.stringify([junk(), junk()]), rs()][i % 5]); const r = readReports(); if (!Array.isArray(r) || r.some(x => !x || typeof x !== 'object')) note('readReports returns non-objects', JSON.stringify(r).slice(0, 60)); break; }
    case 8: { const out = reportRow({ id: rs(), issue: '<img src=x onerror=1>', address: '<b>' + rs(), description: '<script>', status: 'Resolved', createdAt: rs() }); if (/<img|<script|<b>/.test(out)) note('XSS in reportRow', out.slice(0, 60)); break; }
    case 9: { localStorage.fail = true; try { saveReports([{ id: 'x' }]); } catch (e) { note('saveReports throws when storage fails', e); } localStorage.fail = false; break; }
    case 10: { if (typeof csvCell === 'function') { const c = csvCell('=' + rs()); if (/^"?[=+\-@]/.test(c)) note('csv formula injection', c); }
               const before = localStorage.getItem(SESSION_KEY); handleGoogleCredential({ credential: rs(30) }); if (localStorage.getItem(SESSION_KEY) !== before) note('garbage Google token created a session', ''); break; }

    case 11: { // CSV export round-trip: hostile text must survive Excel-style parsing, unchanged except the formula guard
      const rows = Array.from({ length: 1 + (i % 3) }, () => ({ id: rs(), issue: rs(), address: rs(30), description: rs(40) + '\r\n' + rs(10), status: 'Under Review', department: rs(), severity: 'High', score: Math.floor(Math.random() * 100), createdAt: new Date(Math.random() * 2e12).toISOString(),
        lat: (Math.random() * 180 - 90).toFixed(5), lng: (Math.random() * 360 - 180).toFixed(5), city: rs(), state: rs(), locSource: 'gps' }));
      const parsed = parseCsv(reportsToCsv(rows));
      if (parsed.length !== rows.length + 1) { note('csv row count wrong', parsed.length + ' vs ' + (rows.length + 1)); break; }
      if (parsed[0].join(',') !== CSV_COLUMNS.join(',')) note('csv header wrong', parsed[0].join(','));
      rows.forEach((r, k) => { const cells = parsed[k + 1]; if (cells.length !== CSV_COLUMNS.length) { note('csv column count wrong', cells.length); return; }
        const want = { id: r.id, issue: r.issue, address: r.address, description: r.description, city: r.city, state: r.state };
        for (const col in want) { const exp = /^[=+\-@\t\r]/.test(want[col]) ? "'" + want[col] : want[col]; if (cells[CSV_COLUMNS.indexOf(col)] !== exp) note('csv cell corrupted: ' + col, JSON.stringify(want[col]).slice(0, 50)); }
        const lat = Number(cells[CSV_COLUMNS.indexOf('latitude')]), lng = Number(cells[CSV_COLUMNS.indexOf('longitude')]);
        if (Math.abs(lat - Number(r.lat)) > 1e-5 || Math.abs(lng - Number(r.lng)) > 1e-5) { if (!(Number(r.lat) === 0 && Number(r.lng) === 0)) note('csv coordinates wrong', r.lat + ',' + r.lng + ' -> ' + lat + ',' + lng); }
        if (cells[CSV_COLUMNS.indexOf('score')] !== String(r.score)) note('csv score wrong', cells[CSV_COLUMNS.indexOf('score')]); });
      break; }
    case 12: { // toCoord / cleanLoc: junk in -> null or a valid, stable point; never throws
      const raw = [() => rs(), () => Math.random() * 400 - 200, () => null, () => undefined, () => NaN, () => '', () => ({}), () => [], () => true, () => String((Math.random() * 180 - 90).toFixed(6)), () => 0, () => '0', () => Infinity][Math.floor(Math.random() * 13)];
      const c = toCoord(raw(), raw());
      if (c && (!(Math.abs(c.lat) <= 90) || !(Math.abs(c.lng) <= 180) || typeof c.lat !== 'number')) note('toCoord returned invalid point', JSON.stringify(c));
      const loc = cleanLoc({ lat: raw(), lng: raw(), city: raw(), state: raw(), address: raw(), source: rs(), accuracy: raw() });
      if (loc) { const again = cleanLoc(loc); if (JSON.stringify(again) !== JSON.stringify(loc)) note('cleanLoc not idempotent', JSON.stringify(loc)); if (!SOURCE_LABEL[loc.source]) note('cleanLoc bad source', loc.source); }
      if (cleanLoc(raw()) !== null) note('cleanLoc accepted a non-object', ''); break; }
    case 13: { // geocoder / IP provider payloads of any shape
      const j = () => [null, undefined, {}, [], 'x', 5, { lat: rs(), lon: rs(), address: 'oops' }, { lat: '28.61', lon: '77.21', display_name: rs(), address: { road: rs(), city: rs() } }, { geometry: { coordinates: [77.2, 28.6] }, properties: { name: rs(), city: rs() } }, { geometry: { coordinates: 'zz' } }, { success: false }, { latitude: '28.6', longitude: '77.2', city: rs() }][Math.floor(Math.random() * 12)];
      const outs = [fromNominatim(j()), fromNominatim(j(), { short: true }), fromPhoton(j()), ...IP_PROVIDERS.map(([, shape]) => { try { return shape(j() ?? {}); } catch { return null; } })];
      outs.forEach(o => { const l = cleanLoc({ ...(o || {}), source: 'manual' }); if (l && !toCoord(l.lat, l.lng)) note('normalizer produced invalid loc', JSON.stringify(l)); }); break; }
    case 14: { // "lat, lng" typed into the search box
      const la = (Math.random() * 178 - 89).toFixed(1 + (i % 5)), ln = (Math.random() * 358 - 179).toFixed(1 + (i % 5)), sep = [', ', ',', ' ', '  ,  '][i % 4];
      if (Number(la) !== 0 || Number(ln) !== 0) { const p = parseCoordinates(la + sep + ln); if (!p || Math.abs(p.lat - Number(la)) > 1e-5 || Math.abs(p.lng - Number(ln)) > 1e-5) note('parseCoordinates failed on valid input', la + sep + ln); }
      const g = parseCoordinates(rs(12)); if (g && !toCoord(g.lat, g.lng)) note('parseCoordinates invalid output', rs()); break; }
    case 15: { // duplicate detection by place: same spot (<=30 m) flagged, >=120 m away not (different wording)
      const lat = Math.random() * 120 - 60, lng = Math.random() * 300 - 150, dLat = (0.00009 * Math.random()), far = 0.0011 + Math.random() * 0.01;
      const open = [{ id: 'CAI-1', issue: 'Pothole', address: 'First wording ' + rs(5), status: 'In Progress', lat, lng }];
      if (!analyzeDuplicate('Pothole', 'Totally different text ' + rs(6), open, { lat: lat + dLat, lng })) note('duplicate at same spot missed', lat + ',' + lng);
      if (analyzeDuplicate('Pothole', 'Another wording ' + rs(6), open, { lat: lat + far, lng })) note('far-away report flagged duplicate', String(far));
      if (analyzeDuplicate('Streetlight', 'x ' + rs(6), open, { lat, lng })) note('different issue flagged duplicate', '');
      open[0].status = 'Resolved'; if (analyzeDuplicate('Pothole', 'x ' + rs(6), open, { lat, lng })) note('resolved report flagged duplicate', ''); break; }
    case 16: { const a = toCoord(Math.random() * 170 - 85, Math.random() * 350 - 175), b = toCoord(Math.random() * 170 - 85, Math.random() * 350 - 175);
      if (a && b) { const d1 = metersBetween(a, b), d2 = metersBetween(b, a); if (!(d1 >= 0) || Math.abs(d1 - d2) > 1e-6 || metersBetween(a, a) !== 0 || d1 > 20040000) note('metersBetween invalid', d1 + ' ' + d2); } break; }
    case 17: { // admin location row + map popup must escape stored data
      const evil = '<img src=x onerror=alert(1)>' + rs(); const out = adminLocation({ id: evil, lat: 28.6, lng: 77.2, city: evil, state: '"><script>' });
      if (/<img|<script/.test(out)) note('XSS in adminLocation', out.slice(0, 80)); if (!/No map coordinates/.test(adminLocation({ id: 'x', lat: 'abc' + rs(), lng: 'x' + rs() }))) note('adminLocation shows bogus coords', ''); break; }
    case 18: { // editing the address text drops the attached point; untouched text keeps it
      const t = rs(10).trim(); reportLocation = { lat: 1, lng: 2, text: t }; document.querySelector('#address').value = t; onAddressTyped(); if (!reportLocation) note('point dropped though text unchanged', t);
      document.querySelector('#address').value = t + 'x'; onAddressTyped(); if (reportLocation) note('stale point kept after edit', t); reportLocation = null; break; }
  } } catch (e) { note(`throws in case ${t}`, e); }
}
console.log(JSON.stringify({ iterations: N, failures: fails }, null, 1)); if (Object.keys(fails).length) globalThis.__failed = true;
