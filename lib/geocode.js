"use strict";

const { normalizeName, editDistance } = require("./text");

/**
 * Offline city lookup.
 *
 * @param {object} data
 * @param {Array<[string, string, number, number, number]>} data.rows  [name, country, lat, lon, population]
 * @param {Record<string, [string, string]>} [data.aliases]  normalized alias -> [city name, country]
 */
function createGeocoder ({ rows, aliases = {} }) {
	/** "lisbon|PT" -> best (most populous) row */
	const exact = new Map();
	/** "PT" -> rows in that country, for suggestions */
	const byCountry = new Map();

	/** every city with its normalized name, most populous first */
	const sorted = rows
		.map((row) => ({ row, norm: normalizeName(row[0]) }))
		.sort((a, b) => b.row[4] - a.row[4]);
	for (const entry of sorted) {
		const key = `${entry.norm}|${entry.row[1]}`;
		if (!exact.has(key)) exact.set(key, entry.row);
		if (!byCountry.has(entry.row[1])) byCountry.set(entry.row[1], []);
		byCountry.get(entry.row[1]).push(entry);
	}

	const toResult = (row, matchedBy) => ({
		name: row[0],
		country: row[1],
		lat: row[2],
		lon: row[3],
		population: row[4],
		matchedBy
	});

	return {
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
				const row = exact.get(`${normalizeName(alias[0])}|${country}`);
				if (row) return toResult(row, "alias");
			}
			const row = exact.get(`${name}|${country}`);
			return row ? toResult(row, "name") : null;
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
			const candidates = byCountry.get(country) || [];
			if (!name) return [];
			const maxDistance = name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
			const scored = [];
			const seen = new Set();
			for (const { row, norm: candidate } of candidates) {
				if (seen.has(candidate)) continue;
				const d = editDistance(name, candidate, maxDistance);
				const prefix = candidate.startsWith(name) && name.length >= 3;
				if (d <= maxDistance || prefix) {
					seen.add(candidate);
					scored.push({ name: row[0], d: prefix ? Math.min(d, maxDistance) : d, pop: row[4] });
				}
			}
			scored.sort((a, b) => a.d - b.d || b.pop - a.pop);
			return scored.slice(0, limit).map((s) => s.name);
		},

		/**
		 * Autocomplete for the editor: cities in a country (or anywhere) starting with the text.
		 * @param {string} text
		 * @param {string} [country]
		 * @param {number} [limit]
		 */
		autocomplete (text, country, limit = 8) {
			const prefix = normalizeName(text);
			if (prefix.length < 2) return [];
			const pool = country ? byCountry.get(country) || [] : sorted;
			const out = [];
			for (const { row, norm } of pool) {
				if (norm.startsWith(prefix)) {
					out.push(toResult(row, "prefix"));
					if (out.length >= limit) break;
				}
			}
			return out;
		}
	};
}

module.exports = { createGeocoder };
