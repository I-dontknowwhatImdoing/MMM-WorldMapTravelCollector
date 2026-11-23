"use strict";

/**
 * Regression tests for the bugs found in the pre-release review (B1–B13 in the release plan).
 * Each one failed before its fix.
 */

const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const path = require("node:path");

jest.mock("node_helper", () => ({ create: (def) => def }), { virtual: true });
jest.mock("logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }), { virtual: true });

const Log = require("logger");
const { loadGeoData } = require("../lib/geodata");
const { createEditorHandler, hostAllowed } = require("../lib/editor-server");
const { createTripService } = require("../lib/service");
const { createTripBook } = require("../lib/editing");
const { normalizeDate, normalizeDay, dateTrouble, validateTrip, validateTrips } = require("../lib/schema");
const { rowsToRecords, parseCSV } = require("../lib/csv");
const { writeTripsFile, backupOrder } = require("../lib/store");
const { parseUpload } = require("../lib/importers");
const { buildViewModel } = require("../lib/viewmodel");
const { makeZip } = require("./zip-helper");
const { ctx, NOW } = require("./helpers");

const geo = loadGeoData();
let dir;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "wmtc-fix-"));
});
afterEach(() => {
	delete global.config;
	fs.rmSync(dir, { recursive: true, force: true });
});

