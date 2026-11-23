"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildViewModel, groupOf } = require("../lib/viewmodel");
const { createTripService, resolveHome } = require("../lib/service");
const { loadGeoData } = require("../lib/geodata");
const { NOW, trip } = require("./helpers");

const geo = loadGeoData();
const names = ["Alex", "Sam"];

describe("groupOf", () => {
	test("single shared group or mixed", () => {
		expect(groupOf([trip({ travelers: ["Alex"] }), trip({ travelers: ["Alex"] })], names)).toBe("Alex");
		expect(groupOf([trip({ travelers: ["Alex"] }), trip({ travelers: ["Sam"] })], names)).toBe("mixed");
		expect(groupOf([trip()], names)).toBe("together");
	});
});

describe("buildViewModel", () => {
	const trips = [
		trip({ id: "lis", city: "Lisbon", country: "PT", date: "2025-03" }),
		trip({ id: "lis2", city: "Lisbon", country: "PT", date: "2019-06", travelers: ["Alex"] }),
		trip({ id: "rey", city: "Reykjavík", country: "IS", date: "2023-08", travelers: ["Sam"], lat: 64.1, lon: -21.9 }),
		trip({ id: "ice", city: "", country: "IS", date: "2023-08", travelers: ["Sam"], lat: null, lon: null }),
		trip({ id: "chi", city: "Chicago", country: "US", date: "2024-06", travelers: ["Alex"], lat: 41.85, lon: -87.65 }),
		trip({ id: "cpt", city: "Cape Town", country: "ZA", date: "2027-04", lat: -33.92, lon: 18.42 })
	];
	const model = buildViewModel(trips, { travelerNames: names, now: NOW, countries: geo.countries, home: { lat: 42.36, lon: -71.06 } });

	test("most recent visit per country and pin, for fading old trips", () => {
		const all = model.views[0];
		expect(model.currentMonth).toBe("2026-11");
		expect(model.today).toBe("2026-11-23");
		expect(model.years).toEqual(["2019", "2023", "2024", "2025", "2027"]);
		expect(all.countries.PT.when).toBe("2025-03");
		expect(all.countries.ZA.when).toBe("2027-04"); // only planned: its planned month
		expect(all.pins.find((p) => p.city === "Cape Town").when).toBe("2027-04");
		expect(all.countries.PT.last).toBe("2025-03");
		expect(all.countries.ZA).toMatchObject({ state: "planned", last: null });
		expect(all.pins.find((p) => p.city === "Lisbon").last).toBe("2025-03");
		expect(all.pins.find((p) => p.city === "Cape Town").last).toBeNull();
		// In Alex's solo view, Lisbon was last visited (alone) in 2019.
		expect(model.views.find((v) => v.id === "solo:Alex").countries.PT.last).toBe("2019-06");
	});

	test("each pin and country lists its trips, newest first, for the details card", () => {
		const all = model.views[0];
		expect(all.countries.PT.tripIds).toEqual(["lis", "lis2"]);
		expect(all.countries.IS.tripIds.sort()).toEqual(["ice", "rey"]);
		expect(all.countries.ZA.tripIds).toEqual(["cpt"]);
		expect(all.pins.find((p) => p.city === "Lisbon").tripIds).toEqual(["lis", "lis2"]);
		expect(model.views.find((v) => v.id === "solo:Sam").countries.IS.tripIds.sort()).toEqual(["ice", "rey"]);
	});

	test("default views and labels", () => {
		expect(model.views.map((v) => [v.id, v.label])).toEqual([
			["all", "All"],
			["together", "Together"],
			["solo:Alex", "Alex only"],
			["solo:Sam", "Sam only"]
		]);
		expect(model.travelers).toEqual(names);
		expect(model.generatedAt).toBe(NOW.toISOString());
	});

	test("trip table", () => {
		expect(model.trips.lis).toMatchObject({ countryName: "Portugal", group: "together", planned: false, days: null, note: "" });
		expect(model.trips.cpt.planned).toBe(true);
		expect(model.trips.chi.group).toBe("Alex");
	});

	test("country shading: visited beats planned, colors by group", () => {
		const all = model.views[0];
		expect(all.countries).toEqual({
			PT: { state: "visited", group: "mixed", last: "2025-03", when: "2025-03", tripIds: ["lis", "lis2"] },
			IS: { state: "visited", group: "Sam", last: "2023-08", when: "2023-08", tripIds: expect.arrayContaining(["ice", "rey"]) },
			US: { state: "visited", group: "Alex", last: "2024-06", when: "2024-06", tripIds: ["chi"] },
			ZA: { state: "planned", group: "together", last: null, when: "2027-04", tripIds: ["cpt"] }
		});
	});

	test("pins: one per city, visit counts, planned and newest", () => {
		const all = model.views[0];
		const byKey = Object.fromEntries(all.pins.map((p) => [p.key, p]));
		expect(Object.keys(byKey).sort()).toEqual(["cape town|ZA", "chicago|US", "lisbon|PT", "reykjavik|IS"]);
		expect(byKey["lisbon|PT"]).toMatchObject({ visits: 2, planned: false, group: "mixed", newest: true });
		expect(byKey["cape town|ZA"]).toMatchObject({ visits: 0, planned: true, newest: false });
		expect(all.pins[0].key).toBe("lisbon|PT");
		expect(all.newestId).toBe("lis");
	});

	test("ledger order is newest first", () => {
		expect(model.views[0].tripIds).toEqual(["cpt", "lis", "chi", "ice", "rey", "lis2"]);
	});

	test("views filter trips and carry their own stats", () => {
		const sam = model.views.find((v) => v.id === "solo:Sam");
		expect(Object.keys(sam.countries)).toEqual(["IS"]);
		expect(sam.stats).toMatchObject({ countries: 1, cities: 1 });
		expect(sam.pins[0].newest).toBe(true);
		const together = model.views.find((v) => v.id === "together");
		expect(together.stats.countries).toBe(1);
		expect(together.newestId).toBe("lis");
		expect(model.views[0].stats.distance).toBeGreaterThan(0);
	});

	test("empty data and custom filters", () => {
		const m = buildViewModel([], { travelerNames: ["Alex"], filters: ["all", "together"], countries: geo.countries });
		expect(m.views).toHaveLength(1);
		expect(m.views[0]).toMatchObject({ id: "all", pins: [], tripIds: [], newestId: null, countries: {} });
	});

	test("custom labels", () => {
		const m = buildViewModel([], { travelerNames: names, filters: ["solo"], labels: { solo: "Solo: {name}" }, countries: geo.countries, now: NOW });
		expect(m.views.map((v) => v.label)).toEqual(["Solo: Alex", "Solo: Sam"]);
	});
});

