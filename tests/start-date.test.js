"use strict";

const { normalizeDay, endDay, validateTrip, storedTrip } = require("../lib/schema");
const { mergeTrips } = require("../lib/merge");
const { rowsToRecords, toCSV, parseCSV } = require("../lib/csv");
const { buildViewModel } = require("../lib/viewmodel");
const { formatRange, placeDetails } = require("../lib/ledger");
const { fadeFactor } = require("../lib/layout");
const { parseUpload } = require("../lib/importers");
const { loadGeoData } = require("../lib/geodata");
const { ctx, trip, NOW } = require("./helpers");

const geo = loadGeoData();
const base = { city: "Lisbon", country: "PT", travelers: ["Alex"] };

describe("reading a start day", () => {
	test.each([
		["2025-03-14", "2025-03-14"],
		["2025/3/4", "2025-03-04"],
		["2025-03-14T10:00:00Z", "2025-03-14"],
		["14 March 2025", "2025-03-14"],
		["14th Mar 2025", "2025-03-14"],
		["March 14, 2025", "2025-03-14"],
		["Mar 1 2025", "2025-03-01"],
		[new Date(Date.UTC(2025, 2, 14)), "2025-03-14"],
		["2024-02-29", "2024-02-29"],
		["2025-02-29", null],
		["2025-04-31", null],
		["2025-03-00", null],
		["03/04/2025", null],
		["2025-03", null],
		["14 Smarch 2025", null],
		["14 Ma 2025", null],
		["", null],
		[null, null],
		[undefined, null],
		[new Date("nope"), null]
	])("%p → %p", (input, expected) => {
		expect(normalizeDay(input)).toBe(expected);
	});

	test("the end day counts the start as day one", () => {
		expect(endDay("2025-03-14", 5)).toBe("2025-03-18");
		expect(endDay("2025-03-28", 5)).toBe("2025-04-01");
		expect(endDay("2025-12-30", 5)).toBe("2026-01-03");
		expect(endDay("2025-03-14", null)).toBe("2025-03-14");
		expect(endDay(null, 5)).toBeNull();
	});
});

describe("trips with a start day", () => {
	const c = ctx();
	test("a start day alone sets the month", () => {
		const r = validateTrip({ ...base, start: "14 March 2025" }, c);
		expect(r.trip).toMatchObject({ date: "2025-03", start: "2025-03-14" });
	});
	test("a full date in the date column keeps its day", () => {
		expect(validateTrip({ ...base, date: "2025-03-14" }, c).trip).toMatchObject({ date: "2025-03", start: "2025-03-14" });
		expect(validateTrip({ ...base, date: "March 2025" }, c).trip.start).toBeNull();
	});
	test("start and month must agree; unreadable starts are reported", () => {
		expect(validateTrip({ ...base, date: "2025-04", start: "2025-03-14" }, c)).toEqual({ ok: false, errors: ["The start date 2025-03-14 isn't in the trip's month (2025-04)"] });
		expect(validateTrip({ ...base, date: "2025-03", start: "the 14th" }, c).errors).toEqual(["Can't read the start date 'the 14th'. Use year, month and day like 2025-03-14"]);
		expect(validateTrip({ ...base, start: "soon" }, c).errors).toEqual(["Can't read the start date 'soon'. Use year, month and day like 2025-03-14"]);
		expect(validateTrip({ ...base, date: "2025-03", start: "2025-03-14" }, c).ok).toBe(true);
	});
	test("saved only when known", () => {
		expect(storedTrip(trip({ id: "t_1", start: "2025-03-14" }), c.geocoder)).toMatchObject({ date: "2025-03", start: "2025-03-14" });
		expect(storedTrip(trip({ id: "t_1" }), c.geocoder)).not.toHaveProperty("start");
	});
	test("combining two people's entries keeps the earliest start", () => {
		const a = trip({ id: "a", travelers: ["Alex"], start: "2025-03-16" });
		const b = trip({ id: "b", travelers: ["Sam"], start: "2025-03-14" });
		const none = trip({ id: "n", travelers: ["Sam"] });
		expect(mergeTrips([[a], [b]], ["Alex", "Sam"]).trips[0].start).toBe("2025-03-14");
		expect(mergeTrips([[a], [none]], ["Alex", "Sam"]).trips[0].start).toBe("2025-03-16");
		expect(mergeTrips([[none], [a]], ["Alex", "Sam"]).trips[0].start).toBe("2025-03-16");
	});
});

