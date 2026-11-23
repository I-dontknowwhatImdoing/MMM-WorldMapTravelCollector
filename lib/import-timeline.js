"use strict";

const { haversineKm } = require("./stats");
const { placeFromCoords } = require("./import-places");
const { normalizeName } = require("./text");

const HOME_TYPES = new Set(["home", "inferredhome", "inferred home", "work", "inferredwork", "inferred work"]);
const HOUR = 3600 * 1000;
/** Visits shorter than this in total (per city and month) are dropped as noise. */
const MIN_MINUTES = 30;
/** Candidates under this many hours start unticked: often a layover or a drive-through. */
const SHORT_HOURS = 2;

/**
 * Read "38.7223°, -9.1393°", "geo:38.7223,-9.1393" or E7 integers.
 * @returns {{lat: number, lon: number}|null}
 */
function parseLatLng (value) {
	if (!value) return null;
	if (typeof value === "object") {
		if (value.latLng) return parseLatLng(value.latLng);
		if (value.latitudeE7 !== undefined) return valid(Number(value.latitudeE7) / 1e7, Number(value.longitudeE7) / 1e7);
		if (value.lat !== undefined) return valid(Number(value.lat), Number(value.lng ?? value.lon));
		return null;
	}
	const m = String(value).replace(/^geo:/, "").match(/(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)°?/);
	return m ? valid(Number(m[1]), Number(m[2])) : null;
}

function valid (lat, lon) {
	return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? { lat, lon } : null;
}

/**
 * A point in time plus the local calendar date it fell on. Timeline strings carry their own
 * UTC offset ("2024-03-01T10:00:00.000+01:00"), so the date part is already local.
 * Millisecond timestamps (old exports) are read as UTC.
 */
function parseTime (value, offsetMinutes) {
	if (value === undefined || value === null || value === "") return null;
	if (/^\d{11,}$/.test(String(value))) value = Number(value);
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	let day;
	if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && !/Z$/i.test(value)) day = value.slice(0, 10);
	else if (Number.isFinite(Number(offsetMinutes))) day = new Date(date.getTime() + Number(offsetMinutes) * 60000).toISOString().slice(0, 10);
	else day = date.toISOString().slice(0, 10);
	return { ms: date.getTime(), day };
}

function visitFrom (lat, lon, start, end, type, name) {
	const pos = parseLatLng(lat !== undefined && lon !== undefined ? { lat, lng: lon } : null);
	return pos && start && end && end.ms >= start.ms ? { ...pos, start, end, type: normalizeName(type || ""), name: name || "" } : null;
}

/**
 * Collect visits from any Google Timeline format:
 *  - phone export "Timeline.json" ({semanticSegments: [...]}), Android and newer iPhone
 *  - older iPhone export (a plain list of segments with "geo:" places)
 *  - Takeout "Semantic Location History/2019/2019_JANUARY.json" ({timelineObjects: [...]})
 * @param {unknown} data parsed JSON
 * @returns {{visits: object[], format: string|null}}
 */
function visitsFromTimeline (data) {
	if (data && Array.isArray(data.timelineObjects)) {
		const visits = [];
		for (const obj of data.timelineObjects) {
			const pv = obj && obj.placeVisit;
			if (!pv || !pv.location) continue;
			const d = pv.duration || {};
			const pos = parseLatLng(pv.location) || parseLatLng(pv.centerLatE7 !== undefined ? { latitudeE7: pv.centerLatE7, longitudeE7: pv.centerLngE7 } : null);
			if (!pos) continue;
			const v = visitFrom(pos.lat, pos.lon, parseTime(d.startTimestamp ?? d.startTimestampMs), parseTime(d.endTimestamp ?? d.endTimestampMs), pv.location.semanticType, pv.location.name);
			if (v) visits.push(v);
		}
		return { visits, format: "takeout" };
	}
	const isSegment = (s) => s && typeof s === "object" && "startTime" in s && ("visit" in s || "activity" in s || "timelinePath" in s);
	const segments = Array.isArray(data) ? (data.some(isSegment) ? data : null) : data && Array.isArray(data.semanticSegments) ? data.semanticSegments : null;
	if (!segments) return { visits: [], format: null };
	const visits = [];
	for (const seg of segments) {
		const visit = seg && seg.visit;
		if (!visit || !visit.topCandidate) continue;
		if (Number(visit.hierarchyLevel || 0) > 0) continue; // a place inside another visit: its time is already counted
		const top = visit.topCandidate;
		const pos = parseLatLng(top.placeLocation);
		if (!pos) continue;
		const offset = seg.startTimeTimezoneUtcOffsetMinutes;
		const v = visitFrom(pos.lat, pos.lon, parseTime(seg.startTime, offset), parseTime(seg.endTime, seg.endTimeTimezoneUtcOffsetMinutes ?? offset), top.semanticType, "");
		if (v) visits.push(v);
	}
	return { visits, format: Array.isArray(data) ? "phone-ios" : "phone" };
}

