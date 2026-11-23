"use strict";

const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const path = require("node:path");
const { createEditorHandler, travelerList } = require("../lib/editor-server");
const { createTripService } = require("../lib/service");
const { packFiles } = require("../lib/importers");
const { loadGeoData } = require("../lib/geodata");

const geo = loadGeoData();
const PREFIX = "/MMM-WorldMapTravelCollector";
const FIX = path.join(__dirname, "fixtures");
const NOW = new Date(2026, 10, 23, 12);

let dir;
let server;
let base;
let ctx;
let saves;

/** Start a server shaped like MagicMirror's: Express-style mount at PREFIX. */
async function start (opts = {}) {
	const handler = createEditorHandler({ getContext: () => ctx, clock: () => NOW, onSaved: () => saves++, logger: { warn: jest.fn() }, ...opts });
	server = http.createServer((req, res) => {
		if (!req.url.startsWith(PREFIX)) {
			res.writeHead(404);
			return res.end();
		}
		req.originalUrl = req.url;
		req.url = req.url.slice(PREFIX.length) || "/";
		if (opts.preparse) opts.preparse(req);
		handler(req, res);
	});
	await new Promise((r) => server.listen(0, "127.0.0.1", r));
	base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
}

async function call (method, route, body, headers = {}) {
	const opts = { method, headers: { "X-WMTC": "1", ...headers }, redirect: "manual" };
	if (body !== undefined) {
		if (Buffer.isBuffer(body)) {
			opts.body = body;
			opts.headers["Content-Type"] = "application/octet-stream";
		} else {
			opts.body = typeof body === "string" ? body : JSON.stringify(body);
			opts.headers["Content-Type"] = "application/json";
		}
	}
	const res = await fetch(base + route, opts);
	const type = res.headers.get("content-type") || "";
	return { status: res.status, headers: res.headers, body: type.includes("json") ? await res.json() : await res.text() };
}

