/* CivicAI: lightweight browser-only civic reporting prototype. */
const STORAGE_KEY = 'civicai-reports-v1';
const SESSION_KEY = 'civicai-demo-session-v1';
// Paste your Google OAuth Client ID here to enable "Continue with Google" (see README).
const GOOGLE_CLIENT_ID = '';
// Emails that can open the Admin panel (client-side demo only: add real server-side auth before production).
const ADMIN_EMAILS = ['admin@civicai.com'];
const STATUSES = ['Under Review', 'In Progress', 'Resolved'];
let currentUser = null;
const LOCATION_KEY = 'civicai-location-v1';
const USERS_KEY = 'civicai-known-users-v1';
const issueMeta = {
  Pothole: { icon: '🕳️', cls: 'pothole', department: 'Transportation', severity: 'Medium', score: 54 },
  Streetlight: { icon: '💡', cls: 'streetlight', department: 'Street Lighting', severity: 'Medium', score: 48 },
  Graffiti: { icon: '🎨', cls: 'graffiti', department: 'Maintenance', severity: 'Low', score: 31 },
  'Trash & dumping': { icon: '🗑️', cls: 'trash', department: 'Environmental Services', severity: 'Medium', score: 46 },
  'Water leak': { icon: '💧', cls: 'water', department: 'Water Bureau', severity: 'High', score: 79 },
  Other: { icon: '＋', cls: 'other', department: 'Customer Service', severity: 'Low', score: 28 }
};
let selectedIssue = 'Pothole';
let selectedFilter = 'All';
let toastTimeout;
let authMode = 'login';

function safeSet(key, value) { try { localStorage.setItem(key, value); return true; } catch { return false; } }
function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
  catch { return null; }
}

function readUsers() {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}'); }
  catch { return {}; }
}
function saveKnownUser(email, name) {
  if (!email || !name) return;
  const users = readUsers(); users[email] = name;
  try { localStorage.setItem(USERS_KEY, JSON.stringify(users)); } catch {}
}
function titleCase(word) { return word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ''; }
// "adityabais2008@gmail.com" -> "Adityabais", "john.doe@x.com" -> "John"
function nameFromEmail(email) {
  const local = (email || '').split('@')[0].replace(/[0-9]+/g, ' ');
  const first = local.split(/[\s._-]+/).filter(Boolean)[0];
  return titleCase(first) || 'Friend';
}
function firstNameOf(user) {
  const full = (user?.name || '').trim();
  if (full) return titleCase(full.split(/\s+/)[0]);
  return nameFromEmail(user?.email);
}
function greetingForNow() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function updateGreeting(user) {
  document.querySelector('#greeting-text').textContent = greetingForNow();
  document.querySelector('#greeting-name').textContent = firstNameOf(user);
  document.querySelector('#today-date').textContent = new Date()
    .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();
}

/* ---------- Location: automatic (GPS, then internet lookup) + manual (search, "lat, lng", map pin) ---------- */
let currentLocation = null;   // { lat, lng, city, state, area, address, source: gps|ip|manual|pin, accuracy }
let reportLocation = null;    // point attached to the report being written { lat, lng, city, state, source, text }
let locToken = 0;             // bumped on every new choice, so slow/stale lookups are ignored
let pinSeq = 0;
let autoTried = false;
const maps = {};              // Leaflet map state by prefix: home / report / admin
const hasLeaflet = () => typeof L !== 'undefined' && typeof L.map === 'function';
const SOURCE_LABEL = { gps: 'GPS', ip: 'Approximate (internet)', manual: 'Chosen manually', pin: 'Map pin', typed: 'Typed address' };
const CITY_KEYS = ['city', 'town', 'village', 'municipality', 'county', 'state_district'];
const AREA_KEYS = ['neighbourhood', 'suburb', 'quarter', 'city_district'];

// A valid, rounded {lat, lng} (numbers) or null. Accepts numbers or numeric strings only.
function toCoord(lat, lng) {
  const ok = value => typeof value === 'number' || (typeof value === 'string' && value.trim() !== '');
  if (!ok(lat) || !ok(lng)) return null;
  const a = Number(lat), b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180 || (a === 0 && b === 0)) return null;
  return { lat: Number(a.toFixed(5)), lng: Number(b.toFixed(5)) };
}
const clip = value => (typeof value === 'string' || typeof value === 'number') ? String(value).trim().slice(0, 200) : '';
function cleanLoc(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const point = toCoord(raw.lat, raw.lng); if (!point) return null;
  const accuracy = Number(raw.accuracy);
  return { ...point, city: clip(raw.city), state: clip(raw.state), area: clip(raw.area), address: clip(raw.address),
    source: Object.prototype.hasOwnProperty.call(SOURCE_LABEL, raw.source) ? raw.source : 'manual', accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : 0 };
}
function parseCoordinates(text) {
  const match = String(text ?? '').trim().match(/^(-?\d{1,2}\.\d+)\s*[,\s]\s*(-?\d{1,3}\.\d+)$/);
  return match ? toCoord(match[1], match[2]) : null;
}
function metersBetween(a, b) {
  const rad = deg => deg * Math.PI / 180, dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
function readSavedLocation() {
  try { return cleanLoc(JSON.parse(localStorage.getItem(LOCATION_KEY) || 'null')); } catch { return null; }
}
function cityLabel(loc) { return loc.city ? [loc.city, loc.state].filter(Boolean).join(', ') : (loc.address ? loc.address.split(',')[0] : 'Location set'); }
function mapEmbedUrl(query) { return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=16&output=embed`; }
function mapsLink(query) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`; }

// fetch + JSON with a hard timeout (a hung provider must never freeze location detection).
function fetchJson(url, ms = 6000) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { try { controller?.abort(); } catch {} reject(new Error('timeout')); }, ms); });
  const request = (async () => {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller?.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })();
  request.catch(() => {});
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}

