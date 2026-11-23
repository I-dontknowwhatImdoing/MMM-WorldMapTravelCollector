"use strict";

const { normalizeName } = require("./text");

/**
 * Country lookups over the bundled geo/countries-meta.json table.
 * @param {Record<string, {name: string, numeric: string|null, continent: string, aliases: string[]}>} meta
 */
function createCountryIndex (meta) {
	const byName = new Map();
	for (const [code, entry] of Object.entries(meta)) {
		byName.set(normalizeName(code), code);
		for (const alias of entry.aliases) {
			const key = normalizeName(alias);
			// Never let an alias shadow a real two-letter code (e.g. "LA" is Laos, "CA" is Canada).
			if (key && !byName.has(key)) byName.set(key, code);
		}
	}

	return {
		/**
		 * Resolve "Portugal", "PT", "PRT" or "portugal " to "PT".
		 * @param {string} input
		 * @returns {string|null}
		 */
		resolve (input) {
			const key = normalizeName(input);
			if (!key) return null;
			return byName.get(key) || null;
		},
		/** @param {string} code */
		get (code) {
			return meta[code] || null;
		},
		/** @param {string} code */
		name (code) {
			return meta[code] ? meta[code].name : code;
		},
		/** @param {string} code */
		continent (code) {
			return meta[code] ? meta[code].continent : null;
		},
		codes () {
			return Object.keys(meta);
		}
	};
}

module.exports = { createCountryIndex };
