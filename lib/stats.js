"use strict";

const { isPlanned } = require("./filters");
const { normalizeName } = require("./text");

const EARTH_RADIUS_KM = 6371.0088;
const KM_PER_MILE = 1.609344;
/** Shown when the config doesn't say. */
const ALL_STATS = ["countries", "cities", "continents", "worldPercent", "tripsThisYear", "distance"];
/** More that can be listed in the stats option. */
const EXTRA_STATS = ["daysTraveled", "nextTrip", "lastTrip", "farthest", "newThisYear", "mostVisited", "longestTrip", "usStates"];
const DAY_MS = 24 * 60 * 60 * 1000;

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
 * @param {{lookup(city: string, country: string): {region?: string}|null}} [opts.geocoder] for the US states stat
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
	const units = opts.units === "mi" ? "mi" : "km";
	const place = (t) => t.city || (opts.countries.name ? opts.countries.name(t.country) : t.country);
	const countryName = (code) => (opts.countries.name ? opts.countries.name(code) : code);
	const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	const dayOf = (ymd) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));
	const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
	const thisMonth = now.getFullYear() * 12 + now.getMonth();

	// Days away: the days of every visit that has them.
	const withDays = visited.filter((t) => Number(t.days) > 0);
	const daysTraveled = withDays.length ? withDays.reduce((sum, t) => sum + Number(t.days), 0) : null;

	// The soonest planned trip: days to go when its start day is known, else months.
	const planned = trips.filter((t) => isPlanned(t, now)).sort((a, b) => (a.start || `${a.date}-01`).localeCompare(b.start || `${b.date}-01`) || place(a).localeCompare(place(b)));
	let nextTrip = null;
	if (planned.length) {
		const t = planned[0];
		nextTrip = t.start ? { place: place(t), days: Math.max(0, Math.round((dayOf(t.start) - today) / DAY_MS)) } : { place: place(t), months: monthIndex(t.date) - thisMonth };
	}

	// The most recent visit: days ago when it ended less than a month ago, else months or years.
	let lastTrip = null;
	const newest = newestTrip(visited, now);
	if (newest) {
		const end = endOf(newest);
		const days = end ? Math.round((today - dayOf(end)) / DAY_MS) : null;
		lastTrip = { place: place(newest), months: thisMonth - monthIndex(newest.date) };
		if (days !== null && days >= 0 && days < 31) lastTrip.days = days;
	}

	// The visited place farthest from home, as the crow flies.
	let farthest = null;
	if (opts.home && Number.isFinite(opts.home.lat) && Number.isFinite(opts.home.lon)) {
		for (const t of visited) {
			if (!Number.isFinite(t.lat) || !Number.isFinite(t.lon)) continue;
			const km = haversineKm(opts.home, t);
			if (!farthest || km > farthest.km) farthest = { place: place(t), km };
		}
		if (farthest) farthest = { place: farthest.place, distance: Math.round(units === "mi" ? farthest.km / KM_PER_MILE : farthest.km) };
	}

	// Countries first visited this year.
	const firstVisit = new Map();
	for (const t of visited) if (!firstVisit.has(t.country) || t.date < firstVisit.get(t.country)) firstVisit.set(t.country, t.date);
	const newThisYear = [...firstVisit.values()].filter((d) => d.startsWith(year + "-")).length;

	// The country with the most visits (a visit = a month there, so a two-city trip counts once).
	const visitMonths = new Map();
	for (const t of visited) {
		if (!visitMonths.has(t.country)) visitMonths.set(t.country, new Set());
		visitMonths.get(t.country).add(t.date);
	}
	let mostVisited = null;
	for (const [code, months] of visitMonths) {
		const last = [...months].sort().pop();
		if (!mostVisited || months.size > mostVisited.visits || (months.size === mostVisited.visits && last > mostVisited.last)) mostVisited = { country: code, visits: months.size, last };
	}
	mostVisited = mostVisited && mostVisited.visits >= 2 ? { place: countryName(mostVisited.country), visits: mostVisited.visits } : null;

	// The longest trip: days added up per country and month (a trip to Tokyo and Kyoto is one trip to Japan).
	const tripDays = new Map();
	for (const t of withDays) {
		const key = `${t.country}|${t.date}`;
		tripDays.set(key, (tripDays.get(key) || 0) + Number(t.days));
	}
	let longestTrip = null;
	for (const [key, days] of tripDays) {
		const [code, date] = key.split("|");
		if (!longestTrip || days > longestTrip.days || (days === longestTrip.days && date > longestTrip.date)) longestTrip = { days, place: countryName(code), date };
	}
	if (longestTrip) longestTrip = { days: longestTrip.days, place: longestTrip.place };

	// US states with a visited city (Washington, D.C. isn't a state).
	let usStates = null;
	if (opts.geocoder) {
		const states = new Set();
		for (const t of visited) {
			if (t.country !== "US" || !t.city) continue;
			const hit = opts.geocoder.lookup(t.city, "US");
			if (hit && hit.region && hit.region !== "DC") states.add(hit.region);
		}
		usStates = states.size;
	}

	return {
		countries: countries.size,
		cities: cities.size,
		continents: continents.size,
		continentNames: [...continents].sort(),
		worldPercent: percent > 0 && percent < 1 ? Math.round(percent * 10) / 10 : Math.round(percent),
		tripsThisYear: visited.filter((t) => t.date.startsWith(year + "-")).length,
		year: Number(year),
		distance,
		units,
		daysTraveled,
		nextTrip,
		lastTrip,
		farthest,
		newThisYear,
		mostVisited,
		longestTrip,
		usStates
	};
}

/** The last day of a trip with a start day and days (YYYY-MM-DD), else null. */
function endOf (trip) {
	if (!trip.start) return null;
	const days = Number(trip.days) > 0 ? Number(trip.days) : 1;
	const d = new Date(Date.UTC(Number(trip.start.slice(0, 4)), Number(trip.start.slice(5, 7)) - 1, Number(trip.start.slice(8, 10)) + days - 1));
	return d.toISOString().slice(0, 10);
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

module.exports = { computeStats, haversineKm, newestTrip, ALL_STATS, EXTRA_STATS };