/* --- geocoding: OpenStreetMap Nominatim first, Photon (also OSM data) as a backup --- */
const firstOf = (obj, keys) => { for (const key of keys) if (obj && obj[key]) return String(obj[key]); return ''; };
function streetAddress(a, fallback) {
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  return [street, firstOf(a, AREA_KEYS), firstOf(a, CITY_KEYS)].filter(Boolean).join(', ') || fallback || '';
}
function fromNominatim(p, { short = false } = {}) {
  const a = (p && typeof p.address === 'object' && p.address) || {};
  return { lat: p?.lat, lng: p?.lon, city: firstOf(a, CITY_KEYS), state: a.state || '', area: firstOf(a, AREA_KEYS),
    address: short ? streetAddress(a, p?.display_name) : (p?.display_name || streetAddress(a)) };
}
function fromPhoton(feature) {
  const p = feature?.properties || {}, g = feature?.geometry?.coordinates || [];
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const city = p.city || p.town || p.village || p.county || '', area = p.district || p.locality || '';
  return { lat: g[1], lng: g[0], city, state: p.state || '', area, address: [...new Set([p.name, street, area, city, p.state, p.country].filter(Boolean))].join(', ') };
}
async function reverseGeocode(lat, lng) {
  try {
    const data = await fetchJson(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=en&lat=${lat}&lon=${lng}`);
    if (data && !data.error) { const s = fromNominatim(data, { short: true }); return { city: s.city, state: s.state, area: s.area, address: s.address }; }
  } catch {}
  const data = await fetchJson(`https://photon.komoot.io/reverse?lang=en&lat=${lat}&lon=${lng}`);
  const feature = data?.features?.[0]; if (!feature) throw new Error('no address here');
  const s = fromPhoton(feature); return { city: s.city, state: s.state, area: s.area, address: s.address };
}
// Never throws: returns [] when nothing is found or the network is down.
async function searchPlaces(query) {
  const q = String(query ?? '').trim(); if (q.length < 3) return [];
  const exact = parseCoordinates(q);
  if (exact) return [cleanLoc({ ...exact, address: `${exact.lat}, ${exact.lng}`, source: 'manual' })];
  const near = currentLocation && toCoord(currentLocation.lat, currentLocation.lng);
  const viewbox = near ? `&viewbox=${near.lng - 1},${near.lat + 1},${near.lng + 1},${near.lat - 1}` : '';
  let places = [];
  try {
    const data = await fetchJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=en${viewbox}&q=${encodeURIComponent(q)}`);
    places = (Array.isArray(data) ? data : []).map(p => cleanLoc({ ...fromNominatim(p), source: 'manual' })).filter(Boolean);
  } catch {}
  if (!places.length) {
    try {
      const data = await fetchJson(`https://photon.komoot.io/api/?lang=en&limit=6${near ? `&lat=${near.lat}&lon=${near.lng}` : ''}&q=${encodeURIComponent(q)}`);
      places = (Array.isArray(data?.features) ? data.features : []).map(f => cleanLoc({ ...fromPhoton(f), source: 'manual' })).filter(Boolean);
    } catch {}
  }
  return places;
}

/* --- automatic detection: GPS (precise) -> 3 internet providers (approximate) --- */
const IP_PROVIDERS = [
  ['https://ipapi.co/json/', d => ({ lat: d.latitude, lng: d.longitude, city: d.city, state: d.region })],
  ['https://ipwho.is/', d => (d.success === false ? null : { lat: d.latitude, lng: d.longitude, city: d.city, state: d.region })],
  ['https://get.geojs.io/v1/ip/geo.json', d => ({ lat: d.latitude, lng: d.longitude, city: d.city, state: d.region })]
];
async function ipLocation() {
  for (const [url, shape] of IP_PROVIDERS) {
    try {
      const raw = shape(await fetchJson(url, 5000)), point = raw && toCoord(raw.lat, raw.lng);
      if (point) return cleanLoc({ ...point, city: raw.city, state: raw.state, address: [raw.city, raw.state].filter(Boolean).join(', '), source: 'ip' });
    } catch {}
  }
  throw new Error('no ip location');
}
const getPosition = options => new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options));
async function gpsLocation() {
  if (!navigator.geolocation || !window.isSecureContext) { const error = new Error('GPS needs https or localhost'); error.code = 0; throw error; }
  let position;
  try { position = await getPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }); }
  catch (error) { if (error && error.code === 1) throw error; position = await getPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }); }
  const point = toCoord(position?.coords?.latitude, position?.coords?.longitude);
  if (!point) { const error = new Error('bad GPS fix'); error.code = 2; throw error; }
  let place = {}; try { place = await reverseGeocode(point.lat, point.lng); } catch {}
  return cleanLoc({ ...place, ...point, source: 'gps', accuracy: position.coords.accuracy });
}

