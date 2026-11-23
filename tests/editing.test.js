"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTripBook, newId } = require("../lib/editing");
const { storedTrip } = require("../lib/schema");
const { readTripsFile } = require("../lib/store");
const { ctx, trip } = require("./helpers");

let dir;
let file;
let tick;
const clock = () => new Date(Date.UTC(2026, 10, 23, 12, 0, tick++));
const book = () => createTripBook({ file, ctx: ctx(), clock });
const raw = () => readTripsFile(file);

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "wmtc-edit-"));
	file = path.join(dir, "trips.json");
	tick = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("storedTrip", () => {
	const geo = ctx();
	test("drops looked-up coordinates and empty fields", () => {
		expect(storedTrip(trip({ id: "t_1", days: null, note: "" }), geo.geocoder)).toEqual({ id: "t_1", city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex", "Sam"] });
	});
	test("keeps coordinates someone set on purpose, and country-level ones", () => {
		expect(storedTrip(trip({ id: "t_1", city: "Paris", country: "US", lat: 33.66, lon: -95.0, days: 2, note: "x" }), geo.geocoder)).toMatchObject({ lat: 33.66, lon: -95.0, days: 2, note: "x" });
		expect(storedTrip(trip({ id: "t_1", city: "", country: "IS", lat: 64.9, lon: -18.6 }), geo.geocoder)).toMatchObject({ lat: 64.9, lon: -18.6 });
		expect(storedTrip(trip({ id: "t_1", city: "Nowhere", country: "IS", lat: 64.9, lon: -18.6 }), geo.geocoder)).toMatchObject({ lat: 64.9 });
		expect(storedTrip(trip({ id: "t_1", city: "", lat: null, lon: null }), geo.geocoder)).not.toHaveProperty("lat");
	});
});

describe("trip book", () => {
	test("starts empty, adds trips with new ids, and backs up before each change", () => {
		const b = book();
		expect(b.load()).toEqual({ trips: [], broken: [] });
		const r = b.add({ city: "Lisbn", country: "PT", date: "2025-03", travelers: ["Alex"] });
		expect(r).toEqual({ ok: false, errors: ["Unknown city 'Lisbn' in Portugal. Did you mean Lisbon?"] });
		expect(fs.existsSync(file)).toBe(false);

		const a = b.add({ id: "ignored", city: "lisbon", country: "Portugal", date: "March 2025", days: "5", travelers: ["Alex"], note: " Anniversary " });
		expect(a.ok).toBe(true);
		expect(a.combined).toBe(false);
		expect(a.trip).toMatchObject({ city: "Lisbon", country: "PT", date: "2025-03", days: 5, note: "Anniversary" });
		expect(a.trip.id).toMatch(/^t_[0-9a-f]{10}$/);
		expect(a.trip.id).not.toBe("ignored");
		expect(raw()).toEqual([{ id: a.trip.id, city: "Lisbon", country: "PT", date: "2025-03", days: 5, travelers: ["Alex"], note: "Anniversary" }]);

		b.add({ city: "Porto", country: "PT", date: "2025-03", travelers: ["Sam"] });
		expect(fs.readdirSync(path.join(dir, "backups"))).toHaveLength(1);
		expect(b.backups()).toEqual([expect.objectContaining({ trips: 1, savedAt: "2026-11-23T12:00:01.000Z" })]);
	});

	test("the same place and month combines travelers into one together trip", () => {
		const b = book();
		const first = b.add({ city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"], days: 3 });
		const second = b.add({ city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Sam"], days: 5, note: "Sam's" });
		expect(second.combined).toBe(true);
		expect(second.trip).toMatchObject({ id: first.trip.id, travelers: ["Alex", "Sam"], days: 5, note: "Sam's" });
		expect(b.load().trips).toHaveLength(1);
	});

	test("edit, move onto another trip, and delete", () => {
		const b = book();
		const lisbon = b.add({ city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] }).trip;
		const porto = b.add({ city: "Porto", country: "PT", date: "2025-03", travelers: ["Sam"] }).trip;

		const edited = b.update(lisbon.id, { city: "Lisbon", country: "PT", date: "2025-04", travelers: ["Alex", "Sam"], note: "moved" });
		expect(edited).toMatchObject({ ok: true, combined: false, trip: { id: lisbon.id, date: "2025-04", note: "moved" } });
		expect(b.update(lisbon.id, { country: "PT" }).ok).toBe(false);
		expect(b.update("t_missing", { city: "Rome", country: "IT", date: "2022-09", travelers: ["Alex"] })).toMatchObject({ ok: false, notFound: true });

		// Renaming Porto to Lisbon in April joins the existing trip.
		const joined = b.update(porto.id, { city: "Lisbon", country: "PT", date: "2025-04", travelers: ["Sam"] });
		expect(joined).toMatchObject({ ok: true, combined: true, trip: { id: lisbon.id } });
		expect(b.load().trips).toHaveLength(1);

		expect(b.remove("t_missing")).toBe(false);
		expect(b.remove(lisbon.id)).toBe(true);
		expect(raw()).toEqual([]);
	});

	test("unreadable rows are kept, listed, and can be fixed or deleted", () => {
		fs.writeFileSync(file, JSON.stringify([
			{ id: "t_good", city: "Rome", country: "IT", date: "2022-09", travelers: ["Alex"] },
			{ city: "Lisbn", country: "PT", date: "2025-03", travelers: ["Alex"] },
			"just a string",
			{ city: "Kyoto", country: "JP", date: "nope", travelers: ["Sam"] }
		]));
		const b = book();
		const { trips, broken } = b.load();
		expect(trips.map((t) => t.id)).toEqual(["t_good"]);
		expect(broken.map((x) => x.id)).toEqual(["row-2", "row-3", "row-4"]);
		expect(broken[1].raw).toEqual({ value: "just a string" });

		// Saving something else never loses the broken rows.
		b.add({ city: "Paris", country: "FR", date: "2022-05", travelers: ["Sam"] });
		expect(raw()).toHaveLength(5);
		expect(raw()[4]).toEqual({ city: "Kyoto", country: "JP", date: "nope", travelers: ["Sam"] });

		// Fixing one turns it into a normal trip.
		const lisbn = b.load().broken.find((x) => x.raw.city === "Lisbn");
		const fixed = b.update(lisbn.id, { city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] });
		expect(fixed.ok).toBe(true);
		expect(fixed.trip.id).toMatch(/^t_/);
		expect(b.load().broken.map((x) => x.raw.city || x.raw.value)).toEqual(["just a string", "Kyoto"]);
		// Row numbers follow the file, which changes after a save, so take the id from a fresh read.
		expect(b.remove(b.load().broken[0].id)).toBe(true);
		expect(b.load().broken).toHaveLength(1);
	});

	test("rows typed by hand without ids get ids that stay the same", () => {
		fs.writeFileSync(file, JSON.stringify([
			{ city: "Rome", country: "IT", date: "2022-09", travelers: ["Alex"] },
			{ city: "Rome", country: "IT", date: "2022-09", travelers: ["Alex"] },
			{ id: "dup", city: "Paris", country: "FR", date: "2022-05", travelers: ["Alex"] },
			{ id: "dup", city: "Nice", country: "FR", date: "2022-05", travelers: ["Alex"] }
		]));
		const b = book();
		const ids = b.load().trips.map((t) => t.id);
		expect(new Set(ids).size).toBe(4);
		expect(b.load().trips.map((t) => t.id)).toEqual(ids);
		expect(ids.slice(2)).toEqual(["dup", "dup_1"]);
		expect(b.remove(ids[1])).toBe(true);
		expect(newId()).not.toBe(newId());
	});

	test("checking and importing many rows", () => {
		const b = book();
		b.add({ city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] });
		const rows = [
			{ city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Sam"] },
			{ city: "Kyoto", country: "JP", date: "2024-10", travelers: ["Alex", "Sam"], days: "3" },
			{ city: "Kyoto", country: "JP", date: "", travelers: [] }
		];
		const checks = b.checkMany(rows);
		expect(checks[0]).toMatchObject({ ok: true, combinesWith: { city: "Lisbon", travelers: ["Alex"] }, adds: ["Sam"] });
		expect(checks[1]).toMatchObject({ adds: ["Alex", "Sam"] });
		expect(checks[1]).toMatchObject({ ok: true, combinesWith: null });
		expect(checks[2]).toEqual({ ok: false, errors: ["Date is missing", "No travelers listed"] });

		const r = b.importMany(rows);
		expect(r).toEqual({ added: 1, combined: 1, already: 0, rejected: [{ row: 3, errors: ["Date is missing", "No travelers listed"] }], total: 2 });
		// Importing the same trip again adds nobody: it's "already there", not "combined".
		expect(b.importMany([rows[0]])).toMatchObject({ added: 0, combined: 0, already: 1 });
		expect(b.load().trips.find((t) => t.city === "Lisbon").travelers).toEqual(["Alex", "Sam"]);

		const before = fs.statSync(file).mtimeMs;
		expect(b.importMany([{ country: "Atlantis" }])).toMatchObject({ added: 0, combined: 0, total: 2 });
		expect(fs.statSync(file).mtimeMs).toBe(before);
	});

	test("restoring a backup, which is itself undoable", () => {
		const b = book();
		expect(b.backups()).toEqual([]);
		b.add({ city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] });
		b.add({ city: "Porto", country: "PT", date: "2025-03", travelers: ["Alex"] });
		b.add({ city: "Rome", country: "IT", date: "2022-09", travelers: ["Alex"] });
		const list = b.backups();
		expect(list.map((x) => x.trips)).toEqual([2, 1]);
		expect(b.restore(list[1].name)).toEqual({ trips: 1, unreadable: 0 });
		expect(b.load().trips.map((t) => t.city)).toEqual(["Lisbon"]);
		expect(b.backups()[0].trips).toBe(3);

		expect(() => b.restore("../trips.json")).toThrow("Unknown backup");
		expect(() => b.restore("notes.txt")).toThrow("Unknown backup");
		expect(() => b.restore("trips-1999.json")).toThrow("no longer exists");

		fs.writeFileSync(path.join(dir, "backups", "trips-zzz.json"), "{broken");
		expect(b.backups()[0]).toMatchObject({ name: "trips-zzz.json", trips: null, savedAt: null });
	});
});
