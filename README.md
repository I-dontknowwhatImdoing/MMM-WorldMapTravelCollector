# MMM-WorldMapTravelCollector

A [MagicMirror²](https://magicmirror.builders/) module that maps everywhere you've traveled, solo or together, with a notebook-style ledger of places and dates, travel stats, and a phone-friendly editor.

![The map showing trips by two travelers](screenshots/digital-all.png)

> **Status:** under active development (pre-release). The map works; the ledger, stats line, analog theme and web editor are coming. See [CHANGELOG.md](CHANGELOG.md) for progress.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/I-dontknowwhatImdoing/MMM-WorldMapTravelCollector
cd MMM-WorldMapTravelCollector
npm install --omit=dev
```

Add your trips to `data/trips.json` or `data/trips.csv` (see [Trip data](#trip-data)), then add the module to `config/config.js`:

```javascript
{
	module: "MMM-WorldMapTravelCollector",
	position: "fullscreen_below",
	config: {
		travelers: [
			{ name: "Alex", color: "#4FC3F7" },
			{ name: "Sam", color: "#F48FB1" }
		]
	}
},
```

The mirror picks up changes to your trips file within a second. No restart is needed.

To update later: `git pull && npm install --omit=dev`, then restart MagicMirror. Your `data/trips.json` is never touched by updates.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `travelers` | `[]` | Who travels: `{ name, color }` per person, or just names |
| `togetherColor` | `"#FFD54F"` | Color for trips everyone took together |
| `home` | `null` | `{ city: "Boston", country: "US" }` or `{ lat, lon }`. Used for the distance stat |
| `layout` | `"fullscreen"` | `"fullscreen"` (use a `fullscreen_below`/`fullscreen_above` position) or `"centered"` (any position) |
| `maxWidth`, `maxHeight` | `"90%"`, `"80%"` | Size when `layout` is `"centered"`. Percentages are of the screen |
| `projection` | `"equalEarth"` | `"equalEarth"`, `"naturalEarth"` or `"mercator"` |
| `hideAntarctica` | `true` | Leave Antarctica off the map |
| `filters` | `["all", "together", "solo"]` | Views to offer. `"solo"` adds one per traveler; `"person"` adds "every trip with this person" |
| `defaultFilter` | `"all"` | View to start on, e.g. `"together"` or `"solo:Sam"` |
| `showPlanned` | `true` | Show future trips as dashed outlines and hollow pins |
| `highlightNewest` | `true` | Gently pulse the most recent trip |
| `animations` | `true` | Turn off all motion |
| `showLegend` | `true` | Show the color key |
| `showProblems` | `true` | Show a note when rows in your trips file were skipped |
| `dataDir` | module's `data/` | Folder holding `trips.json` / `trips.csv` |

Colors and sizes are CSS variables, so you can restyle the module in `css/custom.css`:

```css
.wmtc {
	--wmtc-land: rgba(255, 255, 255, 0.08);
	--wmtc-visited-opacity: 0.5;
}
```

## Trip data

Each row is one visit to one place. A two-city trip is two rows with the same month.

| Column | Required | Example | Notes |
| --- | --- | --- | --- |
| city | no | Lisbon | Leave blank for a country-level visit |
| country | yes | Portugal, PT or PRT | |
| date | yes | 2025-03 | Year and month. "March 2025" and full dates work too |
| days | no | 5 | Days spent there |
| travelers | yes | Alex; Sam | Names from your config. "both" or "all" means everyone |
| lat, lon | no | 33.66, -95.55 | Only needed for places the lookup can't find, or to pick a specific one (Paris, Texas) |
| note | no | Anniversary | |

A month after the current month counts as a planned trip.

See [data/trips.example.csv](data/trips.example.csv) for a sample.

### Importing a CSV from the command line

```bash
cd ~/MagicMirror/modules/MMM-WorldMapTravelCollector
node scripts/import.js my-trips.csv --travelers "Alex,Sam" --dry-run   # check only
node scripts/import.js my-trips.csv --travelers "Alex,Sam"             # save to data/trips.json
```

Rows that can't be read are listed with the reason and skipped. Duplicates (same place and month) are merged, and their travelers are combined.

## Development

```bash
npm install
npm test            # unit tests
npm run lint
npm run preview     # see the module in your browser at http://localhost:8099, no MagicMirror needed
npm run build:geo   # rebuild geo/ from the original data sources (maintainers only)
```

## Credits

- Country shapes: [Natural Earth](https://www.naturalearthdata.com/) (public domain) via [world-atlas](https://github.com/topojson/world-atlas) (ISC).
- Cities: [GeoNames](https://www.geonames.org/) (CC BY 4.0) via [all-the-cities](https://github.com/zeke/all-the-cities) (MIT).
- Country codes and names: [i18n-iso-countries](https://github.com/michaelwittig/node-i18n-iso-countries) (MIT) and [countries-list](https://github.com/annexare/Countries) (MIT).

## License

MIT. See [LICENSE](LICENSE).