/** Run the editor handler on a real local server; returns a request helper and a closer. */
async function editor (context) {
	const handler = createEditorHandler({ getContext: () => context });
	const server = http.createServer((req, res) => {
		req.originalUrl = req.url;
		req.url = req.url.replace(/^\/MMM-WorldMapTravelCollector/, "") || "/";
		handler(req, res);
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	const base = `http://127.0.0.1:${server.address().port}/MMM-WorldMapTravelCollector`;
	const call = (method, route, body, headers = {}) => new Promise((resolve, reject) => {
		const req = http.request(base + route, { method, headers: { "X-WMTC": "1", "Content-Type": "application/json", ...headers } }, (res) => {
			let text = "";
			res.on("data", (c) => (text += c));
			res.on("end", () => resolve({ status: res.statusCode, body: /json/.test(res.headers["content-type"] || "") ? JSON.parse(text) : text }));
		});
		req.on("error", reject);
		if (body !== undefined) req.write(JSON.stringify(body));
		req.end();
	});
	return { call, close: () => new Promise((r) => server.close(r)) };
}

describe("B1: changing a trip's city moves its pin", () => {
	test("the editor only receives coordinates someone set on purpose", async () => {
		fs.writeFileSync(path.join(dir, "trips.json"), JSON.stringify([
			{ id: "t_lis", city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] },
			{ id: "t_tx", city: "Paris", country: "US", date: "2021-09", travelers: ["Alex"], lat: 33.6, lon: -95.5 }
		]));
		const config = { travelers: ["Alex"] };
		const e = await editor({ config, dataDir: dir, geo });
		const state = (await e.call("GET", "/api/state")).body;
		expect(state.trips.find((t) => t.id === "t_lis")).toMatchObject({ lat: null, lon: null });
		expect(state.trips.find((t) => t.id === "t_tx")).toMatchObject({ lat: 33.6, lon: -95.5 });

		// The phone sends back what it received with only the city changed: Porto gets Porto's position.
		const lisbon = state.trips.find((t) => t.id === "t_lis");
		const saved = await e.call("PUT", "/api/trips/t_lis", { ...lisbon, city: "Porto" });
		expect(saved.status).toBe(200);
		expect(saved.body.trip.lat).toBeCloseTo(41.15, 1);
		const file = JSON.parse(fs.readFileSync(path.join(dir, "trips.json"), "utf8")).trips;
		expect(file.find((t) => t.id === "t_lis")).not.toHaveProperty("lat");
		await e.close();
	});
});

describe("B4: the editor's guard settings come from MagicMirror's config file", () => {
	function makeHelper () {
		const def = require("../node_helper");
		const h = Object.create(def);
		h.name = "MMM-WorldMapTravelCollector";
		h.path = path.join(__dirname, "..");
		h.sent = [];
		h.sendSocketNotification = (n, p) => h.sent.push([n, p]);
		h.start();
		return h;
	}

	test("a forged start message can't drop the PIN, turn the editor on, or move the data folder", () => {
		global.config = { modules: [{ module: "clock" }, { module: "MMM-WorldMapTravelCollector", config: { travelers: ["Alex"], editorPin: "4321", dataDir: dir } }] };
		const h = makeHelper();
		h.socketNotificationReceived("WMTC_INIT", { identifier: "module_1_MMM-WorldMapTravelCollector", config: { travelers: ["Alex"], editorPin: "4321", dataDir: dir } });
		// A second message claiming another instance with no PIN and another folder.
		h.socketNotificationReceived("WMTC_INIT", { identifier: "module_7_MMM-WorldMapTravelCollector", config: { travelers: ["Alex"], editorPin: "", dataDir: "/tmp" } });
		expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining("isn't in MagicMirror's config"));
		// Even the real instance's message can't change them.
		h.socketNotificationReceived("WMTC_INIT", { identifier: "module_1_MMM-WorldMapTravelCollector", config: { travelers: ["Alex"], editorPin: "", editor: true, dataDir: "/tmp", editorHosts: ["evil.example"] } });
		const c = h.editorContext();
		expect(c.config.editorPin).toBe("4321");
		expect(c.dataDir).toBe(dir);
		expect(c.config.editorHosts).toBeUndefined();
		expect(h.instances.size).toBe(1);
		h.stop();
	});

	test("disabled entries, other modules and odd identifiers are refused; no MagicMirror config falls back", () => {
		global.config = { modules: [{ module: "MMM-WorldMapTravelCollector", disabled: true }, { module: "clock" }] };
		const h = makeHelper();
		expect(h.trustedConfig("module_0_MMM-WorldMapTravelCollector")).toBeNull();
		expect(h.trustedConfig("module_1_clock")).toBeNull();
		expect(h.trustedConfig("nonsense")).toBeNull();
		global.config.modules.push({ module: "MMM-WorldMapTravelCollector" });
		expect(h.trustedConfig("module_2_MMM-WorldMapTravelCollector")).toEqual({});
		delete global.config;
		expect(h.trustedConfig("anything")).toBeUndefined();
		h.socketNotificationReceived("WMTC_INIT", { identifier: "x" });
		expect(h.sent).toHaveLength(0);
		h.stop();
	});
});

describe("B5: a whole Takeout zip never unpacks the raw location history", () => {
	test("Records.json is skipped by name, inside a zip and on its own", () => {
		// method 12 can't be unpacked: reading it would add a different warning.
		const zip = makeZip([
			{ name: "Takeout/Location History/Records.json", data: "{\"locations\":[]}", method: 12 },
			{ name: "Takeout/Location History/Semantic Location History/2019/2019_NOVEMBER.json", data: fs.readFileSync(path.join(__dirname, "fixtures", "2019_NOVEMBER.json")) }
		]);
		const r = parseUpload([{ name: "takeout.zip", data: zip }], { geo, travelerNames: ["Alex"] });
		expect(r.kind).toBe("timeline");
		expect(r.warnings).toEqual([expect.stringMatching(/^Records\.json is raw location points/)]);
		expect(() => parseUpload([{ name: "Records.json", data: Buffer.from("not even json") }], { geo, travelerNames: ["Alex"] })).toThrow("raw location points");
	});
});

