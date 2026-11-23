"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { validateTrip, storedTrip, tripId, normalizeDate, normalizeDay, normalizeTravelers } = require("./schema");
const { mergeTrips, visitKey } = require("./merge");
const { readTripsFile, writeTripsFile, readBackupNote, backupOrder } = require("./store");

/** Random id for trips made in the editor. */
function newId () {
	return "t_" + crypto.randomBytes(5).toString("hex");
}

/**
 * Add, change and delete trips in trips.json for the web editor and the importers.
 *
 * Rows the module can't read are never thrown away: they stay in the file (at the end) with
 * their original values, and are listed so they can be fixed or deleted from the editor.
 * Every save keeps a backup (see store.js).
 *
 * @param {object} opts
 * @param {string} opts.file path to trips.json
 * @param {{travelerNames: string[], countries: object, geocoder: object}} opts.ctx
 * @param {() => Date} [opts.clock]
 */
function createTripBook ({ file, ctx, clock = () => new Date() }) {
	const names = ctx.travelerNames;

	/**
	 * @returns {{trips: object[], broken: Array<{id: string, raw: object, errors: string[]}>}}
	 */
	function load () {
		const rows = readTripsFile(file);
		const trips = [];
		const broken = [];
		const seen = new Set();
		const occurrences = new Map();
		rows.forEach((raw, i) => {
			const r = validateTrip(raw, ctx);
			if (!r.ok) {
				const row = raw && typeof raw === "object" ? raw : { value: raw };
				broken.push({ id: `row-${i + 1}`, raw: row, errors: r.errors, guess: guessFields(row) });
				return;
			}
			const trip = r.trip;
			// Rows typed by hand may have no id, or a copied one: give them one that stays the same between reads.
			let id = trip.id || tripId(trip);
			while (seen.has(id)) {
				const n = (occurrences.get(id) || 0) + 1;
				occurrences.set(id, n);
				id = trip.id ? `${trip.id}_${n}` : tripId(trip, n);
			}
			trip.id = id;
			seen.add(id);
			trips.push(trip);
		});
		return { trips, broken };
	}

	/**
	 * What the editor can tell from a row it can't read, so its form opens filled in:
	 * "May 2019" as 2019-05, "Portugal" as PT, the travelers it knows and the ones it doesn't.
	 */
	function guessFields (raw) {
		const t = normalizeTravelers(raw.travelers, names);
		const start = normalizeDay(raw.start) || normalizeDay(raw.date) || "";
		return {
			date: normalizeDate(raw.date) || start.slice(0, 7),
			start,
			country: raw.country ? ctx.countries.resolve(String(raw.country)) || "" : "",
			travelers: t.travelers,
			unknownTravelers: t.unknown
		};
	}

	function save (trips, broken, note) {
		const rows = [...trips.map((t) => storedTrip(t, ctx.geocoder)), ...broken.map((b) => b.raw)];
		writeTripsFile(file, rows, { now: clock(), note });
	}

	/** "Cusco, Nov 2019", for backup notes. */
	function describe (t) {
		const place = t.city || (ctx.countries && ctx.countries.name ? ctx.countries.name(t.country) : t.country) || "a trip";
		const m = /^(\d{4})-(\d{2})/.exec(String(t.date || ""));
		return m ? `${place}, ${SHORT_MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(place);
	}

	function check (raw) {
		const r = validateTrip({ ...raw, id: undefined }, ctx);
		return r.ok ? { ok: true, trip: r.trip } : { ok: false, errors: r.errors };
	}

	/** Merge same city + country + month; report which trip absorbed the change. */
	function mergeInto (trips, changed) {
		const key = visitKey(changed);
		const { trips: merged } = mergeTrips([trips], names);
		const result = merged.find((t) => visitKey(t) === key);
		return { trips: merged, trip: result, combined: merged.length < trips.length };
	}

	return {
		load,

		/**
		 * @param {object} raw trip fields from the editor
		 * @returns {{ok: true, trip: object, combined: boolean} | {ok: false, errors: string[]}}
		 */
		add (raw) {
			const c = check(raw);
			if (!c.ok) return c;
			const { trips, broken } = load();
			const trip = { ...c.trip, id: newId() };
			const m = mergeInto([...trips, trip], trip);
			save(m.trips, broken, `Before adding ${describe(trip)}`);
			return { ok: true, trip: m.trip, combined: m.combined };
		},

		/**
		 * Replace a trip (or fix an unreadable row, by its "row-N" id).
		 * @returns {{ok: true, trip: object, combined: boolean} | {ok: false, errors: string[], notFound?: boolean}}
		 */
		update (id, raw) {
			const c = check(raw);
			if (!c.ok) return c;
			const { trips, broken } = load();
			const i = trips.findIndex((t) => t.id === id);
			const b = broken.findIndex((x) => x.id === id);
			if (i < 0 && b < 0) return { ok: false, notFound: true, errors: ["That trip no longer exists. It may have been deleted on another device"] };
			const trip = { ...c.trip, id: i >= 0 ? id : newId() };
			const list = [...trips];
			if (i >= 0) list[i] = trip;
			else {
				list.push(trip);
				broken.splice(b, 1);
			}
			const m = mergeInto(list, trip);
			save(m.trips, broken, i >= 0 ? `Before changing ${describe(trips[i])}` : `Before fixing ${describe(trip)}`);
			return { ok: true, trip: m.trip, combined: m.combined };
		},

		/** @returns {boolean} false when there was no such trip */
		remove (id) {
			const { trips, broken } = load();
			const keep = trips.filter((t) => t.id !== id);
			const keepBroken = broken.filter((b) => b.id !== id);
			if (keep.length === trips.length && keepBroken.length === broken.length) return false;
			const gone = trips.find((t) => t.id === id);
			save(keep, keepBroken, gone ? `Before deleting ${describe(gone)}` : "Before deleting a trip that couldn't be shown");
			return true;
		},

		/**
		 * Check rows from the import review screen without saving.
		 * @param {object[]} rows
		 * @returns {Array<{ok: true, trip: object, combinesWith: object|null} | {ok: false, errors: string[]}>}
		 */
		checkMany (rows) {
			const { trips } = load();
			const byKey = new Map(trips.map((t) => [visitKey(t), t]));
			return rows.map((raw) => {
				const c = check(raw);
				if (!c.ok) return c;
				const existing = byKey.get(visitKey(c.trip)) || null;
				// Travelers this row would add to a trip that's already there; none = it's already there.
				const adds = existing ? c.trip.travelers.filter((n) => !existing.travelers.includes(n)) : c.trip.travelers;
				return { ok: true, trip: c.trip, combinesWith: existing, adds };
			});
		},

		/**
		 * Save the good rows from an import. Same place and month as an existing trip combines
		 * the travelers, so two people's Timeline imports become "together" trips.
		 * `combined` counts rows that added someone to a trip already there; `already` counts rows
		 * whose trip (with those travelers) was already there.
		 * @param {object[]} rows
		 * @param {{keepRejected?: boolean}} [opts] keep unreadable rows in the file, to fix in the editor
		 */
		importMany (rows, opts = {}) {
			const { trips, broken } = load();
			const byKey = new Map(trips.map((t) => [visitKey(t), t]));
			const good = [];
			const rejected = [];
			let combined = 0;
			let already = 0;
			rows.forEach((raw, i) => {
				const c = check(raw);
				if (!c.ok) {
					rejected.push({ row: i + 1, errors: c.errors });
					if (opts.keepRejected) broken.push({ raw: raw && typeof raw === "object" ? raw : { value: raw } });
					return;
				}
				const existing = byKey.get(visitKey(c.trip));
				if (existing) {
					if (c.trip.travelers.every((n) => existing.travelers.includes(n))) already++;
					else combined++;
				}
				good.push({ ...c.trip, id: newId() });
			});
			const { trips: merged } = mergeTrips([trips, good], names);
			if (good.length || (opts.keepRejected && rejected.length)) save(merged, broken, opts.note || `Before importing ${good.length} trip${good.length === 1 ? "" : "s"}`);
			return { added: merged.length - trips.length, combined, already, rejected, total: merged.length };
		},

		/** Backups, newest first. */
		backups () {
			const dir = path.join(path.dirname(file), "backups");
			if (!fs.existsSync(dir)) return [];
			const base = path.basename(file, ".json");
			return fs.readdirSync(dir)
				.filter((f) => f.startsWith(`${base}-`) && f.endsWith(".json"))
				.sort(backupOrder)
				.reverse()
				.map((f) => {
					let count;
					try {
						count = readTripsFile(path.join(dir, f)).length;
					} catch {
						count = null;
					}
					return { name: f, size: fs.statSync(path.join(dir, f)).size, trips: count, savedAt: stampToIso(f.slice(base.length + 1, -5)), note: readBackupNote(path.join(dir, f)) };
				});
		},

		/**
		 * Put a backup back. The current file is backed up first, so this can be undone.
		 * @param {string} name a file name from backups()
		 */
		restore (name) {
			const dir = path.join(path.dirname(file), "backups");
			if (path.basename(name) !== name || !name.endsWith(".json")) throw new Error("Unknown backup");
			const source = path.join(dir, name);
			if (!fs.existsSync(source)) throw new Error("That backup no longer exists");
			const rows = readTripsFile(source);
			writeTripsFile(file, rows, { now: clock(), note: "Before putting back a backup" });
			const readable = rows.filter((r) => validateTrip(r, ctx).ok).length;
			return { trips: readable, unreadable: rows.length - readable };
		}
	};
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-23T12-00-00-000Z" (from a backup name) back to an ISO time. */
function stampToIso (stamp) {
	const m = stamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
	return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}

module.exports = { createTripBook, newId };
