"use strict";

/**
 * Current month as "YYYY-MM" (local time, which is what a mirror on the wall means by "now").
 * @param {Date} [now]
 */
function currentMonth (now = new Date()) {
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * A trip is planned when its month is after the current month.
 * @param {{date: string}} trip
 * @param {Date} [now]
 */
function isPlanned (trip, now = new Date()) {
	return trip.date > currentMonth(now);
}

/**
 * Turn the config's filter list into concrete views.
 * "solo" -> one "solo:<name>" per traveler, "person" -> one "person:<name>" per traveler.
 * "years" -> one "year:YYYY" per year with trips, newest first; "months" -> one "month:M" per
 * calendar month with trips (all Marches together), January first.
 * With a single traveler, "together" and that person's views all equal "all", so they are dropped.
 * @param {string[]} filters e.g. ["all", "together", "solo", "years"]
 * @param {string[]} names configured traveler names
 * @param {{date: string}[]} [trips] needed for "years" and "months"
 * @returns {string[]}
 */
function expandFilters (filters, names, trips = []) {
	const out = [];
	const add = (f) => {
		if (!out.includes(f)) out.push(f);
	};
	for (const f of Array.isArray(filters) ? filters : []) {
		if (f === "all") add("all");
		else if (f === "together") {
			if (names.length > 1) add("together");
		} else if (f === "solo" || f === "person") {
			if (names.length > 1) names.forEach((n) => add(`${f}:${n}`));
		} else if (/^(solo|person):/.test(f)) {
			const name = f.slice(f.indexOf(":") + 1);
			if (names.includes(name) && names.length > 1) add(f);
		} else if (f === "years") {
			[...new Set(trips.map((t) => t.date.slice(0, 4)))].sort().reverse().forEach((y) => add(`year:${y}`));
		} else if (f === "months") {
			[...new Set(trips.map((t) => Number(t.date.slice(5, 7))))].sort((a, b) => a - b).forEach((m) => add(`month:${m}`));
		} else if (/^year:\d{4}$/.test(f)) add(f);
		else if (/^month:(\d{1,2})$/.test(f)) {
			const m = Number(f.slice(6));
			if (m >= 1 && m <= 12) add(`month:${m}`);
		}
	}
	if (!out.length) out.push("all");
	return out;
}

/**
 * Does a trip belong in a view?
 * @param {{travelers: string[]}} trip
 * @param {string} filter "all" | "together" | "solo:<name>" | "person:<name>" | "year:YYYY" | "month:M"
 * @param {string[]} names configured traveler names
 */
function matchesFilter (trip, filter, names) {
	if (filter === "all") return true;
	if (filter === "together") return names.length > 0 && names.every((n) => trip.travelers.includes(n));
	if (filter.startsWith("solo:")) {
		const name = filter.slice(5);
		return trip.travelers.length === 1 && trip.travelers[0] === name;
	}
	if (filter.startsWith("person:")) return trip.travelers.includes(filter.slice(7));
	if (filter.startsWith("year:")) return trip.date.slice(0, 4) === filter.slice(5);
	if (filter.startsWith("month:")) return Number(trip.date.slice(5, 7)) === Number(filter.slice(6));
	return false;
}

/**
 * @param {object[]} trips
 * @param {string} filter
 * @param {string[]} names
 */
function filterTrips (trips, filter, names) {
	return trips.filter((t) => matchesFilter(t, filter, names));
}

/**
 * Which color group a trip falls in on the map: "together", a single traveler's name, or "group"
 * (a subset of three or more travelers, drawn in the together color but lighter).
 * @param {{travelers: string[]}} trip
 * @param {string[]} names
 */
function travelerGroup (trip, names) {
	if (names.length > 1 && names.every((n) => trip.travelers.includes(n))) return "together";
	if (trip.travelers.length === 1) return trip.travelers[0];
	return "group";
}

/**
 * Human label for a view, e.g. "Alex only".
 * @param {string} filter
 * @param {{all?: string, together?: string, solo?: string, person?: string}} [labels]
 */
function filterLabel (filter, labels = {}) {
	const l = { all: "All", together: "Together", solo: "{name} only", person: "All of {name}'s", year: "{name}", month: "{name}", ...labels };
	if (filter === "all") return l.all;
	if (filter === "together") return l.together;
	if (filter.startsWith("month:")) {
		// English here; the screen swaps in the mirror's language.
		const name = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(filter.slice(6)) - 1] || filter;
		return l.month.replace("{name}", name);
	}
	const [kind, name] = [filter.slice(0, filter.indexOf(":")), filter.slice(filter.indexOf(":") + 1)];
	return (l[kind] || "{name}").replace("{name}", name);
}

module.exports = { currentMonth, isPlanned, expandFilters, matchesFilter, filterTrips, travelerGroup, filterLabel };
