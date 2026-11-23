"use strict";

const { parseCSV, rowsToRecords, toCSV } = require("../lib/csv");

const BOM = String.fromCharCode(0xfeff);

describe("parseCSV", () => {
	test("simple rows", () => {
		expect(parseCSV("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
	});

	test("quoted commas, doubled quotes and line breaks inside quotes", () => {
		const text = "city,note\nParis,\"Paris, Texas\"\nRome,\"She said \"\"ciao\"\"\"\nOslo,\"line one\nline two\"";
		expect(parseCSV(text)).toEqual([
			["city", "note"],
			["Paris", "Paris, Texas"],
			["Rome", "She said \"ciao\""],
			["Oslo", "line one\nline two"]
		]);
	});

	test("CRLF, BOM, blank lines and a missing final newline", () => {
		expect(parseCSV(BOM + "a,b\r\n\r\n1,2\r\n,\r\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
	});

	test("semicolon and tab separated files", () => {
		expect(parseCSV("city;country\nLisbon;PT")).toEqual([["city", "country"], ["Lisbon", "PT"]]);
		expect(parseCSV("city\tcountry\nLisbon\tPT")).toEqual([["city", "country"], ["Lisbon", "PT"]]);
	});

	test("empty input", () => {
		expect(parseCSV("")).toEqual([]);
		expect(parseCSV(null)).toEqual([]);
	});

	test("a quote in the middle of a field is kept as text", () => {
		expect(parseCSV("a\n5'11\"")).toEqual([["a"], ["5'11\""]]);
	});
});

describe("rowsToRecords", () => {
	test("maps common header spellings", () => {
		const rows = [
			["Town", "Country Name", "Month", "Nights", "Who", "Latitude", "Lng", "Comments", "Rating"],
			["Lisbon", "Portugal", "2025-03", "5", "Alex", "38.7", "-9.1", "Nice", "5"]
		];
		const { records, unknownHeaders, missingFields } = rowsToRecords(rows);
		expect(records).toEqual([{ city: "Lisbon", country: "Portugal", date: "2025-03", days: "5", travelers: "Alex", lat: "38.7", lon: "-9.1", note: "Nice" }]);
		expect(unknownHeaders).toEqual(["Rating"]);
		expect(missingFields).toEqual([]);
	});

	test("explicit column mapping wins", () => {
		const rows = [["Where", "Land", "When", "Crew"], ["Lisbon", "PT", "2025-03", "Alex"]];
		const { records, missingFields } = rowsToRecords(rows, { Where: "city", Land: "country", Crew: "travelers" });
		expect(records[0]).toEqual({ city: "Lisbon", country: "PT", date: "2025-03", travelers: "Alex" });
		expect(missingFields).toEqual([]);
	});

	test("reports missing required columns", () => {
		expect(rowsToRecords([["city"], ["Lisbon"]]).missingFields).toEqual(["country", "date", "travelers"]);
		expect(rowsToRecords([]).missingFields).toEqual(["city", "country", "date", "travelers"]);
	});

	test("short rows and duplicate columns", () => {
		const { records } = rowsToRecords([["city", "town", "country"], ["Lisbon"]]);
		expect(records).toEqual([{ city: "Lisbon", country: "" }]);
	});
});

describe("toCSV", () => {
	test("round-trips through parseCSV", () => {
		const trips = [
			{ id: "t_1", city: "Paris", country: "US", date: "2021-09", days: 1, travelers: ["Alex"], lat: 33.66, lon: -95.55, note: "Paris, Texas \"the other one\"" },
			{ id: "t_2", city: "", country: "IS", date: "2023-08", days: null, travelers: ["Alex", "Sam"], lat: null, lon: null, note: "" }
		];
		const rows = parseCSV(toCSV(trips));
		const { records } = rowsToRecords(rows);
		expect(records[0]).toMatchObject({ city: "Paris", note: "Paris, Texas \"the other one\"", travelers: "Alex", lat: "33.66" });
		expect(records[1]).toMatchObject({ city: "", travelers: "Alex; Sam", days: "", lat: "" });
	});

	test("missing travelers list", () => {
		expect(toCSV([{ country: "PT" }])).toContain(",PT,");
	});
});
