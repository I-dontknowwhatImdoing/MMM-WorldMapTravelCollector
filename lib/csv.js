"use strict";

const { normalizeName } = require("./text");

/**
 * Parse CSV text (RFC 4180): quoted fields, doubled quotes, commas and line breaks inside quotes,
 * CRLF or LF line endings, and a leading byte-order mark. Semicolon- and tab-separated files
 * are detected from the header line.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCSV (text) {
	const src = String(text || "").replace(/^\uFEFF/, "");
	const firstLine = src.split(/\r?\n/, 1)[0] || "";
	const delimiter = pickDelimiter(firstLine);
	const rows = [];
	let row = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < src.length; i++) {
		const ch = src[i];
		if (quoted) {
			if (ch === "\"") {
				if (src[i + 1] === "\"") {
					field += "\"";
					i++;
				} else quoted = false;
			} else field += ch;
		} else if (ch === "\"" && field === "") {
			quoted = true;
		} else if (ch === delimiter) {
			row.push(field);
			field = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && src[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else field += ch;
	}
	if (field !== "" || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function pickDelimiter (line) {
	let best = ",";
	let bestCount = -1;
	for (const d of [",", ";", "\t"]) {
		const count = line.split(d).length - 1;
		if (count > bestCount) {
			best = d;
			bestCount = count;
		}
	}
	return best;
}

/** Header spellings people use, mapped to trip fields. */
const HEADER_ALIASES = {
	id: ["id", "trip id"],
	city: ["city", "town", "place", "location", "city name"],
	country: ["country", "nation", "country code", "country name"],
	date: ["date", "month", "when", "visited", "date visited", "month year", "trip date"],
	days: ["days", "nights", "duration", "length", "days spent", "number of days"],
	travelers: ["travelers", "travellers", "who", "people", "with", "traveler", "traveller", "visited by"],
	lat: ["lat", "latitude"],
	lon: ["lon", "lng", "long", "longitude"],
	note: ["note", "notes", "comment", "comments", "description"]
};

const HEADER_LOOKUP = new Map();
for (const [field, names] of Object.entries(HEADER_ALIASES)) {
	for (const name of names) HEADER_LOOKUP.set(normalizeName(name), field);
}

/**
 * Turn CSV rows into trip-shaped objects using the header row.
 * @param {string[][]} rows
 * @param {Record<string, string>} [columnMap] explicit header -> field mapping, overrides the guesses
 * @returns {{records: Array<Record<string, string>>, unknownHeaders: string[], missingFields: string[]}}
 */
function rowsToRecords (rows, columnMap = {}) {
	if (!rows.length) return { records: [], unknownHeaders: [], missingFields: ["city", "country", "date", "travelers"] };
	const header = rows[0];
	const explicit = new Map(Object.entries(columnMap).map(([h, f]) => [normalizeName(h), f]));
	const fields = header.map((h) => {
		const key = normalizeName(h);
		// An explicit "" or null means "ignore this column", even if its name looks familiar.
		return explicit.has(key) ? explicit.get(key) || null : HEADER_LOOKUP.get(key) || null;
	});
	const unknownHeaders = header.filter((h, i) => !fields[i] && h.trim() !== "");
	const missingFields = ["country", "date", "travelers"].filter((f) => !fields.includes(f));
	const records = rows.slice(1).map((r) => {
		const rec = {};
		fields.forEach((f, i) => {
			if (f && rec[f] === undefined) rec[f] = (r[i] || "").trim();
		});
		return rec;
	});
	return { records, unknownHeaders, missingFields };
}

function escapeCell (value) {
	const s = value === null || value === undefined ? "" : String(value);
	return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}

/**
 * Write trips as CSV with the standard columns.
 * @param {Array<object>} trips
 */
function toCSV (trips) {
	const cols = ["id", "city", "country", "date", "days", "travelers", "lat", "lon", "note"];
	const lines = [cols.join(",")];
	for (const t of trips) {
		lines.push(cols.map((c) => escapeCell(c === "travelers" ? (t.travelers || []).join("; ") : t[c])).join(","));
	}
	return lines.join("\n") + "\n";
}

module.exports = { parseCSV, rowsToRecords, toCSV, HEADER_ALIASES };
