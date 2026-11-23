"use strict";

const { normalizeDate, normalizeTravelers, tripId, validateTrip, validateTrips } = require("../lib/schema");
const { ctx } = require("./helpers");

describe("normalizeDate", () => {
	test.each([
		["2025-03", "2025-03"],
		["2025-3", "2025-03"],
		["2025/03", "2025-03"],
		["2025.03", "2025-03"],
		["2025-03-14", "2025-03"],
		["2025-03-14T10:00:00Z", "2025-03"],
		["2025-03-14 10:00", "2025-03"],
		["03/2025", "2025-03"],
		["3-2025", "2025-03"],
		["March 2025", "2025-03"],
		["march 2025", "2025-03"],
		["Mar 2025", "2025-03"],
		["Mar. 2025", "2025-03"],
		["Sept 2025", "2025-09"],
		["14 March 2025", "2025-03"],
		["1st May, 2024", "2024-05"],
		[" 2025-12 ", "2025-12"]
	])("%s -> %s", (input, expected) => {
		expect(normalizeDate(input)).toBe(expected);
	});

	test.each([["2025-13"], ["2025-00"], ["13/2025"], ["Marx 2025"], ["Ma 2025"], ["2025"], ["yesterday"], [""], [null], [undefined], ["1850-01"], ["2300-01"]])(
		"rejects %p",
		(input) => {
			expect(normalizeDate(input)).toBeNull();
		}
	);

	test("Date objects", () => {
		expect(normalizeDate(new Date(Date.UTC(2024, 1, 10)))).toBe("2024-02");
		expect(normalizeDate(new Date("nope"))).toBeNull();
	});
});

describe("normalizeTravelers", () => {
	const names = ["Alex", "Sam"];

	test.each([
		["Alex", ["Alex"]],
		["alex; sam", ["Alex", "Sam"]],
		["Sam, Alex", ["Alex", "Sam"]],
		["Sam & Alex", ["Alex", "Sam"]],
		["Alex and Sam", ["Alex", "Sam"]],
		["Alex+Sam", ["Alex", "Sam"]],
		["Alex/Sam", ["Alex", "Sam"]],
		["Alex | Sam", ["Alex", "Sam"]],
		["both", ["Alex", "Sam"]],
		["Together", ["Alex", "Sam"]],
		[["SAM"], ["Sam"]],
		["", []],
		[null, []]
	])("%p -> %p", (input, expected) => {
		expect(normalizeTravelers(input, names)).toEqual({ travelers: expected, unknown: [] });
	});

	test("reports unknown names", () => {
		expect(normalizeTravelers("Alex, Bob", names)).toEqual({ travelers: ["Alex"], unknown: ["Bob"] });
	});

	test("names with accents and hyphens", () => {
		expect(normalizeTravelers("josé; mary jane", ["José", "Mary-Jane"]).travelers).toEqual(["José", "Mary-Jane"]);
	});
});

describe("tripId", () => {
	const base = { city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] };

	test("is stable and content-based", () => {
		expect(tripId(base)).toBe(tripId({ ...base }));
		expect(tripId(base)).toMatch(/^t_[0-9a-f]{10}$/);
		expect(tripId(base)).not.toBe(tripId({ ...base, date: "2025-04" }));
		expect(tripId(base)).not.toBe(tripId(base, 1));
		expect(tripId({ ...base, city: "LISBON" })).toBe(tripId(base));
	});
});

