#!/usr/bin/env node
"use strict";

/**
 * Rebuilds the bundled files in geo/ from their original open-data sources.
 * Only maintainers need this; the generated files are committed to the repo.
 *
 *   npm run build:geo
 *
 * Sources (all installed as devDependencies):
 *   - world-atlas (ISC, derived from Natural Earth, public domain): country shapes
 *   - all-the-cities (MIT, data from GeoNames, CC BY 4.0): cities with 1,000+ people
 *   - i18n-iso-countries (MIT): ISO codes and English names/aliases
 *   - countries-list (MIT): continent per country
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { normalizeName } = require("../lib/text");

const GEO_DIR = path.join(__dirname, "..", "geo");

const CONTINENT_NAMES = {
	AF: "Africa",
	AN: "Antarctica",
	AS: "Asia",
	EU: "Europe",
	NA: "North America",
	OC: "Oceania",
	SA: "South America"
};

// Where countries-list's continent differs from the one most travelers would expect.
const CONTINENT_OVERRIDES = { RU: "EU" };

// world-atlas shapes that carry no ISO numeric id. Assigned the way GeoNames assigns
// their cities, so a trip's country and the shaded shape always agree.
const UNNUMBERED_SHAPES = {
	"Kosovo": "XK",
	"N. Cyprus": "CY",
	"Somaliland": "SO",
	"Indian Ocean Ter.": "AU"
};

function buildCountryMeta () {
	const iso = require("i18n-iso-countries");
	const { countries } = require("countries-list");
	const meta = {};
	const codes = new Set([...Object.keys(iso.getAlpha2Codes()), ...Object.keys(countries)]);
	for (const code of [...codes].sort()) {
		const listed = countries[code];
		const continentCode = CONTINENT_OVERRIDES[code] || (listed && listed.continent);
		if (!continentCode) continue;
		const isoNames = iso.getNames("en", { select: "all" })[code] || [];
		const name = (listed && listed.name) || isoNames[0];
		const aliases = new Set([name, ...isoNames]);
		if (listed && listed.native) aliases.add(listed.native);
		const alpha3 = iso.alpha2ToAlpha3(code);
		if (alpha3) aliases.add(alpha3);
		meta[code] = {
			name,
			numeric: iso.alpha2ToNumeric(code) || null,
			continent: CONTINENT_NAMES[continentCode],
			aliases: [...aliases].filter(Boolean)
		};
	}
	return meta;
}

function buildShapes (meta) {
	const topo = JSON.parse(fs.readFileSync(require.resolve("world-atlas/countries-50m.json"), "utf8"));
	const byNumeric = {};
	for (const [code, m] of Object.entries(meta)) if (m.numeric) byNumeric[m.numeric] = code;
	let unassigned = 0;
	for (const g of topo.objects.countries.geometries) {
		const code = g.id ? byNumeric[g.id] : UNNUMBERED_SHAPES[g.properties.name];
		g.properties = { name: g.properties.name, iso2: code || null };
		if (!code) unassigned++;
	}
	return { topo, unassigned };
}

function buildCities (meta) {
	const all = require("all-the-cities");
	const rows = [];
	for (const c of all) {
		if (!meta[c.country]) continue;
		const [lon, lat] = c.loc.coordinates;
		const row = [c.name, c.country, Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4, c.population];
		// Region, only where GeoNames uses readable letters (US states "TX", UK nations "ENG"): it tells
		// apart same-name towns in the editor's city suggestions. Numeric codes mean nothing to people.
		if (/^[A-Z]{2,3}$/.test(c.adminCode || "")) row.push(c.adminCode);
		rows.push(row);
	}
	rows.sort((a, b) => b[4] - a[4]);
	return rows;
}

function buildAliases (cityRows) {
	const source = JSON.parse(fs.readFileSync(path.join(__dirname, "city-aliases.source.json"), "utf8"));
	const known = new Set(cityRows.map((r) => `${normalizeName(r[0])}|${r[1]}`));
	const out = {};
	const missing = [];
	for (const [alias, target] of Object.entries(source)) {
		if (alias.startsWith("_")) continue;
		const [name, country] = target;
		if (!known.has(`${normalizeName(name)}|${country}`)) missing.push(`${alias} -> ${name}, ${country}`);
		out[normalizeName(alias)] = [name, country, alias]; // the alias as people write it, for suggestions
	}
	return { aliases: out, missing };
}

function main () {
	fs.mkdirSync(GEO_DIR, { recursive: true });
	const meta = buildCountryMeta();
	const { topo, unassigned } = buildShapes(meta);
	const cities = buildCities(meta);
	const { aliases, missing } = buildAliases(cities);
	if (missing.length) {
		console.error("City aliases point at cities that are not in the data:\n  " + missing.join("\n  "));
		process.exit(1);
	}

	fs.writeFileSync(path.join(GEO_DIR, "countries-meta.json"), JSON.stringify(meta));
	fs.writeFileSync(path.join(GEO_DIR, "countries-50m.json"), JSON.stringify(topo));
	fs.writeFileSync(path.join(GEO_DIR, "city-aliases.json"), JSON.stringify(aliases, null, 1));
	const payload = JSON.stringify({ fields: ["name", "country", "lat", "lon", "population", "region?"], rows: cities });
	fs.writeFileSync(path.join(GEO_DIR, "cities.json.gz"), zlib.gzipSync(payload, { level: 9 }));

	console.log(`countries: ${Object.keys(meta).length}, shapes: ${topo.objects.countries.geometries.length} (${unassigned} without a country), cities: ${cities.length}, aliases: ${Object.keys(aliases).length}`);
}

if (require.main === module) main();

module.exports = { buildCountryMeta, CONTINENT_NAMES };
