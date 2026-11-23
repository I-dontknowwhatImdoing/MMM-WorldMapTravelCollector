"use strict";

const { mergeTrips, visitKey } = require("../lib/merge");
const { currentMonth, isPlanned, expandFilters, matchesFilter, filterTrips, travelerGroup, filterLabel } = require("../lib/filters");
const { computeStats, haversineKm, newestTrip, ALL_STATS } = require("../lib/stats");
const { loadGeoData } = require("../lib/geodata");
const { NOW, trip } = require("./helpers");

const { countries } = loadGeoData();

describe("mergeTrips", () => {
	test("same city, country and month merge, travelers combine in config order", () => {
		const a = [trip({ id: "a1", travelers: ["Sam"], days: null, note: "" })];
		const b = [trip({ id: "b1", city: "LISBON", travelers: ["Alex"], days: 4, note: "from Alex's import" })];
		const { trips, merged } = mergeTrips([a, b], ["Alex", "Sam"]);
		expect(merged).toBe(1);
		expect(trips).toHaveLength(1);
		expect(trips[0]).toMatchObject({ id: "a1", travelers: ["Alex", "Sam"], days: 4, note: "from Alex's import" });
	});

	test("longest stay wins, first note wins, first coordinates win", () => {
		const a = [trip({ days: 3, note: "first", lat: 1, lon: 2 })];
		const b = [trip({ days: 5, note: "second", lat: 9, lon: 9 })];
		const c = [trip({ days: 2 })];
		const { trips } = mergeTrips([a, b, c]);
		expect(trips[0]).toMatchObject({ days: 5, note: "first", lat: 1, lon: 2 });
	});

	test("fills in missing coordinates from a later source", () => {
		const a = [trip({ lat: null, lon: null })];
		const b = [trip({ lat: 5, lon: 6 })];
		expect(mergeTrips([a, b]).trips[0]).toMatchObject({ lat: 5, lon: 6 });
	});

	test("a later source without days keeps the earlier days", () => {
		const { trips } = mergeTrips([[trip({ days: 3 })], [trip({ days: null })]]);
		expect(trips[0].days).toBe(3);
	});

	test("different months or cities stay separate; country-only visits merge with each other", () => {
		const list = [
			trip({ date: "2025-03" }),
			trip({ date: "2025-04" }),
			trip({ city: "Porto" }),
			trip({ city: "", lat: null, lon: null }),
			trip({ city: "", lat: null, lon: null, travelers: ["Alex"] })
		];
		const { trips, merged } = mergeTrips([list]);
		expect(trips).toHaveLength(4);
		expect(merged).toBe(1);
	});

	test("travelers not in the config are kept, after the known ones", () => {
		const { trips } = mergeTrips([[trip({ travelers: ["Kim"] })], [trip({ travelers: ["Sam"] })]], ["Alex", "Sam"]);
		expect(trips[0].travelers).toEqual(["Sam", "Kim"]);
	});

	test("does not modify its input", () => {
		const a = [trip({ travelers: ["Sam"] })];
		mergeTrips([a, [trip({ travelers: ["Alex"] })]], ["Alex", "Sam"]);
		expect(a[0].travelers).toEqual(["Sam"]);
	});

	test("visitKey ignores accents and case", () => {
		expect(visitKey(trip({ city: "Reykjavík" }))).toBe(visitKey(trip({ city: "reykjavik" })));
	});
});

describe("planned trips", () => {
	test("current month is local", () => {
		expect(currentMonth(NOW)).toBe("2026-11");
		expect(typeof currentMonth()).toBe("string");
	});

	test("only months after the current month are planned", () => {
		expect(isPlanned(trip({ date: "2026-10" }), NOW)).toBe(false);
		expect(isPlanned(trip({ date: "2026-11" }), NOW)).toBe(false);
		expect(isPlanned(trip({ date: "2026-12" }), NOW)).toBe(true);
		expect(isPlanned(trip({ date: "2027-01" }), NOW)).toBe(true);
		expect(isPlanned(trip({ date: "2000-01" }))).toBe(false);
	});
});

