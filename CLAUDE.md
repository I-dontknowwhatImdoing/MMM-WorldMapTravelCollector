# MMM-WorldMapTravelCollector: notes for Claude

A MagicMirror² module: a world map of trips (countries shaded, cities pinned) with views by traveler, year or month, a ledger grid of places and dates, a stats line, Digital/Analog themes, and a phone editor served by MagicMirror. It is listed on the MagicMirror 3rd-party module list, so every choice is a config option with a sensible default.

- The owner tests on a Raspberry Pi 4 and is not a developer: explain changes in plain words and send screenshots of visual changes.
- Ideas for later: timeline view (Jan–Dec × years), zoom to a region, specific spots, photos, a "days traveled" stat, settings in the editor.

## Decisions already made

- Trip fields: city (optional), country (required, stored as ISO alpha-2), date `YYYY-MM` (required; filled from start when missing), start `YYYY-MM-DD` (optional; end = start + days - 1, see `endDay`), days, travelers (required, names from config), lat/lon (optional override), note. One row per place per trip; no layovers.
- "Together" = every configured traveler went. "Solo" = only that person. "person:X" = every trip X was on. Planned = after the current month.
- Same city + country + month combine travelers (two people's imports become "together").
- Group tabs (`viewGroups`, default on): views fall into People / Years / Months (`viewGroup`); only the current group's buttons show, rotation and `stepView` stay inside it (`groupIndices`), and `colorBy: "auto"` (default) colors by the group on screen. Default `views` includes `"years"` and `"months"`.
- Config names: `views` and `defaultView` (before 1.0: `filters`, `defaultFilter`, still read when the new ones aren't set; the node side reads `views || filters`). Notifications `WMTC_SET_VIEW` / `WMTC_NEXT_VIEW` / `WMTC_PREV_VIEW`; the `*_FILTER` names still work.
- Logic lives in Node (`lib/`); the browser only draws. `lib/layout.js` and `lib/ledger.js` are UMD so both sides use them. MagicMirror merges config shallowly; `start()` fills nested `ledger` options from defaults.
- Offline geocoding: GeoNames cities with 1,000+ people via `all-the-cities`, plus aliases in `scripts/city-aliases.source.json`; rebuild `geo/` with `npm run build:geo`. `geo/cities.tsv.gz` is read byte by byte into columns (`readCityTable`, `CityTable`) to keep memory low; the reverse-lookup grid is built on first use and dropped after 10 idle minutes.
- Trust: `node_helper.trustedConfig()` maps the instance identifier (`module_<index>_<name>`) to its entry in MagicMirror's `global.config.modules`; `editor`, `editorPin`, `editorHosts` and `dataDir` always come from there, never from the browser's `WMTC_INIT`. The editor refuses Hosts that aren't an IP, localhost, a one-word or local-suffix name, or in `editorHosts` (DNS rebinding).
- Editor: `lib/editor-server.js` is a plain `(req, res)` handler, mounted by `node_helper` on `this.expressApp` and by `scripts/preview.js`; it serves the most recently started instance. Changes need the `X-WMTC: 1` header; `editorPin` comes in `X-WMTC-Pin` (5 tries, then a minute's lockout). Static page in `editor/` (vanilla JS, all text via `textContent`).
- Editing (`lib/editing.js`) never drops unreadable rows: they stay at the end of trips.json with ids `row-N` and a `guess` for the form. Saved trips go through `storedTrip`, which drops coordinates equal to the city lookup.
- Importers: `lib/importers.js` detects zip/KMZ, KML, GeoJSON, Timeline JSON and CSV. Uploads use `packFiles`/`unpackFiles` framing. Reverse geocoding: `geocoder.nearest` (population / (km + 2)² within 30 km). Google Sheet: `lib/sheet.js`, cached in `data/sheet-cache.csv`, read-only in the editor.
- Getting started (`showEditorLink`): `lib/editor-link.js` works out the editor's address and whether MagicMirror's `address`/`ipWhitelist` let phones in; `node_helper` sends it with a QR path as `WMTC_EDITOR`. MagicMirror's logger already prefixes the module name.
- Mirror drawing: `renderMap` keeps the country outlines (`mapBase`, keyed by size/projection/theme) and only recolors them on a view switch. Taps pick the nearest pin (`pinPoints`), else the country (`data-code`); `WMTCLedger.placeDetails` builds the card.
- Colors: `colorBy` travelers | year | month | season. Month palette is checked for color blindness (test in `tests/layout.test.js`). Fade by age scales opacity through `--wmtc-fade` (`WMTCLayout.fadeFactor`); planned trips never fade.
- Ledger: `rows: "auto"` (5, up to 30 on tall screens when there are trips for them) × `columns: "auto"` (4, or 2 on a portrait screen), newest first, overflow `cycle` or `shrink`.

## Working in this repo

```bash
npm install
npm test            # Jest; coverage threshold 90% lines on lib/
npm run lint        # ESLint flat config, tabs, double quotes
npm run preview     # http://localhost:8099, editor at /MMM-WorldMapTravelCollector/ (PREVIEW_DATE=2026-11-23T12:00:00 for stable screenshots; ?editor=off hides the phone card)
```

- Fixtures in `tests/fixtures/` are made-up exports in each real Google format; `tests/zip-helper.js` builds zips.
- `tests/frontend.test.js` and `tests/editor-page.test.js` run the mirror and the editor page in jsdom (the mirror with the low-detail world for speed).
- `tests/readme.test.js` checks that every option in `defaults` is documented in the README.
- `data/trips.json` and `data/trips.csv` are gitignored (personal data). `data/trips.example.csv` is the sample.
- One branch and PR per piece of work; squash-merge when the owner approves. End commit messages with a `Co-Authored-By: Claude` line.
