"use strict";

const path = require("node:path");
const { parseCSV, rowsToRecords } = require("./csv");
const { validateTrips } = require("./schema");
const { mergeTrips } = require("./merge");
const { readTripsFile, writeTripsFile } = require("./store");

/**
 * Read raw trip records from CSV or JSON text. The format is taken from the file name,
 * or guessed from the content when there is no extension.
 * @param {string} text
 * @param {string} [filename]
 * @returns {{records: object[], unknownHeaders: string[], missingFields: string[]}}
 */
function recordsFromText (text, filename = "") {
	const ext = path.extname(filename).toLowerCase();
	const trimmed = String(text || "").replace(/^\uFEFF/, "").trim();
	const looksJson = ext === ".json" || (!ext && /^[[{]/.test(trimmed));
	if (looksJson) {
		const data = trimmed ? JSON.parse(trimmed) : [];
		const records = Array.isArray(data) ? data : data && Array.isArray(data.trips) ? data.trips : null;
		if (!records) throw new Error("JSON should be a list of trips, or an object with a \"trips\" list");
		return { records, unknownHeaders: [], missingFields: [] };
	}
	return rowsToRecords(parseCSV(trimmed));
}

/**
 * Validate new records and add them to a trips file, merging duplicates.
 *
 * @param {object} opts
 * @param {string} opts.file path to trips.json
 * @param {object[]} opts.records raw records
 * @param {string[]} opts.travelerNames
 * @param {{countries: object, geocoder: object}} opts.geo
 * @param {boolean} [opts.dryRun] check only, don't write
 * @param {string} [opts.source] label used in problem reports
 */
function importRecords ({ file, records, travelerNames, geo, dryRun = false, source = "import" }) {
	const ctx = { travelerNames, countries: geo.countries, geocoder: geo.geocoder };
	const existingRaw = readTripsFile(file);
	const existing = validateTrips(existingRaw, ctx, { source: path.basename(file) });
	const incoming = validateTrips(records, ctx, { source, firstRowNumber: 2 });
	const before = existing.trips.length;
	const { trips, merged } = mergeTrips([existing.trips, incoming.trips], travelerNames);
	// Never rewrite a file that has rows we couldn't read: they would be lost.
	const blocked = existing.problems.length > 0;
	const written = !dryRun && !blocked && incoming.trips.length > 0;
	if (written) writeTripsFile(file, trips);
	return {
		written,
		blocked,
		added: trips.length - before,
		merged,
		rejected: incoming.problems,
		existingProblems: existing.problems,
		total: trips.length
	};
}

module.exports = { recordsFromText, importRecords };
