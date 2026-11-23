"use strict";

const crypto = require("node:crypto");
const { normalizeName } = require("./text");

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const EVERYONE_WORDS = new Set(["all", "both", "everyone", "together", "us"]);

/**
 * Turn the many ways people write a month into "YYYY-MM".
 * Accepts 2025-03, 2025-3, 2025/03, 2025-03-14, 2025-03-14T10:00Z, 03/2025, 3-2025,
 * March 2025, Mar 2025, 14 March 2025, and Date objects. Returns null if unreadable.
 * @param {unknown} input
 * @returns {string|null}
 */
function normalizeDate (input) {
	if (input instanceof Date) {
		if (Number.isNaN(input.getTime())) return null;
		return format(input.getUTCFullYear(), input.getUTCMonth() + 1);
	}
	if (input === undefined || input === null) return null;
	const text = String(input).trim().toLowerCase();
	if (!text) return null;

	let m = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2}(?:[t\s].*)?)?$/);
	if (m) return format(+m[1], +m[2]);

	m = text.match(/^(\d{1,2})[-/.](\d{4})$/);
	if (m) return format(+m[2], +m[1]);

	m = text.match(/^(?:\d{1,2}(?:st|nd|rd|th)?\s+)?([a-z]+)\.?,?\s+(\d{4})$/);
	if (m) {
		const word = m[1];
		const month = word.length >= 3 ? MONTHS.findIndex((full) => full.startsWith(word)) : -1;
		if (month >= 0) return format(+m[2], month + 1);
	}
	// A full date in any form normalizeDay reads ("March 14, 2025", "15/03/2024") gives its month.
	const day = normalizeDay(input);
	return day ? day.slice(0, 7) : null;
}

/**
 * Read an exact day: 2025-03-14, 2025/3/14, 2025-03-14T10:00Z, 14 March 2025, March 14, 2025,
 * 14th Mar 2025, or a Date. Returns "YYYY-MM-DD", or null when there's no (valid) day in it.
 * (03/04/2025 is left alone: it means different days in different countries.)
 * @param {unknown} input
 * @returns {string|null}
 */
function normalizeDay (input) {
	if (input instanceof Date) {
		if (Number.isNaN(input.getTime())) return null;
		return formatDay(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate());
	}
	if (input === undefined || input === null) return null;
	const text = String(input).trim().toLowerCase();
	let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[t\s].*)?$/);
	if (m) return formatDay(+m[1], +m[2], +m[3]);
	m = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/);
	if (m) return formatDay(+m[3], monthFromWord(m[2]), +m[1]);
	m = text.match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
	if (m) return formatDay(+m[3], monthFromWord(m[1]), +m[2]);
	// 15/03/2024 (day first) or 03/15/2024 (month first), only when the numbers allow one reading.
	m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
	if (m) {
		const [a, b, y] = [+m[1], +m[2], +m[3]];
		if (a > 12 && b <= 12) return formatDay(y, b, a);
		if (b > 12 && a <= 12) return formatDay(y, a, b);
		if (a === b) return formatDay(y, a, a);
	}
	return null;
}

const MONTH_NAMES = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));

/**
 * Why a date that looks like a date can't be used, in plain words, or null.
 * "03/04/2025" → "could be 3 April or 4 March"; "2024-02-31" → "February 2024 has no 31st".
 */