describe("validateTrip", () => {
	const c = ctx();

	test("a clean row", () => {
		const r = validateTrip({ city: "Lisboa", country: "Portugal", date: "March 2025", days: "5", travelers: "Alex; Sam", note: " Anniversary " }, c);
		expect(r.ok).toBe(true);
		expect(r.trip).toMatchObject({ id: null, city: "Lisbon", country: "PT", date: "2025-03", days: 5, travelers: ["Alex", "Sam"], note: "Anniversary" });
		expect(r.trip.lat).toBeCloseTo(38.72, 1);
	});

	test("country-only visit has no coordinates", () => {
		const r = validateTrip({ country: "Iceland", date: "2023-08", travelers: "Sam" }, c);
		expect(r.ok).toBe(true);
		expect(r.trip).toMatchObject({ city: "", country: "IS", lat: null, lon: null, days: null, note: "" });
	});

	test("country-only visit may carry coordinates", () => {
		const r = validateTrip({ country: "IS", date: "2023-08", travelers: "Sam", lat: "64.1", lon: "-21.9" }, c);
		expect(r.trip).toMatchObject({ lat: 64.1, lon: -21.9 });
	});

	test("manual coordinates win and skip the lookup", () => {
		const r = validateTrip({ city: "Tiny Village", country: "AT", date: "2024-07", travelers: "Alex", lat: 47.56, lon: 13.65 }, c);
		expect(r.ok).toBe(true);
		expect(r.trip).toMatchObject({ city: "Tiny Village", lat: 47.56, lon: 13.65 });
	});

	test("keeps an existing id", () => {
		const r = validateTrip({ id: " t_abc ", city: "Porto", country: "PT", date: "2025-03", travelers: "Alex" }, c);
		expect(r.trip.id).toBe("t_abc");
	});

	test("collects every problem in one go", () => {
		const r = validateTrip({ city: "Foo", country: "Narnia", date: "2019-13", travelers: "Bob", days: "2.5" }, c);
		expect(r.ok).toBe(false);
		expect(r.errors).toEqual([
			"Unknown country 'Narnia'",
			"Can't read the date '2019-13'. Use a year and month like 2025-03",
			"Days must be a whole number of 1 or more (got '2.5')",
			"Unknown traveler 'Bob'. Add them to the travelers list in your config"
		]);
	});

	test.each([
		[{}, ["Country is missing", "Date is missing", "No travelers listed"]],
		[{ country: "PT", date: "2025-03", travelers: "Bob, Kim" }, ["Unknown travelers 'Bob', 'Kim'. Add them to the travelers list in your config"]],
		[{ country: "PT", date: "2025-03", travelers: "Alex", days: 0 }, ["Days must be a whole number of 1 or more (got '0')"]],
		[{ country: "PT", date: "2025-03", travelers: "Alex", lat: 10 }, ["Give both latitude and longitude, or neither"]],
		[{ country: "PT", date: "2025-03", travelers: "Alex", lat: 95, lon: 10 }, ["Latitude must be between -90 and 90 (got '95')"]],
		[{ country: "PT", date: "2025-03", travelers: "Alex", lat: 10, lon: 200 }, ["Longitude must be between -180 and 180 (got '200')"]],
		[{ country: "PT", date: "2025-03", travelers: "Alex", lat: "abc", lon: 1 }, ["Latitude must be between -90 and 90 (got 'abc')"]],
		[{ city: "Lisbn", country: "PT", date: "2025-03", travelers: "Alex" }, ["Unknown city 'Lisbn' in Portugal. Did you mean Lisbon?"]],
		[{ city: "Qqqqqq", country: "PT", date: "2025-03", travelers: "Alex" }, ["Unknown city 'Qqqqqq' in Portugal. Check the spelling or add its latitude and longitude"]]
	])("rejects %p", (row, errors) => {
		const r = validateTrip(row, c);
		expect(r.ok).toBe(false);
		expect(r.errors).toEqual(errors);
	});

	test("handles a missing row", () => {
		expect(validateTrip(null, c).ok).toBe(false);
	});
});

describe("validateTrips", () => {
	const c = ctx();

	test("keeps good rows, reports bad ones with row numbers, never throws", () => {
		const { trips, problems } = validateTrips(
			[
				{ city: "Lisbon", country: "PT", date: "2025-03", travelers: "Alex" },
				{ city: "Lisbn", country: "PT", date: "2025-03", travelers: "Alex" },
				{ city: "Porto", country: "PT", date: "2025-03", travelers: "Alex" }
			],
			c,
			{ source: "sheet", firstRowNumber: 2 }
		);
		expect(trips.map((t) => t.city)).toEqual(["Lisbon", "Porto"]);
		expect(problems).toEqual([{ source: "sheet", row: 3, errors: [expect.stringContaining("Unknown city 'Lisbn'")] }]);
	});

	test("identical rows get different, stable ids", () => {
		const row = { city: "Lisbon", country: "PT", date: "2025-03", travelers: "Alex" };
		const a = validateTrips([row, row], c).trips;
		const b = validateTrips([row, row], c).trips;
		expect(a[0].id).not.toBe(a[1].id);
		expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id));
	});

	test("default source label and row numbers", () => {
		const { problems } = validateTrips([{}], c);
		expect(problems[0]).toMatchObject({ source: "data", row: 1 });
	});
});
