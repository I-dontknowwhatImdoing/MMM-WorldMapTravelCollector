#!/usr/bin/env node
"use strict";

/**
 * Command-line import of a CSV or JSON file into data/trips.json.
 *
 *   node scripts/import.js my-trips.csv --travelers "Alex,Sam"
 *   node scripts/import.js my-trips.csv --travelers "Alex,Sam" --dry-run
 *
 * Options:
 *   --travelers  the same names as in your MagicMirror config, comma-separated (required)
 *   --out        trips file to add to (default: data/trips.json in this module)
 *   --dry-run    check the file and report problems without saving anything
 */

const fs = require("node:fs");
const path = require("node:path");
const { loadGeoData } = require("../lib/geodata");
const { recordsFromText, importRecords } = require("../lib/pipeline");

function parseArgs (argv) {
	const args = { file: null, travelers: null, out: path.join(__dirname, "..", "data", "trips.json"), dryRun: false, help: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--travelers") args.travelers = argv[++i];
		else if (a.startsWith("--travelers=")) args.travelers = a.slice(12);
		else if (a === "--out") args.out = argv[++i];
		else if (a.startsWith("--out=")) args.out = a.slice(6);
		else if (a === "--dry-run") args.dryRun = true;
		else if (a === "--help" || a === "-h") args.help = true;
		else if (!args.file) args.file = a;
		else throw new Error(`Unexpected argument '${a}'`);
	}
	return args;
}

function run (argv, log = console.log) {
	const args = parseArgs(argv);
	if (args.help || !args.file) {
		log("Usage: node scripts/import.js <file.csv|file.json> --travelers \"Alex,Sam\" [--out data/trips.json] [--dry-run]");
		return args.help ? 0 : 1;
	}
	if (!args.travelers) {
		log("Please pass --travelers with the same names as in your MagicMirror config, e.g. --travelers \"Alex,Sam\"");
		return 1;
	}
	const travelerNames = args.travelers.split(",").map((s) => s.trim()).filter(Boolean);
	const text = fs.readFileSync(args.file, "utf8");
	const { records, unknownHeaders, missingFields } = recordsFromText(text, args.file);
	if (missingFields.length) {
		log(`The file has no column for: ${missingFields.join(", ")}. Expected columns: city, country, date, days, travelers, lat, lon, note`);
		return 1;
	}
	if (unknownHeaders.length) log(`Ignoring columns: ${unknownHeaders.join(", ")}`);

	const result = importRecords({
		file: args.out,
		records,
		travelerNames,
		geo: loadGeoData(),
		dryRun: args.dryRun,
		source: path.basename(args.file)
	});

	for (const p of result.existingProblems) log(`${p.source} row ${p.row}: ${p.errors.join("; ")}`);
	for (const p of result.rejected) log(`Skipped ${p.source} row ${p.row}: ${p.errors.join("; ")}`);
	if (result.blocked) {
		log(`Nothing saved: ${path.basename(args.out)} has rows that couldn't be read (listed above). Fix those first.`);
		return 1;
	}
	const verb = args.dryRun ? "Would add" : "Added";
	log(`${verb} ${result.added} trip${result.added === 1 ? "" : "s"}, merged ${result.merged} duplicate${result.merged === 1 ? "" : "s"}, skipped ${result.rejected.length}. ${args.dryRun ? "Nothing was saved (dry run)." : `${result.total} trips in ${args.out}.`}`);
	return 0;
}

if (require.main === module) {
	try {
		process.exitCode = run(process.argv.slice(2));
	} catch (err) {
		console.error(err.message);
		process.exitCode = 1;
	}
}

module.exports = { run, parseArgs };
