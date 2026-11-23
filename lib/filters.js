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
 * With a single traveler, "together" and that person's views all equal "all", so they are dropped.
 * @param {string[]} filters e.g. ["all", "together", "solo"]
 * @param {string[]} names configured traveler names
 * @returns {string[]}
 */
function expandFilters (filters, names) {
	const out = [];
	const add = (f) => {
		if (!out.includes(f)) out.push(f);
	};
	for (const f of filters || []) {
		if (f === "all") add("all");
		else if (f === "together") {
			if (names.length > 1) add("together");
		} else if (f === "solo" || f === "person") {
			if (names.length > 1) names.forEach((n) => add(`${f}:${n}`));
		} else if (/^(solo|person):/.test(f)) {
			const name = f.slice(f.indexOf(":") + 1);
			if (names.includes(name) && names.length > 1) add(f);
		}
	}
	if (!out.length) out.push("all");
	return out;
}

/**
 * Does a trip belong in a view?
 * @param {{travelers: string[]}} trip
 * @param {string} filter "all" | "together" | "solo:<name>" | "person:<name>"
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
	const l = { all: "All", together: "Together", solo: "{name} only", person: "All of {name}'s", ...labels };
	if (filter === "all") return l.all;
	if (filter === "together") return l.together;
	const [kind, name] = [filter.slice(0, filter.indexOf(":")), filter.slice(filter.indexOf(":") + 1)];
	return (l[kind] || "{name}").replace("{name}", name);
}

module.exports = { currentMonth, isPlanned, expandFilters, matchesFilter, filterTrips, travelerGroup, filterLabel };
