"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readTripsFile } = require("./store");
const { recordsFromText } = require("./pipeline");
const { validateTrips } = require("./schema");
const { mergeTrips } = require("./merge");
const { buildViewModel } = require("./viewmodel");

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
 */
function createTripService (opts) {
	const { dataDir, config, geo } = opts;
	const logger = opts.logger || { warn () {}, info () {} };
	const clock = opts.clock || (() => new Date());
	const travelerNames = (Array.isArray(config.travelers) ? config.travelers : []).map((t) => (typeof t === "string" ? t : t && t.name)).filter(Boolean);
	const ctx = { travelerNames, countries: geo.countries, geocoder: geo.geocoder };
	let watcher = null;
	let timer = null;
	let last = null;

	function readSources () {
		const lists = [];
		const problems = [];
		const jsonFile = path.join(dataDir, "trips.json");
		const csvFile = path.join(dataDir, "trips.csv");
		try {
			const r = validateTrips(readTripsFile(jsonFile), ctx, { source: "trips.json" });
			lists.push(r.trips);
			problems.push(...r.problems);
		} catch (err) {
			problems.push({ source: "trips.json", row: 0, errors: [err.message] });
		}
		if (fs.existsSync(csvFile)) {
			try {
				const { records, missingFields } = recordsFromText(fs.readFileSync(csvFile, "utf8"), csvFile);
				if (missingFields.length) throw new Error(`trips.csv has no column for: ${missingFields.join(", ")}`);
				const r = validateTrips(records, ctx, { source: "trips.csv", firstRowNumber: 2 });
				lists.push(r.trips);
				problems.push(...r.problems);
			} catch (err) {
				problems.push({ source: "trips.csv", row: 0, errors: [err.message] });
			}
		}
		return { trips: mergeTrips(lists, travelerNames).trips, problems };
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
		get lastModel () {
			return last;
		},
		/** Watch the data folder; changes are picked up within a second. */
		watch (debounceMs = 500) {
			if (watcher) return;
			fs.mkdirSync(dataDir, { recursive: true });
			watcher = fs.watch(dataDir, (event, filename) => {
				if (!filename || WATCHED_FILES.has(String(filename))) scheduleReload(debounceMs);
			});
		},
		/** Rebuild now (e.g. once an hour, so trips move from planned to visited as months pass). */
		refresh () {
			scheduleReload(0);
		},
		stop () {
			clearTimeout(timer);
			if (watcher) watcher.close();
			watcher = null;
		}
	};
}

module.exports = { createTripService, resolveHome };
