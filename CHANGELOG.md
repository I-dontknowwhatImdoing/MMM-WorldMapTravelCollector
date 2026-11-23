# Changelog

## Unreleased

### People · Years · Months tabs

- New tabs before the view buttons switch between **People** (all, together, each person), **Years** and **Months**. Only that group's buttons show, so a mirror with many years doesn't fill up with buttons. The mirror takes turns only through the chosen group. `viewGroups: false` goes back to one row.
- The default views now include `"years"` and `"months"`, so the tabs show out of the box. Rotation still starts on People.
- `colorBy: "auto"` is the new default: people's colors for People, years for Years, months for Months. Setting `colorBy` keeps one coloring everywhere.
- Group tab names can be changed with `labels` (`people`, `years`, `months`).

### Fixes from a usability walkthrough

Three AI testers played a non-technical phone user, a guest at the mirror and a first-time installer. What they ran into:

- Mirror:
  - The stats line names the view its numbers are for ("Alex only: 3 countries"), and the active view button stands out more.
  - On a portrait screen the ledger uses 2 columns, so place names fit (`ledger.columns` is now `"auto"`: 4, or 2 on a tall screen).
  - A city's card has "See all of Japan", since small countries are hard to tap. A country's trips count each month there once, so Tokyo and Kyoto in one October are 1 trip.
  - Tapping a place in the list opens its card; tapping the page number turns the page.
  - The editor's address on the mirror breaks only after a "/". When phones can't reach the editor yet, the mirror shows its own address, to help with the setup.
  - "1 trip can't be shown" instead of "1 row skipped".
- Editor:
  - A stray "null" at the top of the Import screen is gone.
  - On a trip the mirror can't show, the problem is marked under its field, and "Did you mean Lisbon?" is a button.
  - After saving a changed trip, the old search word is cleared.
  - Undo stays up for 15 seconds, and each backup says what changed ("Before deleting Cusco, Nov 2019").
  - Import rows that are already there start unticked, so the ticks match what Save does.
  - Plainer words: "1 trip can't be shown on the mirror", and the PIN note speaks to whoever set up the mirror.
- README:
  - Every example line ends with a comma.
  - The setups say to replace the Quick start block and keep `home`.
  - New sections cover a blank mirror after editing config.js (`npm run config:check`), restarting without pm2, where the module sits under MagicMirror's other modules, and working out the home network from the mirror's address.

### More stats

- Eight more stats to choose from in `stats`: `daysTraveled`, `nextTrip` ("Next: Tokyo in 23 days"), `lastTrip`, `farthest` (from home), `newThisYear` (countries visited for the first time this year), `mostVisited`, `longestTrip` and `usStates`. The default line is the same six as before.
- The README explains how to write a list of options (square brackets, each item in quotes), lists every stat with an example, and says what each ledger `sort` order means.

### Settings names, docs and requirements

- `filters` is now called `views`, and `defaultFilter` is `defaultView`. The old names still work. New notification names `WMTC_SET_VIEW` (with `{ view }`), `WMTC_NEXT_VIEW` and `WMTC_PREV_VIEW`; the `*_FILTER` ones still work.
- Needs Node.js 22 or newer (MagicMirror 2.38 already does). Tests run on Node 22 and 24.
- The README is rewritten for people setting up a mirror: a 5-step quick start, 4 ready-made setups (a couple, one traveler, a portrait mirror, a TV), options in groups, and sections on updating, privacy, offline use, backups, uninstalling and troubleshooting.
- Templates for reporting problems and asking for features on GitHub, automatic dependency update checks, and a code of conduct.

### Mirror: getting started, readability and speed

