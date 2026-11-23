"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const GEO = path.join(__dirname, "..", "geo");
const meta = JSON.parse(fs.readFileSync(path.join(GEO, "countries-meta.json"), "utf8"));
const topo = JSON.parse(fs.readFileSync(path.join(GEO, "countries-50m.json"), "utf8"));
const cities = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(GEO, "cities.json.gz"))).toString("utf8"));
const aliases = JSON.parse(fs.readFileSync(path.join(GEO, "city-aliases.json"), "utf8"));

const CONTINENTS = ["Africa", "Antarctica", "Asia", "Europe", "North America", "Oceania", "South America"];

describe("bundled geo data", () => {
	test("every country has a name and one of the 7 continents", () => {
		for (const [code, m] of Object.entries(meta)) {
			expect(code).toMatch(/^[A-Z]{2}$/);
			expect(m.name).toBeTruthy();
			expect(CONTINENTS).toContain(m.continent);
		}
	});

	test("every country shape maps to a known country, except Siachen Glacier", () => {
		const geoms = topo.objects.countries.geometries;
		expect(geoms.length).toBeGreaterThan(230);
		const unmapped = geoms.filter((g) => !g.properties.iso2).map((g) => g.properties.name);
		expect(unmapped).toEqual(["Siachen Glacier"]);
		for (const g of geoms) if (g.properties.iso2) expect(meta[g.properties.iso2]).toBeDefined();
	});

	test("small countries are present at this detail level", () => {
		const codes = new Set(topo.objects.countries.geometries.map((g) => g.properties.iso2));
		for (const code of ["SG", "MT", "MC", "LU", "BH", "AD"]) expect(codes.has(code)).toBe(true);
	});

	test("city rows are well formed and sorted by population", () => {
		expect(cities.fields).toEqual(["name", "country", "lat", "lon", "population", "region?"]);
		expect(cities.rows.length).toBeGreaterThan(100000);
		let prev = Infinity;
		for (const [name, country, lat, lon, pop, region] of cities.rows) {
			if (!name || !meta[country] || !(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180) || !(pop <= prev) || !(region === undefined || /^[A-Z]{2,3}$/.test(region))) {
				throw new Error(`Bad city row: ${name} ${country} ${lat} ${lon} ${pop}`);
			}
			prev = pop;
		}
	});

	test("aliases point to real countries", () => {
		for (const [, [name, country]] of Object.entries(aliases)) {
			expect(name).toBeTruthy();
			expect(meta[country]).toBeDefined();
		}
	});
});
