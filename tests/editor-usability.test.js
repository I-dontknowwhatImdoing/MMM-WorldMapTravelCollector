"use strict";

/**
 * Server side of the phase 2 editor changes: city suggestions (R7), guesses for unreadable rows (E3),
 * moving trips.csv into the editor (R9) and coordinates written with a comma (E5).
 */

const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const path = require("node:path");
const { loadGeoData } = require("../lib/geodata");
const { createEditorHandler } = require("../lib/editor-server");
const { createTripBook } = require("../lib/editing");
const { createTripService } = require("../lib/service");
const { validateTrip } = require("../lib/schema");
const { ctx } = require("./helpers");

const geo = loadGeoData();
let dir;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "wmtc-p2-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("R7: city suggestions", () => {
	const names = (list) => list.map((c) => `${c.name}${c.region ? `/${c.region}` : ""}${c.alias ? ` [${c.alias}]` : ""}${c.isDefault ? "*" : ""}`);

	test("same-name towns show their region; only the best-known one is the default", () => {
		const paris = geo.geocoder.autocomplete("paris", "US");
		expect(names(paris).slice(0, 3)).toEqual(["Paris/TX*", "Paris/TN", "Paris/KY"]);
		expect(paris[1].population).toBeGreaterThan(1000);
	});

	test("local and old names find the city, labelled with what was typed", () => {
		expect(names(geo.geocoder.autocomplete("munchen")).at(0)).toBe("Munich [München]*");
		expect(names(geo.geocoder.autocomplete("seville", "ES")).at(0)).toBe("Sevilla [Seville]*");
		expect(names(geo.geocoder.autocomplete("sevil", "ES")).at(0)).toBe("Sevilla*");
		expect(names(geo.geocoder.autocomplete("oporto", "PT"))).toEqual(["Porto [Oporto]*"]);
		// Typing the city's own name shows no extra label.
		expect(names(geo.geocoder.autocomplete("lisb", "PT"))).toEqual(["Lisbon*"]);
		// An alias for another country doesn't leak in.
		expect(names(geo.geocoder.autocomplete("munchen", "PT"))).toEqual([]);
	});

	test("district entries are left out when the city itself exists", () => {
		const zurich = names(geo.geocoder.autocomplete("zurich", "CH"));
		expect(zurich[0]).toMatch(/^Zürich/);
		expect(zurich.some((n) => n.includes("Kreis"))).toBe(false);
	});

	test("the editor's city API passes region, alias and default flag on", async () => {
		const handler = createEditorHandler({ getContext: () => ({ config: { travelers: ["Alex"] }, dataDir: dir, geo }) });
		const server = http.createServer((req, res) => {
			req.url = req.url.replace(/^\/MMM-WorldMapTravelCollector/, "");
			handler(req, res);
		});
		await new Promise((r) => server.listen(0, "127.0.0.1", r));
		const res = await fetch(`http://127.0.0.1:${server.address().port}/MMM-WorldMapTravelCollector/api/cities?q=munchen`);
		const [first] = await res.json();
		expect(first).toMatchObject({ name: "Munich", country: "DE", countryName: "Germany", alias: "München", isDefault: true });
		await new Promise((r) => server.close(r));
	});
});

describe("E3: unreadable rows come with a best guess", () => {
	test("date, start, country and travelers, known and unknown", () => {
		fs.writeFileSync(path.join(dir, "trips.json"), JSON.stringify([
			{ city: "Porto", country: "Portugal", date: "May 2019", travelers: "Alex; Bob" },
			{ city: "Lisbn", country: "Atlantis", start: "14 March 2025", travelers: ["Sam"] },
			"junk"
		]));
		const book = createTripBook({ file: path.join(dir, "trips.json"), ctx: ctx(["Alex", "Sam"]) });
		const { broken } = book.load();
		expect(broken.map((b) => b.guess)).toEqual([
			{ date: "2019-05", start: "", country: "PT", travelers: ["Alex"], unknownTravelers: ["Bob"] },
			{ date: "2025-03", start: "2025-03-14", country: "", travelers: ["Sam"], unknownTravelers: [] },
			{ date: "", start: "", country: "", travelers: [], unknownTravelers: [] }
		]);
	});
});

describe("R9: moving trips.csv into the editor", () => {
	async function call (route, method = "POST") {
		const service = createTripService({ dataDir: dir, config: { travelers: ["Alex", "Sam"] }, geo });
		const handler = createEditorHandler({ getContext: () => ({ config: { travelers: ["Alex", "Sam"] }, dataDir: dir, geo, service }), clock: () => new Date("2026-11-23T12:00:00Z") });
		const server = http.createServer((req, res) => {
			req.url = req.url.replace(/^\/MMM-WorldMapTravelCollector/, "");
			handler(req, res);
		});
		await new Promise((r) => server.listen(0, "127.0.0.1", r));
		const res = await fetch(`http://127.0.0.1:${server.address().port}/MMM-WorldMapTravelCollector/api${route}`, { method, headers: { "X-WMTC": "1" } });
		const body = await res.json();
		await new Promise((r) => server.close(r));
		return { status: res.status, body };
	}

	test("good rows become editable trips, bad ones are kept to fix, the file is renamed", async () => {
		fs.writeFileSync(path.join(dir, "trips.json"), JSON.stringify([{ id: "t_l", city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] }]));
		fs.writeFileSync(path.join(dir, "trips.csv"), "city,country,date,travelers\nLisbon,PT,2025-03,Alex\nRome,IT,2022-09,Sam\nLisbn,PT,2023-01,Alex\nLisbon,PT,2025-03,Sam\n");
		const r = await call("/import/move-csv");
		expect(r.status).toBe(200);
		expect(r.body).toMatchObject({ added: 1, combined: 1, already: 1, needFixing: 1, renamedTo: "trips.csv.moved-2026-11-23" });
		expect(fs.existsSync(path.join(dir, "trips.csv"))).toBe(false);
		expect(fs.readFileSync(path.join(dir, "trips.csv.moved-2026-11-23"), "utf8")).toContain("Rome");
		const book = createTripBook({ file: path.join(dir, "trips.json"), ctx: ctx(["Alex", "Sam"]) });
		const { trips, broken } = book.load();
		expect(trips.map((t) => `${t.city} ${t.travelers.join("+")}`).sort()).toEqual(["Lisbon Alex+Sam", "Rome Sam"]);
		expect(broken.map((b) => b.raw.city)).toEqual(["Lisbn"]);
	});

	test("no file, or a file without the needed columns", async () => {
		expect((await call("/import/move-csv")).status).toBe(404);
		fs.writeFileSync(path.join(dir, "trips.csv"), "name,age\nx,1\n");
		const r = await call("/import/move-csv");
		expect(r.status).toBe(422);
		expect(r.body.error).toMatch(/no column for: country, date, travelers/);
		expect(fs.existsSync(path.join(dir, "trips.csv"))).toBe(true);
	});
});

describe("E5: coordinates with a comma", () => {
	test("38,72 reads as 38.72", () => {
		const r = validateTrip({ city: "", country: "PT", date: "2025-03", travelers: ["Alex"], lat: "38,72", lon: "-9,14" }, ctx(["Alex"]));
		expect(r.trip).toMatchObject({ lat: 38.72, lon: -9.14 });
		expect(validateTrip({ city: "", country: "PT", date: "2025-03", travelers: ["Alex"], lat: "38,72,1", lon: "1" }, ctx(["Alex"])).ok).toBe(false);
	});
});