/* --- maps: Leaflet + OpenStreetMap tiles (draggable pin). Falls back to a Google Maps iframe if Leaflet is unavailable. --- */
const pinIcon = () => L.divIcon({ className: 'civic-pin', html: '<span>📍</span>', iconSize: [30, 30], iconAnchor: [15, 28] });
function mapParts(prefix) {
  return { box: document.querySelector(`#${prefix}-leaf`), frame: document.querySelector(`#${prefix}-map`), holder: document.querySelector(`#${prefix}-map-placeholder`), link: document.querySelector(`#${prefix}-gmaps`) };
}
function ensureMap(prefix, editable) {
  if (maps[prefix]) return maps[prefix];
  const { box } = mapParts(prefix); if (!box) return null;
  const map = L.map(box, { scrollWheelZoom: false }).setView([22.9734, 78.6569], 4);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  const state = maps[prefix] = { map, marker: null, point: null, layer: null, markers: {}, sig: '' };
  if (editable) map.on('click', event => onPin(prefix, event.latlng));
  return state;
}
function showMap(prefix, loc, { editable = false, recenter = true } = {}) {
  const point = loc && toCoord(loc.lat, loc.lng); if (!point) return;
  const { box, frame, holder, link } = mapParts(prefix), query = `${point.lat},${point.lng}`;
  if (link) { link.href = mapsLink(query); link.classList.remove('hidden'); }
  if (holder) holder.classList.add('hidden');
  if (hasLeaflet() && box) {
    const state = ensureMap(prefix, editable);
    box.classList.remove('hidden'); if (frame) frame.classList.add('hidden');
    state.point = point;
    if (!state.marker) {
      state.marker = L.marker([point.lat, point.lng], { draggable: editable, icon: pinIcon() }).addTo(state.map);
      if (editable) state.marker.on('dragend', () => onPin(prefix, state.marker.getLatLng()));
    } else state.marker.setLatLng([point.lat, point.lng]);
    if (recenter) state.map.setView([point.lat, point.lng], loc.source === 'ip' ? 11 : 16); else state.map.panTo([point.lat, point.lng]);
    setTimeout(() => { try { state.map.invalidateSize(); } catch {} }, 60);
    return;
  }
  if (frame) { frame.src = mapEmbedUrl(query); frame.classList.remove('hidden'); }
}
// Maps created while their page was hidden have size 0; fix them once the page is shown.
function refreshMaps() {
  Object.values(maps).forEach(state => {
    try { state.map.invalidateSize(); if (state.point) state.map.setView([state.point.lat, state.point.lng], state.map.getZoom()); } catch {}
  });
}

/* --- applying a location (header chip, greetings, home map) --- */
function applyLocation(raw, { persist = true, recenter = true } = {}) {
  const loc = cleanLoc(raw); if (!loc) return false;
  currentLocation = loc;
  if (persist) { try { localStorage.setItem(LOCATION_KEY, JSON.stringify(loc)); } catch {} }
  document.querySelectorAll('.city-name').forEach(node => { node.textContent = loc.city || 'your city'; });
  document.querySelector('#city-label').textContent = cityLabel(loc);
  document.querySelector('#location-pill').title = `${SOURCE_LABEL[loc.source]} · ${loc.lat}, ${loc.lng} — click to change`;
  showMap('home', loc, { editable: true, recenter });
  if (!reportLocation && !document.querySelector('#address').value.trim()) showMap('report', loc, { editable: true, recenter });
  updateNearby();
  return true;
}
function updateNearby() {
  const count = readReports().length;
  document.querySelector('#nearby-count').textContent = `${count} ${count === 1 ? 'report' : 'reports'}`;
  document.querySelector('#nearby-label').textContent = currentLocation?.area ? `from you in ${currentLocation.area}` : 'from you so far';
}
// Attach a point to the report form (and optionally write its address into the field).
function setReportLocation(raw, { fill = true, recenter = true } = {}) {
  const loc = cleanLoc(raw); if (!loc) return false;
  const input = document.querySelector('#address');
  if (fill) input.value = loc.address || `Near ${loc.lat}, ${loc.lng}`;
  reportLocation = { lat: loc.lat, lng: loc.lng, city: loc.city, state: loc.state, source: loc.source, text: String(input.value).trim() };
  showMap('report', loc, { editable: true, recenter });
  return true;
}
// Map click / marker drag.
async function onPin(prefix, latlng) {
  const point = toCoord(latlng?.lat, latlng?.lng); if (!point) return;
  const rough = { ...point, address: `Near ${point.lat}, ${point.lng}`, source: 'pin' };
  if (prefix === 'home') {
    const token = ++locToken;
    applyLocation(rough, { recenter: false });
    let place = {}; try { place = await reverseGeocode(point.lat, point.lng); } catch {}
    if (token !== locToken) return;
    applyLocation({ ...rough, ...place }, { recenter: false });
    showToast(`Location set: ${cityLabel(currentLocation)}`);
  } else if (prefix === 'report') {
    const token = ++pinSeq;
    setReportLocation(rough, { recenter: false });
    let place = {}; try { place = await reverseGeocode(point.lat, point.lng); } catch {}
    if (token !== pinSeq || !reportLocation || reportLocation.text !== document.querySelector('#address').value.trim()) return;
    setReportLocation({ ...rough, ...place }, { recenter: false });
  }
}

