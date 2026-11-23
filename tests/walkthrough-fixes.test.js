"use strict";

/** Server side of the fixes from the AI usability walkthrough: backups that say what changed. */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createTripBook } = require("../lib/editing");
const { writeTripsFile, readBackupNote } = require("../lib/store");
const { ctx } = require("./helpers");

let dir;
let file;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "wmtc-walk-"));
	file = path.join(dir, "trips.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("backups say what changed", () => {
	test("add, change, delete, import and restore each leave a note on the backup before them", () => {
		let tick = 0;
		const book = createTripBook({ file, ctx: ctx(["Alex", "Sam"]), clock: () => new Date(Date.UTC(2026, 10, 23, 12, 0, tick++)) });
		fs.writeFileSync(file, JSON.stringify({ version: 1, trips: [{ id: "t_cus", city: "Cusco", country: "PE", date: "2019-11", travelers: ["Alex"] }] }));
		const added = book.add({ city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] });
		book.update(added.trip.id, { city: "Porto", country: "PT", date: "2025-03", travelers: ["Alex"] });
		book.remove("t_cus");
		book.importMany([{ city: "Rome", country: "IT", date: "2022-09", travelers: ["Sam"] }]);
		const first = book.backups().at(-1);
		book.restore(first.name);
		expect(book.backups().map((b) => b.note)).toEqual([
			"Before putting back a backup",
			"Before importing 1 trip",
			"Before deleting Cusco, Nov 2019",
			"Before changing Lisbon, Mar 2025",
			"Before adding Lisbon, Mar 2025"
		]);
		// The note doesn't come back with the restored list.
		expect(JSON.parse(fs.readFileSync(file, "utf8"))).not.toHaveProperty("backupNote");
		expect(book.load().trips.map((t) => t.city)).toEqual(["Cusco"]);
	});

	test("fixing a row the mirror couldn't show, and deleting one", () => {
		fs.writeFileSync(file, JSON.stringify([{ city: "Lisbn", country: "PT", date: "2024-05", travelers: ["Alex"] }, { city: "Nowhere", country: "ZZ", date: "x", travelers: ["Alex"] }]));
		const book = createTripBook({ file, ctx: ctx(["Alex"]) });
		book.update("row-1", { city: "Lisbon", country: "PT", date: "2024-05", travelers: ["Alex"] });
		expect(book.backups()[0].note).toBe("Before fixing Lisbon, May 2024");
		book.remove(book.load().broken[0].id);
		expect(book.backups()[0].note).toBe("Before deleting a trip that couldn't be shown");
	});

	test("an old list stored as a bare array, or a file that isn't JSON, is still backed up", () => {
		fs.writeFileSync(file, JSON.stringify([{ city: "Lisbon", country: "PT", date: "2025-03", travelers: ["Alex"] }]));
		writeTripsFile(file, [], { now: new Date("2026-11-23T12:00:00Z"), note: "Before a test" });
		const backups = path.join(dir, "backups");
		const [one] = fs.readdirSync(backups);
		expect(JSON.parse(fs.readFileSync(path.join(backups, one), "utf8"))).toMatchObject({ version: 1, backupNote: "Before a test", trips: [{ city: "Lisbon" }] });

		fs.writeFileSync(file, "not json at all");
		writeTripsFile(file, [], { now: new Date("2026-11-23T12:00:01Z"), note: "Before another test" });
		const second = fs.readdirSync(backups).find((f) => f !== one);
		expect(fs.readFileSync(path.join(backups, second), "utf8")).toBe("not json at all");
		expect(readBackupNote(path.join(backups, second))).toBe("");
		expect(readBackupNote(path.join(backups, one))).toBe("Before a test");
	});
});