describe("B7: dates", () => {
	test("full dates in any common form give their month", () => {
		expect(normalizeDate("March 14, 2025")).toBe("2025-03");
		expect(normalizeDate("Mar 14 2025")).toBe("2025-03");
		expect(normalizeDate("15/03/2024")).toBe("2024-03");
		expect(normalizeDate("03/15/2024")).toBe("2024-03");
		expect(normalizeDay("15.03.2024")).toBe("2024-03-15");
		expect(normalizeDay("03/03/2024")).toBe("2024-03-03");
		expect(normalizeDay("31/02/2024")).toBeNull();
	});

	test("unclear and impossible dates are explained", () => {
		expect(dateTrouble("03/04/2025")).toBe("'03/04/2025' could be 3 April or 4 March. Write it as 2025-04-03 or 2025-03-04");
		expect(dateTrouble("2024-02-31")).toBe("February 2024 has no 31st");
		expect(dateTrouble("2025-04-31")).toBe("April 2025 has no 31st");
		expect(dateTrouble("2025-02-30")).toBe("February 2025 has no 30th");
		expect(dateTrouble("31 February 2024")).toBe("February 2024 has no 31st");
		expect(dateTrouble("February 31, 2024")).toBe("February 2024 has no 31st");
		expect(dateTrouble("2024-13-01")).toBeNull();
		expect(dateTrouble("31 Smarch 2024")).toBeNull();
		expect(dateTrouble("soon")).toBeNull();
		expect(dateTrouble(undefined)).toBeNull();
		const c = ctx();
		expect(validateTrip({ city: "Lisbon", country: "PT", start: "2024-02-31", travelers: ["Alex"] }, c).errors).toEqual(["February 2024 has no 31st"]);
		expect(validateTrip({ city: "Lisbon", country: "PT", date: "03/04/2025", travelers: ["Alex"] }, c).errors[0]).toMatch("could be 3 April or 4 March");
	});

	test("a spreadsheet with a start column and no date column is read", () => {
		expect(rowsToRecords(parseCSV("city,country,start,travelers\nLisbon,PT,2025-03-14,Alex")).missingFields).toEqual([]);
		fs.writeFileSync(path.join(dir, "trips.csv"), "city,country,start date,travelers\nLisbon,PT,14 March 2025,Alex\n");
		const model = createTripService({ dataDir: dir, config: { travelers: ["Alex"] }, geo, clock: () => NOW }).load();
		expect(model.problems).toEqual([]);
		expect(Object.values(model.trips)[0]).toMatchObject({ date: "2025-03", start: "2025-03-14" });
	});
});

describe("B9: backups made in the same moment", () => {
	test("are ordered by time, then by their counter", () => {
		const names = ["trips-2026-11-23T12-00-00-000Z-10.json", "trips-2026-11-23T12-00-00-000Z-2.json", "trips-2026-11-23T12-00-00-000Z.json", "trips-2026-11-23T11-59-59-999Z.json", "trips-odd.json"];
		expect([...names].sort(backupOrder)).toEqual(["trips-2026-11-23T11-59-59-999Z.json", "trips-2026-11-23T12-00-00-000Z.json", "trips-2026-11-23T12-00-00-000Z-2.json", "trips-2026-11-23T12-00-00-000Z-10.json", "trips-odd.json"]);
	});

	test("pruning keeps the newest ten even with a frozen clock", () => {
		const file = path.join(dir, "trips.json");
		const now = new Date("2026-11-23T12:00:00Z");
		for (let i = 0; i < 14; i++) writeTripsFile(file, [{ n: i }], { now });
		const book = createTripBook({ file, ctx: ctx(["Alex"]), clock: () => now });
		const kept = book.backups().map((b) => JSON.parse(fs.readFileSync(path.join(dir, "backups", b.name), "utf8")).trips[0].n);
		expect(kept).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
	});
});

