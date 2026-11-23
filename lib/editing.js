"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { validateTrip, storedTrip, tripId } = require("./schema");
const { mergeTrips, visitKey } = require("./merge");
const { readTripsFile, writeTripsFile, backupOrder } = require("./store");

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
				broken.push({ id: `row-${i + 1}`, raw: raw && typeof raw === "object" ? raw : { value: raw }, errors: r.errors });
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

	function save (trips, broken) {
		const rows = [...trips.map((t) => storedTrip(t, ctx.geocoder)), ...broken.map((b) => b.raw)];
		writeTripsFile(file, rows, { now: clock() });
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
			save(m.trips, broken);
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
			save(m.trips, broken);
			return { ok: true, trip: m.trip, combined: m.combined };
		},

		/** @returns {boolean} false when there was no such trip */
		remove (id) {
			const { trips, broken } = load();
			const keep = trips.filter((t) => t.id !== id);
			const keepBroken = broken.filter((b) => b.id !== id);
			if (keep.length === trips.length && keepBroken.length === broken.length) return false;
			save(keep, keepBroken);
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
				return { ok: true, trip: c.trip, combinesWith: byKey.get(visitKey(c.trip)) || null };
			});
		},

		/**
		 * Save the good rows from an import. Same place and month as an existing trip combines
		 * the travelers, so two people's Timeline imports become "together" trips.
		 * @param {object[]} rows
		 */
		importMany (rows) {
			const { trips, broken } = load();
			const good = [];
			const rejected = [];
			rows.forEach((raw, i) => {
				const c = check(raw);
				if (c.ok) good.push({ ...c.trip, id: newId() });
				else rejected.push({ row: i + 1, errors: c.errors });
			});
			const { trips: merged, merged: combined } = mergeTrips([trips, good], names);
			if (good.length) save(merged, broken);
			return { added: merged.length - trips.length, combined, rejected, total: merged.length };
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
					return { name: f, size: fs.statSync(path.join(dir, f)).size, trips: count, savedAt: stampToIso(f.slice(base.length + 1, -5)) };
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
			writeTripsFile(file, rows, { now: clock() });
			return rows.length;
		}
	};
}

/** "2026-11-23T12-00-00-000Z" (from a backup name) back to an ISO time. */
function stampToIso (stamp) {
	const m = stamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
	return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : null;
}

module.exports = { createTripBook, newId };