beforeEach(async () => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "wmtc-editor-"));
	saves = 0;
	const config = { travelers: [{ name: "Alex", color: "#4FC3F7" }, "Sam"], home: { city: "Boston", country: "US" } };
	ctx = { config, dataDir: dir, geo, service: createTripService({ dataDir: dir, config, geo, clock: () => NOW }) };
	await start();
});
afterEach(async () => {
	await new Promise((r) => server.close(r));
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("the page", () => {
	test("serves the editor files with safe headers, and adds the trailing slash", async () => {
		const page = await call("GET", "/");
		expect(page.status).toBe(200);
		expect(page.body).toContain("<title>Trip editor</title>");
		expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
		expect((await call("GET", "/editor.js")).headers.get("content-type")).toContain("javascript");
		expect((await call("GET", "/editor.css")).headers.get("content-type")).toContain("css");
		expect((await call("GET", "/icon.svg")).headers.get("content-type")).toContain("svg");
		const bare = await fetch(base, { redirect: "manual" });
		expect(bare.status).toBe(301);
		expect(bare.headers.get("location")).toBe(`${PREFIX}/`);
		expect((await call("GET", "/../node_helper.js")).status).toBe(404);
		expect((await call("GET", "/secret.txt")).status).toBe(404);
		expect((await call("POST", "/")).status).toBe(404);
	});
});

describe("API", () => {
	test("state lists travelers, countries, trips and the other sources", async () => {
		fs.writeFileSync(path.join(dir, "trips.json"), JSON.stringify([{ id: "t_a", city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] }, { city: "Atlantis", country: "XX" }]));
		fs.writeFileSync(path.join(dir, "trips.csv"), "city,country,date,travelers\nRome,IT,2022-09,Sam\n");
		const { status, body } = await call("GET", "/api/state");
		expect(status).toBe(200);
		expect(body.travelers).toEqual([{ name: "Alex", color: "#4FC3F7" }, { name: "Sam" }]);
		expect(body.countries.find((c) => c[0] === "PT")).toEqual(["PT", "Portugal"]);
		expect(body.trips.map((t) => t.id)).toEqual(["t_a"]);
		expect(body.broken).toHaveLength(1);
		expect(body.readOnly).toEqual([{ source: "trips.csv", trips: [expect.objectContaining({ city: "Rome" })], problems: [] }]);
		expect(body).toMatchObject({ sheet: null, pinRequired: false, home: { city: "Boston" }, homeRadiusKm: 50, currentMonth: "2026-11", togetherColor: "#FFD54F" });
	});

	test("city autocomplete, inside a country or anywhere", async () => {
		const pt = (await call("GET", "/api/cities?q=lis&country=Portugal")).body;
		expect(pt[0]).toMatchObject({ name: "Lisbon", country: "PT", countryName: "Portugal" });
		expect(pt.every((c) => c.country === "PT")).toBe(true);
		expect((await call("GET", "/api/cities?q=kyo")).body[0].name).toBe("Kyoto");
		expect((await call("GET", "/api/cities?q=k")).body).toEqual([]);
		expect((await call("GET", "/api/cities")).body).toEqual([]);
	});

	test("add, edit and delete trips", async () => {
		const bad = await call("POST", "/api/trips", { city: "Lisbn", country: "PT", date: "2025-03", travelers: ["Alex"] });
		expect(bad).toMatchObject({ status: 422, body: { errors: ["Unknown city 'Lisbn' in Portugal. Did you mean Lisbon?"] } });
		const added = await call("POST", "/api/trips", { city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] });
		expect(added.status).toBe(200);
		const id = added.body.trip.id;
		const combined = await call("POST", "/api/trips", { city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Sam"] });
		expect(combined.body).toMatchObject({ combined: true, trip: { id, travelers: ["Alex", "Sam"] } });

		const edited = await call("PUT", `/api/trips/${id}`, { city: "Porto", country: "PT", date: "2025-03", travelers: ["Sam"] });
		expect(edited.body.trip).toMatchObject({ id, city: "Porto" });
		expect((await call("PUT", `/api/trips/${id}`, { country: "PT" })).status).toBe(422);
		expect((await call("PUT", "/api/trips/t_nope", { city: "Rome", country: "IT", date: "2022-09", travelers: ["Alex"] })).status).toBe(404);

		expect((await call("DELETE", `/api/trips/${id}`)).body).toEqual({ deleted: id });
		expect((await call("DELETE", `/api/trips/${id}`)).status).toBe(404);
		expect(saves).toBe(4);
	});

	test("bad requests", async () => {
		expect((await call("POST", "/api/trips", "{not json")).body).toEqual({ error: "The request wasn't valid JSON" });
		expect((await call("POST", "/api/trips", "")).status).toBe(422);
		expect((await call("GET", "/api/whatever")).status).toBe(404);
		expect((await call("PATCH", "/api/trips/x")).status).toBe(404);
		expect((await call("POST", "/api/import/check", {})).body).toEqual({ error: "No rows were sent" });
	});

	test("changes need the editor header, so other web pages can't make them", async () => {
		const res = await fetch(`${base}/api/trips`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" });
		expect(res.status).toBe(403);
		expect((await fetch(`${base}/api/state`)).status).toBe(200);
	});

	test("import: parse an upload, check rows, save them", async () => {
		const upload = packFiles([{ name: "timeline-phone.json", data: fs.readFileSync(path.join(FIX, "timeline-phone.json")) }]);
		const parsed = await call("POST", "/api/import/parse?homeRadiusKm=50", upload);
		expect(parsed.status).toBe(200);
		expect(parsed.body).toMatchObject({ kind: "timeline", home: { name: "Boston", guessed: false }, ignoredAtHome: 2 });
		expect(parsed.body.drafts.map((d) => d.city)).toEqual(["Frankfurt am Main", "Lisbon", "Sintra", "Kyoto"]);

		const radius = await call("POST", "/api/import/parse?homeRadiusKm=", upload);
		expect(radius.body.ignoredAtHome).toBe(2);

		const rows = parsed.body.drafts.filter((d) => d.include).map((d) => ({ ...d, travelers: ["Alex"] }));
		rows.push({ city: "", country: "", date: "", travelers: [] });
		const checked = await call("POST", "/api/import/check", { rows });
		expect(checked.body.results.map((r) => r.ok)).toEqual([true, true, true, false]);
		const saved = await call("POST", "/api/import/save", { rows });
		expect(saved.body).toMatchObject({ added: 3, combined: 0, total: 3 });
		expect(saved.body.rejected).toHaveLength(1);
		expect(saves).toBe(1);
		const again = await call("POST", "/api/import/save", { rows: [{ country: "Atlantis" }] });
		expect(again.body.added).toBe(0);
		expect(saves).toBe(1);
	});

	test("import: CSV column mapping and choosing between kinds", async () => {
		const upload = packFiles([{ name: "mine.csv", data: Buffer.from("Place,Nation,When,Who\nLisboa,PT,2025-03,Alex\n") }]);
		const mapped = await call("POST", `/api/import/parse?mapping=${encodeURIComponent(JSON.stringify({ Who: "note" }))}`, upload);
		expect(mapped.body.csv.mapping.Who).toBe("note");
		expect(mapped.body.drafts[0].note).toBe("Alex");
		const badMapping = await call("POST", "/api/import/parse?mapping=%7Bnope", upload);
		expect(badMapping.body.csv.mapping.Who).toBe("travelers");
		const want = await call("POST", "/api/import/parse?want=places", packFiles([
			{ name: "a.json", data: fs.readFileSync(path.join(FIX, "2019_NOVEMBER.json")) },
			{ name: "mymap.kml", data: fs.readFileSync(path.join(FIX, "mymap.kml")) }
		]));
		expect(want.body).toMatchObject({ kind: "places", alsoFound: ["timeline"] });
	});

	test("import: empty, broken and oversized uploads", async () => {
		expect((await call("POST", "/api/import/parse", Buffer.alloc(0))).body.error).toBe("No file was received");
		expect((await call("POST", "/api/import/parse", Buffer.from([1, 2]))).body.error).toBe("Upload was cut off");
		expect((await call("POST", "/api/import/parse", packFiles([{ name: "x.json", data: Buffer.from("{\"a\":1}") }]))).status).toBe(422);

		await new Promise((r) => server.close(r));
		await start({ uploadLimit: 1000 });
		const big = await call("POST", "/api/import/parse", packFiles([{ name: "x.csv", data: Buffer.alloc(5000, 97) }]));
		expect(big.status).toBe(413);
		expect(big.body.error).toMatch("too big");
	});

	test("an upload without a declared size is still capped", async () => {
		await new Promise((r) => server.close(r));
		await start({ uploadLimit: 1000 });
		const status = await new Promise((resolve) => {
			const req = http.request(`${base}/api/import/parse`, { method: "POST", headers: { "X-WMTC": "1", "Transfer-Encoding": "chunked" } }, (res) => {
				res.resume();
				resolve(res.statusCode);
			});
			req.on("error", () => resolve("closed"));
			req.write(Buffer.alloc(800));
			req.write(Buffer.alloc(800));
			req.end();
		});
		expect([413, "closed"]).toContain(status);
	});

	test("backups: list and restore", async () => {
		await call("POST", "/api/trips", { city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] });
		await call("POST", "/api/trips", { city: "Rome", country: "IT", date: "2022-09", travelers: ["Alex"] });
		const list = (await call("GET", "/api/backups")).body.backups;
		expect(list).toHaveLength(1);
		const restored = await call("POST", "/api/backups/restore", { name: list[0].name });
		expect(restored.body).toEqual({ restored: list[0].name, trips: 1, unreadable: 0 });
		expect((await call("POST", "/api/backups/restore", { name: "../../etc/passwd" })).status).toBe(404);
		expect((await call("POST", "/api/backups/restore", {})).status).toBe(404);
	});

	test("download everything as CSV, including the other sources", async () => {
		await call("POST", "/api/trips", { city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] });
		fs.writeFileSync(path.join(dir, "trips.csv"), "city,country,date,travelers\nRome,IT,2022-09,Sam\nLisbon,PT,2025-03,Sam\n");
		const res = await call("GET", "/api/export.csv");
		expect(res.headers.get("content-disposition")).toBe("attachment; filename=\"trips-2026-11-23.csv\"");
		const lines = res.body.trim().split("\n");
		expect(lines[0]).toBe("id,city,country,date,start,days,travelers,lat,lon,note");
		expect(lines.slice(1).map((l) => l.split(",").slice(1, 4).join(","))).toEqual(["Lisbon,Portugal,2025-03", "Rome,Italy,2022-09"]);
		expect(lines[1]).toContain("Alex; Sam");
	});

	test("Google Sheet status and refresh", async () => {
		expect((await call("POST", "/api/sheet/refresh")).status).toBe(404);
		const fetchSheet = async () => ({ ok: true, status: 200, headers: { get: () => "text/csv" }, text: async () => "city,country,date,travelers\nRome,IT,2022-09,Sam\n" });
		ctx.config = { ...ctx.config, sheetUrl: "https://example.com/t.csv" };
		ctx.service = createTripService({ dataDir: dir, config: ctx.config, geo, fetch: fetchSheet });
		const r = await call("POST", "/api/sheet/refresh");
		expect(r.body.sheet).toMatchObject({ ok: true, error: null });
		const state = (await call("GET", "/api/state")).body;
		expect(state.readOnly).toEqual([expect.objectContaining({ source: "Google Sheet" })]);
		expect(state.sheet.ok).toBe(true);
	});

	test("works without a trip service (only the file)", async () => {
		delete ctx.service;
		ctx.config = { ...ctx.config, home: { lat: 1, lon: 2 } };
		const state = (await call("GET", "/api/state")).body;
		expect(state).toMatchObject({ readOnly: [], sheet: null, home: { city: "" } });
		expect((await call("POST", "/api/trips", { city: "Rome", country: "IT", date: "2022-09", travelers: ["Sam"] })).status).toBe(200);
		expect((await call("GET", "/api/export.csv")).body).toContain("Rome");
		ctx.config = { ...ctx.config, home: null, homeRadiusKm: 10 };
		expect((await call("GET", "/api/state")).body).toMatchObject({ home: null, homeRadiusKm: 10 });
	});
});

describe("access", () => {
	test("before the mirror starts, and with the editor turned off", async () => {
		const saved = ctx;
		ctx = null;
		expect(await call("GET", "/api/state")).toMatchObject({ status: 503, body: { error: expect.stringContaining("hasn't started") } });
		expect((await call("GET", "/")).status).toBe(200);
		ctx = { ...saved, config: { ...saved.config, editor: false } };
		expect((await call("GET", "/api/state")).status).toBe(403);
	});

	test("PIN: required, wrong, right, and a lockout after five wrong tries", async () => {
		ctx.config = { ...ctx.config, editorPin: 4321 };
		expect(await call("GET", "/api/state")).toMatchObject({ status: 401, body: { error: "Enter the editor PIN", pinRequired: true } });
		expect((await call("GET", "/api/state", undefined, { "X-WMTC-Pin": "" })).status).toBe(401);
		expect((await call("GET", "/api/state", undefined, { "X-WMTC-Pin": "4321" })).body.pinRequired).toBe(true);
		for (let i = 0; i < 4; i++) {
			const wrong = await call("GET", "/api/state", undefined, { "X-WMTC-Pin": "0000" });
			expect(wrong.body).toMatchObject({ error: "Wrong PIN", triesLeft: 4 - i });
		}
		const fifth = await call("GET", "/api/state", undefined, { "X-WMTC-Pin": "00000" });
		expect(fifth).toMatchObject({ status: 429, body: { pinRequired: true, retryAfter: 60 } });
		const locked = await call("GET", "/api/state", undefined, { "X-WMTC-Pin": "4321" });
		expect(locked.status).toBe(429);
		expect(locked.body.error).toMatch(/Try again in \d+ seconds/);
		expect(locked.body.retryAfter).toBeGreaterThan(0);
	});

	test("unexpected errors are reported, not crashes", async () => {
		const warn = jest.fn();
		await new Promise((r) => server.close(r));
		await start({ logger: { warn } });
		ctx.service = { readEachSource: () => { throw new Error("disk on fire"); } };
		const res = await call("GET", "/api/state");
		expect(res).toMatchObject({ status: 500, body: { error: "Something went wrong: disk on fire" } });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("disk on fire"));

		await new Promise((r) => server.close(r));
		await start({ editorDir: path.join(dir, "missing") });
		const page = await call("GET", "/");
		expect(page.status).toBe(500);
	});

	test("JSON bodies already parsed by Express are used as they are", async () => {
		await new Promise((r) => server.close(r));
		await start({
			preparse: (req) => {
				if (req.headers["content-type"] === "application/json") {
					req._body = true;
					req.body = { city: "Rome", country: "IT", date: "2022-09", travelers: ["Sam"] };
					req.resume();
				}
			}
		});
		const r = await call("POST", "/api/trips", { ignored: true });
		expect(r.body.trip.city).toBe("Rome");
	});

	test("traveler list from any config shape", () => {
		expect(travelerList({ travelers: ["A", { name: "B", color: "#fff" }, { color: "#000" }, null] })).toEqual([{ name: "A" }, { name: "B", color: "#fff" }]);
		expect(travelerList({})).toEqual([]);
	});
});