/* --- detection flows --- */
// Button / auto flow. GPS first, internet lookup if GPS is denied/unavailable/times out.
async function detectLocation({ fillAddress = false, silent = false } = {}) {
  const token = ++locToken;
  if (!silent) showToast('Finding your location…');
  let loc = null, approx = false, reason = '';
  try { loc = await gpsLocation(); }
  catch (error) {
    reason = error?.code === 1 ? 'Location permission was denied.' : error?.code === 0 ? 'GPS needs https or localhost (not a file:// page).' : 'Could not get a GPS fix.';
    try { loc = await ipLocation(); approx = true; } catch {}
  }
  if (token !== locToken) return null;                       // a newer choice (manual pick, another detect) won
  if (!loc) { if (!silent) showToast(`${reason} Search your area with the location button at the top, or tap the map.`); return null; }
  applyLocation(loc);
  if (fillAddress) setReportLocation(loc);
  if (!silent) showToast(approx ? `Approximate location: ${cityLabel(loc)} (from internet). Tap the map to fine-tune.` : `Location set: ${cityLabel(loc)}`);
  return loc;
}
// Runs once per page load after sign-in. Never overrides a location the user chose by hand.
async function autoDetectLocation() {
  const saved = currentLocation;
  if (saved && (saved.source === 'manual' || saved.source === 'pin')) return;
  let permission = 'prompt';
  try { permission = (await navigator.permissions.query({ name: 'geolocation' })).state; } catch {}
  if (saved && permission !== 'granted') return;             // keep what we have; don't nag with prompts
  if (permission === 'denied') {
    if (saved) return;
    try { applyLocation(await ipLocation()); } catch {}
    return;
  }
  await detectLocation({ silent: !!saved });
}
function chooseManually(place) {
  locToken++;                                                 // cancel any in-flight automatic detection
  const ok = applyLocation({ ...place, source: place.source === 'pin' ? 'pin' : 'manual' });
  if (ok) showToast(`Location set: ${cityLabel(currentLocation)}`);
}

/* --- search suggestions (location popover + report address) --- */
function attachSuggest(input, list, onPick, { enterPicks = false } = {}) {
  let timer, seq = 0, latest = [];
  const hide = () => list.classList.add('hidden');
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const query = input.value.trim(), mine = ++seq;
    if (query.length < 3) { hide(); return; }
    timer = setTimeout(async () => {
      const results = await searchPlaces(query);
      if (mine !== seq) return;                               // a newer keystroke is already searching
      latest = results; list.innerHTML = '';
      if (!results.length) {
        const none = document.createElement('div'); none.className = 'suggest-empty';
        none.textContent = 'No places found. Try fewer words, "lat, lng", or tap the map to drop a pin.'; list.appendChild(none);
      } else results.forEach(place => {
        const item = document.createElement('button'); item.type = 'button'; item.textContent = place.address;
        item.addEventListener('click', () => { hide(); onPick(place); });
        list.appendChild(item);
      });
      list.classList.remove('hidden');
    }, 450);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') hide();
    if (event.key === 'Enter' && enterPicks && latest[0] && !list.classList.contains('hidden')) { event.preventDefault(); hide(); onPick(latest[0]); }
  });
}
// Editing the address text invalidates any point we attached earlier; it is re-geocoded on submit.
function onAddressTyped() {
  if (reportLocation && reportLocation.text !== document.querySelector('#address').value.trim()) reportLocation = null;
}
async function geocodeAddress(address) {
  let timer; const timeout = new Promise(resolve => { timer = setTimeout(() => resolve([]), 4000); });
  try { const [best] = await Promise.race([searchPlaces(address), timeout]); return best || null; } finally { clearTimeout(timer); }
}