describe("filters", () => {
	const two = ["Alex", "Sam"];
	const four = ["Alex", "Sam", "Kim", "Lee"];

	test("expandFilters for two travelers", () => {
		expect(expandFilters(["all", "together", "solo"], two)).toEqual(["all", "together", "solo:Alex", "solo:Sam"]);
		expect(expandFilters(["all", "person"], two)).toEqual(["all", "person:Alex", "person:Sam"]);
		expect(expandFilters(["solo:Sam", "solo:Nobody", "all", "all", "weird"], two)).toEqual(["solo:Sam", "all"]);
	});

	test("expandFilters for one traveler collapses to all", () => {
		expect(expandFilters(["all", "together", "solo", "person:Alex"], ["Alex"])).toEqual(["all"]);
		expect(expandFilters([], two)).toEqual(["all"]);
		expect(expandFilters(undefined, two)).toEqual(["all"]);
	});

	test("two travelers", () => {
		const both = trip({ travelers: ["Alex", "Sam"] });
		const alex = trip({ travelers: ["Alex"] });
		expect(matchesFilter(both, "all", two)).toBe(true);
		expect(matchesFilter(both, "together", two)).toBe(true);
		expect(matchesFilter(alex, "together", two)).toBe(false);
		expect(matchesFilter(alex, "solo:Alex", two)).toBe(true);
		expect(matchesFilter(alex, "solo:Sam", two)).toBe(false);
		expect(matchesFilter(both, "solo:Alex", two)).toBe(false);
		expect(matchesFilter(both, "person:Alex", two)).toBe(true);
		expect(matchesFilter(both, "nonsense", two)).toBe(false);
	});

	test("four travelers: subset trips appear only under all and person", () => {
		const subset = trip({ travelers: ["Alex", "Sam"] });
		const everyone = trip({ travelers: four });
		expect(matchesFilter(subset, "together", four)).toBe(false);
		expect(matchesFilter(everyone, "together", four)).toBe(true);
		expect(matchesFilter(subset, "solo:Alex", four)).toBe(false);
		expect(matchesFilter(subset, "person:Sam", four)).toBe(true);
		expect(matchesFilter(subset, "person:Kim", four)).toBe(false);
		expect(filterTrips([subset, everyone], "together", four)).toEqual([everyone]);
	});

	test("together with no travelers configured matches nothing", () => {
		expect(matchesFilter(trip(), "together", [])).toBe(false);
	});

	test("travelerGroup picks the map color group", () => {
		expect(travelerGroup(trip({ travelers: ["Alex", "Sam"] }), two)).toBe("together");
		expect(travelerGroup(trip({ travelers: ["Sam"] }), two)).toBe("Sam");
		expect(travelerGroup(trip({ travelers: ["Alex", "Sam"] }), four)).toBe("group");
		expect(travelerGroup(trip({ travelers: ["Alex"] }), ["Alex"])).toBe("Alex");
	});

	test("filterLabel", () => {
		expect(filterLabel("all")).toBe("All");
		expect(filterLabel("together")).toBe("Together");
		expect(filterLabel("solo:Sam")).toBe("Sam only");
		expect(filterLabel("person:Sam")).toBe("All of Sam's");
		expect(filterLabel("solo:Sam", { solo: "Solo {name}" })).toBe("Solo Sam");
		expect(filterLabel("odd:Sam")).toBe("Sam");
		expect(filterLabel("year:2025")).toBe("2025");
		expect(filterLabel("year:2025", { year: "Trips in {name}" })).toBe("Trips in 2025");
		expect(filterLabel("month:3")).toBe("March");
		expect(filterLabel("month:3", { month: "{name} trips" })).toBe("March trips");
		expect(filterLabel("month:13")).toBe("month:13");
	});

	test("year and month views", () => {
		const trips = [trip({ date: "2024-03" }), trip({ date: "2025-10" }), trip({ date: "2025-03" }), trip({ date: "2027-01" })];
		expect(expandFilters(["all", "years"], two, trips)).toEqual(["all", "year:2027", "year:2025", "year:2024"]);
		expect(expandFilters(["months"], two, trips)).toEqual(["month:1", "month:3", "month:10"]);
		expect(expandFilters(["year:2019", "month:03", "month:13", "year:25", "years"], two, trips)).toEqual(["year:2019", "month:3", "year:2027", "year:2025", "year:2024"]);
		expect(expandFilters(["years"], ["Alex"])).toEqual(["all"]);
		expect(filterTrips(trips, "year:2025", two).map((t) => t.date)).toEqual(["2025-10", "2025-03"]);
		expect(filterTrips(trips, "month:3", two).map((t) => t.date)).toEqual(["2024-03", "2025-03"]);
		// Year views work with one traveler too.
		expect(expandFilters(["all", "years"], ["Alex"], trips)).toEqual(["all", "year:2027", "year:2025", "year:2024"]);
	});
});

