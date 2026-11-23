# Changelog

## Unreleased

### Map: views and colors by year or month

- New views: `"years"` in `filters` adds one view per year with trips; `"months"` one per calendar month (all Marches together). Single ones: `"year:2025"`, `"month:3"`. Month names follow MagicMirror's language.
- `colorBy`: color the map by `"travelers"` (as before, the default), `"year"` or `"month"`. Each place takes the color of its most recent visit in the view.
- Year colors: `yearColors: "gradient"` (oldest to newest, colors set by `yearGradient`), `"distinct"`, or chosen colors for some years. Month colors follow the seasons; `monthColors` replaces them.
- A color key shows what the colors mean, unless the view chips already do.

### Map: details on tap, flat map shape

- Tap a pin to see that city's visits (month, days, who went, notes) and a summary when there are several.
- Tap a country to see its number of trips and cities, days in total, first and latest visit, the next planned trip, who went and its cities.
- Taps pick the nearest pin, so cities close together (Lisbon and Porto) are both easy to tap. The card stays on screen near edges, pauses view rotation, and closes after `detailsTimeout` seconds, with ×, or with a tap elsewhere. `details: false` turns it off.
- New map shape: `projection: "equirectangular"`, a flat rectangle that fills the width.

### Map: fade older trips

- New `fadeByAge` option: countries and pins you visited long ago are drawn fainter, and recent ones in full color. `fadeStrength` sets how much (0 to 0.95). `fadeUnit` (`"years"`, `"months"` or `"days"`) and `fadeAmount` set how quickly, e.g. `fadeUnit: "months", fadeAmount: 18`. Off by default; planned trips never fade.

### Milestone 4: Trip editor and imports

- Trip editor for your phone, served by the mirror at `http://<mirror>:8080/MMM-WorldMapTravelCollector/`: list and search trips, add with city autocomplete, edit, delete. Works in light and dark mode.
- Same city and month as an existing trip combines the travelers, so two people's entries become one together trip.
- Rows that can't be read are kept in the file and listed in the editor to fix, instead of being lost.
- Imports with a review step (tick, untick and change rows before saving):
  - Google Maps Timeline: the phone export (Android and iPhone) and older Takeout monthly files. One trip per city and month, with days; time at home left out; short stops start unticked; home guessed when not configured.
  - Saved places: Takeout "Saved Places.json", "Saved" lists (CSV), My Maps KML/KMZ, or a whole Takeout zip. "Want to go" lists start unticked.
  - Spreadsheets (CSV/JSON) with column matching.
- Google Sheet as a trip source (`sheetUrl`, `sheetRefreshMinutes`), with an offline copy and clear messages when the sheet isn't published.
- Optional `editorPin`, with a lockout after five wrong tries.
- Backups: list and restore the last 10 versions from the editor. Download all trips as CSV.
- Only coordinates you set by hand are saved, so renaming a city moves its pin.
- The note under the ledger now says which source has a problem (for example the Google Sheet).
- `npm run preview` also serves the editor.

### Milestone 3: Ledger, stats, views and the Analog theme

- Ledger: a ruled grid of places and dates under the map, newest first. Rows, columns, sort order, date format, traveler markers (dots, initials, color), country and days are all options.
- When trips don't fit: turn pages on a timer, or shrink the text down to a minimum and show "+N more".
- Stats line: countries, cities, continents, % of the world, trips this year, distance from home. Pick which ones and their order.
- View chips that double as the color key. Tap one on a touch screen to switch.
- Views rotate on a timer with a fade, and pause after a tap or a command.
- Commands from other modules: `WMTC_SET_FILTER`, `WMTC_NEXT_FILTER`, `WMTC_PREV_FILTER`, `WMTC_NEXT_PAGE`, `WMTC_SET_THEME`.
- Analog theme: paper texture, sepia ink, map grid lines, soft watercolor fills, a notebook-style ledger and bundled open-license fonts.
- Text sizes now follow screen area, so portrait mirrors get readable text.
- Timers stop while MagicMirror hides the module.
- More sample trips in `data/trips.example.csv`.

### Milestone 2: The map

- World map drawn as SVG, sized to any screen (Pi screens, portrait mirrors, 4K TVs) and redrawn on resize.
- Visited countries shaded in the traveler's color; cities pinned, bigger for repeat visits.
- Planned trips drawn as dashed country outlines and hollow pins.
- The newest trip gently pulses.
- Views: all, together, each person's solo trips. The view stays put when data refreshes.
- Fullscreen or centered layout; Equal Earth, Natural Earth or Mercator projection; Antarctica hidden by default.
- Trips reload automatically when `data/trips.json` or `data/trips.csv` changes, and hourly so planned trips turn into visited ones.
- Legend and a note when rows were skipped.
- `npm run preview` shows the module in a browser without MagicMirror.

### Milestone 1: Foundation

- Trip data model: city (optional), country, month, days (optional), travelers, coordinates (optional), note.
- Reads dates written many ways (2025-03, March 2025, 03/2025, full dates).
- Offline country and city lookup: 252 countries, 135,000+ cities with 1,000+ people, common local and old names (Lisboa, Kiev, München).
- Spelling suggestions for unknown cities.
- CSV parsing (quotes, semicolons, tabs, BOM) with flexible column names.
- Merging duplicates across sources, combining travelers.
- Filters: all, together, each person's solo trips, every trip a person was on.
- Stats: countries, cities, continents, % of world, trips this year, distance from home.
- Safe saving with 10 rolling backups.
- Command-line import: `node scripts/import.js trips.csv --travelers "Alex,Sam"`.
