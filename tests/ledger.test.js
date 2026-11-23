"use strict";

const L = require("../lib/ledger");

describe("formatMonth", () => {
	test.each([
		["2025-03", undefined, "Mar 2025"],
		["2025-03", "MMM YYYY", "Mar 2025"],
		["2025-03", "MMMM YYYY", "March 2025"],
		["2025-03", "MM/YYYY", "03/2025"],
		["2025-03", "M/YY", "3/25"],
		["2025-12", "YYYY-MM", "2025-12"],
		["2025-09", "MMM 'YY", "Sep '25"]
	])("%s with %p -> %s", (value, pattern, expected) => {
		expect(L.formatMonth(value, pattern, "en")).toBe(expected);
	});

	test("other languages", () => {
		expect(L.formatMonth("2025-03", "MMMM YYYY", "de")).toBe("März 2025");
		expect(L.formatMonth("2025-05", "MMM YYYY", "fr")).toMatch(/^mai 2025$/);
	});

	test("bad locale falls back to English, bad dates pass through", () => {
		expect(L.formatMonth("2025-03", "MMM YYYY", "not a locale!!")).toBe("Mar 2025");
		expect(L.formatMonth("2025-03", "MMMM", "not a locale!!")).toBe("March");
		expect(L.formatMonth("soon")).toBe("soon");
		expect(L.formatMonth(null)).toBe("");
	});

	test("month names are cached", () => {
		expect(L.monthNames("en", "short")).toBe(L.monthNames("en", "short"));
	});
});

describe("sortTrips", () => {
	const trips = [
		{ city: "Rome", countryName: "Italy", date: "2022-09" },
		{ city: "", countryName: "Iceland", date: "2023-08" },
		{ city: "Athens", countryName: "Greece", date: "2022-09" },
		{ city: "Rome", countryName: "Italy", date: "2024-01" }
	];

	test("newest, oldest, alphabetical", () => {
		expect(L.sortTrips(trips).map((t) => t.city || t.countryName)).toEqual(["Rome", "Iceland", "Athens", "Rome"]);
		expect(L.sortTrips(trips, "oldest").map((t) => `${t.city || t.countryName} ${t.date}`)).toEqual(["Athens 2022-09", "Rome 2022-09", "Iceland 2023-08", "Rome 2024-01"]);
		expect(L.sortTrips(trips, "alpha").map((t) => `${t.city || t.countryName} ${t.date}`)).toEqual(["Athens 2022-09", "Iceland 2023-08", "Rome 2024-01", "Rome 2022-09"]);
	});

	test("does not modify the input; uses the country code when no name", () => {
		const input = [{ country: "PT", date: "2020-01" }, { country: "ES", date: "2020-01" }];
		expect(L.sortTrips(input, "alpha")[0].country).toBe("ES");
		expect(input[0].country).toBe("PT");
	});
});

describe("cellText", () => {
	const lisbon = { city: "Lisbon", countryName: "Portugal", date: "2025-03", days: 5 };

	test("place with or without country, optional days", () => {
		expect(L.cellText(lisbon)).toEqual({ place: "Lisbon, Portugal", date: "Mar 2025", days: "" });
		expect(L.cellText(lisbon, { showCountry: false, showDays: true, dateFormat: "MM/YYYY" })).toEqual({ place: "Lisbon", date: "03/2025", days: "5d" });
		expect(L.cellText({ city: "", countryName: "Iceland", date: "2023-08" }, { showCountry: false }).place).toBe("Iceland");
		expect(L.cellText({ ...lisbon, days: null }, { showDays: true }).days).toBe("");
	});
});

describe("initials", () => {
	test("first letters, two letters when they clash", () => {
		expect(L.initials(["Alex", "Sam"])).toEqual({ Alex: "A", Sam: "S" });
		expect(L.initials(["Alex", "Ana", "sam"])).toEqual({ Alex: "Al", Ana: "An", sam: "S" });
	});
});

describe("paginate", () => {
	test("splits into rows x columns pages", () => {
		const items = Array.from({ length: 45 }, (_, i) => i);
		const pages = L.paginate(items, 5, 4);
		expect(pages.map((p) => p.length)).toEqual([20, 20, 5]);
		expect(pages[1][0]).toBe(20);
		expect(L.paginate([], 5, 4)).toEqual([[]]);
		expect(L.paginate([1, 2], 0, 0)).toEqual([[1], [2]]);
	});
});

describe("shrinkPlan", () => {
	test("fits without shrinking", () => {
		expect(L.shrinkPlan({ count: 12, rows: 5, columns: 4, fontSize: 20, minFontSize: 10 })).toEqual({ rows: 5, fontSize: 20, shown: 12, more: 0 });
	});

	test("adds rows and shrinks text to fit everything", () => {
		expect(L.shrinkPlan({ count: 30, rows: 5, columns: 4, fontSize: 20, minFontSize: 10 })).toEqual({ rows: 8, fontSize: 12.5, shown: 30, more: 0 });
	});

	test("stops at the minimum size and shows +N more", () => {
		expect(L.shrinkPlan({ count: 100, rows: 5, columns: 4, fontSize: 20, minFontSize: 10 })).toEqual({ rows: 10, fontSize: 10, shown: 39, more: 61 });
	});

	test("odd inputs", () => {
		expect(L.shrinkPlan({ count: 3, rows: 0, columns: 0, fontSize: 12 })).toEqual({ rows: 3, fontSize: 4, shown: 3, more: 0 });
		// A minimum above the base size can't make text bigger
		expect(L.shrinkPlan({ count: 30, rows: 5, columns: 4, fontSize: 10, minFontSize: 20 })).toEqual({ rows: 5, fontSize: 10, shown: 19, more: 11 });
	});
});

describe("statParts", () => {
	const stats = { countries: 15, cities: 1, continents: 6, worldPercent: 8, tripsThisYear: 1, year: 2026, distance: 262800, units: "km" };

	test("all stats, in order, with plurals", () => {
		expect(L.statParts(stats, undefined, "en")).toEqual([
			{ key: "countries", value: "15", label: "countries" },
			{ key: "cities", value: "1", label: "city" },
			{ key: "continents", value: "6/7", label: "continents" },
			{ key: "worldPercent", value: "8%", label: "of the world" },
			{ key: "tripsThisYear", value: "1", label: "trip in 2026" },
			{ key: "distance", value: "262,800", label: "km traveled" }
		]);
	});

	test("picks and orders stats; skips distance without home; ignores unknown keys", () => {
		expect(L.statParts({ ...stats, countries: 1, distance: null }, ["distance", "countries", "bogus"]).map((p) => `${p.value} ${p.label}`)).toEqual(["1 country"]);
		expect(L.statParts(null)).toEqual([]);
	});

	test("number formatting follows the locale, with a fallback", () => {
		expect(L.statParts(stats, ["distance"], "de")[0].value).toBe("262.800");
		expect(L.statParts(stats, ["distance"], "not a locale!!")[0].value).toBe("262800");
	});
});
