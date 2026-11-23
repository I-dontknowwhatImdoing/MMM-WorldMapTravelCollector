"use strict";

const { XMLParser, XMLValidator } = require("fast-xml-parser");
const { normalizeName } = require("./text");

/** How far a saved place can be from a town and still count as being in it. */
const CITY_KM = 75;
/** Beyond CITY_KM, still guess the country from the nearest town this close. */
const COUNTRY_KM = 300;

/**
 * Turn coordinates into a city and country using the offline list.
 * @param {number} lat
 * @param {number} lon
 * @param {{geocoder: object}} geo
 * @param {string|null} [country] ISO code when the source already knows it
 * @returns {{city: string, country: string, lat: number, lon: number} | {city: "", country: string, far: true} | null}
 */
function placeFromCoords (lat, lon, geo, country = null) {
	const near = geo.geocoder.nearest(lat, lon, { maxKm: CITY_KM, country: country || undefined });
	if (near) return { city: near.name, country: near.country, lat: near.lat, lon: near.lon };
	const wide = geo.geocoder.nearest(lat, lon, { maxKm: COUNTRY_KM, country: country || undefined });
	if (wide || country) return { city: "", country: country || wide.country, far: true };
	return null;
}

/**
 * Best-effort city and country from a written address, e.g.
 * "Praça do Império, 1400-206 Lisboa, Portugal".
 * @param {string} address
 * @param {{countries: object, geocoder: object}} geo
 * @param {string|null} [countryHint]
 */
function placeFromAddress (address, geo, countryHint = null) {
	const parts = String(address || "").split(",").map((p) => p.trim()).filter(Boolean);
	if (!parts.length) return null;
	let country = countryHint ? geo.countries.resolve(countryHint) : null;
	if (!country) {
		country = geo.countries.resolve(parts[parts.length - 1]);
		if (country) parts.pop();
	} else if (geo.countries.resolve(parts[parts.length - 1]) === country) parts.pop();
	if (!country) return null;
	for (let i = parts.length - 1; i >= 0; i--) {
		const words = parts[i].split(/\s+/).filter((w) => !/\d/.test(w) && !/^[A-Z]{2,3}$/.test(w));
		for (let take = Math.min(3, words.length); take >= 1; take--) {
			const hit = geo.geocoder.lookup(words.slice(-take).join(" "), country);
			if (hit) return { city: hit.name, country, lat: hit.lat, lon: hit.lon };
		}
	}
	return { city: "", country };
}

/**
 * Pull coordinates out of a Google Maps link, when it has them.
 * Handles .../@38.69,-9.21,17z, !3d38.69!4d-9.21, ?q=38.69,-9.21 and /search/38.69,-9.21.
 * @param {string} url
 * @returns {{lat: number, lon: number}|null}
 */
function coordsFromMapsUrl (url) {
	const text = decodeSafe(String(url || ""));
	const patterns = [
		/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
		/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
		/[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
		/\/(?:search|place|dir)\/(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/
	];
	for (const re of patterns) {
		const m = text.match(re);
		if (m) {
			const lat = Number(m[1]);
			const lon = Number(m[2]);
			if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)) return { lat, lon };
		}
	}
	return null;
}

/** The place name inside a Google Maps link: /maps/place/Torre+de+Bel%C3%A9m/... */
function nameFromMapsUrl (url) {
	const m = decodeSafe(String(url || "")).match(/\/place\/([^/@?]+)/);
	return m ? m[1].replace(/\+/g, " ").trim() : "";
}

function decodeSafe (s) {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
}

/** Treat a saved place's title as a city when it is one, e.g. a pin saved as "Kyoto". */
function placeFromCityName (name, geo) {
	const key = normalizeName(name);
	if (!key) return null;
	const hit = geo.geocoder.autocomplete(name, undefined, 50).find((c) => normalizeName(c.name) === key);
	return hit ? { city: hit.name, country: hit.country, lat: hit.lat, lon: hit.lon } : null;
}

/**
 * Google Takeout "Saved" lists are CSV files with Title, Note, URL (and sometimes Tags, Comment).
 * @param {string[][]} rows parsed CSV, header first
 * @param {{countries: object, geocoder: object}} geo
 */
function placesFromSavedCsv (rows, geo) {
	const header = rows[0].map((h) => normalizeName(h));
	const col = (name) => header.indexOf(name);
	const iTitle = col("title");
	const iUrl = col("url");
	const iNote = col("note");
	const iComment = col("comment");
	return rows.slice(1).map((r) => {
		const title = (r[iTitle] || "").trim() || nameFromMapsUrl(r[iUrl]);
		const coords = coordsFromMapsUrl(r[iUrl]);
		const where = (coords && placeFromCoords(coords.lat, coords.lon, geo)) || placeFromCityName(title, geo) || placeFromCityName(nameFromMapsUrl(r[iUrl]), geo);
		return { name: title, note: [r[iNote], r[iComment]].filter((s) => s && s.trim()).join(" ").trim(), where };
	}).filter((p) => p.name || p.where);
}

/**
 * Google Takeout "Saved Places.json" (Maps → Your places): a GeoJSON FeatureCollection.
 * Places without real coordinates come as [0, 0]; their address is used instead.
 * @param {object} data
 * @param {{countries: object, geocoder: object}} geo
 */
