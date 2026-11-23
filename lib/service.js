"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readTripsFile } = require("./store");
const { recordsFromText } = require("./pipeline");
const { validateTrips } = require("./schema");
const { mergeTrips } = require("./merge");
const { buildViewModel } = require("./viewmodel");
const { createSheetSource } = require("./sheet");

const WATCHED_FILES = new Set(["trips.json", "trips.csv"]);

/**
 * Resolve the config's home setting to coordinates.
 * Accepts {lat, lon} or {city, country}. Returns null if missing or not found.
 * @param {object|undefined} home
 * @param {{countries: object, geocoder: object}} geo
 */
function resolveHome (home, geo) {
	if (!home || typeof home !== "object") return null;
	const lat = Number(home.lat);
	const lon = Number(home.lon);
	if (home.lat !== undefined && home.lon !== undefined && Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
	if (!home.city || !home.country) return null;
	const country = geo.countries.resolve(String(home.country));
	const hit = country && geo.geocoder.lookup(String(home.city), country);
	return hit ? { lat: hit.lat, lon: hit.lon } : null;
}

/**
 * Loads trips from the module's data folder, keeps them up to date, and builds the screen's view model.
 *
 * @param {object} opts
 * @param {string} opts.dataDir folder holding trips.json and/or trips.csv
 * @param {object} opts.config the module config (travelers, filters, home, worldCountryCount, distanceUnits)
 * @param {{countries: object, geocoder: object}} opts.geo
 * @param {(model: object) => void} [opts.onChange] called after a watched file changes
 * @param {{warn: Function, info: Function}} [opts.logger]
 * @param {() => Date} [opts.clock]
 * @param {typeof fetch} [opts.fetch] used for the Google Sheet (config.sheetUrl)
 */
function createTripService (opts) {
	const { dataDir, config, geo } = opts;
	const logger = opts.logger || { warn () {}, info () {} };
	const clock = opts.clock || (() => new Date());
	const travelerNames = (Array.isArray(config.travelers) ? config.travelers : []).map((t) => (typeof t === "string" ? t : t && t.name)).filter(Boolean);
	const ctx = { travelerNames, countries: geo.countries, geocoder: geo.geocoder };
	const sheet = config.sheetUrl ? createSheetSource({ url: config.sheetUrl, cacheFile: path.join(dataDir, "sheet-cache.csv"), fetch: opts.fetch, clock }) : null;
	let watcher = null;
	let timer = null;
	let sheetTimer = null;
	let last = null;

	function readCsvText (text, name) {
		const { records, missingFields } = recordsFromText(text, "x.csv");
		if (missingFields.length) throw new Error(`${name} has no column for: ${missingFields.join(", ")}`);
		return validateTrips(records, ctx, { source: name, firstRowNumber: 2 });
	}

	/**
	 * Each source on its own: trips.json (the editor's file), trips.csv and the Google Sheet.
	 * @returns {Array<{name: string, editable: boolean, trips: object[], problems: object[]}>}
	 */
	function readEachSource () {
		const out = [];
		const jsonFile = path.join(dataDir, "trips.json");
		const csvFile = path.join(dataDir, "trips.csv");
		const add = (name, editable, read) => {
			try {
				const r = read();
				out.push({ name, editable, trips: r.trips, problems: r.problems });
			} catch (err) {
				out.push({ name, editable, trips: [], problems: [{ source: name, row: 0, errors: [err.message] }] });
			}
		};
		add("trips.json", true, () => validateTrips(readTripsFile(jsonFile), ctx, { source: "trips.json" }));
		if (fs.existsSync(csvFile)) add("trips.csv", false, () => readCsvText(fs.readFileSync(csvFile, "utf8"), "trips.csv"));
		if (sheet) {
			const status = sheet.status;
			if (sheet.text !== null) add("Google Sheet", false, () => readCsvText(sheet.text, "Google Sheet"));
			if (status.error) out.push({ name: "Google Sheet", editable: false, trips: [], problems: [{ source: "Google Sheet", row: 0, errors: [status.error] }] });
		}
		return out;
	}

	function readSources () {
		const each = readEachSource();
		return {
			trips: mergeTrips(each.map((s) => s.trips), travelerNames).trips,
			problems: each.flatMap((s) => s.problems)
		};
	}

	function load () {
		const { trips, problems } = readSources();
		for (const p of problems) logger.warn(`${p.source}${p.row ? ` row ${p.row}` : ""}: ${p.errors.join("; ")}`);
		const model = buildViewModel(trips, {
			travelerNames,
			filters: Array.isArray(config.filters) ? config.filters : undefined,
			now: clock(),
			countries: geo.countries,
			home: resolveHome(config.home, geo),
			worldCountryCount: config.worldCountryCount,
			units: config.distanceUnits,
			labels: config.labels
		});
		model.problems = problems;
		last = model;
		return model;
	}

	function scheduleReload (delay) {
		clearTimeout(timer);
		timer = setTimeout(() => {
			try {
				const model = load();
				if (opts.onChange) opts.onChange(model);
			} catch (err) {
				logger.warn(`Reload failed: ${err.message}`);
			}
		}, delay);
	}

	return {
		load,
		readEachSource,
		get lastModel () {
			return last;
		},
		get sheetStatus () {
			return sheet ? sheet.status : null;
		},
		/** Download the Google Sheet now; the mirror updates if it changed. */
		async refreshSheet () {
			if (!sheet) return;
			const before = sheet.status.error;
			const changed = await sheet.refresh();
			if (changed || sheet.status.error !== before) scheduleReload(0);
		},
		/** Watch the data folder; changes are picked up within a second. */
		watch (debounceMs = 500) {
			if (watcher) return;
			fs.mkdirSync(dataDir, { recursive: true });
			watcher = fs.watch(dataDir, (event, filename) => {
				if (!filename || WATCHED_FILES.has(String(filename))) scheduleReload(debounceMs);
			});
			if (sheet) {
				const minutes = Math.max(1, Number(config.sheetRefreshMinutes) || 30);
				this.refreshSheet();
				sheetTimer = setInterval(() => this.refreshSheet(), minutes * 60 * 1000);
			}
		},
		/** Rebuild now (e.g. once an hour, so trips move from planned to visited as months pass). */
		refresh () {
			scheduleReload(0);
		},
		stop () {
			clearTimeout(timer);
			clearInterval(sheetTimer);
			if (watcher) watcher.close();
			watcher = null;
		}
	};
}

module.exports = { createTripService, resolveHome };