function handleGoogleCredential(response) {
  try {
    const b64 = response.credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), ch => ch.charCodeAt(0))));
    if (!p || typeof p.email !== 'string' || !p.email.includes('@')) throw new Error('bad token');
    const user = { name: p.name || nameFromEmail(p.email), email: p.email, picture: /^https:\/\/[^\s"'()]+$/.test(p.picture || '') ? p.picture : '', google: true };
    saveKnownUser(user.email, user.name);
    safeSet(SESSION_KEY, JSON.stringify(user)); showApplication(user);
    if (location.hash.length > 1) navigate(location.hash.slice(1));
  } catch { document.querySelector('#auth-error').textContent = 'Google sign-in failed. Please try again.'; }
}
function initGoogleLogin() {
  const fallback = document.querySelector('#google-fallback');
  const warn = () => { document.querySelector('#auth-error').textContent = 'Add your Google Client ID in app.js to enable Google sign-in (see README).'; };
  fallback.addEventListener('click', warn);
  if (!GOOGLE_CLIENT_ID) return;
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
  script.onload = () => {
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleGoogleCredential });
    google.accounts.id.renderButton(document.querySelector('#google-btn'), { theme: 'outline', size: 'large', width: 320, text: 'continue_with' });
    fallback.classList.add('hidden');
  };
  document.head.appendChild(script);
}
function isAdmin(user) { return !!user?.email && ADMIN_EMAILS.includes(String(user.email).toLowerCase()); }
/* ---------- Admin: CSV export + report table + map of all reports ---------- */
// Spreadsheet-safe cell: numbers stay numbers; text is quoted, and anything Excel could read as a formula is neutralised.
function csvCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}
const CSV_COLUMNS = ['id', 'issue', 'status', 'severity', 'score', 'department', 'address', 'city', 'state', 'latitude', 'longitude', 'mapLink', 'description', 'duplicateOf', 'locationSource', 'createdAt', 'resolvedAt'];
function csvRecord(report) {
  const point = toCoord(report.lat, report.lng);
  return { ...report, score: Number.isFinite(Number(report.score)) && report.score !== null && report.score !== '' ? Number(report.score) : '',
    latitude: point ? point.lat : '', longitude: point ? point.lng : '', mapLink: point ? mapsLink(`${point.lat},${point.lng}`) : '', locationSource: report.locSource };
}
function reportsToCsv(reports) {
  const rows = (Array.isArray(reports) ? reports : []).filter(report => report && typeof report === 'object' && !Array.isArray(report)).map(csvRecord);
  return [CSV_COLUMNS.join(',')].concat(rows.map(row => CSV_COLUMNS.map(col => csvCell(row[col])).join(','))).join('\r\n') + '\r\n';
}
const localDateStamp = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
// Works in Chrome, Edge, Firefox and Safari (the link must be in the DOM for Firefox). The BOM makes Excel read Hindi/emoji as UTF-8.
function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), link = document.createElement('a');
  link.href = url; link.download = name; link.rel = 'noopener'; link.style.display = 'none';
  document.body.appendChild(link); link.click();
  setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 5000);
}
function exportCsv() {
  const { rows } = adminRows();
  if (!rows.length) { showToast('No reports to export.'); return false; }
  downloadFile(`civicai-reports-${localDateStamp()}.csv`, '﻿' + reportsToCsv(rows), 'text/csv;charset=utf-8');
  showToast(`Exported ${rows.length} ${rows.length === 1 ? 'report' : 'reports'} to CSV.`);
  return true;
}
function adminRows() {
  const all = readReports();
  const query = document.querySelector('#admin-search').value.trim().toLowerCase(), filter = document.querySelector('#admin-filter').value;
  const rows = all.filter(report => (filter === 'All' || report.status === filter) && `${report.id ?? ''} ${report.issue ?? ''} ${report.address ?? ''} ${report.city ?? ''}`.toLowerCase().includes(query));
  return { all, rows };
}
function adminLocation(report) {
  const point = toCoord(report.lat, report.lng);
  if (!point) return '<small class="admin-loc admin-loc-none">📍 No map coordinates</small>';
  const where = [report.city, report.state].filter(Boolean).map(escapeHtml).join(', ');
  return `<small class="admin-loc">📍 ${where ? `${where} · ` : ''}${point.lat}, ${point.lng} · <a href="${mapsLink(`${point.lat},${point.lng}`)}" target="_blank" rel="noopener">Google Maps ↗</a> · <button type="button" class="admin-locate" data-id="${escapeHtml(report.id ?? '')}">Show on map</button></small>`;
}
const STATUS_COLOR = { 'Under Review': '#f59e0b', 'In Progress': '#3b5bfd', Resolved: '#16a34a' };
function renderAdminMap(rows) {
  const box = document.querySelector('#admin-leaf'), note = document.querySelector('#admin-map-note');
  if (!hasLeaflet() || !box) { note.textContent = 'Map could not load. Each report still has a Google Maps link.'; return; }
  const state = ensureMap('admin', false); if (!state) return;
  if (state.layer) state.layer.clearLayers(); else state.layer = L.layerGroup().addTo(state.map);
  state.markers = {};
  const points = [];
  rows.forEach(report => {
    const point = toCoord(report.lat, report.lng); if (!point) return;
    const marker = L.circleMarker([point.lat, point.lng], { radius: 9, weight: 2, color: '#fff', fillColor: STATUS_COLOR[report.status] || '#64748b', fillOpacity: 0.95 })
      .bindPopup(`<strong>${escapeHtml(report.issue ?? '')}</strong><br>${escapeHtml(report.id ?? '')} · ${escapeHtml(report.status ?? '')}<br>${escapeHtml(report.address ?? '')}`);
    marker.addTo(state.layer); state.markers[report.id] = marker; points.push([point.lat, point.lng]);
  });
  note.textContent = points.length ? `${points.length} of ${rows.length} reports on the map · colour = status` : (rows.length ? 'These reports have no map coordinates (older reports or address not found).' : 'No reports to show.');
  const signature = points.join('|');
  if (points.length && signature !== state.sig) state.map.fitBounds(points, { padding: [30, 30], maxZoom: 16 });
  else if (!points.length && currentLocation) state.map.setView([currentLocation.lat, currentLocation.lng], 11);
  state.sig = signature;
  setTimeout(() => { try { state.map.invalidateSize(); } catch {} }, 60);
}
function renderAdmin() {
  if (!isAdmin(currentUser)) return;
  const { all, rows } = adminRows(), count = status => all.filter(report => report.status === status).length;
  const kpis = [['Total', all.length], ['Under review', count('Under Review')], ['In progress', count('In Progress')], ['Resolved', count('Resolved')], ['High priority', all.filter(report => report.severity === 'High').length]];
  document.querySelector('#admin-kpis').innerHTML = kpis.map(([label, value]) => `<article class="panel admin-kpi"><strong>${value}</strong><span>${label}</span></article>`).join('');
  document.querySelector('#admin-export').innerHTML = `<span>↓</span> Export CSV (${rows.length})`;
  document.querySelector('#admin-table').innerHTML = rows.length ? rows.map(report => `<div class="admin-row"><div><strong>${escapeHtml(report.issue ?? '')}</strong> <small>${escapeHtml(report.id ?? '')}</small><p>${escapeHtml(report.address ?? '')}</p>${adminLocation(report)}</div><span class="sev sev-${escapeHtml(String(report.severity || 'low').toLowerCase())}">${escapeHtml(report.severity ?? '—')}</span><select class="auth-input admin-status" data-id="${escapeHtml(report.id ?? '')}">${STATUSES.map(status => `<option${status === report.status ? ' selected' : ''}>${status}</option>`).join('')}</select><button type="button" class="admin-del" data-id="${escapeHtml(report.id ?? '')}">Delete</button></div>`).join('') : '<div class="no-cases">No reports match.</div>';
  renderAdminMap(rows);
}
function showApplication(user) {
  const name = user?.name || nameFromEmail(user?.email);
  const initials = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'JD';
  document.querySelector('#login-shell').classList.add('hidden');
  document.querySelector('#app-shell').classList.remove('hidden');
  document.querySelector('#profile-button .avatar').textContent = initials;
  document.querySelector('#profile-button .profile-copy strong').textContent = name;
  document.querySelector('#profile-email').textContent = user?.email || 'Demo account';
  document.querySelector('.top-avatar').textContent = initials;
  document.querySelectorAll('#profile-button .avatar, .top-avatar').forEach(node => {
    if (user?.picture) { node.style.cssText = `background:url("${user.picture}") center/cover`; node.textContent = ''; }
    else node.style.cssText = '';
  });
  currentUser = user;
  document.querySelector('#nav-admin').classList.toggle('hidden', !isAdmin(user));
  updateGreeting(user);
  if (!autoTried) { autoTried = true; autoDetectLocation().catch(() => {}); }
}
function logout() {
  currentUser = null; document.querySelector('#nav-admin').classList.add('hidden');
  try { google.accounts.id.disableAutoSelect(); } catch {}
  localStorage.removeItem(SESSION_KEY);
  document.querySelector('#profile-popover').classList.add('hidden');
  document.querySelector('#app-shell').classList.add('hidden');
  document.querySelector('#login-shell').classList.remove('hidden');
  history.replaceState(null, '', location.pathname + location.search);
  setAuthMode('login');
}
function setAuthMode(mode) {
  authMode = mode;
  const signup = mode === 'signup';
  document.querySelector('#auth-eyebrow').textContent = signup ? 'JOIN YOUR COMMUNITY' : 'WELCOME BACK';
  document.querySelector('#auth-title').textContent = signup ? 'Let’s make a difference.' : 'Good to see you.';
  document.querySelector('#auth-subtitle').textContent = signup ? 'Create an account to report issues and follow their progress.' : 'Sign in to stay connected to your community.';
  document.querySelector('#auth-name').classList.toggle('hidden', !signup);
  document.querySelector('#name-label').classList.toggle('hidden', !signup);
  document.querySelector('#auth-name').required = signup;
  document.querySelector('#auth-password').autocomplete = signup ? 'new-password' : 'current-password';
  document.querySelector('#auth-submit-label').textContent = signup ? 'Create account' : 'Sign in';
  document.querySelector('#auth-switch').innerHTML = signup ? 'Already part of CivicAI? <button type="button" id="auth-switch-button">Sign in</button>' : 'New to CivicAI? <button type="button" id="auth-switch-button">Create an account</button>';
  document.querySelector('#auth-error').textContent = '';
  document.querySelector('#auth-password').value = '';
}