describe("spreadsheets", () => {
	test("a start column by any of its usual names, and in the download", () => {
		for (const header of ["start", "Start date", "Arrived", "From"]) {
			expect(rowsToRecords([[header], ["2025-03-14"]]).records[0]).toEqual({ start: "2025-03-14" });
		}
		const csv = toCSV([{ id: "t", city: "Lisbon", country: "PT", date: "2025-03", start: "2025-03-14", days: 5, travelers: ["Alex"] }]);
		expect(parseCSV(csv)).toEqual([
			["id", "city", "country", "date", "start", "days", "travelers", "lat", "lon", "note"],
			["t", "Lisbon", "PT", "2025-03", "2025-03-14", "5", "Alex", "", "", ""]
		]);
	});
	test("imports carry the start day; Timeline imports fill it in", () => {
		const csv = Buffer.from("city,country,date,start,travelers\nLisbon,PT,2025-03,2025-03-14,Alex\nPorto,PT,14 March 2025,,Alex\nFaro,PT,2025-03,someday,Alex\n");
		const r = parseUpload([{ name: "a.csv", data: csv }], { geo, travelerNames: ["Alex"] });
		expect(r.drafts.map((d) => d.start)).toEqual(["2025-03-14", "2025-03-14", "someday"]);
		const fs = require("node:fs");
		const t = parseUpload([{ name: "Timeline.json", data: fs.readFileSync(`${__dirname}/fixtures/timeline-phone.json`) }], { geo, travelerNames: ["Alex"], home: { lat: 42.36, lon: -71.06 } });
		expect(t.drafts.find((d) => d.city === "Lisbon")).toMatchObject({ date: "2025-03", start: "2025-03-02", days: "4" });
	});
});

describe("on the map", () => {
	const trips = [
		trip({ id: "a", date: "2026-10", start: "2026-10-01", days: 10 }),
		trip({ id: "b", city: "Porto", date: "2026-10", lat: 41.15, lon: -8.61 })
	];
	const model = buildViewModel(trips, { travelerNames: ["Alex", "Sam"], now: NOW, countries: geo.countries });

	test("trips know their start and end; fading counts from the latest end", () => {
		expect(model.trips.a).toMatchObject({ start: "2026-10-01", end: "2026-10-10" });
		expect(model.trips.b).toMatchObject({ start: null, end: null });
		// Lisbon ended 10 Oct; Porto has only a month (read as 15 Oct when fading by days).
		const all = model.views[0];
		expect(all.pins.find((p) => p.city === "Lisbon").last).toBe("2026-10-10");
		expect(all.countries.PT.last).toBe("2026-10-10");
		const days = { enabled: true, strength: 0.6, unit: "days", amount: 90 };
		expect(fadeFactor("2026-10-10", model.today, days)).toBe(0.707); // 44 of 90 days
		expect(fadeFactor("2026-10", model.today, days)).toBe(0.74);
		// Months and years still work with a full date.
		expect(fadeFactor("2025-11-20", "2026-11-23", { enabled: true, strength: 0.6, unit: "months", amount: 24 })).toBe(0.7);
	});

	test("the details card shows exact dates when known", () => {
		expect(formatRange("2025-03-14")).toBe("14 Mar 2025");
		expect(formatRange("2025-03-14", "2025-03-18")).toBe("14–18 Mar 2025");
		expect(formatRange("2025-03-28", "2025-04-01")).toBe("28 Mar – 1 Apr 2025");
		expect(formatRange("2025-12-30", "2026-01-03")).toBe("30 Dec 2025 – 3 Jan 2026");
		expect(formatRange("2025-03-14", "garbled")).toBe("14 Mar 2025");
		expect(formatRange("soon")).toBe("soon");
		expect(formatRange(null)).toBe("");
		const d = placeDetails([model.trips.a, model.trips.b], { kind: "country" });
		expect(d.visits.map((v) => v.when)).toEqual(["1–10 Oct 2026", "Oct 2026"]);
	});
});
