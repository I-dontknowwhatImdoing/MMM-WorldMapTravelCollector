"use strict";

const { expandFilters, filterTrips, travelerGroup, filterLabel, isPlanned, currentMonth } = require("./filters");
const { computeStats, newestTrip } = require("./stats");
const { normalizeName } = require("./text");

/**
 * One color group for a set of trips: the single group they share, or "mixed"
 * (e.g. Alex went alone once and Sam went alone once).
 * @param {object[]} trips
 * @param {string[]} names
 */
function groupOf (trips, names) {
	const groups = new Set(trips.map((t) => travelerGroup(t, names)));
	return groups.size === 1 ? [...groups][0] : "mixed";
}

/** "YYYY-MM" of the most recent trip in a list, or null. Used to fade places visited long ago. */
function latest (trips) {
	return trips.reduce((max, t) => (max === null || t.date > max ? t.date : max), null);
}

function byNewest (a, b) {
	return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.city || "").localeCompare(b.city || "");
}

/**
 * Everything one view (filter) needs to draw: country shading, pins, the ledger order and stats.
 * @param {object[]} trips trips in this view
 * @param {object} opts see buildViewModel
 */
function buildView (filter, trips, opts) {
	const { travelerNames: names, now } = opts;
	const visited = trips.filter((t) => !isPlanned(t, now));
	const planned = trips.filter((t) => isPlanned(t, now));
	const newest = newestTrip(trips, now);

	const countries = {};
	const countryCodes = new Set(trips.map((t) => t.country));
	for (const code of countryCodes) {
		const v = visited.filter((t) => t.country === code);
		const list = v.length ? v : planned.filter((t) => t.country === code);
		countries[code] = { state: v.length ? "visited" : "planned", group: groupOf(list, names), last: latest(v) };
	}

	const pinMap = new Map();
	for (const t of trips) {
		if (!t.city || !Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
		const key = `${normalizeName(t.city)}|${t.country}`;
		if (!pinMap.has(key)) pinMap.set(key, { key, city: t.city, country: t.country, lat: t.lat, lon: t.lon, trips: [] });
		pinMap.get(key).trips.push(t);
	}
	const pins = [...pinMap.values()].map((p) => {
		const v = p.trips.filter((t) => !isPlanned(t, now));
		return {
			key: p.key,
			city: p.city,
			country: p.country,
			lat: p.lat,
			lon: p.lon,
			visits: v.length,
			planned: v.length === 0,
			group: groupOf(v.length ? v : p.trips, names),
			last: latest(v),
			newest: Boolean(newest && p.trips.includes(newest))
		};
	});
	// Draw big pins first so small ones stay clickable/visible on top.
	pins.sort((a, b) => b.visits - a.visits || a.key.localeCompare(b.key));

	return {
		id: filter,
		label: filterLabel(filter, opts.labels),
		countries,
		pins,
		tripIds: [...trips].sort(byNewest).map((t) => t.id),
		newestId: newest ? newest.id : null,
		stats: computeStats(trips, opts)
	};
}

/**
 * The data the screen needs, built on the server so the browser only draws.
 *
 * @param {object[]} trips validated, merged trips
 * @param {object} opts
 * @param {string[]} opts.travelerNames
 * @param {string[]} [opts.filters] config filter list, e.g. ["all", "together", "solo"]
 * @param {Date} [opts.now]
 * @param {{name(code: string): string, continent(code: string): string|null}} opts.countries
 * @param {{lat: number, lon: number}|null} [opts.home]
 * @param {number} [opts.worldCountryCount]
 * @param {"km"|"mi"} [opts.units]
 * @param {object} [opts.labels] filter label templates
 */
function buildViewModel (trips, opts) {
	const now = opts.now || new Date();
	const full = { ...opts, now };
	const filters = expandFilters(opts.filters || ["all", "together", "solo"], opts.travelerNames);
	const tripTable = {};
	for (const t of trips) {
		tripTable[t.id] = {
			id: t.id,
			city: t.city,
			country: t.country,
			countryName: opts.countries.name(t.country),
			date: t.date,
			days: t.days ?? null,
			travelers: t.travelers,
			group: travelerGroup(t, opts.travelerNames),
			planned: isPlanned(t, now),
			note: t.note || ""
		};
	}
	return {
		generatedAt: now.toISOString(),
		currentMonth: currentMonth(now),
		travelers: opts.travelerNames,
		trips: tripTable,
		views: filters.map((f) => buildView(f, filterTrips(trips, f, opts.travelerNames), full))
	};
}

module.exports = { buildViewModel, buildView, groupOf };