function readReports() {
  try { const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); return Array.isArray(data) ? data.filter(item => item && typeof item === 'object' && !Array.isArray(item)) : []; }
  catch { return []; }
}
function saveReports(items) { return safeSet(STORAGE_KEY, JSON.stringify(items)); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function shortDate(value) { const date = new Date(value); return isNaN(date) ? '—' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date); }
function showToast(message) {
  const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(toastTimeout); toastTimeout = setTimeout(() => toast.classList.remove('show'), 2400);
}
function iconFor(issue) { return issueMeta[issue]?.icon || '＋'; }
function classFor(issue) { return issueMeta[issue]?.cls || 'other'; }
function render() {
  const reports = readReports();
  const resolved = reports.filter(report => report.status === 'Resolved').length;
  const progress = reports.filter(report => report.status === 'In Progress').length;
  document.querySelector('#stat-reports').textContent = reports.length;
  document.querySelector('#stat-progress').textContent = progress;
  document.querySelector('#stat-resolved').textContent = resolved;
  document.querySelector('#stat-impact').textContent = reports.length ? new Intl.NumberFormat().format(reports.length * 84) : '0';
  document.querySelector('#nav-count').textContent = reports.length;
  document.querySelector('#filter-all').textContent = reports.length;
  renderRecent(reports); renderCases(reports);
  if (document.querySelector('#nearby-count')) updateNearby();
}
function reportRow(report) {
  const pill = report.status === 'Resolved' ? 'pill-resolved' : report.status === 'Under Review' ? 'pill-review' : 'pill-progress';
  return `<div class="report-row"><span class="report-symbol issue-${classFor(report.issue)}">${iconFor(report.issue)}</span><div class="report-details"><div class="report-title">${escapeHtml(report.issue)}${report.description ? ` — ${escapeHtml(report.description)}` : ''}</div><div class="report-meta">${escapeHtml(report.address)} · ${shortDate(report.createdAt)} · ${escapeHtml(report.id)}</div></div><span class="status-pill ${pill}">${escapeHtml(String(report.status || 'Under Review').toUpperCase())}</span></div>`;
}
function renderRecent(reports) {
  const target = document.querySelector('#recent-list');
  if (!reports.length) { target.innerHTML = '<div class="empty-state"><strong>Your reports will show up here.</strong>Spotted something? Let’s get it sorted.</div>'; return; }
  target.innerHTML = reports.slice(0, 3).map(reportRow).join('');
}
function renderCases(reports) {
  const query = document.querySelector('#case-search').value.trim().toLowerCase();
  const visible = reports.filter(report => (selectedFilter === 'All' || report.status === selectedFilter) && `${report.issue} ${report.address} ${report.id}`.toLowerCase().includes(query));
  const target = document.querySelector('#cases-list');
  if (!visible.length) { target.innerHTML = `<div class="no-cases">${reports.length ? 'No reports match this filter.' : 'You haven’t reported anything yet. Your first report can help your whole neighborhood.'}</div>`; return; }
  target.innerHTML = visible.map(report => {
    const pill = report.status === 'Resolved' ? 'pill-resolved' : report.status === 'Under Review' ? 'pill-review' : 'pill-progress';
    return `<div class="case-row"><span class="report-symbol issue-${classFor(report.issue)}">${iconFor(report.issue)}</span><div><div class="report-title">${escapeHtml(report.issue)}${report.description ? ` — ${escapeHtml(report.description)}` : ''}</div><div class="case-address">${escapeHtml(report.address)} · ${escapeHtml(report.id)}</div></div><span class="case-date">${shortDate(report.createdAt)}</span><span class="status-pill ${pill}">${escapeHtml(String(report.status || 'Under Review').toUpperCase())}</span><button class="case-arrow" data-case="${escapeHtml(report.id)}" aria-label="View ${escapeHtml(report.id)}">↗</button></div>`;
  }).join('');
}
function navigate(page) {
  const validPages = ['home', 'report', 'cases', 'community', 'admin'];
  page = validPages.includes(page) ? page : 'home';
  if (page === 'admin' && !isAdmin(currentUser)) page = 'home';
  document.querySelectorAll('.page-wrap').forEach(element => element.classList.toggle('hidden', element.id !== `page-${page}`));
  document.querySelectorAll('.nav-link').forEach(link => link.classList.toggle('active', link.dataset.page === page));
  document.querySelector('#breadcrumb-page').textContent = ({ home: 'Overview', report: 'Report an issue', cases: 'My reports', community: 'Community', admin: 'Admin panel' })[page];
  document.querySelector('#sidebar').classList.remove('open');
  history.replaceState(null, '', `#${page}`);
  if (page === 'cases') renderCases(readReports());
  if (page === 'admin') renderAdmin();
  setTimeout(refreshMaps, 80);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function generateId(reports) {
  const used = new Set(reports.map(report => report?.id));
  for (let attempt = 0; attempt < 200; attempt++) { const id = `CAI-${Math.floor(Math.random() * 90000) + 10000}`; if (!used.has(id)) return id; }
  let n = Date.now() % 100000000; while (used.has(`CAI-${n}`)) n++;
  return `CAI-${n}`;
}
function analyzeDuplicate(issue, address, reports, point) {
  const normalize = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{M}\p{N} ]/gu, '').replace(/\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr)\b/g, '').replace(/\s+/g, ' ').trim();
  const normalizedAddress = normalize(address), here = point && toCoord(point.lat, point.lng);
  return reports.find(report => {
    if (!report || report.issue !== issue || report.status === 'Resolved') return false;
    if (normalizedAddress && normalize(report.address) === normalizedAddress) return true;
    const there = here && toCoord(report.lat, report.lng);
    return !!(there && metersBetween(here, there) <= 40);
  });
}

