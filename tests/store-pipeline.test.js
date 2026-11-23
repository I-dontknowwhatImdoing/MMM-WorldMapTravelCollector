"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readTripsFile, writeTripsFile, MAX_BACKUPS } = require("../lib/store");
const { recordsFromText, importRecords } = require("../lib/pipeline");
const { run, parseArgs } = require("../scripts/import");
const { loadGeoData } = require("../lib/geodata");
const { trip } = require("./helpers");

const BOM = String.fromCharCode(0xfeff);
const EXAMPLE_CSV = path.join(__dirname, "..", "data", "trips.example.csv");

let dir;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "wmtc-"));
});
afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("store", () => {
	test("missing or empty file means no trips", () => {
		expect(readTripsFile(path.join(dir, "nope.json"))).toEqual([]);
		fs.writeFileSync(path.join(dir, "empty.json"), "  \n");
		expect(readTripsFile(path.join(dir, "empty.json"))).toEqual([]);
	});

	test("reads a bare list, a {trips} object, and files with a BOM", () => {
		fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify([trip({ id: "a" })]));
		fs.writeFileSync(path.join(dir, "b.json"), BOM + JSON.stringify({ version: 1, trips: [trip({ id: "b" })] }));
		expect(readTripsFile(path.join(dir, "a.json"))[0].id).toBe("a");
		expect(readTripsFile(path.join(dir, "b.json"))[0].id).toBe("b");
	});

	test("rejects files that aren't trip lists", () => {
		fs.writeFileSync(path.join(dir, "c.json"), "{\"hello\": 1}");
		expect(() => readTripsFile(path.join(dir, "c.json"))).toThrow("c.json should contain a list of trips");
	});

	test("writes atomically, backs up the previous version, keeps at most 10 backups", () => {
		const file = path.join(dir, "sub", "trips.json");
		writeTripsFile(file, [trip({ id: "v0" })]);
		expect(fs.existsSync(path.join(dir, "sub", "backups"))).toBe(false);
		for (let i = 1; i <= 12; i++) {
			writeTripsFile(file, [trip({ id: `v${i}` })], { now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) });
		}
		expect(readTripsFile(file)[0].id).toBe("v12");
		const backups = fs.readdirSync(path.join(dir, "sub", "backups")).sort();
		expect(backups).toHaveLength(MAX_BACKUPS);
		const newest = JSON.parse(fs.readFileSync(path.join(dir, "sub", "backups", backups[backups.length - 1]), "utf8"));
		expect(newest.trips[0].id).toBe("v11");
		expect(fs.readdirSync(path.join(dir, "sub")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
	});

	test("two saves in the same second keep both backups", () => {
		const file = path.join(dir, "trips.json");
		const now = new Date(Date.UTC(2026, 0, 1));
		writeTripsFile(file, [trip()], { now });
		writeTripsFile(file, [trip()], { now });
		writeTripsFile(file, [trip()], { now });
		expect(fs.readdirSync(path.join(dir, "backups"))).toHaveLength(2);
	});
});

describe("recordsFromText", () => {
	test("CSV by extension or content", () => {
		expect(recordsFromText("city,country\nLisbon,PT", "x.csv").records).toEqual([{ city: "Lisbon", country: "PT" }]);
		expect(recordsFromText("city,country\nLisbon,PT").records).toEqual([{ city: "Lisbon", country: "PT" }]);
	});

	test("JSON list or {trips}", () => {
		expect(recordsFromText("[{\"city\":\"Lisbon\"}]", "x.json").records).toEqual([{ city: "Lisbon" }]);
		expect(recordsFromText(BOM + "{\"trips\":[{\"city\":\"Porto\"}]}").records).toEqual([{ city: "Porto" }]);
		expect(recordsFromText("", "x.json").records).toEqual([]);
	});

	test("bad JSON shapes", () => {
		expect(() => recordsFromText("{\"x\":1}", "x.json")).toThrow("JSON should be a list of trips");
		expect(() => recordsFromText("null", "x.json")).toThrow("JSON should be a list of trips");
	});
});

