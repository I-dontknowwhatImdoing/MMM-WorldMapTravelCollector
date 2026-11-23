"use strict";

const { normalizeName, editDistance } = require("./text");
const { haversineKm } = require("./stats");

const distanceKm = (lat1, lon1, lat2, lon2) => haversineKm({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });

/**
 * The city list as columns instead of one small array per city: about a third of the memory, which
 * matters on a Raspberry Pi where MagicMirror's own process holds it.
 * @typedef {object} CityTable
 * @property {string[]} names
 * @property {string[]} norms   normalized names ("sao paulo"); "" = work it out from the name
 * @property {Uint16Array} country  index into `codes`
 * @property {string[]} codes   ISO alpha-2 codes
 * @property {Float64Array} lat
 * @property {Float64Array} lon
 * @property {Uint32Array} pop
 * @property {Map<number, string>} region  letter region codes (TX, ENG), where known
 */

/** A table from [name, country, lat, lon, population, region?] rows (tests and small lists). */
function tableFromRows (rows) {
	const n = rows.length;
	const t = { names: new Array(n), norms: new Array(n), country: new Uint16Array(n), codes: [], lat: new Float64Array(n), lon: new Float64Array(n), pop: new Uint32Array(n), region: new Map() };
	const codeIndex = new Map();
	rows.forEach((row, i) => {
		t.names[i] = row[0];
		t.norms[i] = "";
		if (!codeIndex.has(row[1])) {
			codeIndex.set(row[1], t.codes.length);
			t.codes.push(row[1]);
		}
		t.country[i] = codeIndex.get(row[1]);
		t.lat[i] = row[2];
		t.lon[i] = row[3];
		t.pop[i] = row[4];
		if (row[5]) t.region.set(i, row[5]);
	});
	return t;
}

/**
 * Offline city lookup.
 *
 * @param {object} data
 * @param {Array<[string, string, number, number, number, string?]>} [data.rows]  [name, country, lat, lon, population, region?]
 * @param {CityTable} [data.table]  the same as columns (what loadGeoData reads)
 * @param {Record<string, [string, string, string?]>} [data.aliases]  normalized alias -> [city name, country, alias as written]
 * @param {number} [data.idleMs]  the reverse-lookup index is dropped after this long unused
 */