- "Add trips from your phone": the map shows the trip editor's address and a QR code to scan, in the middle when there are no trips yet and in a corner for the first 10 minutes after each start. If MagicMirror only lets the mirror itself in (its default), the mirror says so and points to the README instead. New option `showEditorLink` (`"auto"`, `true`, `false`).
- MagicMirror's log shows the editor's real address, and the module's name once instead of twice.
- Grey text (dates, stat labels, the key) is brighter, so it reads through mirror glass. New option `contrast: "high"` for dim mirrors.
- Month colors that people with red-green color blindness can tell apart. New `colorBy: "season"` with 4 colors (and `seasonColors`, `hemisphere`).
- With many views (one per year), the buttons turn into one ‹ 2025 › button with a dot per view instead of wrapping over two lines. New option `viewSwitcher`.
- Touch screens show "Tap a place for details" until the first tap. A tap anywhere outside the details card closes it. `detailsNotes: false` keeps trip notes off the mirror.
- Switching views is much faster: the country shapes are drawn once and only recolored (about 140 ms down to 5 ms here; on a Pi 4, from about half a second).
- Less memory: the city list takes about 20 MB instead of 50, and the index used for imports is let go after 10 minutes.
- Ledger `rows` is now `"auto"` by default: 5, or more on a portrait screen when there are trips to fill the space under the map.

### Editor: easier on a phone

- Mistakes show under the field they're about, and the page scrolls to the first one. A misspelled city offers "Did you mean…" buttons.
- City suggestions show the state or region and size ("Paris, TX · United States · 25k people"), so same-name towns can be told apart. Picking a smaller one says so. Local and old names work too: typing "München", "Seville" or "Oporto" finds the city.
- After adding a place, the country, month and travelers stay filled in for the next stop on the same trip.
- Deleting a trip can be undone from the message at the bottom.
- The phone's Back button moves between the editor's screens instead of leaving the page. Leaving an import half-done asks first.
- Rows that couldn't be read open with everything that could be read already filled in; travelers not in the config are named.
- Trips kept in trips.csv (read-only in the editor) can be moved into the editor with one button. The file is renamed, not deleted.
- Importing: a "Who went on these trips?" card sets the travelers for every row at once. The Save button says why it's waiting ("pick who went (3 rows)") and only counts rows that change something.
- The PIN screen says how many tries are left and how long to wait after too many.
- Restoring a backup lists how many trips it holds compared with now.
- Clearer messages when the Google Sheet can't be reached; coordinates typed with a comma (38,72) are read; the CSV download has country names.
- Small screens (320 px): rows wrap instead of running off the side; buttons are at least 44 px tall; the city list works with the arrow keys.

### Fixes from the pre-release review

- Changing a trip's city in the editor now moves its pin. Before, the old city's position was kept.
- Editor search filters as you type, including trips from trips.csv and the Google Sheet.
- The spreadsheet column-matching panel shows its drop-downs again.
- Rows that can't be shown on the mirror can be fixed or deleted from the editor even when they carry an id.
- Security: the editor's PIN, `editor: false` and the data folder are read from MagicMirror's own config file, so a message sent to the mirror can't switch them off. The editor also only answers at home-network addresses (IP addresses, `localhost`, local names); new option `editorHosts` adds other names.
- Importing a whole Google Takeout zip no longer reads the raw Records.json (which could use gigabytes of memory on a Pi).
- Dates: "March 14, 2025", day-first "15/03/2024" and month-first "03/15/2024" are read; unclear dates like 03/04/2025 and impossible ones like 31 February get a clear message; a spreadsheet with a start-date column but no date column works.
- Several spreadsheets uploaded together each keep their own columns. Very large Timeline files no longer fail.
- A hidden module no longer restarts its timers when trips change.
- Backups made in the same moment no longer delete the newest one. Repeated ids in a hand-edited trips.json no longer show the wrong trip.

### Trips: optional start day

- New optional `start` field (e.g. 2025-03-14). With `days`, a trip has an exact end: the details card shows "14–18 Mar 2025", and fading counts from the end of the trip.
- The editor has an optional Day box next to Month and Year, in the form and on each import row. The trip list shows exact dates.
- Google Maps Timeline imports fill in the start day. A full date in a spreadsheet's date column, or a `start` / "start date" / "arrived" column, sets it too.
- When two people's entries for the same place and month are combined, the earliest start is kept.
- The CSV download has a `start` column.

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
