"use strict";

const { computeStats, EXTRA_STATS } = require("../lib/stats");
const { statParts } = require("../lib/ledger");
const { loadGeoData } = require("../lib/geodata");

const geo = loadGeoData();
const NOW = new Date("2026-11-23T12:00:00");
const trip = (o) => ({ city: "", country: "PT", date: "2025-03", travelers: ["Alex"], ...o });
const BOSTON = { lat: 42.36, lon: -71.06 };
const trips = [
	trip({ city: "Lisbon", lat: 38.72, lon: -9.14, days: 5, start: "2025-03-10" }),
	trip({ city: "Porto", lat: 41.15, lon: -8.61, days: 2 }),
	trip({ city: "Lisbon", date: "2026-11", start: "2026-11-01", days: 3, lat: 38.72, lon: -9.14 }),
	trip({ city: "Sydney", country: "AU", date: "2024-01", days: 21, lat: -33.87, lon: 151.21 }),
	trip({ city: "Austin", country: "US", date: "2026-02", lat: 30.27, lon: -97.74 }),
	trip({ city: "Paris", country: "US", date: "2026-04", lat: 33.66, lon: -95.56 }),
	trip({ city: "Denver", country: "US", date: "2023-06", lat: 39.74, lon: -104.98 }),
	trip({ city: "Washington", country: "US", date: "2023-07", lat: 38.9, lon: -77.04 }),
	trip({ city: "Tokyo", country: "JP", date: "2027-02", lat: 35.69, lon: 139.69 }),
	trip({ city: "Kyoto", country: "JP", date: "2026-12", start: "2026-12-20", lat: 35.01, lon: 135.77 })
];
const stats = (list, extra = {}) => computeStats(list, { now: NOW, countries: geo.countries, geocoder: geo.geocoder, home: BOSTON, ...extra });
const line = (s, keys) => statParts(s, keys, "en").map((p) => `${p.before ? `${p.before} ` : ""}${p.value} ${p.label}`);

describe("more stats", () => {
	test("each one, worked out from the trips", () => {
		const s = stats(trips);
		expect(s).toMatchObject({
			daysTraveled: 31,
			nextTrip: { place: "Kyoto", days: 27 },
			lastTrip: { place: "Lisbon", months: 0, days: 20 },
			farthest: { place: "Sydney", distance: 16240 },
			newThisYear: 0,
			mostVisited: { place: "United States", visits: 4 },
			longestTrip: { days: 21, place: "Australia" },
			usStates: 2 // Texas (Austin, Paris) and Colorado; Washington, D.C. isn't a state
		});
		expect(line(s, EXTRA_STATS)).toEqual([
			"31 days traveled",
			"Next: Kyoto in 27 days",
			"Last: Lisbon 20 days ago",
			"Farthest: Sydney 16,240 km from home",
			"0 new countries in 2026",
			"Most visited: United States 4 visits",
			"Longest trip: 21 days in Australia",
			"2/50 US states"
		]);
	});

	test("in the order asked for, with the default six unchanged", () => {
		const s = stats(trips);
		expect(line(s, ["nextTrip", "countries"])).toEqual(["Next: Kyoto in 27 days", "3 countries"]);
		expect(statParts(s).map((p) => p.key)).toEqual(["countries", "cities", "continents", "worldPercent", "tripsThisYear", "distance"]);
	});

	test("months when there's no start day; years for long ago; miles", () => {
		const s = stats([trip({ date: "2019-05", city: "Lisbon", lat: 38.72, lon: -9.14 }), trip({ date: "2027-03", country: "JP" })], { units: "mi" });
		expect(line(s, ["nextTrip", "lastTrip", "farthest"])).toEqual(["Next: Japan in 4 months", "Last: Lisbon 7 years ago", "Farthest: Lisbon 3,188 mi from home"]);
		const soon = stats([trip({ date: "2026-12" }), trip({ date: "2026-10" })]);
		expect(line(soon, ["nextTrip", "lastTrip"])).toEqual(["Next: Portugal next month", "Last: Portugal last month"]);
		const near = stats([trip({ date: "2026-11", start: "2026-11-22", days: 1 }), trip({ date: "2026-12", start: "2026-12-01" })]);
		expect(line(near, ["lastTrip"])).toEqual(["Last: Portugal yesterday"]);
		expect(line({ ...near, nextTrip: { place: "Rome", days: 1 } }, ["nextTrip"])).toEqual(["Next: Rome tomorrow"]);
		expect(line({ ...near, nextTrip: { place: "Rome", days: 0 }, lastTrip: { place: "Oslo", days: 0, months: 0 } }, ["nextTrip", "lastTrip"])).toEqual(["Next: Rome starts today", "Last: Oslo today"]);
		expect(line({ ...near, lastTrip: { place: "Oslo", months: 0 } }, ["lastTrip"])).toEqual(["Last: Oslo this month"]);
		expect(line({ ...near, lastTrip: { place: "Oslo", months: 5 } }, ["lastTrip"])).toEqual(["Last: Oslo 5 months ago"]);
	});

	test("new countries this year, and one-day trips", () => {
		const s = stats([trip({ date: "2026-03", country: "IS", days: 1 }), trip({ date: "2026-05", country: "NO" }), trip({ date: "2020-01", country: "NO" })]);
		expect(line(s, ["newThisYear", "daysTraveled", "longestTrip"])).toEqual(["1 new country in 2026", "1 day traveled", "Longest trip: 1 day in Iceland"]);
	});

	test("left out when there's nothing to show", () => {
		const s = computeStats([trip({ date: "2025-03" })], { now: NOW, countries: geo.countries });
		expect(s).toMatchObject({ daysTraveled: null, nextTrip: null, farthest: null, mostVisited: null, longestTrip: null, usStates: null });
		expect(line(s, EXTRA_STATS)).toEqual(["Last: Portugal 20 months ago", "0 new countries in 2026"]);
		const none = computeStats([], { now: NOW, countries: geo.countries });
		expect(none.lastTrip).toBeNull();
		// A home but no coordinates anywhere: nothing farthest.
		expect(computeStats([trip({})], { now: NOW, countries: geo.countries, home: BOSTON }).farthest).toBeNull();
	});
});