function createGeocoder ({ rows, table, aliases = {}, idleMs = 10 * 60 * 1000 }) {
	const t = table || tableFromRows(rows || []);
	const n = t.names.length;
	for (let i = 0; i < n; i++) if (!t.norms[i]) t.norms[i] = normalizeName(t.names[i]);
	const norm = (i) => t.norms[i];
	const code = (i) => t.codes[t.country[i]];
	const codeIndex = new Map(t.codes.map((c, i) => [c, i]));

	/** every city, most populous first */
	const sorted = new Uint32Array(n);
	for (let i = 0; i < n; i++) sorted[i] = i;
	sorted.sort((a, b) => t.pop[b] - t.pop[a] || a - b);

	/** per country: normalized name -> best (most populous) city; and its cities, largest first */
	const exact = t.codes.map(() => new Map());
	const counts = new Uint32Array(t.codes.length);
	for (let i = 0; i < n; i++) counts[t.country[i]]++;
	const byCountry = t.codes.map((c, k) => new Uint32Array(counts[k]));
	const filled = new Uint32Array(t.codes.length);
	for (const i of sorted) {
		const k = t.country[i];
		const key = norm(i);
		if (!exact[k].has(key)) exact[k].set(key, i);
		byCountry[k][filled[k]++] = i;
	}
	const exactIndex = (name, country) => {
		const k = codeIndex.get(country);
		const i = k === undefined ? undefined : exact[k].get(name);
		return i === undefined ? -1 : i;
	};
	const inCountry = (country) => {
		const k = codeIndex.get(country);
		return k === undefined ? new Uint32Array(0) : byCountry[k];
	};

	const toResult = (i, matchedBy) => ({
		name: t.names[i],
		country: code(i),
		lat: t.lat[i],
		lon: t.lon[i],
		population: t.pop[i],
		region: t.region.get(i) || "",
		matchedBy
	});

	/**
	 * 1° grid of cities, built on the first reverse lookup (only importers need it) and dropped
	 * again after idleMs without one, so an import doesn't keep the mirror's memory up for good.
	 */
	let grid = null;
	let idleTimer = null;
	const cellKey = (lat, lon) => (Math.floor(lat) + 90) * 360 + (Math.floor(lon) + 180);
	function useGrid () {
		if (!grid) {
			grid = new Map();
			for (let i = 0; i < n; i++) {
				const key = cellKey(t.lat[i], t.lon[i]);
				const cell = grid.get(key);
				if (cell) cell.push(i);
				else grid.set(key, [i]);
			}
		}
		clearTimeout(idleTimer);
		if (idleMs > 0) {
			idleTimer = setTimeout(() => {
				grid = null;
			}, idleMs);
			if (idleTimer.unref) idleTimer.unref();
		}
		return grid;
	}

	return {
		/**
		 * The city a coordinate belongs to, for importers that only have coordinates.
		 * Bigger places win over tiny neighbours that happen to be closer, so a point in
		 * central Lisbon gives "Lisbon", not a suburb: score = population / (km + 2)².
		 * Falls back to the plain nearest place up to maxKm away.
		 * @param {number} lat
		 * @param {number} lon
		 * @param {{country?: string, maxKm?: number}} [opts] country limits the search when known
		 * @returns {null | {name: string, country: string, lat: number, lon: number, population: number, km: number, matchedBy: string}}
		 */
		nearest (lat, lon, opts = {}) {
			if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
			const cells = useGrid();
			const maxKm = opts.maxKm ?? 75;
			const preferKm = 30;
			const latSpan = Math.ceil(maxKm / 111);
			const lonSpan = Math.min(180, Math.ceil(maxKm / (111 * Math.max(0.05, Math.cos(lat * Math.PI / 180)))));
			let best = null;
			let bestScore = -1;
			let closest = null;
			for (let dy = -latSpan; dy <= latSpan; dy++) {
				for (let dx = -lonSpan; dx <= lonSpan; dx++) {
					let cellLon = Math.floor(lon) + dx;
					if (cellLon < -180) cellLon += 360;
					if (cellLon >= 180) cellLon -= 360;
					const cellLat = Math.floor(lat) + dy;
					if (cellLat < -90 || cellLat >= 90) continue;
					const cell = cells.get(cellKey(cellLat, cellLon));
					if (!cell) continue;
					for (const i of cell) {
						if (opts.country && code(i) !== opts.country) continue;
						const km = distanceKm(lat, lon, t.lat[i], t.lon[i]);
						if (km > maxKm) continue;
						if (!closest || km < closest.km) closest = { i, km };
						if (km <= preferKm) {
							const score = Math.max(t.pop[i], 1) / ((km + 2) ** 2);
							if (score > bestScore) {
								bestScore = score;
								best = { i, km };
							}
						}
					}
				}
			}
			const pick = best || closest;
			return pick ? { ...toResult(pick.i, "nearest"), km: Math.round(pick.km * 10) / 10 } : null;
		},

		/**
		 * Find a city inside a country. Local/old names (Lisboa, Kiev) are checked first,
		 * then the city's own name. When several cities share a name, the largest wins.
		 * @param {string} city
		 * @param {string} country ISO alpha-2 code
		 */
		lookup (city, country) {
			const name = normalizeName(city);
			if (!name || !country) return null;
			const alias = aliases[name];
			if (alias && alias[1] === country) {
				const i = exactIndex(normalizeName(alias[0]), country);
				if (i >= 0) return toResult(i, "alias");
			}
			const i = exactIndex(name, country);
			return i >= 0 ? toResult(i, "name") : null;
		},

		/**
		 * Close spellings within the country, best first.
		 * @param {string} city
		 * @param {string} country
		 * @param {number} [limit]
		 * @returns {string[]}
		 */
		suggest (city, country, limit = 3) {
			const name = normalizeName(city);
			const candidates = inCountry(country);
			if (!name) return [];
			const maxDistance = name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
			const scored = [];
			const seen = new Set();
			for (const i of candidates) {
				const candidate = norm(i);
				if (seen.has(candidate)) continue;
				const d = editDistance(name, candidate, maxDistance);
				const prefix = candidate.startsWith(name) && name.length >= 3;
				if (d <= maxDistance || prefix) {
					seen.add(candidate);
					scored.push({ name: t.names[i], d: prefix ? Math.min(d, maxDistance) : d, pop: t.pop[i] });
				}
			}
			scored.sort((a, b) => a.d - b.d || b.pop - a.pop);
			return scored.slice(0, limit).map((s) => s.name);
		},

		/**
		 * Suggestions for the editor's city box: cities in a country (or anywhere) whose name, or a
		 * local/old name for them (München, Seville), starts with the text. Largest first. District
		 * entries ("Zürich (Kreis 11) / Seebach") are left out when the city itself exists, and
		 * same-name places in the same region are merged. Each result says whether it's the place
		 * the name normally means (`isDefault`): picking another one keeps its exact position.
		 * @param {string} text
		 * @param {string} [country]
		 * @param {number} [limit]
		 */
		autocomplete (text, country, limit = 8) {
			const prefix = normalizeName(text);
			if (prefix.length < 2) return [];
			const out = [];
			const seen = new Set();
			const add = (i, extra) => {
				const key = `${norm(i)}|${code(i)}|${t.region.get(i) || ""}`;
				if (seen.has(key)) return;
				seen.add(key);
				out.push({ ...toResult(i, extra.matchedBy), isDefault: exactIndex(norm(i), code(i)) === i, ...extra });
			};
			for (const [alias, target] of Object.entries(aliases)) {
				if (!alias.startsWith(prefix) || (country && target[1] !== country)) continue;
				const i = exactIndex(normalizeName(target[0]), target[1]);
				// Only when the city's own name doesn't already match what was typed.
				if (i >= 0 && !normalizeName(target[0]).startsWith(prefix)) add(i, { matchedBy: "alias", alias: target[2] || alias });
			}
			const pool = country ? inCountry(country) : sorted;
			for (const i of pool) {
				if (out.length >= limit) break;
				if (!norm(i).startsWith(prefix)) continue;
				const district = t.names[i].match(/^(.+?)\s*\(/);
				if (district && exactIndex(normalizeName(district[1]), code(i)) >= 0) continue;
				add(i, { matchedBy: "prefix" });
			}
			return out.slice(0, limit);
		}
	};
}

module.exports = { createGeocoder, tableFromRows };