/** Every calendar date from a to b inclusive ("YYYY-MM-DD"). Capped to keep bad data cheap. */
function daysBetween (a, b) {
	const out = [];
	const d = new Date(`${a}T12:00:00Z`);
	const end = new Date(`${b}T12:00:00Z`);
	while (d <= end && out.length < 400) {
		out.push(d.toISOString().slice(0, 10));
		d.setUTCDate(d.getUTCDate() + 1);
	}
	return out;
}

/**
 * Turn visits into one draft trip per city and month, leaving out time at home.
 *
 * @param {object[]} visits from visitsFromTimeline
 * @param {object} opts
 * @param {{countries: object, geocoder: object}} opts.geo
 * @param {{lat: number, lon: number}|null} [opts.home] from the config; guessed from the data when missing
 * @param {number} [opts.homeRadiusKm] visits this close to home are left out (default 50)
 * @returns {{drafts: object[], home: object|null, homeGuessed: boolean, ignoredAtHome: number}}
 */
function draftsFromVisits (visits, opts) {
	const { geo } = opts;
	const radius = Number.isFinite(Number(opts.homeRadiusKm)) && Number(opts.homeRadiusKm) >= 0 ? Number(opts.homeRadiusKm) : 50;
	const cache = new Map();
	const placeOf = (v) => {
		const key = `${v.lat.toFixed(2)}|${v.lon.toFixed(2)}`;
		if (!cache.has(key)) cache.set(key, placeFromCoords(v.lat, v.lon, geo));
		return cache.get(key);
	};

	let home = opts.home && Number.isFinite(opts.home.lat) ? { lat: opts.home.lat, lon: opts.home.lon, name: opts.home.name || "" } : null;
	let homeGuessed = false;
	if (!home) {
		// The place with the most hours overall is almost always home.
		const hours = new Map();
		for (const v of visits) {
			const p = placeOf(v);
			if (!p || !p.city) continue;
			const key = `${p.city}|${p.country}`;
			const entry = hours.get(key) || { p, ms: 0 };
			entry.ms += v.end.ms - v.start.ms;
			hours.set(key, entry);
		}
		const top = [...hours.values()].sort((a, b) => b.ms - a.ms)[0];
		if (top) {
			home = { lat: top.p.lat, lon: top.p.lon, name: top.p.city };
			homeGuessed = true;
		}
	}

	const groups = new Map();
	let ignoredAtHome = 0;
	for (const v of visits) {
		if (HOME_TYPES.has(v.type) || (home && haversineKm(home, v) <= radius)) {
			ignoredAtHome++;
			continue;
		}
		const p = placeOf(v);
		if (!p) continue;
		const month = v.start.day.slice(0, 7);
		const key = `${normalizeName(p.city)}|${p.country}|${month}`;
		if (!groups.has(key)) groups.set(key, { p, month, ms: 0, days: new Set() });
		const g = groups.get(key);
		g.ms += v.end.ms - v.start.ms;
		for (const day of daysBetween(v.start.day, v.end.day)) g.days.add(day);
	}

	const drafts = [];
	for (const g of groups.values()) {
		if (g.ms < MIN_MINUTES * 60000) continue;
		const hours = Math.round(g.ms / HOUR * 10) / 10;
		const short = hours < SHORT_HOURS;
		drafts.push({
			city: g.p.city,
			country: g.p.country,
			date: g.month,
			days: String(g.days.size),
			travelers: [],
			lat: "",
			lon: "",
			note: "",
			hours,
			include: !short,
			hint: short ? `Short stop (${hours < 1 ? `${Math.round(g.ms / 60000)} min` : `${hours} h`}), maybe a layover. Tick it to keep` : g.p.far ? "No town nearby, so this is a country-level visit" : ""
		});
	}
	drafts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.city.localeCompare(b.city)));
	return { drafts, home, homeGuessed, ignoredAtHome };
}

module.exports = { parseLatLng, parseTime, visitsFromTimeline, draftsFromVisits, daysBetween };
