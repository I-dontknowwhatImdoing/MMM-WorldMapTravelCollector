"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { createCountryIndex } = require("./countries");
const { createGeocoder } = require("./geocode");

const DEFAULT_DIR = path.join(__dirname, "..", "geo");
const cache = new Map();

/**
 * Load the bundled country table and city list once per directory.
 * @param {string} [dir]
 * @returns {{countries: ReturnType<typeof createCountryIndex>, geocoder: ReturnType<typeof createGeocoder>}}
 */
function loadGeoData (dir = DEFAULT_DIR) {
	if (cache.has(dir)) return cache.get(dir);
	const meta = JSON.parse(fs.readFileSync(path.join(dir, "countries-meta.json"), "utf8"));
	const cities = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, "cities.json.gz"))).toString("utf8"));
	const aliasFile = path.join(dir, "city-aliases.json");
	const aliases = fs.existsSync(aliasFile) ? JSON.parse(fs.readFileSync(aliasFile, "utf8")) : {};
	const data = {
		countries: createCountryIndex(meta),
		geocoder: createGeocoder({ rows: cities.rows, aliases })
	};
	cache.set(dir, data);
	return data;
}

module.exports = { loadGeoData };