function dateTrouble (input) {
	const text = String(input || "").trim();
	let m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
	if (m && +m[1] <= 12 && +m[2] <= 12 && +m[1] !== +m[2] && +m[1] > 0 && +m[2] > 0) {
		const [a, b, y] = [+m[1], +m[2], m[3]];
		const iso = (mo, d) => `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
		return `'${text}' could be ${a} ${MONTH_NAMES[b - 1]} or ${b} ${MONTH_NAMES[a - 1]}. Write it as ${iso(b, a)} or ${iso(a, b)}`;
	}
	m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/) || null;
	const parts = m ? [+m[1], +m[2], +m[3]] : null;
	if (!parts) {
		const w = text.toLowerCase().match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$/) || text.toLowerCase().match(/^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
		if (w) {
			const dayFirst = /^\d/.test(w[1]);
			const month = monthFromWord(dayFirst ? w[2] : w[1]);
			if (month) return dateTrouble(`${w[3]}-${month}-${dayFirst ? w[1] : w[2]}`);
		}
		return null;
	}
	const [y, mo, d] = parts;
	if (mo < 1 || mo > 12 || d < 1) return null;
	const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
	if (d > last) return `${MONTH_NAMES[mo - 1]} ${y} has no ${d}${d === 31 ? "st" : "th"}`;
	return null;
}

function monthFromWord (word) {
	return word.length >= 3 ? MONTHS.findIndex((full) => full.startsWith(word)) + 1 : 0;
}

function formatDay (year, month, day) {
	const ym = format(year, month);
	if (!ym || !Number.isInteger(day) || day < 1) return null;
	const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return day <= last ? `${ym}-${String(day).padStart(2, "0")}` : null;
}

/**
 * The last day of a trip: its start plus its days, counting the start as day one.
 * @param {string|null} start "YYYY-MM-DD"
 * @param {number|null} days
 * @returns {string|null}
 */
function endDay (start, days) {
	if (!start) return null;
	const d = new Date(`${start}T12:00:00Z`);
	d.setUTCDate(d.getUTCDate() + Math.max(1, Number(days) || 1) - 1);
	return d.toISOString().slice(0, 10);
}

function format (year, month) {
	if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
	if (!Number.isInteger(month) || month < 1 || month > 12) return null;
	return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Split "Alex; Sam", "Alex & Sam", ["alex","SAM"] or "both" into the configured names.
 * @param {unknown} input
 * @param {string[]} names configured traveler names
 * @returns {{travelers: string[], unknown: string[]}}
 */
function normalizeTravelers (input, names) {
	let parts;
	if (Array.isArray(input)) parts = input.map(String);
	else if (input === undefined || input === null) parts = [];
	else parts = String(input).split(/\s*(?:[;,|+/&]|\band\b)\s*/i);
	parts = parts.map((p) => p.trim()).filter(Boolean);

	const byKey = new Map(names.map((n) => [normalizeName(n), n]));
	const found = new Set();
	const unknown = [];
	for (const part of parts) {
		const key = normalizeName(part);
		if (byKey.has(key)) found.add(byKey.get(key));
		else if (EVERYONE_WORDS.has(key)) names.forEach((n) => found.add(n));
		else unknown.push(part);
	}
	// Keep the order the travelers are listed in the config.
	return { travelers: names.filter((n) => found.has(n)), unknown };
}

/**
 * Stable id from a trip's content, so read-only sources (Google Sheet) keep the same ids between reloads.
 * @param {{city?: string, country: string, date: string, travelers: string[]}} trip
 * @param {number} [occurrence] how many identical rows came before this one
 */
function tripId (trip, occurrence = 0) {
	const key = [normalizeName(trip.city || ""), trip.country, trip.date, trip.travelers.join("+"), occurrence].join("|");
	return "t_" + crypto.createHash("sha1").update(key).digest("hex").slice(0, 10);
}

function blank (value) {
	return value === undefined || value === null || String(value).trim() === "";
}

/**
 * Check and clean one raw trip row.
 *
 * @param {Record<string, unknown>} raw row from a file, sheet, import or the editor
 * @param {object} ctx
 * @param {string[]} ctx.travelerNames configured traveler names
 * @param {{resolve(input: string): string|null}} ctx.countries
 * @param {{lookup(city: string, country: string): object|null, suggest(city: string, country: string): string[]}} ctx.geocoder
 * @returns {{ok: true, trip: object, warnings: string[]} | {ok: false, errors: string[]}}
 */
function validateTrip (raw, ctx) {
	const errors = [];
	const warnings = [];
	const row = raw || {};

	const city = blank(row.city) ? "" : String(row.city).trim();

	let country = null;
	if (blank(row.country)) errors.push("Country is missing");
	else {
		country = ctx.countries.resolve(String(row.country));
		if (!country) errors.push(`Unknown country '${String(row.country).trim()}'`);
	}

	// The start day is optional. A full date in the date column counts as one too.
	let start = null;
	if (!blank(row.start)) {
		start = normalizeDay(row.start);
		if (!start) errors.push(dateTrouble(row.start) || `Can't read the start date '${String(row.start).trim()}'. Use year, month and day like 2025-03-14`);
	}
	let date = null;
	if (blank(row.date)) {
		if (start) date = start.slice(0, 7);
		else if (blank(row.start)) errors.push("Date is missing");
	} else {
		date = normalizeDate(row.date);
		if (!date) errors.push(dateTrouble(row.date) || `Can't read the date '${String(row.date).trim()}'. Use a year and month like 2025-03`);
		else if (!start && blank(row.start)) start = normalizeDay(row.date);
		else if (start && start.slice(0, 7) !== date) errors.push(`The start date ${start} isn't in the trip's month (${date})`);
	}

	let days = null;
	if (!blank(row.days)) {
		const n = Number(row.days);
		if (!Number.isInteger(n) || n < 1 || n > 3650) errors.push(`Days must be a whole number of 1 or more (got '${row.days}')`);
		else days = n;
	}

	const { travelers, unknown } = normalizeTravelers(row.travelers, ctx.travelerNames);
	if (unknown.length) errors.push(`Unknown traveler${unknown.length > 1 ? "s" : ""} '${unknown.join("', '")}'. Add them to the travelers list in your config`);
	else if (!travelers.length) errors.push("No travelers listed");

	let lat = null;
	let lon = null;
	const hasLat = !blank(row.lat);
	const hasLon = !blank(row.lon);
	if (hasLat || hasLon) {
		lat = Number(row.lat);
		lon = Number(row.lon);
		if (!hasLat || !hasLon) errors.push("Give both latitude and longitude, or neither");
		else if (!Number.isFinite(lat) || lat < -90 || lat > 90) errors.push(`Latitude must be between -90 and 90 (got '${row.lat}')`);
		else if (!Number.isFinite(lon) || lon < -180 || lon > 180) errors.push(`Longitude must be between -180 and 180 (got '${row.lon}')`);
	}

	let cityName = city;
	if (city && country && !(hasLat && hasLon && !errors.length)) {
		const hit = ctx.geocoder.lookup(city, country);
		if (hit) {
			cityName = hit.name;
			if (!hasLat) {
				lat = hit.lat;
				lon = hit.lon;
			}
		} else if (!hasLat) {
			const ideas = ctx.geocoder.suggest(city, country);
			const where = ctx.countries.name ? ctx.countries.name(country) : String(row.country).trim();
			errors.push(`Unknown city '${city}' in ${where}` + (ideas.length ? `. Did you mean ${ideas.join(", ")}?` : ". Check the spelling or add its latitude and longitude"));
		}
	}

	if (errors.length) return { ok: false, errors };

	if (!city) {
		lat = hasLat ? lat : null;
		lon = hasLon ? lon : null;
	}

	const trip = {
		id: blank(row.id) ? null : String(row.id).trim(),
		city: cityName,
		country,
		date,
		start,
		days,
		travelers,
		lat,
		lon,
		note: blank(row.note) ? "" : String(row.note).trim()
	};
	return { ok: true, trip, warnings };
}

