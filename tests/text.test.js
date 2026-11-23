"use strict";

const { normalizeName, editDistance } = require("../lib/text");

describe("normalizeName", () => {
	test.each([
		["São Paulo", "sao paulo"],
		["  REYKJAVÍK ", "reykjavik"],
		["Zürich", "zurich"],
		["Düsseldorf", "dusseldorf"],
		["Straße", "strasse"],
		["Kraków", "krakow"],
		["Łódź", "lodz"],
		["Tromsø", "tromso"],
		["Ærøskøbing", "aeroskobing"],
		["Đà Nẵng", "da nang"],
		["St. John's", "saint johns"],
		["Ste-Foy", "sainte foy"],
		["Ho-Chi-Minh", "ho chi minh"],
		["Washington, D.C.", "washington d c"]
	])("%s -> %s", (input, expected) => {
		expect(normalizeName(input)).toBe(expected);
	});

	test("empty values", () => {
		expect(normalizeName(null)).toBe("");
		expect(normalizeName(undefined)).toBe("");
		expect(normalizeName("")).toBe("");
		expect(normalizeName(42)).toBe("42");
	});
});

describe("editDistance", () => {
	test("basic distances", () => {
		expect(editDistance("lisbon", "lisbon")).toBe(0);
		expect(editDistance("lisbn", "lisbon")).toBe(1);
		expect(editDistance("kitten", "sitting")).toBe(3);
		expect(editDistance("", "abc")).toBe(3);
	});

	test("stops early past the cap", () => {
		expect(editDistance("abcdef", "uvwxyz", 2)).toBe(3);
		expect(editDistance("a", "abcdefgh", 2)).toBe(3);
	});
});
