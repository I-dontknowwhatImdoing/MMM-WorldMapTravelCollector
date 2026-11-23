"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sheetCsvUrl, createSheetSource } = require("../lib/sheet");
const { createTripService } = require("../lib/service");
const { loadGeoData } = require("../lib/geodata");
const { NOW } = require("./helpers");

const CSV = "city,country,date,travelers\nLisbon,PT,2025-03,Alex\nRome,IT,2022-09,Sam\n";

/** A stand-in for fetch that answers from a list of canned responses. */
function fakeFetch (...answers) {
	const calls = [];
	const fn = async (url, opts) => {
		calls.push({ url, opts });
		const a = answers.length > 1 ? answers.shift() : answers[0];
		if (a instanceof Error) throw a;
		return {
			ok: (a.status || 200) < 400,
			status: a.status || 200,
			headers: { get: (h) => (h.toLowerCase() === "content-type" ? a.type || "text/csv" : null) },
			text: async () => a.body ?? ""
		};
	};
	fn.calls = calls;
	return fn;
}

describe("sheet links", () => {
	test("publish-to-web links become CSV links", () => {
		expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml")).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?single=true&output=csv");
		expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=42&single=true&output=csv")).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=42&single=true&output=csv");
		expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml#gid=7")).toContain("gid=7");
	});

	test("normal edit links use the export link", () => {
		expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/1AbC/edit#gid=123")).toBe("https://docs.google.com/spreadsheets/d/1AbC/export?format=csv&gid=123");
		expect(sheetCsvUrl(" https://docs.google.com/spreadsheets/d/1AbC/edit?usp=sharing ")).toBe("https://docs.google.com/spreadsheets/d/1AbC/export?format=csv");
		expect(sheetCsvUrl("https://docs.google.com/spreadsheets/u/0/")).toBe("https://docs.google.com/spreadsheets/u/0/");
	});

	test("other links are used as they are; non-links are refused", () => {
		expect(sheetCsvUrl("https://example.com/trips.csv")).toBe("https://example.com/trips.csv");
		expect(sheetCsvUrl("")).toBeNull();
		expect(sheetCsvUrl(null)).toBeNull();
		expect(sheetCsvUrl("not a url")).toBeNull();
		expect(sheetCsvUrl("file:///etc/passwd")).toBeNull();
	});
});

describe("sheet source", () => {
	let dir;
	let cacheFile;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "wmtc-sheet-"));
		cacheFile = path.join(dir, "sheet-cache.csv");
	});
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	test("downloads, notices changes, and keeps an offline copy", async () => {
		const fetch = fakeFetch({ body: CSV }, { body: CSV }, { body: CSV + "Paris,FR,2022-05,Alex\n" });
		const s = createSheetSource({ url: "https://example.com/t.csv", cacheFile, fetch, clock: () => NOW });
		expect(s.text).toBeNull();
		expect(await s.refresh()).toBe(true);
		expect(s.text).toBe(CSV);
		expect(s.status).toMatchObject({ ok: true, error: null, checkedAt: NOW.toISOString(), changedAt: NOW.toISOString() });
		expect(fs.readFileSync(cacheFile, "utf8")).toBe(CSV);
		expect(await s.refresh()).toBe(false);
		expect(await s.refresh()).toBe(true);
		expect(fetch.calls[0].opts.signal).toBeDefined();

		// After a reboot without internet, the offline copy is used.
		const offline = createSheetSource({ url: "https://example.com/t.csv", cacheFile, fetch: fakeFetch(new TypeError("fetch failed")) });
		expect(offline.text).toContain("Paris");
		expect(await offline.refresh()).toBe(false);
		expect(offline.status).toMatchObject({ ok: false, error: "fetch failed" });
		expect(offline.text).toContain("Paris");
	});

	test("explains the common mistakes", async () => {
		const check = async (answer) => {
			const s = createSheetSource({ url: "https://example.com/t.csv", cacheFile, fetch: fakeFetch(answer) });
			await s.refresh();
			return s.status.error;
		};
		expect(await check({ status: 404 })).toMatch("wasn't found");
		expect(await check({ status: 403 })).toMatch("Publish to web");
		expect(await check({ status: 401 })).toMatch("isn't shared");
		expect(await check({ status: 500 })).toBe("Google answered with error 500");
		expect(await check({ body: "<html>sign in</html>", type: "text/html; charset=utf-8" })).toMatch("gave a web page");
		expect(await check({ body: "<!DOCTYPE html><html>", type: "" })).toMatch("gave a web page");
		expect(await check(Object.assign(new Error("slow"), { name: "TimeoutError" }))).toBe("The sheet took too long to download");
	});

	test("a bad link never downloads; a read-only disk only loses the offline copy", async () => {
		const fetch = fakeFetch({ body: CSV });
		const bad = createSheetSource({ url: "nope", cacheFile, fetch });
		expect(await bad.refresh()).toBe(false);
		expect(bad.status.error).toBe("The sheet link isn't a web address");
		expect(fetch.calls).toHaveLength(0);

		const noDisk = createSheetSource({ url: "https://example.com/t.csv", cacheFile: path.join(dir, "missing", "deeper", "cache.csv"), fetch: fakeFetch({ body: CSV }) });
		expect(await noDisk.refresh()).toBe(true);
		expect(noDisk.text).toBe(CSV);

		fs.mkdirSync(path.join(dir, "adir.csv"));
		expect(createSheetSource({ url: "https://example.com/t.csv", cacheFile: path.join(dir, "adir.csv"), fetch }).text).toBeNull();
	});
});