describe("stats", () => {
	const trips = [
		trip({ city: "Lisbon", country: "PT", date: "2026-03", lat: 38.7167, lon: -9.1333 }),
		trip({ city: "lisbon", country: "PT", date: "2024-03", lat: 38.7167, lon: -9.1333 }),
		trip({ city: "Porto", country: "PT", date: "2026-02", lat: 41.15, lon: -8.61 }),
		trip({ city: "Tokyo", country: "JP", date: "2024-10", lat: 35.69, lon: 139.69 }),
		trip({ city: "", country: "IS", date: "2023-08", lat: null, lon: null }),
		trip({ city: "Paris", country: "US", date: "2021-09", lat: 33.66, lon: -95.55 }),
		trip({ city: "Cape Town", country: "ZA", date: "2027-04", lat: -33.92, lon: 18.42 })
	];

	test("counts, ignoring planned trips", () => {
		const s = computeStats(trips, { now: NOW, countries });
		expect(s).toMatchObject({
			countries: 4,
			cities: 4,
			continents: 3,
			continentNames: ["Asia", "Europe", "North America"],
			worldPercent: 2,
			tripsThisYear: 2,
			year: 2026,
			distance: null,
			units: "km"
		});
	});

	test("percent shows one decimal under 1%", () => {
		const s = computeStats([trip()], { now: NOW, countries });
		expect(s.worldPercent).toBe(0.5);
		expect(computeStats([], { now: NOW, countries }).worldPercent).toBe(0);
		expect(computeStats([trip()], { now: NOW, countries, worldCountryCount: 10 }).worldPercent).toBe(10);
	});

	test("distance is round trips from home, in km or miles", () => {
		const home = { lat: 38.7167, lon: -9.1333 }; // Lisbon
		const one = [trip({ city: "Porto", lat: 41.15, lon: -8.61, date: "2025-01" })];
		const km = computeStats(one, { now: NOW, countries, home }).distance;
		const leg = haversineKm(home, { lat: 41.15, lon: -8.61 });
		expect(km).toBe(Math.round(2 * leg));
		const mi = computeStats(one, { now: NOW, countries, home, units: "mi" });
		expect(mi.units).toBe("mi");
		expect(mi.distance).toBe(Math.round((2 * leg) / 1.609344));
		expect(computeStats(trips, { now: NOW, countries, home }).distance).toBeGreaterThan(0);
		expect(computeStats(one, { now: NOW, countries, home: { lat: NaN, lon: 0 } }).distance).toBeNull();
	});

	test("defaults now to today", () => {
		expect(computeStats([trip({ date: "2000-01" })], { countries }).tripsThisYear).toBe(0);
	});

	test("haversine against known distances (within 0.5%)", () => {
		expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.195, 2);
		const londonParis = haversineKm({ lat: 51.5074, lon: -0.1278 }, { lat: 48.8566, lon: 2.3522 });
		expect(Math.abs(londonParis - 343.5) / 343.5).toBeLessThan(0.005);
		const nyLa = haversineKm({ lat: 40.7128, lon: -74.006 }, { lat: 34.0522, lon: -118.2437 });
		expect(Math.abs(nyLa - 3936) / 3936).toBeLessThan(0.005);
		expect(haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * 6371.0088, 0);
	});

	test("newestTrip skips planned trips", () => {
		expect(newestTrip(trips, NOW).city).toBe("Lisbon");
		expect(newestTrip([], NOW)).toBeNull();
		expect(newestTrip([trip({ date: "2000-01" })]).date).toBe("2000-01");
	});

	test("ALL_STATS lists every stat key", () => {
		const s = computeStats(trips, { now: NOW, countries });
		for (const key of ALL_STATS) expect(s).toHaveProperty(key);
	});
});
