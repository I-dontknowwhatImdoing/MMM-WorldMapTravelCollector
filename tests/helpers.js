"use strict";

const { loadGeoData } = require("../lib/geodata");

const NAMES = ["Alex", "Sam"];
const NOW = new Date(2026, 10, 23); // 23 Nov 2026, local time

function ctx (names = NAMES) {
	const geo = loadGeoData();
	return { travelerNames: names, countries: geo.countries, geocoder: geo.geocoder };
}

/** Build a clean trip quickly for logic tests. */
function trip (overrides = {}) {
	return {
		id: overrides.id || `t_${Math.random().toString(16).slice(2, 10)}`,
		city: "Lisbon",
		country: "PT",
		date: "2025-03",
		days: null,
		travelers: ["Alex", "Sam"],
		lat: 38.7167,
		lon: -9.1333,
		note: "",
		...overrides
	};
}

module.exports = { NAMES, NOW, ctx, trip };