document.addEventListener('click', event => {
  if (!event.target.closest('.loc-wrap')) document.querySelector('#loc-popover').classList.add('hidden');
  if (!event.target.closest('.input-with-icon, #address-results')) document.querySelector('#address-results').classList.add('hidden');
  if (event.target.closest('#auth-switch-button')) { setAuthMode(authMode === 'login' ? 'signup' : 'login'); return; }
  const pageTarget = event.target.closest('[data-page]');
  if (pageTarget) { event.preventDefault(); navigate(pageTarget.dataset.page); return; }
  const type = event.target.closest('.issue-type');
  if (type) { selectedIssue = type.dataset.issue; document.querySelectorAll('.issue-type').forEach(button => button.classList.toggle('selected', button === type)); }
  const filter = event.target.closest('.filter-tab');
  if (filter) { selectedFilter = filter.dataset.filter; document.querySelectorAll('.filter-tab').forEach(button => button.classList.toggle('active', button === filter)); renderCases(readReports()); }
});
document.querySelector('#mobile-menu').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
document.querySelector('#case-search').addEventListener('input', () => renderCases(readReports()));
document.querySelector('#use-location').addEventListener('click', () => detectLocation({ fillAddress: true }));
document.querySelector('#home-locate').addEventListener('click', () => detectLocation());
const locPopover = document.querySelector('#loc-popover');
const toggleLocPopover = () => { locPopover.classList.toggle('hidden'); if (!locPopover.classList.contains('hidden')) document.querySelector('#loc-search').focus(); };
document.querySelector('#location-pill').addEventListener('click', toggleLocPopover);
document.querySelector('#home-manual').addEventListener('click', toggleLocPopover);
document.querySelector('#loc-gps').addEventListener('click', () => { locPopover.classList.add('hidden'); detectLocation(); });
attachSuggest(document.querySelector('#loc-search'), document.querySelector('#loc-results'), place => { locPopover.classList.add('hidden'); chooseManually(place); }, { enterPicks: true });
attachSuggest(document.querySelector('#address'), document.querySelector('#address-results'), place => setReportLocation(place));
initGoogleLogin();
document.querySelector('#admin-search').addEventListener('input', renderAdmin);
document.querySelector('#admin-filter').addEventListener('change', renderAdmin);
document.querySelector('#admin-table').addEventListener('change', event => {
  const select = event.target.closest('.admin-status'); if (!select) return;
  const reports = readReports(), item = reports.find(report => report.id === select.dataset.id); if (!item) return;
  item.status = select.value; if (item.status === 'Resolved') item.resolvedAt = new Date().toISOString();
  if (saveReports(reports)) { showToast(`${item.id} → ${item.status}`); render(); renderAdmin(); } else showToast('Could not save changes.');
});
document.querySelector('#admin-table').addEventListener('click', event => {
  const locate = event.target.closest('.admin-locate');
  if (locate) {
    const state = maps.admin, marker = state?.markers?.[locate.dataset.id];
    if (marker) { state.map.setView(marker.getLatLng(), Math.max(state.map.getZoom(), 15)); marker.openPopup(); document.querySelector('#admin-leaf').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    return;
  }
  const button = event.target.closest('.admin-del'); if (!button) return;
  if (button.dataset.armed !== '1') { button.dataset.armed = '1'; button.textContent = 'Sure? Click again'; setTimeout(() => { button.dataset.armed = ''; button.textContent = 'Delete'; }, 3000); return; }
  if (saveReports(readReports().filter(report => report.id !== button.dataset.id))) { showToast('Report deleted.'); render(); renderAdmin(); }
});
document.querySelector('#admin-export').addEventListener('click', exportCsv);
document.querySelector('#admin-login').addEventListener('click', () => {
  const user = { name: 'Admin', email: ADMIN_EMAILS[0] }; safeSet(SESSION_KEY, JSON.stringify(user)); showApplication(user); navigate('admin');
});
document.querySelector('#address').addEventListener('input', onAddressTyped);
document.querySelector('#photo-upload').addEventListener('change', event => {
  const file = event.target.files[0];
  const preview = document.querySelector('#upload-preview');
  if (!file) { preview.textContent = ''; return; }
  if (file.size > 10 * 1024 * 1024) { event.target.value = ''; preview.textContent = ''; showToast('Please choose an image under 10 MB.'); return; }
  preview.textContent = `✓ ${file.name}`;
});
let submitting = false;
document.querySelector('#report-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (submitting) return;
  const address = document.querySelector('#address').value.trim();
  if (!address) { document.querySelector('#address').focus(); showToast('Add a street address so the right team can find it.'); return; }
  submitting = true;
  const submit = document.querySelector('#report-form button[type="submit"]'); submit.disabled = true;
  try {
    // Use the point the person picked (search / GPS / map pin); otherwise look the typed address up so admins get coordinates too.
    let geo = reportLocation && reportLocation.text === address ? reportLocation : null;
    if (!geo) { const found = await geocodeAddress(address); if (found) geo = { lat: found.lat, lng: found.lng, city: found.city, state: found.state, source: 'typed' }; }
    const reports = readReports();
    const duplicate = analyzeDuplicate(selectedIssue, address, reports, geo);
    const details = issueMeta[selectedIssue];
    const report = { id: generateId(reports), issue: selectedIssue, address, description: document.querySelector('#description').value.trim(), status: 'Under Review', department: details.department, severity: details.severity, score: details.score, duplicateOf: duplicate?.id || null, lat: geo ? geo.lat : null, lng: geo ? geo.lng : null, city: geo?.city || '', state: geo?.state || '', locSource: geo?.source || '', createdAt: new Date().toISOString() };
    reports.unshift(report); if (!saveReports(reports)) { showToast('Could not save your report (browser storage is full or blocked).'); return; } render();
    document.querySelector('#ticket-id').textContent = report.id;
    document.querySelector('#ai-summary').innerHTML = `<strong>AI routing suggestion:</strong> ${escapeHtml(report.department)} · ${escapeHtml(report.severity)} priority (${report.score}/100).${duplicate ? `<br><strong>Possible duplicate:</strong> Similar open report ${escapeHtml(duplicate.id)} at this location. Your report is preserved for review.` : ''}`;
    document.querySelector('#success-modal').classList.remove('hidden');
  } finally { submitting = false; submit.disabled = false; }
});
function closeModal() { document.querySelector('#success-modal').classList.add('hidden'); document.querySelector('#report-form').reset(); reportLocation = null; if (currentLocation) showMap('report', currentLocation, { editable: true }); document.querySelector('#upload-preview').textContent = ''; selectedIssue = 'Pothole'; document.querySelectorAll('.issue-type').forEach(button => button.classList.toggle('selected', button.dataset.issue === selectedIssue)); }
document.querySelector('#modal-close').addEventListener('click', closeModal);
document.querySelector('#modal-done').addEventListener('click', () => { closeModal(); navigate('cases'); });
document.querySelector('#success-modal').addEventListener('click', event => { if (event.target.id === 'success-modal') closeModal(); });
document.querySelector('#copy-ticket').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(document.querySelector('#ticket-id').textContent); showToast('Report ID copied.'); }
  catch { showToast(`Report ID: ${document.querySelector('#ticket-id').textContent}`); }
});
document.querySelector('#profile-button').addEventListener('click', () => document.querySelector('#profile-popover').classList.toggle('hidden'));
document.querySelector('#logout-button').addEventListener('click', logout);
document.querySelector('#password-toggle').addEventListener('click', event => {
  const password = document.querySelector('#auth-password');
  const visible = password.type === 'password'; password.type = visible ? 'text' : 'password';
  event.currentTarget.textContent = visible ? 'Hide' : 'Show'; event.currentTarget.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
});
document.querySelector('#auth-form').addEventListener('submit', event => {
  event.preventDefault();
  const email = document.querySelector('#auth-email').value.trim().toLowerCase();
  const password = document.querySelector('#auth-password').value;
  const name = document.querySelector('#auth-name').value.trim();
  if (password.length < 8) { document.querySelector('#auth-error').textContent = 'Use a password with at least 8 characters.'; return; }
  if (authMode === 'signup' && !name) { document.querySelector('#auth-error').textContent = 'Please enter your name.'; return; }
  if (authMode === 'signup') saveKnownUser(email, name);
  const user = { name: name || readUsers()[email] || nameFromEmail(email), email };
  safeSet(SESSION_KEY, JSON.stringify(user));
  showApplication(user);
  if (location.hash.length > 1) navigate(location.hash.slice(1));
});
document.querySelector('#demo-login').addEventListener('click', () => {
  const user = { name: 'Jordan Davis', email: 'jordan@example.com' };
  safeSet(SESSION_KEY, JSON.stringify(user)); showApplication(user);
  if (location.hash.length > 1) navigate(location.hash.slice(1));
});
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
render();
const savedLocation = readSavedLocation();
if (savedLocation) applyLocation(savedLocation, { persist: false });
const existingSession = readSession();
if (existingSession) { showApplication(existingSession); if (location.hash.length > 1) navigate(location.hash.slice(1)); }