describe("resolveHome", () => {
	test("coordinates, city lookup, or nothing", () => {
		expect(resolveHome({ lat: 1, lon: 2 }, geo)).toEqual({ lat: 1, lon: 2 });
		expect(resolveHome({ lat: "1.5", lon: "2" }, geo)).toEqual({ lat: 1.5, lon: 2 });
		expect(resolveHome({ city: "Boston", country: "United States" }, geo).lat).toBeCloseTo(42.36, 1);
		expect(resolveHome({ city: "Qqqqville", country: "US" }, geo)).toBeNull();
		expect(resolveHome({ city: "Boston", country: "Narnia" }, geo)).toBeNull();
		expect(resolveHome({ city: "Boston" }, geo)).toBeNull();
		expect(resolveHome({ lat: "x", lon: 2 }, geo)).toBeNull();
		expect(resolveHome(null, geo)).toBeNull();
		expect(resolveHome("Boston", geo)).toBeNull();
	});
});

describe("trip service", () => {
	let dir;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "wmtc-svc-"));
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const config = { travelers: [{ name: "Alex", color: "#4FC3F7" }, "Sam"], filters: ["all", "together", "solo"], home: { city: "Boston", country: "US" } };

	test("no data yet", () => {
		const svc = createTripService({ dataDir: dir, config, geo, clock: () => NOW });
		const model = svc.load();
		expect(model.views[0].tripIds).toEqual([]);
		expect(model.problems).toEqual([]);
		expect(svc.lastModel).toBe(model);
	});

	test("merges trips.json and trips.csv and reports bad rows", () => {
		fs.writeFileSync(path.join(dir, "trips.json"), JSON.stringify([{ city: "Lisbon", country: "PT", date: "2025-03", travelers: "Sam" }]));
		fs.writeFileSync(path.join(dir, "trips.csv"), "city,country,date,travelers\nLisbon,PT,2025-03,Alex\nPorto,PT,2025-03,Bob\n");
		const warnings = [];
		const svc = createTripService({ dataDir: dir, config, geo, clock: () => NOW, logger: { warn: (m) => warnings.push(m), info () {} } });
		const model = svc.load();
		const ids = model.views[0].tripIds;
		expect(ids).toHaveLength(1);
		expect(model.trips[ids[0]].travelers).toEqual(["Alex", "Sam"]);
		expect(model.problems).toEqual([{ source: "trips.csv", row: 3, errors: [expect.stringContaining("Unknown traveler 'Bob'")] }]);
		expect(warnings).toEqual([expect.stringMatching(/^trips\.csv row 3: /)]);
	});

	test("broken files become problems, not crashes", () => {
		fs.writeFileSync(path.join(dir, "trips.json"), "{not json");
		fs.writeFileSync(path.join(dir, "trips.csv"), "city\nLisbon\n");
		const warnings = [];
		const model = createTripService({ dataDir: dir, config, geo, logger: { warn: (m) => warnings.push(m), info () {} } }).load();
		expect(model.problems.map((p) => p.source)).toEqual(["trips.json", "trips.csv"]);
		expect(model.problems[1].errors[0]).toContain("no column for: country, date, travelers");
		expect(warnings[0]).toMatch(/^trips\.json: /);
	});

	test("watch picks up changes, refresh rebuilds, stop is safe", async () => {
		const models = [];
		const svc = createTripService({ dataDir: path.join(dir, "new"), config, geo, onChange: (m) => models.push(m) });
		svc.watch(20);
		svc.watch(20); // second call is a no-op
		fs.writeFileSync(path.join(dir, "new", "trips.json"), JSON.stringify([{ city: "Porto", country: "PT", date: "2024-01", travelers: "Alex" }]));
		await waitFor(() => models.length > 0);
		expect(Object.values(models[models.length - 1].trips)[0].city).toBe("Porto");
		const before = models.length;
		svc.refresh();
		await waitFor(() => models.length > before);
		svc.stop();
		svc.stop();
	});

	test("a reload that throws is logged, not fatal", async () => {
		const warnings = [];
		const svc = createTripService({ dataDir: dir, config, geo, onChange: () => { throw new Error("boom"); }, logger: { warn: (m) => warnings.push(m), info () {} } });
		svc.refresh();
		await waitFor(() => warnings.length > 0);
		expect(warnings[0]).toBe("Reload failed: boom");
	});

	test("works without onChange", async () => {
		const svc = createTripService({ dataDir: dir, config: { travelers: ["Alex"] }, geo });
		svc.refresh();
		await new Promise((r) => setTimeout(r, 20));
		expect(svc.lastModel.views).toHaveLength(1);
	});
});

function waitFor (check, timeout = 3000) {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const tick = () => {
			if (check()) return resolve();
			if (Date.now() - start > timeout) return reject(new Error("timed out"));
			setTimeout(tick, 20);
		};
		tick();
	});
}