describe("importRecords", () => {
	const geo = loadGeoData();
	const names = ["Alex", "Sam"];

	test("adds new trips and merges duplicates into existing ones", () => {
		const file = path.join(dir, "trips.json");
		const first = importRecords({ file, records: [{ city: "Lisbon", country: "PT", date: "2025-03", travelers: "Sam" }], travelerNames: names, geo });
		expect(first).toMatchObject({ added: 1, merged: 0, total: 1, written: true, blocked: false });
		const second = importRecords({
			file,
			records: [
				{ city: "Lisboa", country: "Portugal", date: "March 2025", travelers: "Alex" },
				{ city: "Porto", country: "PT", date: "2025-03", travelers: "Alex" },
				{ city: "Nowhere", country: "PT", date: "2025-03", travelers: "Alex" }
			],
			travelerNames: names,
			geo
		});
		expect(second).toMatchObject({ added: 1, merged: 1, total: 2, written: true });
		expect(second.rejected).toEqual([{ source: "import", row: 4, errors: [expect.stringContaining("Unknown city 'Nowhere'")] }]);
		const saved = readTripsFile(file);
		expect(saved.find((t) => t.city === "Lisbon").travelers).toEqual(["Alex", "Sam"]);
	});

	test("dry run and empty imports write nothing", () => {
		const file = path.join(dir, "trips.json");
		const r = importRecords({ file, records: [{ city: "Lisbon", country: "PT", date: "2025-03", travelers: "Sam" }], travelerNames: names, geo, dryRun: true });
		expect(r).toMatchObject({ added: 1, written: false });
		expect(fs.existsSync(file)).toBe(false);
		expect(importRecords({ file, records: [], travelerNames: names, geo }).written).toBe(false);
	});

	test("never rewrites a file with unreadable rows", () => {
		const file = path.join(dir, "trips.json");
		fs.writeFileSync(file, JSON.stringify([{ city: "Lisbon", country: "PT", date: "2025-03", travelers: "Kim" }]));
		const before = fs.readFileSync(file, "utf8");
		const r = importRecords({ file, records: [{ city: "Porto", country: "PT", date: "2025-03", travelers: "Alex" }], travelerNames: names, geo });
		expect(r).toMatchObject({ blocked: true, written: false });
		expect(r.existingProblems[0].errors[0]).toContain("Unknown traveler 'Kim'");
		expect(fs.readFileSync(file, "utf8")).toBe(before);
	});
});

describe("import command", () => {
	const lines = () => {
		const out = [];
		return { out, log: (m) => out.push(m) };
	};

	test("parseArgs", () => {
		expect(parseArgs(["a.csv", "--travelers=Alex,Sam", "--out=x.json", "--dry-run"])).toMatchObject({ file: "a.csv", travelers: "Alex,Sam", out: "x.json", dryRun: true });
		expect(parseArgs(["a.csv", "--travelers", "Alex", "--out", "y.json"])).toMatchObject({ travelers: "Alex", out: "y.json" });
		expect(parseArgs(["-h"]).help).toBe(true);
		expect(() => parseArgs(["a.csv", "b.csv"])).toThrow("Unexpected argument 'b.csv'");
	});

	test("imports the example file", () => {
		const { out, log } = lines();
		const target = path.join(dir, "trips.json");
		expect(run([EXAMPLE_CSV, "--travelers", "Alex,Sam", "--out", target], log)).toBe(0);
		expect(out.pop()).toMatch(/^Added 22 trips, merged 0 duplicates, skipped 0\. 22 trips in /);
		const trips = readTripsFile(target);
		expect(trips.every((t) => t.city === "" || (Number.isFinite(t.lat) && Number.isFinite(t.lon)))).toBe(true);
		expect(trips.find((t) => t.note === "Paris, Texas")).toMatchObject({ country: "US", lat: 33.6609 });
	});

	test("dry run, help, missing travelers", () => {
		const target = path.join(dir, "trips.json");
		let l = lines();
		expect(run([EXAMPLE_CSV, "--travelers", "Alex,Sam", "--out", target, "--dry-run"], l.log)).toBe(0);
		expect(l.out.pop()).toContain("Would add 22 trips");
		expect(fs.existsSync(target)).toBe(false);
		l = lines();
		expect(run(["--help"], l.log)).toBe(0);
		expect(run([], l.log)).toBe(1);
		expect(run([EXAMPLE_CSV], l.log)).toBe(1);
		expect(l.out.pop()).toContain("--travelers");
	});

	test("reports missing columns, ignored columns, bad rows and a blocked file", () => {
		const missing = path.join(dir, "missing.csv");
		fs.writeFileSync(missing, "city\nLisbon\n");
		let l = lines();
		expect(run([missing, "--travelers", "Alex"], l.log)).toBe(1);
		expect(l.out[0]).toContain("no column for: country, date, travelers");

		const extra = path.join(dir, "extra.csv");
		fs.writeFileSync(extra, "city,country,date,travelers,rating\nLisbon,PT,2025-03,Alex,5\nLisbn,PT,2025-03,Alex,1\n");
		const target = path.join(dir, "trips.json");
		l = lines();
		expect(run([extra, "--travelers", "Alex", "--out", target], l.log)).toBe(0);
		expect(l.out).toEqual([
			"Ignoring columns: rating",
			expect.stringContaining("Skipped extra.csv row 3: Unknown city 'Lisbn'"),
			expect.stringMatching(/^Added 1 trip, merged 0 duplicates, skipped 1\./)
		]);

		l = lines();
		expect(run([extra, "--travelers", "Sam", "--out", target], l.log)).toBe(1);
		expect(l.out.some((m) => m.includes("trips.json row 1"))).toBe(true);
		expect(l.out.pop()).toContain("Nothing saved");
	});
});