describe("service with a Google Sheet", () => {
	let dir;
	const geo = loadGeoData();
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "wmtc-svc-sheet-"));
		fs.writeFileSync(path.join(dir, "trips.json"), JSON.stringify([{ city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Sam"] }]));
	});
	afterEach(() => {
		jest.useRealTimers();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("sheet trips merge with the file's; each source is listed for the editor", async () => {
		const service = createTripService({ dataDir: dir, config: { travelers: ["Alex", "Sam"], sheetUrl: "https://example.com/t.csv" }, geo, clock: () => NOW, fetch: fakeFetch({ body: CSV + "Lisbn,PT,2025-03,Alex\n" }) });
		expect(service.sheetStatus).toMatchObject({ ok: false, error: null });
		expect(service.load().views[0].tripIds).toHaveLength(1);
		await service.refreshSheet();
		const model = service.load();
		// Lisbon from the file (Sam) and from the sheet (Alex) became one together trip.
		expect(model.views.find((v) => v.id === "together").tripIds).toHaveLength(1);
		expect(model.views[0].tripIds).toHaveLength(2);
		expect(model.problems).toEqual([{ source: "Google Sheet", row: 4, errors: [expect.stringContaining("Unknown city 'Lisbn'")] }]);
		const each = service.readEachSource();
		expect(each.map((s) => [s.name, s.editable, s.trips.length])).toEqual([["trips.json", true, 1], ["Google Sheet", false, 2]]);
		service.stop();
	});

	test("a failing sheet shows its error; a sheet with the wrong columns is reported", async () => {
		const service = createTripService({ dataDir: dir, config: { travelers: ["Alex", "Sam"], sheetUrl: "https://example.com/t.csv" }, geo, fetch: fakeFetch({ status: 403 }) });
		await service.refreshSheet();
		expect(service.load().problems).toEqual([{ source: "Google Sheet", row: 0, errors: [expect.stringContaining("isn't shared")] }]);

		const wrong = createTripService({ dataDir: dir, config: { travelers: ["Alex", "Sam"], sheetUrl: "https://example.com/t.csv" }, geo, fetch: fakeFetch({ body: "name,age\nx,1\n" }) });
		await wrong.refreshSheet();
		expect(wrong.load().problems[0].errors[0]).toBe("Google Sheet has no column for: country, date, travelers");

		const none = createTripService({ dataDir: dir, config: { travelers: ["Alex"] }, geo });
		await none.refreshSheet();
		expect(none.sheetStatus).toBeNull();
	});

	test("watching checks the sheet on a timer and redraws the mirror when it changes", async () => {
		jest.useFakeTimers();
		const onChange = jest.fn();
		const fetch = fakeFetch({ body: CSV }, { body: CSV }, { status: 500 });
		const service = createTripService({ dataDir: dir, config: { travelers: ["Alex", "Sam"], sheetUrl: "https://example.com/t.csv", sheetRefreshMinutes: 10 }, geo, fetch, onChange });
		service.watch();
		await jest.advanceTimersByTimeAsync(10);
		expect(fetch.calls).toHaveLength(1);
		expect(onChange).toHaveBeenCalledTimes(1);
		await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
		expect(fetch.calls).toHaveLength(2);
		expect(onChange).toHaveBeenCalledTimes(1); // unchanged
		await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
		expect(onChange).toHaveBeenCalledTimes(2); // now failing: the mirror shows the error
		expect(onChange.mock.calls[1][0].problems[0].errors[0]).toBe("Google answered with error 500");
		service.stop();
		await jest.advanceTimersByTimeAsync(30 * 60 * 1000);
		expect(fetch.calls).toHaveLength(3);
	});
});
