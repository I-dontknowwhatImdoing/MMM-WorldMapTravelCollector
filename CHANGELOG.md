# Changelog

## Unreleased

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
