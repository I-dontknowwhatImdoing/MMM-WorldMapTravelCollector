"use strict";

const { loadGeoData } = require("../lib/geodata");
const { createGeocoder } = require("../lib/geocode");
const { createCountryIndex } = require("../lib/countries");

const geo = loadGeoData();

describe("country lookup", () => {
	test.each([
		["Portugal", "PT"],
		["portugal ", "PT"],
		["PT", "PT"],
		["pt", "PT"],
		["PRT", "PT"],
		["United States", "US"],
		["USA", "US"],
		["U.S.A.", "US"],
		["United States of America", "US"],
		["UK", "GB"],
		["United Kingdom", "GB"],
		["Côte d'Ivoire", "CI"],
		["Japan", "JP"],
		["Kosovo", "XK"],
		["CA", "CA"],
		["LA", "LA"]
	])("%s -> %s", (input, code) => {
		expect(geo.countries.resolve(input)).toBe(code);
	});

	test("unknown or empty", () => {
		expect(geo.countries.resolve("Narnia")).toBeNull();
		expect(geo.countries.resolve("")).toBeNull();
	});

	test("names and continents", () => {
		expect(geo.countries.name("PT")).toBe("Portugal");
		expect(geo.countries.name("ZZ")).toBe("ZZ");
		expect(geo.countries.continent("BR")).toBe("South America");
		expect(geo.countries.continent("RU")).toBe("Europe");
		expect(geo.countries.continent("AU")).toBe("Oceania");
		expect(geo.countries.continent("ZZ")).toBeNull();
		expect(geo.countries.get("JP").numeric).toBe("392");
		expect(geo.countries.get("ZZ")).toBeNull();
		expect(geo.countries.codes().length).toBeGreaterThan(240);
	});

	test("an alias never shadows a real country code", () => {
		const idx = createCountryIndex({
			AA: { name: "Alpha", numeric: "1", continent: "Europe", aliases: ["Alpha", "BB"] },
			BB: { name: "Beta", numeric: "2", continent: "Europe", aliases: ["Beta"] }
		});
		expect(idx.resolve("BB")).toBe("BB");
	});
});

describe("city lookup (bundled data)", () => {
	const g = geo.geocoder;

	test("finds cities by name within a country", () => {
		const hit = g.lookup("Lisbon", "PT");
		expect(hit).toMatchObject({ name: "Lisbon", country: "PT", matchedBy: "name" });
		expect(hit.lat).toBeCloseTo(38.72, 1);
		expect(hit.lon).toBeCloseTo(-9.13, 1);
	});

	test("ignores accents and case", () => {
		expect(g.lookup("sao paulo", "BR").name).toBe("São Paulo");
		expect(g.lookup("REYKJAVIK", "IS").name).toBe("Reykjavík");
		expect(g.lookup("zurich", "CH").name).toBe("Zürich");
	});

	test("understands local and old names", () => {
		expect(g.lookup("Lisboa", "PT")).toMatchObject({ name: "Lisbon", matchedBy: "alias" });
		expect(g.lookup("Kiev", "UA").name).toBe("Kyiv");
		expect(g.lookup("München", "DE").name).toBe("Munich");
		expect(g.lookup("Cologne", "DE").name).toBe("Köln");
		expect(g.lookup("Washington", "US").name).toBe("Washington, D.C.");
	});

	test("an alias only applies in its own country", () => {
		// Roma, Queensland is a real town; the Rome alias must not hijack it.
		const hit = g.lookup("Roma", "AU");
		expect(hit.name).toBe("Roma");
		expect(hit.country).toBe("AU");
	});

	test("picks the largest city when names repeat", () => {
		const paris = g.lookup("Paris", "FR");
		expect(paris.population).toBeGreaterThan(2000000);
		const parisUS = g.lookup("Paris", "US");
		expect(parisUS.country).toBe("US");
		expect(parisUS.lat).not.toBeCloseTo(paris.lat, 0);
	});

	test("includes small towns (1,000+ people) but not villages", () => {
		expect(g.lookup("Zermatt", "CH")).not.toBeNull();
		expect(g.lookup("Positano", "IT")).not.toBeNull();
		// Hallstatt has under 1,000 residents, so it needs manual coordinates.
		expect(g.lookup("Hallstatt", "AT")).toBeNull();
	});

	test("misses return null", () => {
		expect(g.lookup("Atlantis", "GR")).toBeNull();
		expect(g.lookup("", "PT")).toBeNull();
		expect(g.lookup("Lisbon", "")).toBeNull();
		expect(g.lookup("Lisbon", "ES")).toBeNull();
	});

	test("suggests close spellings", () => {
		expect(g.suggest("Lisbn", "PT")).toContain("Lisbon");
		expect(g.suggest("Barcelna", "ES")[0]).toBe("Barcelona");
		expect(g.suggest("Xyzzyq", "PT")).toEqual([]);
		expect(g.suggest("", "PT")).toEqual([]);
		expect(g.suggest("Lisbon", "ZZ")).toEqual([]);
	});

	test("autocompletes by prefix, biggest first", () => {
		const list = g.autocomplete("lis", "PT");
		expect(list[0].name).toBe("Lisbon");
		expect(g.autocomplete("l", "PT")).toEqual([]);
		expect(g.autocomplete("tok").map((c) => c.name)).toContain("Tokyo");
		expect(g.autocomplete("Lis", "ZZ")).toEqual([]);
		expect(g.autocomplete("par", "FR", 3)).toHaveLength(3);
	});
});

describe("geocoder on a tiny dataset", () => {
	const g = createGeocoder({
		rows: [
			["Springfield", "US", 39.8, -89.6, 114000],
			["Springfield", "US", 37.2, -93.3, 169000],
			["Smalltown", "US", 40, -90, 1200]
		]
	});

	test("largest duplicate wins regardless of input order", () => {
		expect(g.lookup("Springfield", "US").lat).toBe(37.2);
	});

	test("works without aliases", () => {
		expect(g.lookup("Smalltown", "US").matchedBy).toBe("name");
	});

	test("suggestions skip duplicate names and allow prefixes", () => {
		expect(g.suggest("Spring", "US")).toEqual(["Springfield"]);
		expect(g.suggest("Sma", "US")).toEqual(["Smalltown"]);
	});
});

describe("loadGeoData", () => {
	test("is cached", () => {
		expect(loadGeoData()).toBe(geo);
	});
});
