"use strict";

const { normalizeName } = require("./text");

/**
 * Key for "the same visit": same city (or the same country-only visit), country and month.
 * @param {{city: string, country: string, date: string}} trip
 */
function visitKey (trip) {
	return `${normalizeName(trip.city)}|${trip.country}|${trip.date}`;
}

/**
 * Combine trips from several sources. Duplicate visits are merged into one, and their travelers
 * are combined — so two people's separate imports of the same trip become one "together" trip.
 *
 * @param {Array<Array<object>>} lists trips per source, in priority order (earlier sources win ties)
 * @param {string[]} travelerNames configured names, used to keep travelers in config order
 * @returns {{trips: object[], merged: number}}
 */
function mergeTrips (lists, travelerNames = []) {
	const byKey = new Map();
	let merged = 0;
	const order = (names) => {
		const known = travelerNames.filter((n) => names.has(n));
		const extra = [...names].filter((n) => !travelerNames.includes(n));
		return [...known, ...extra];
	};
	for (const list of lists) {
		for (const trip of list) {
			const key = visitKey(trip);
			const existing = byKey.get(key);
			if (!existing) {
				byKey.set(key, { ...trip, travelers: [...trip.travelers] });
				continue;
			}
			merged++;
			existing.travelers = order(new Set([...existing.travelers, ...trip.travelers]));
			if (existing.days === null || existing.days === undefined) existing.days = trip.days ?? null;
			else if (trip.days) existing.days = Math.max(existing.days, trip.days);
			if (!existing.note && trip.note) existing.note = trip.note;
			if ((existing.lat === null || existing.lat === undefined) && trip.lat !== null && trip.lat !== undefined) {
				existing.lat = trip.lat;
				existing.lon = trip.lon;
			}
		}
	}
	return { trips: [...byKey.values()], merged };
}

module.exports = { mergeTrips, visitKey };
