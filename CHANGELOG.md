# Changelog

## Unreleased

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
