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
	const table = readCityTable(zlib.gunzipSync(fs.readFileSync(path.join(dir, "cities.tsv.gz"))));
	const aliasFile = path.join(dir, "city-aliases.json");
	const aliases = fs.existsSync(aliasFile) ? JSON.parse(fs.readFileSync(aliasFile, "utf8")) : {};
	const data = {
		countries: createCountryIndex(meta),
		geocoder: createGeocoder({ table, aliases })
	};
	cache.set(dir, data);
	return data;
}

/**
 * Read cities.tsv (name, country, lat, lon, population, region, normalized name; one city per line
 * after a header) straight into columns. Going through the bytes, rather than JSON.parse or split,
 * keeps the peak memory of loading low: no array per city, and names don't keep the whole file alive.
 * @param {Buffer} buf
 * @returns {import("./geocode").CityTable}
 */
function readCityTable (buf) {
	let lines = 0;
	for (let i = 0; i < buf.length; i++) if (buf[i] === 10) lines++;
	const n = Math.max(0, lines - 1);
	const t = { names: new Array(n), norms: new Array(n), country: new Uint16Array(n), codes: [], lat: new Float64Array(n), lon: new Float64Array(n), pop: new Uint32Array(n), region: new Map() };
	const codeIndex = new Map();
	let pos = buf.indexOf(10) + 1; // skip the header
	const tab = (from, end) => {
		const i = buf.indexOf(9, from);
		return i < 0 || i > end ? end : i;
	};
	const str = (from, to) => (to > from ? buf.toString("utf8", from, to) : "");
	// Numbers straight from the bytes: "-12.3456" -> -12.3456, without a string per number.
	const num = (from, to) => {
		let sign = 1;
		let value = 0;
		let scale = 0;
		for (let i = from; i < to; i++) {
			const c = buf[i];
			if (c === 45) sign = -1;
			else if (c === 46) scale = 1;
			else {
				value = value * 10 + (c - 48);
				if (scale) scale *= 10;
			}
		}
		return sign * (scale ? value / scale : value);
	};
	for (let row = 0; row < n; row++) {
		const end = buf.indexOf(10, pos);
		const e0 = tab(pos, end);
		const e1 = tab(e0 + 1, end);
		const e2 = tab(e1 + 1, end);
		const e3 = tab(e2 + 1, end);
		const e4 = tab(e3 + 1, end);
		const e5 = e4 < end ? tab(e4 + 1, end) : end;
		const e6 = e5 < end ? tab(e5 + 1, end) : end;
		const name = str(pos, e0);
		const code = str(e0 + 1, e1);
		let k = codeIndex.get(code);
		if (k === undefined) {
			k = t.codes.length;
			codeIndex.set(code, k);
			t.codes.push(code);
		}
		t.names[row] = name;
		t.country[row] = k;
		t.lat[row] = num(e1 + 1, e2);
		t.lon[row] = num(e2 + 1, e3);
		t.pop[row] = num(e3 + 1, e4);
		if (e5 > e4 + 1) t.region.set(row, str(e4 + 1, e5));
		t.norms[row] = e6 > e5 + 1 ? str(e5 + 1, e6) : name.toLowerCase();
		pos = end + 1;
	}
	return t;
}

module.exports = { loadGeoData, readCityTable };
