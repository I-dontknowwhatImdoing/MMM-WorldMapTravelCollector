"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_BACKUPS = 10;

/**
 * Read trips.json. A missing file means "no trips yet".
 * @param {string} file
 * @returns {object[]}
 */
function readTripsFile (file) {
	if (!fs.existsSync(file)) return [];
	const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
	if (!text.trim()) return [];
	const data = JSON.parse(text);
	if (Array.isArray(data)) return data;
	if (data && Array.isArray(data.trips)) return data.trips;
	throw new Error(`${path.basename(file)} should contain a list of trips`);
}

/**
 * Save trips safely: back up the current file, write a temp file, then swap it in,
 * so a power cut mid-write never leaves a half-written trips.json.
 * @param {string} file
 * @param {object[]} trips
 * @param {{now?: Date, maxBackups?: number, note?: string}} [opts] note: what this save changes, kept with the
 *        backup of the list before it ("Before deleting Cusco, Nov 2019") so people can tell backups apart
 */
function writeTripsFile (file, trips, opts = {}) {
	const dir = path.dirname(file);
	fs.mkdirSync(dir, { recursive: true });
	if (fs.existsSync(file)) backup(file, opts.now || new Date(), opts.maxBackups ?? MAX_BACKUPS, opts.note);
	const tmp = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify({ version: 1, trips }, null, 2) + "\n");
	fs.renameSync(tmp, file);
}

function backup (file, now, maxBackups, note) {
	const backupDir = path.join(path.dirname(file), "backups");
	fs.mkdirSync(backupDir, { recursive: true });
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const base = path.basename(file, ".json");
	// Saves in the same millisecond get -1, -2 …, always above the highest number used so far for that
	// moment, so a name freed by pruning is never reused for a newer backup (it would sort as the oldest).
	const sameMoment = fs.readdirSync(backupDir)
		.map((f) => f.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-${stamp}(?:-(\\d+))?\\.json$`)))
		.filter(Boolean)
		.map((m) => Number(m[1] || 0));
	const target = sameMoment.length
		? path.join(backupDir, `${base}-${stamp}-${Math.max(...sameMoment) + 1}.json`)
		: path.join(backupDir, `${base}-${stamp}.json`);
	copyWithNote(file, target, note);
	const old = fs.readdirSync(backupDir)
		.filter((f) => f.startsWith(`${base}-`) && f.endsWith(".json"))
		.sort(backupOrder);
	for (const f of old.slice(0, Math.max(0, old.length - maxBackups))) fs.unlinkSync(path.join(backupDir, f));
}

/** Copy the list, adding the note when it reads as JSON (a hand-edited file that doesn't is copied as it is). */
function copyWithNote (file, target, note) {
	if (note) {
		try {
			const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
			const out = Array.isArray(data) ? { version: 1, trips: data } : data;
			if (out && typeof out === "object" && Array.isArray(out.trips)) {
				fs.writeFileSync(target, JSON.stringify({ ...out, backupNote: note }, null, 2) + "\n");
				return;
			}
		} catch {
			// fall through to a plain copy
		}
	}
	fs.copyFileSync(file, target);
}

/** The note a backup was made with, or "". */
function readBackupNote (file) {
	try {
		const data = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
		return data && typeof data.backupNote === "string" ? data.backupNote : "";
	} catch {
		return "";
	}
}

/**
 * Oldest backup first. Names are "<base>-<time>.json", then "<base>-<time>-1.json", "-2" … for saves in the
 * same millisecond; a plain name sort would put "-1" before the first and "-10" before "-2".
 */
function backupOrder (a, b) {
	const key = (name) => {
		const m = name.match(/^(.*?Z)(?:-(\d+))?\.json$/);
		return m ? [m[1], Number(m[2] || 0)] : [name, 0];
	};
	const [sa, na] = key(a);
	const [sb, nb] = key(b);
	return sa < sb ? -1 : sa > sb ? 1 : na - nb;
}

module.exports = { readTripsFile, writeTripsFile, readBackupNote, backupOrder, MAX_BACKUPS };