describe("B10: repeated ids in a hand-edited file", () => {
	test("each trip keeps its own place on the mirror", () => {
		const { trips } = validateTrips([
			{ id: "t_1", city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] },
			{ id: "t_1", city: "Madrid", country: "ES", date: "2025-03", travelers: ["Alex"] },
			{ id: "t_1", city: "Rome", country: "IT", date: "2025-03", travelers: ["Alex"] }
		], ctx(["Alex"]));
		expect(trips.map((t) => t.id)).toEqual(["t_1", "t_1_1", "t_1_2"]);
		const model = buildViewModel(trips, { travelerNames: ["Alex"], now: NOW, countries: geo.countries });
		expect(model.views[0].countries.PT.tripIds.map((id) => model.trips[id].city)).toEqual(["Lisbon"]);
	});
});

describe("B11 and B12: imports", () => {
	test("several spreadsheets keep their own columns", () => {
		const a = Buffer.from("city,country,date,travelers\nLisbon,PT,2025-03,Alex\n");
		const b = Buffer.from("country,city,date,travelers,days\nES,Madrid,2024-05,Alex,3\n");
		const r = parseUpload([{ name: "a.csv", data: a }, { name: "b.csv", data: b }], { geo, travelerNames: ["Alex"] });
		expect(r.drafts.map((d) => [d.city, d.country, d.days])).toEqual([["Lisbon", "PT", ""], ["Madrid", "ES", "3"]]);
		expect(r.csv.headers).toEqual(["city", "country", "date", "travelers", "days"]);
		expect(r.csv.missing).toEqual([]);
		const partial = parseUpload([{ name: "a.csv", data: Buffer.from("city,country\nLisbon,PT\n") }, { name: "b.csv", data: Buffer.from("city,when\nRome,2022-09\n") }], { geo, travelerNames: ["Alex"] });
		expect(partial.csv.missing).toEqual(["travelers"]);
	});

	test("a very large Timeline file doesn't overflow", () => {
		const seg = { startTime: "2024-10-10T09:00:00.000+09:00", endTime: "2024-10-10T12:00:00.000+09:00", visit: { topCandidate: { placeLocation: { latLng: "35.0116°, 135.7681°" } } } };
		const data = Buffer.from(JSON.stringify({ semanticSegments: Array(200000).fill(seg) }));
		const r = parseUpload([{ name: "Timeline.json", data }], { geo, travelerNames: ["Alex"], home: { lat: 42.36, lon: -71.06 } });
		expect(r.visits).toBe(200000);
		expect(r.drafts.map((d) => d.city)).toEqual(["Kyoto"]);
	});
});

describe("B13: the editor answers only at home-network addresses", () => {
	test("which addresses count", () => {
		for (const ok of ["192.168.1.20:8080", "localhost:8080", "[::1]:8080", "magicmirror:8080", "mirror.local", "pi.lan", "mirror.home.arpa", "mirror.home", "mirror.internal", "pi.localdomain", undefined, ""]) expect(hostAllowed(ok)).toBe(true);
		for (const bad of ["evil.example.com", "attacker.net:8080", "192.168.1.20.nip.io"]) expect(hostAllowed(bad)).toBe(false);
		expect(hostAllowed("mirror.example.net:8080", ["Mirror.Example.net"])).toBe(true);
		expect(hostAllowed("mirror.example.net", "not a list")).toBe(false);
	});

	test("other addresses get a clear refusal", async () => {
		const e = await editor({ config: { travelers: ["Alex"] }, dataDir: dir, geo });
		const r = await e.call("GET", "/api/state", undefined, { Host: "evil.example.com" });
		expect(r.status).toBe(403);
		expect(r.body.error).toMatch(/add it to editorHosts/);
		const page = await e.call("GET", "/", undefined, { Host: "evil.example.com" });
		expect(page.status).toBe(403);
		await e.close();
		const named = await editor({ config: { travelers: ["Alex"], editorHosts: ["evil.example.com"] }, dataDir: dir, geo });
		expect((await named.call("GET", "/api/state", undefined, { Host: "evil.example.com" })).status).toBe(200);
		await named.close();
	});
});