function placesFromGeoJson (data, geo) {
	const features = Array.isArray(data.features) ? data.features : [];
	return features.map((f) => {
		const props = f.properties || {};
		const loc = props.location || props.Location || {};
		const name = loc.name || loc.business_name || props.Title || props.name || nameFromMapsUrl(props.google_maps_url) || "";
		const countryHint = loc.country_code || loc["Country Code"] || null;
		const country = countryHint ? geo.countries.resolve(countryHint) : null;
		const coords = f.geometry && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : [];
		const lon = Number(coords[0]);
		const lat = Number(coords[1]);
		let where = null;
		if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0)) where = placeFromCoords(lat, lon, geo, country);
		if (!where || !where.city) where = placeFromAddress(loc.address || loc.Address || props.address, geo, country) || where;
		if (!where) {
			const fromUrl = coordsFromMapsUrl(props.google_maps_url);
			if (fromUrl) where = placeFromCoords(fromUrl.lat, fromUrl.lon, geo, country);
		}
		if (!where && country) where = { city: "", country };
		return { name, note: props.Comment || props.comment || "", where };
	}).filter((p) => p.name || p.where);
}

/**
 * KML from Google My Maps or Google Earth. Every Placemark with a Point becomes a place;
 * lines and shapes use their first point.
 * @param {string} xml
 * @param {{countries: object, geocoder: object}} geo
 * @returns {{places: object[], skipped: number}}
 */
function placesFromKml (xml, geo) {
	const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true, processEntities: true, htmlEntities: true, parseTagValue: false, trimValues: true });
	const valid = XMLValidator.validate(xml);
	if (valid !== true) throw new Error(`This KML file couldn't be read (${valid.err.msg} on line ${valid.err.line})`);
	const doc = parser.parse(xml);
	const placemarks = [];
	(function walk (node) {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(walk);
		for (const [key, value] of Object.entries(node)) {
			if (key === "Placemark") [].concat(value).forEach((p) => placemarks.push(p));
			else walk(value);
		}
	})(doc);
	if (!placemarks.length && !/<kml/i.test(xml)) throw new Error("This doesn't look like a KML file");
	const places = [];
	let skipped = 0;
	for (const p of placemarks) {
		const point = firstCoordinate(p);
		const name = textOf(p.name);
		if (!point) {
			skipped++;
			continue;
		}
		const where = placeFromCoords(point.lat, point.lon, geo);
		if (!where) {
			skipped++;
			continue;
		}
		places.push({ name, note: stripHtml(textOf(p.description)).slice(0, 200), where });
	}
	return { places, skipped };
}

function textOf (v) {
	if (v === undefined || v === null) return "";
	if (typeof v === "object") return textOf(v["#text"] ?? "");
	return String(v).trim();
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/** Descriptions in My Maps are little HTML snippets: keep just the words. */
function stripHtml (s) {
	return s.replace(/<[^>]*>/g, " ")
		.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, e) => {
			if (e[0] === "#") {
				const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
				return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
			}
			return ENTITIES[e.toLowerCase()] ?? all;
		})
		.replace(/\s+/g, " ")
		.trim();
}

function firstCoordinate (placemark) {
	let found = null;
	(function walk (node) {
		if (found || !node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(walk);
		for (const [key, value] of Object.entries(node)) {
			if (found) return;
			if (key === "coordinates" || key === "coord") {
				const first = textOf([].concat(value)[0]).split(/\s+/)[0] || "";
				const nums = first.split(/[,\s]+/).map(Number);
				if (nums.length >= 2 && nums.every(Number.isFinite) && Math.abs(nums[1]) <= 90 && Math.abs(nums[0]) <= 180) found = { lon: nums[0], lat: nums[1] };
			} else walk(value);
		}
	})(placemark);
	return found;
}

/**
 * Group saved places into one draft trip per city (or per country when no town is near).
 * Dates and travelers are left blank for the review step.
 * @param {Array<{name: string, note: string, where: object|null}>} places
 * @returns {object[]} drafts
 */
function draftsFromPlaces (places) {
	const groups = new Map();
	const unplaced = [];
	for (const p of places) {
		if (!p.where || !p.where.country) {
			unplaced.push(p);
			continue;
		}
		const key = `${normalizeName(p.where.city)}|${p.where.country}`;
		if (!groups.has(key)) groups.set(key, { where: p.where, names: [], notes: [] });
		const g = groups.get(key);
		if (p.name && !g.names.includes(p.name) && normalizeName(p.name) !== normalizeName(p.where.city)) g.names.push(p.name);
		if (p.note) g.notes.push(p.note);
	}
	const drafts = [...groups.values()].map((g) => ({
		city: g.where.city,
		country: g.where.country,
		date: "",
		days: "",
		travelers: [],
		lat: "",
		lon: "",
		note: summarizeNames(g.names),
		places: g.names.length,
		hint: g.where.far ? "No town nearby, so this is a country-level visit" : ""
	}));
	drafts.sort((a, b) => a.country.localeCompare(b.country) || a.city.localeCompare(b.city));
	for (const p of unplaced) {
		drafts.push({ city: "", country: "", date: "", days: "", travelers: [], lat: "", lon: "", note: p.name, places: 1, include: false, hint: "Couldn't tell where this is. Tick it and fill in the city and country to keep it" });
	}
	return drafts;
}

function summarizeNames (names) {
	if (!names.length) return "";
	const shown = names.slice(0, 3).join(", ");
	return names.length > 3 ? `${shown} +${names.length - 3} more` : shown;
}

module.exports = {
	placeFromCoords,
	placeFromAddress,
	coordsFromMapsUrl,
	nameFromMapsUrl,
	placesFromSavedCsv,
	placesFromGeoJson,
	placesFromKml,
	draftsFromPlaces
};
