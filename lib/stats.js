"use strict";

const { isPlanned } = require("./filters");
const { normalizeName } = require("./text");

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_MILE = 1.609344;
const ALL_STATS = ["countries", "cities", "continents", "worldPercent", "tripsThisYear", "distance"];

/**
 * Great-circle distance in kilometres.
 * @param {{lat: number, lon: number}} a
 * @param {{lat: number, lon: number}} b
 */
function haversineKm (a, b) {
	const rad = Math.PI / 180;
	const dLat = (b.lat - a.lat) * rad;
	const dLon = (b.lon - a.lon) * rad;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * All stats for a set of trips (already filtered to the current view). Planned trips are ignored.
 *
 * @param {object[]} trips
 * @param {object} opts
 * @param {Date} [opts.now]
 * @param {{continent(code: string): string|null}} opts.countries
 * @param {{lat: number, lon: number}|null} [opts.home] needed for distance
 * @param {number} [opts.worldCountryCount] default 195
 * @param {"km"|"mi"} [opts.units] default "km"
 */
function computeStats (trips, opts) {
	const now = opts.now || new Date();
	const visited = trips.filter((t) => !isPlanned(t, now));
	const countries = new Set(visited.map((t) => t.country));
	const cities = new Set(visited.filter((t) => t.city).map((t) => `${normalizeName(t.city)}|${t.country}`));
	const continents = new Set([...countries].map((c) => opts.countries.continent(c)).filter(Boolean));
	const worldCountryCount = opts.worldCountryCount || 195;
	const year = String(now.getFullYear());

	let distance = null;
	if (opts.home && Number.isFinite(opts.home.lat) && Number.isFinite(opts.home.lon)) {
		let km = 0;
		for (const t of visited) {
			if (Number.isFinite(t.lat) && Number.isFinite(t.lon)) km += 2 * haversineKm(opts.home, t);
		}
		distance = Math.round(opts.units === "mi" ? km / KM_PER_MILE : km);
	}

	const percent = (countries.size / worldCountryCount) * 100;
	return {
		countries: countries.size,
		cities: cities.size,
		continents: continents.size,
		continentNames: [...continents].sort(),
		worldPercent: percent > 0 && percent < 1 ? Math.round(percent * 10) / 10 : Math.round(percent),
		tripsThisYear: visited.filter((t) => t.date.startsWith(year + "-")).length,
		year: Number(year),
		distance,
		units: opts.units === "mi" ? "mi" : "km"
	};
}

/**
 * The newest visited (not planned) trip, or null.
 * @param {object[]} trips
 * @param {Date} [now]
 */
function newestTrip (trips, now = new Date()) {
	let best = null;
	for (const t of trips) {
		if (isPlanned(t, now)) continue;
		if (!best || t.date > best.date) best = t;
	}
	return best;
}

module.exports = { computeStats, haversineKm, newestTrip, ALL_STATS };
