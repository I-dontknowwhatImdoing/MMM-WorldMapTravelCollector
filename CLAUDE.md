# MMM-WorldMapTravelCollector: notes for Claude

A MagicMirror² module: a world map of trips (countries shaded, cities pinned), filtered by traveler, with a ledger grid of places/dates, a stats line, and Digital/Analog themes. Built to be published on the MagicMirror 3rd-party module list, so every choice is a config option with a sensible default.

- Full v1 plan: https://claude.ai/artifact/VQT8dsptdSsLj7Lmcs4PjH
- Owner develops against a Raspberry Pi 4. The owner is not a developer: explain in plain words, send screenshots of visual changes.

## Milestones (one PR each, tests must pass before the next)

1. Foundation: data model, offline geocoding, filters, stats, CSV import. **Merged (#1).**
2. The map: front end, responsive layout, Digital theme, node_helper. **Merged (#2).**
3. Ledger, stats line, view chips/rotation/notifications/touch, Analog theme. **PR #3.**
4. Web editor + imports: phone-friendly editor served by MagicMirror (`/MMM-WorldMapTravelCollector/`), add/edit/delete with city autocomplete; CSV, Google Takeout saved places (CSV/GeoJSON), My Maps KML/KMZ, and Google Maps Timeline (phone `Timeline.json` and old Takeout monthly files) importers with a review step; Google Sheet source (publish-to-web CSV, `sheetRefreshMinutes`); optional `editorPin`; backups. Merge rule: same city+country+month combine travelers, so two people's imports become "together".
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

## Working in this repo

```bash
npm install
npm test            # Jest; coverage threshold 90% lines on lib/
npm run lint        # ESLint flat config, tabs, double quotes
npm run preview     # browser preview at http://localhost:8099 (PREVIEW_DATE=2026-11-23T12:00:00 for stable screenshots)
```

- Front-end tests run in jsdom with the low-detail world (`world-atlas/countries-110m.json`) for speed.
- `data/trips.json` and `data/trips.csv` are gitignored (personal data). `data/trips.example.csv` is the sample.
- Branch per milestone (`milestone-N-name`), open a PR, squash-merge when the owner approves.
- End commit messages with a `Co-Authored-By: Claude` line.
