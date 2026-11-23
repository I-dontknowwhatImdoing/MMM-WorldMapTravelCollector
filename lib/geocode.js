"use strict";

const { normalizeName, editDistance } = require("./text");
const { haversineKm } = require("./stats");

const distanceKm = (lat1, lon1, lat2, lon2) => haversineKm({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 });

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
		region: row[5] || "",
		matchedBy
	});

	/** 1° grid of cities, built on first reverse lookup (it is only needed by importers). */
	let grid = null;
	const cellKey = (lat, lon) => `${Math.floor(lat)}|${Math.floor(lon)}`;
	function buildGrid () {
		grid = new Map();
		for (const row of rows) {
			const key = cellKey(row[2], row[3]);
			if (!grid.has(key)) grid.set(key, []);
			grid.get(key).push(row);
		}
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
			if (!grid) buildGrid();
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
					const cell = grid.get(`${Math.floor(lat) + dy}|${cellLon}`);
					if (!cell) continue;
					for (const row of cell) {
						if (opts.country && row[1] !== opts.country) continue;
						const km = distanceKm(lat, lon, row[2], row[3]);
						if (km > maxKm) continue;
						if (!closest || km < closest.km) closest = { row, km };
						if (km <= preferKm) {
							const score = Math.max(row[4], 1) / ((km + 2) ** 2);
							if (score > bestScore) {
								bestScore = score;
								best = { row, km };
							}
						}
					}
				}
			}
			const pick = best || closest;
			return pick ? { ...toResult(pick.row, "nearest"), km: Math.round(pick.km * 10) / 10 } : null;
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
			const add = (row, extra) => {
				const key = `${normalizeName(row[0])}|${row[1]}|${row[5] || ""}`;
				if (seen.has(key)) return;
				seen.add(key);
				out.push({ ...toResult(row, extra.matchedBy), isDefault: exact.get(`${normalizeName(row[0])}|${row[1]}`) === row, ...extra });
			};
			for (const [alias, target] of Object.entries(aliases)) {
				if (!alias.startsWith(prefix) || (country && target[1] !== country)) continue;
				const row = exact.get(`${normalizeName(target[0])}|${target[1]}`);
				// Only when the city's own name doesn't already match what was typed.
				if (row && !normalizeName(target[0]).startsWith(prefix)) add(row, { matchedBy: "alias", alias: target[2] || alias });
			}
			const pool = country ? byCountry.get(country) || [] : sorted;
			for (const { row, norm } of pool) {
				if (out.length >= limit) break;
				if (!norm.startsWith(prefix)) continue;
				const district = row[0].match(/^(.+?)\s*\(/);
				if (district && exact.has(`${normalizeName(district[1])}|${row[1]}`)) continue;
				add(row, { matchedBy: "prefix" });
			}
			return out.slice(0, limit);
		}
	};
}

module.exports = { createGeocoder };