/**
 * Validate a whole list. Bad rows are reported, never thrown.
 * @param {Array<Record<string, unknown>>} rows
 * @param {Parameters<typeof validateTrip>[1]} ctx
 * @param {{source?: string, firstRowNumber?: number}} [opts]
 */
function validateTrips (rows, ctx, opts = {}) {
	const source = opts.source || "data";
	const first = opts.firstRowNumber === undefined ? 1 : opts.firstRowNumber;
	const trips = [];
	const problems = [];
	const occurrences = new Map();
	const seen = new Set();
	rows.forEach((row, i) => {
		const result = validateTrip(row, ctx);
		if (!result.ok) {
			problems.push({ source, row: i + first, errors: result.errors });
			return;
		}
		const trip = result.trip;
		if (!trip.id) {
			const base = tripId(trip);
			const n = occurrences.get(base) || 0;
			occurrences.set(base, n + 1);
			trip.id = n === 0 ? base : tripId(trip, n);
		}
		// A copied row keeps its id in a hand-edited file: give the copy its own (the editor does the same).
		for (let n = 1; seen.has(trip.id); n++) trip.id = `${String(row.id).trim()}_${n}`;
		seen.add(trip.id);
		trips.push(trip);
	});
	return { trips, problems };
}

/**
 * The trip as it should be written to trips.json: only the fields that carry information.
 * Coordinates are kept only when they differ from what the city lookup gives, i.e. when someone
 * set them on purpose. Otherwise renaming the city later would leave the pin in the old place.
 * @param {object} trip a validated trip
 * @param {{lookup(city: string, country: string): object|null}} geocoder
 */
function storedTrip (trip, geocoder) {
	const out = { id: trip.id, city: trip.city || "", country: trip.country, date: trip.date };
	if (trip.start) out.start = trip.start;
	if (trip.days) out.days = trip.days;
	out.travelers = [...trip.travelers];
	if (Number.isFinite(trip.lat) && Number.isFinite(trip.lon)) {
		const hit = trip.city ? geocoder.lookup(trip.city, trip.country) : null;
		const same = hit && Math.abs(hit.lat - trip.lat) < 1e-4 && Math.abs(hit.lon - trip.lon) < 1e-4;
		if (!same) {
			out.lat = trip.lat;
			out.lon = trip.lon;
		}
	}
	if (trip.note) out.note = trip.note;
	return out;
}

module.exports = { normalizeDate, normalizeDay, dateTrouble, endDay, normalizeTravelers, tripId, validateTrip, validateTrips, storedTrip };
