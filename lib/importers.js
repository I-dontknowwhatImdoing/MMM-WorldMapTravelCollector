"use strict";

const path = require("node:path");
const { parseCSV, rowsToRecords } = require("./csv");
const { normalizeDate, normalizeTravelers } = require("./schema");
const { normalizeName } = require("./text");
const { isZip, readZip } = require("./zip");
const { placesFromSavedCsv, placesFromGeoJson, placesFromKml, draftsFromPlaces } = require("./import-places");
const { visitsFromTimeline, draftsFromVisits } = require("./import-timeline");

const KINDS = {
	trips: "Trips file",
	timeline: "Google Maps Timeline",
	places: "Saved places"
};
/** Lists people keep for places they haven't been yet. */
const WISHLIST = /want to go|wish ?list|to visit|bucket|someday|ideas/i;

function text (buf) {
	return buf.toString("utf8").replace(/^\uFEFF/, "");
}

/**
 * Work out what one file is and read it.
 * @returns {{kind: string, ...}|{kind: "skip", warning: string}}
 */
function readOne (name, buf, geo) {
	const ext = path.extname(name).toLowerCase();
	const base = path.basename(name);
	if (ext === ".kmz" || (isZip(buf) && ext !== ".zip")) {
		const kml = readZip(buf).filter((e) => e.name.toLowerCase().endsWith(".kml"));
		if (!kml.length) return { kind: "skip", warning: `${base} has no map inside` };
		const out = { kind: "places", places: [], skipped: 0 };
		for (const e of kml) {
			const r = placesFromKml(text(e.read()), geo);
			out.places.push(...r.places.map((p) => ({ ...p, list: path.basename(base, ext) })));
			out.skipped += r.skipped;
		}
		return out;
	}
	if (ext === ".kml" || /^\s*(<\?xml[^>]*>\s*)?<kml[\s>]/i.test(text(buf.subarray(0, 512)))) {
		const r = placesFromKml(text(buf), geo);
		return { kind: "places", places: r.places.map((p) => ({ ...p, list: path.basename(base, ext) })), skipped: r.skipped };
	}
	const body = text(buf);
	const trimmed = body.trim();
	if (ext === ".json" || ext === ".geojson" || /^[[{]/.test(trimmed)) {
		let data;
		try {
			data = JSON.parse(trimmed);
		} catch {
			if (ext === ".json" || ext === ".geojson") return { kind: "skip", warning: `${base} isn't valid JSON` };
			data = undefined;
		}
		if (data !== undefined) return readJson(base, data, geo);
	}
	const rows = parseCSV(body);
	if (!rows.length) return { kind: "skip", warning: `${base} is empty` };
	const header = rows[0].map((h) => normalizeName(h));
	if (header.includes("title") && header.includes("url") && !header.includes("country")) {
		return { kind: "places", places: placesFromSavedCsv(rows, geo).map((p) => ({ ...p, list: path.basename(base, ext) })), skipped: 0 };
	}
	return { kind: "trips", rows };
}

function readJson (base, data, geo) {
	if (data && data.type === "FeatureCollection") {
		return { kind: "places", places: placesFromGeoJson(data, geo).map((p) => ({ ...p, list: path.basename(base, path.extname(base)) })), skipped: 0 };
	}
	if (data && Array.isArray(data.locations) && !data.semanticSegments) {
		return { kind: "skip", warning: `${base} is raw location points, which this module doesn't read. Use the Timeline export from your phone, or the "Semantic Location History" folder` };
	}
	const timeline = visitsFromTimeline(data);
	if (timeline.format) return { kind: "timeline", visits: timeline.visits };
	const records = Array.isArray(data) ? data : data && Array.isArray(data.trips) ? data.trips : null;
	if (records && records.every((r) => r && typeof r === "object" && !Array.isArray(r))) return { kind: "trips", records };
	return { kind: "skip", warning: `${base} isn't a file this module knows` };
}

/** Files inside a Google Takeout zip that are worth reading. */
function takeoutEntries (entries) {
	return entries.filter((e) => {
		const n = e.name.replace(/\\/g, "/");
		const lower = n.toLowerCase();
		if (/(^|\/)records\.json$/i.test(n)) return true; // so we can explain why it's skipped
		if (/semantic location history\/.+\.json$/i.test(n)) return true;
		if (/(^|\/)timeline\.json$/i.test(n) || /location-history\.json$/i.test(n)) return true;
		if (/saved places\.json$/i.test(n)) return true;
		if (/(^|\/)saved\/[^/]+\.csv$/i.test(n)) return true;
		return lower.endsWith(".kml") || lower.endsWith(".kmz") || (lower.endsWith(".csv") && !lower.includes("/"));
	});
}

/** Drafts from a trips CSV or JSON, with travelers turned into checkboxes. */
function draftsFromRecords (records, travelerNames, geo) {
	return records.map((rec) => {
		const { travelers, unknown } = normalizeTravelers(rec.travelers, travelerNames);
		const date = normalizeDate(rec.date);
		const country = rec.country ? geo.countries.resolve(String(rec.country)) : null;
		return {
			city: str(rec.city),
			country: country || str(rec.country),
			date: date || str(rec.date),
			days: str(rec.days),
			travelers,
			lat: str(rec.lat),
			lon: str(rec.lon),
			note: str(rec.note),
			hint: unknown.length ? `Not in your travelers list: ${unknown.join(", ")}` : ""
		};
	});
}

function str (v) {
	return v === undefined || v === null ? "" : String(v).trim();
}

/**
 * Read uploaded files and turn them into draft trips for the review screen.
 *
 * @param {Array<{name: string, data: Buffer}>} files
 * @param {object} opts
 * @param {{countries: object, geocoder: object}} opts.geo
 * @param {string[]} opts.travelerNames
 * @param {{lat: number, lon: number}|null} [opts.home]
 * @param {number} [opts.homeRadiusKm]
 * @param {Record<string, string>} [opts.mapping] CSV header -> trip field, chosen by the person
 * @param {string} [opts.want] which kind to show when several were found
 */
function parseUpload (files, opts) {
	const { geo } = opts;
	if (!files.length) throw new Error("No file was received");
	const found = { trips: { rows: [], records: [] }, timeline: { visits: [] }, places: { places: [], skipped: 0 } };
	const present = new Set();
	const warnings = [];

	const take = (name, data) => {
		let r;
		try {
			r = readOne(name, data, geo);
		} catch (err) {
			warnings.push(`${path.basename(name)}: ${err.message}`);
			return;
		}
		if (r.kind === "skip") return warnings.push(r.warning);
		present.add(r.kind);
		if (r.kind === "timeline") found.timeline.visits.push(...r.visits);
		else if (r.kind === "places") {
			found.places.places.push(...r.places);
			found.places.skipped += r.skipped;
		} else if (r.rows) {
			// Several CSVs: keep the first header, add the others' data rows.
			found.trips.rows.push(...(found.trips.rows.length ? r.rows.slice(1) : r.rows));
		} else found.trips.records.push(...r.records);
	};

	for (const f of files) {
		if (isZip(f.data) && path.extname(f.name).toLowerCase() === ".zip") {
			const entries = takeoutEntries(readZip(f.data));
			if (!entries.length) warnings.push(`${f.name} has no Google Maps or trip files inside`);
			for (const e of entries) take(e.name, e.read());
		} else take(f.name, f.data);
	}

	const order = ["trips", "timeline", "places"].filter((k) => present.has(k));
	if (!order.length) throw new Error(warnings[0] || "Nothing to import was found in that file");
	const kind = order.includes(opts.want) ? opts.want : present.has("timeline") ? "timeline" : order[0];
	const result = { kind, label: KINDS[kind], alsoFound: order.filter((k) => k !== kind), warnings, drafts: [] };

	if (kind === "trips") {
		let records = found.trips.records;
		if (found.trips.rows.length) {
			const r = rowsToRecords(found.trips.rows, opts.mapping || {});
			const header = found.trips.rows[0];
			result.csv = {
				headers: header,
				mapping: Object.fromEntries(header.map((h) => {
					const chosen = opts.mapping && Object.prototype.hasOwnProperty.call(opts.mapping, h) ? opts.mapping[h] : undefined;
					return [h, chosen !== undefined ? chosen || null : guessField(h)];
				})),
				missing: r.missingFields
			};
			records = records.concat(r.records);
		}
		result.drafts = draftsFromRecords(records, opts.travelerNames, geo);
	} else if (kind === "timeline") {
		const t = draftsFromVisits(found.timeline.visits, opts);
		result.drafts = t.drafts;
		result.visits = found.timeline.visits.length;
		result.ignoredAtHome = t.ignoredAtHome;
		result.home = t.home ? { name: t.home.name || "", guessed: t.homeGuessed } : null;
		if (!found.timeline.visits.length) warnings.push("The Timeline file had no visits in it");
	} else {
		const drafts = draftsFromPlaces(found.places.places);
		// Places from a "Want to go" list weren't visited yet: start them unticked.
		const listsByKey = new Map();
		for (const p of found.places.places) {
			if (!p.where || !p.where.country) continue;
			const key = `${normalizeName(p.where.city)}|${p.where.country}`;
			if (!listsByKey.has(key)) listsByKey.set(key, new Set());
			listsByKey.get(key).add(p.list || "");
		}
		for (const d of drafts) {
			const lists = listsByKey.get(`${normalizeName(d.city)}|${d.country}`);
			if (lists && [...lists].every((l) => WISHLIST.test(l))) {
				d.include = false;
				d.hint = `From your "${[...lists][0]}" list, so maybe not visited yet. Tick it to keep`;
			}
		}
		result.drafts = drafts;
		result.places = found.places.places.length;
		if (found.places.skipped) warnings.push(`${found.places.skipped} map item${found.places.skipped === 1 ? "" : "s"} had no usable location and ${found.places.skipped === 1 ? "was" : "were"} skipped`);
	}
	for (const d of result.drafts) if (d.include === undefined) d.include = true;
	return result;
}

/** The trip field a column header means, using the same guesses as CSV files. */
function guessField (header) {
	const r = rowsToRecords([[header], ["x"]]);
	return Object.keys(r.records[0])[0] || null;
}

/**
 * Unpack files sent by the editor: each is [4-byte name length][name][4-byte size][bytes].
 * (Simpler and lighter than multipart form parsing, and the editor is the only client.)
 * @param {Buffer} buf
 * @returns {Array<{name: string, data: Buffer}>}
 */
function unpackFiles (buf) {
	const files = [];
	let i = 0;
	while (i < buf.length) {
		if (i + 4 > buf.length) throw new Error("Upload was cut off");
		const nameLen = buf.readUInt32LE(i);
		i += 4;
		if (nameLen > 1024 || i + nameLen + 4 > buf.length) throw new Error("Upload was cut off");
		const name = buf.toString("utf8", i, i + nameLen);
		i += nameLen;
		const size = buf.readUInt32LE(i);
		i += 4;
		if (i + size > buf.length) throw new Error("Upload was cut off");
		files.push({ name, data: buf.subarray(i, i + size) });
		i += size;
	}
	return files;
}

/** The inverse of unpackFiles, used by tests and the command line. */
function packFiles (files) {
	const parts = [];
	for (const f of files) {
		const name = Buffer.from(f.name, "utf8");
		const head = Buffer.alloc(4);
		head.writeUInt32LE(name.length);
		const size = Buffer.alloc(4);
		size.writeUInt32LE(f.data.length);
		parts.push(head, name, size, f.data);
	}
	return Buffer.concat(parts);
}

module.exports = { parseUpload, unpackFiles, packFiles, draftsFromRecords, KINDS };
