# MMM-WorldMapTravelCollector: notes for Claude

A MagicMirror² module: a world map of trips (countries shaded, cities pinned), filtered by traveler, with a ledger grid of places/dates, a stats line, and Digital/Analog themes. Built to be published on the MagicMirror 3rd-party module list, so every choice is a config option with a sensible default.

- Full v1 plan: https://claude.ai/artifact/VQT8dsptdSsLj7Lmcs4PjH
- Owner develops against a Raspberry Pi 4. The owner is not a developer: explain in plain words, send screenshots of visual changes.

## Milestones (one PR each, tests must pass before the next)

1. Foundation: data model, offline geocoding, filters, stats, CSV import. **Merged (#1).**
2. The map: front end, responsive layout, Digital theme, node_helper. **Merged (#2).**
3. Ledger, stats line, view chips/rotation/notifications/touch, Analog theme. **Merged (#3).**
4. Web editor + imports: phone-friendly editor served by MagicMirror (`/MMM-WorldMapTravelCollector/`), add/edit/delete with city autocomplete; CSV, Google Takeout saved places (CSV/GeoJSON), My Maps KML/KMZ, and Google Maps Timeline (phone `Timeline.json` and old Takeout monthly files) importers with a review step; Google Sheet source (publish-to-web CSV, `sheetRefreshMinutes`); optional `editorPin`; backups. Merge rule: same city+country+month combine travelers, so two people's imports become "together". **Merged (#4).**
5. Release: README polish, screenshots, final Pi 4 check, submit to the module list.

Later (v2+): timeline view (Jan–Dec × years), zoom/focus on a region or city, specific spots, photos, a "days traveled" stat.

## Decisions already made

- Trip fields: city (optional), country (required, stored as ISO alpha-2), date `YYYY-MM` (required), days (optional), travelers (required, names from config), lat/lon (optional override), note. One row per place per trip.
- "Together" = every configured traveler went. "Solo" = only that person. "person:X" = every trip X was on. Planned = month after the current month.
- No layover concept: entries are places actually visited.
- Offline geocoding: GeoNames cities with 1,000+ people via `all-the-cities`, plus hand-kept aliases in `scripts/city-aliases.source.json`. Rebuild `geo/` with `npm run build:geo`.
- Ledger defaults 5 rows × 4 columns, newest first, overflow `cycle` (alternative `shrink`).
- Logic lives in Node (`lib/`), the browser only draws. `lib/layout.js` and `lib/ledger.js` are UMD so both sides use them.
- MagicMirror merges config shallowly; `start()` fills nested `ledger` options from defaults.
- Editor: `lib/editor-server.js` is a plain `(req, res)` handler (no Express features), mounted by `node_helper` on `this.expressApp` and by `scripts/preview.js`. It serves the most recently started module instance. Changes need the `X-WMTC: 1` header (blocks cross-site requests); `editorPin` comes in `X-WMTC-Pin`. Static page is `editor/` (vanilla JS, no build, all text via `textContent`).
- Editing (`lib/editing.js`) never drops unreadable rows: they stay at the end of trips.json with ids `row-N` (N = position in the file, so refetch after a save). Saved trips go through `storedTrip`, which drops coordinates equal to the city lookup.
- Importers: `lib/importers.js` detects the file type (zip/KMZ, KML, GeoJSON, Timeline JSON, CSV) and routes to `import-places.js` / `import-timeline.js`. Uploads use a tiny framing (`packFiles`/`unpackFiles`) instead of multipart. Reverse geocoding is `geocoder.nearest`: population / (km + 2)² within 30 km, else the closest place within `maxKm`.
- Google Sheet: `lib/sheet.js`, cached in `data/sheet-cache.csv`; read-only in the editor.
- Details card (`details`, `detailsTimeout`): view model gives each pin and country `tripIds` (newest first); `WMTCLedger.placeDetails` builds the card text; the front end picks the nearest pin to a tap from `this.pinPoints` (pins overlap at world scale), else the tapped country path (`data-code`).
- Projections: `equalEarth` (default), `naturalEarth`, `equirectangular`, `mercator` (`makeProjection` in the front end).
- Fade by age (`fadeByAge`, `fadeStrength`, `fadeYears`; off by default): the view model gives each country and pin `last` (most recent visited month in that view) and the model `currentMonth`; `WMTCLayout.fadeFactor` turns that into `--wmtc-fade`, which scales fill/stroke opacity in CSS. Planned trips never fade.

## Working in this repo

```bash
npm install
npm test            # Jest; coverage threshold 90% lines on lib/
npm run lint        # ESLint flat config, tabs, double quotes
npm run preview     # browser preview at http://localhost:8099, editor at /MMM-WorldMapTravelCollector/ (PREVIEW_DATE=2026-11-23T12:00:00 for stable screenshots)
```

- Importer fixtures in `tests/fixtures/` are made-up exports in each real Google format; `tests/zip-helper.js` builds zips for tests.
- Front-end tests run in jsdom with the low-detail world (`world-atlas/countries-110m.json`) for speed.
- `data/trips.json` and `data/trips.csv` are gitignored (personal data). `data/trips.example.csv` is the sample.
- Branch per milestone (`milestone-N-name`), open a PR, squash-merge when the owner approves.
- End commit messages with a `Co-Authored-By: Claude` line.
