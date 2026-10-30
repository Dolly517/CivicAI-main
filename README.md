# CivicAI

CivicAI is a responsive civic issue reporting application. It gives residents a clear way to report problems and see their reports, with a lightweight rule-based analysis preview for department routing, priority, and possible duplicates.

## Run the application

Open `index.html` in a modern browser, or serve this folder with any static web server. No build step or dependencies are required.

## Publish with GitHub Pages

The repository includes a GitHub Actions workflow at `.github/workflows/pages.yml`. Push the project to a GitHub repository, then in **Settings → Pages**, set the source to **GitHub Actions**. The workflow publishes the site on pushes to `main` or `master`. GitHub Pages sites are public on the internet; do not publish credentials, private data, or real complaint information in the repository.

## Included

- Responsive overview dashboard, issue submission form, personal report list, and community board.
- Welcome, sign-in, and account-creation screens with a demo account shortcut, password visibility control, and profile-menu logout.
- Report categories, descriptions, address capture, image selection, and optional browser geolocation.
- Local browser persistence using `localStorage`.
- Transparent rule-based department and priority suggestions, plus same-category, same-address duplicate flags. Original reports are preserved.
- Complaint IDs, status labels, and a confirmation dialog with copyable report ID.
- Mobile navigation and report search/filtering.

## Demo limitations and production path

This is a complete front-end prototype. Reports and the demo sign-in session stay in the current browser and are not shared with a municipality. The sign-in and account-creation screens are interface demonstrations: they do not verify credentials or provide secure authentication. AI analysis currently uses transparent rules; the map is a visual preview rather than a geocoding or map service. There is no server, authority review queue, evidence upload workflow, or production notification system.

For a production deployment, connect a secure API and PostgreSQL database, implement verified citizen and staff authentication, use an approved civic taxonomy and jurisdiction configuration, add image storage with access controls, and build staff assignment plus evidence approval. Only an authorized reviewer should be able to close a report after reviewing resolution evidence. Replace the local heuristic with a monitored classification service and audited duplicate matching, while keeping human review for routing, priority, and duplicate decisions.

## Local data

The demo writes report records to the browser's `localStorage` key `civicai-reports-v1`. Clearing site data resets the demonstration reports.

## Google sign-in (Gmail) setup
1. Open Google Cloud Console → APIs & Services → Credentials → Create credentials → OAuth client ID → Web application.
2. Add your site under "Authorized JavaScript origins" (e.g. `https://<user>.github.io` and `http://localhost:8000`).
3. Copy the Client ID and paste it into `GOOGLE_CLIENT_ID` at the top of `app.js`.

## Location
**Automatic:** after sign-in the app asks the browser for GPS (high accuracy, then a low-accuracy retry). If GPS is denied, times out or the page is not on https/localhost, it falls back to approximate internet location, trying three providers in turn (ipapi.co, ipwho.is, geojs.io). A location you chose by hand is never overridden by auto-detection.

**Manual:** (1) the location chip in the top bar: search a city/area/street (OpenStreetMap Nominatim, Photon as backup) or paste `lat, lng`; (2) click the map or drag the pin on the Overview or Report page; (3) type an address in the report form. The map is Leaflet + OpenStreetMap tiles (vendored in `assets/vendor/leaflet`, no API key); if it cannot load, a Google Maps iframe is used instead.

Every report now stores `lat`, `lng`, `city`, `state` and `locSource` (gps / pin / manual / typed). Typed addresses are geocoded on submit. Duplicate detection also flags the same issue within 40 m.

GPS needs https or `localhost` (run `python3 -m http.server`).

## Admin panel
Use the "Admin demo login" button, or sign in with an email listed in `ADMIN_EMAILS` (top of `app.js`). Admins can search/filter reports, change status, delete, see every report on a map (colour = status; "Show on map" per row) and export CSV.

**CSV export** downloads exactly the rows currently shown (the button shows the count). The file is UTF-8 with a BOM so Excel shows Hindi/emoji correctly, uses CRLF line endings, keeps multi-line descriptions inside one cell, writes coordinates as numbers, includes a Google Maps link per report, and neutralises cells starting with `= + - @` so they cannot run as spreadsheet formulas.

Data is the browser's localStorage, and the admin check is client-side only, so add a real backend before production. Until then the admin panel only sees reports created in the same browser.

## Tests
`node tests/run.js` runs about 2,000,000 randomized operations against `app.js` (stubbed DOM, mocked GPS/network): 1M sync checks (CSV round-trip, coordinates, escaping, duplicates...) and 1M location scenarios (GPS/IP/geocoder failures, stale lookups, manual vs auto). Run one suite with `node tests/run.js fuzz|admin|location`; `N_SCEN=5000 node tests/run.js location` shortens the location run.
