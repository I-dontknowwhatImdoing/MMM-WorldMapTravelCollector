/**
 * Ledger and stats-line helpers, shared by the browser (window.WMTCLedger) and Node (tests).
 * Pure functions only: no DOM.
 */
(function (root, factory) {
	if (typeof module === "object" && module.exports) module.exports = factory();
	else root.WMTCLedger = factory();
}(typeof self !== "undefined" ? self : this, function () {
	"use strict";

	const monthCache = {};

	/**
	 * Month names for a locale, falling back to English.
	 * @param {string} locale
	 * @param {"short"|"long"} width
	 */
	function monthNames (locale, width) {
		const key = `${locale}|${width}`;
		if (monthCache[key]) return monthCache[key];
		let names;
		try {
			const fmt = new Intl.DateTimeFormat(locale || "en", { month: width, timeZone: "UTC" });
			names = Array.from({ length: 12 }, (_, i) => fmt.format(new Date(Date.UTC(2000, i, 15))));
		} catch {
			names = width === "long"
				? ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
				: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
		}
		monthCache[key] = names;
		return names;
	}

	/**
	 * Format "2025-03" with a pattern. Tokens: YYYY, YY, MMMM, MMM, MM, M. Other text is kept.
	 * @param {string} yyyymm
	 * @param {string} [pattern] default "MMM YYYY"
	 * @param {string} [locale]
	 */
	function formatMonth (yyyymm, pattern, locale) {
		const m = /^(\d{4})-(\d{2})$/.exec(String(yyyymm || ""));
		if (!m) return String(yyyymm || "");
		const year = m[1];
		const month = Number(m[2]);
		return String(pattern || "MMM YYYY").replace(/YYYY|YY|MMMM|MMM|MM|M/g, (token) => {
			switch (token) {
				case "YYYY": return year;
				case "YY": return year.slice(2);
				case "MMMM": return monthNames(locale, "long")[month - 1];
				case "MMM": return monthNames(locale, "short")[month - 1].replace(/\.$/, "");
				case "MM": return m[2];
				default: return String(month);
			}
		});
	}

	/**
	 * Sort trips for the ledger.
	 * @param {object[]} trips
	 * @param {"newest"|"oldest"|"alpha"} [order]
	 */
	function sortTrips (trips, order) {
		const list = trips.slice();
		const place = (t) => (t.city || t.countryName || t.country || "").toLowerCase();
		if (order === "alpha") list.sort((a, b) => place(a).localeCompare(place(b)) || (a.date < b.date ? 1 : -1));
		else if (order === "oldest") list.sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : place(a).localeCompare(place(b))));
		else list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : place(a).localeCompare(place(b))));
		return list;
	}

	/**
	 * The text parts of one ledger cell.
	 * @param {{city: string, countryName: string, date: string, days?: number|null}} trip
	 * @param {{showCountry?: boolean, showDays?: boolean, dateFormat?: string, locale?: string}} [opts]
	 * @returns {{place: string, date: string, days: string}}
	 */
	function cellText (trip, opts) {
		const o = opts || {};
		const showCountry = o.showCountry !== false;
		let place;
		if (!trip.city) place = trip.countryName;
		else place = showCountry ? `${trip.city}, ${trip.countryName}` : trip.city;
		return {
			place,
			date: formatMonth(trip.date, o.dateFormat, o.locale),
			days: o.showDays && trip.days ? `${trip.days}d` : ""
		};
	}

	/**
	 * Initials for a traveler marker: "Alex" -> "A"; clashes get a second letter ("Alex", "Ana" -> "Al", "An").
	 * @param {string[]} names
	 * @returns {Record<string, string>}
	 */
	function initials (names) {
		const out = {};
		const first = (n) => String(n).trim().charAt(0).toUpperCase();
		for (const name of names) {
			const clash = names.filter((n) => first(n) === first(name)).length > 1;
			const s = String(name).trim();
			out[name] = clash ? s.charAt(0).toUpperCase() + s.charAt(1).toLowerCase() : first(name);
		}
		return out;
	}

	/**
	 * Split a list into pages of rows x columns.
	 * @param {any[]} items
	 * @param {number} rows
	 * @param {number} columns
	 * @returns {any[][]} at least one (possibly empty) page
	 */
	function paginate (items, rows, columns) {
		const size = Math.max(1, rows) * Math.max(1, columns);
		const pages = [];
		for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
		return pages.length ? pages : [[]];
	}

	/**
	 * How to fit every item in the grid by shrinking text. Adds rows (smaller text) until all items fit
	 * or the text reaches minFontSize; anything still left over becomes a "+N more" cell.
	 * @param {{count: number, rows: number, columns: number, fontSize: number, minFontSize: number}} p
	 * @returns {{rows: number, fontSize: number, shown: number, more: number}}
	 */
	function shrinkPlan (p) {
		const rows = Math.max(1, Math.floor(p.rows));
		const columns = Math.max(1, Math.floor(p.columns));
		const minFont = Math.min(p.fontSize, Math.max(1, p.minFontSize || 1));
		const neededRows = Math.max(rows, Math.ceil(p.count / columns));
		let fontSize = (p.fontSize * rows) / neededRows;
		let useRows = neededRows;
		if (fontSize < minFont) {
			fontSize = minFont;
			useRows = Math.max(rows, Math.floor((p.fontSize * rows) / minFont));
		}
		const capacity = useRows * columns;
		const fits = p.count <= capacity;
		const shown = fits ? p.count : capacity - 1;
		return { rows: useRows, fontSize: Math.round(fontSize * 10) / 10, shown, more: p.count - shown };
	}

	const STAT_KEYS = ["countries", "cities", "continents", "worldPercent", "tripsThisYear", "distance"];

	/**
	 * Stats as display parts: [{key, value, label}], in the order asked for. Distance is skipped
	 * when no home is set.
	 * @param {object} stats from computeStats
	 * @param {string[]} [keys]
	 * @param {string} [locale]
	 */
	function statParts (stats, keys, locale) {
		if (!stats) return [];
		const n = (v) => {
			try {
				return new Intl.NumberFormat(locale || "en").format(v);
			} catch {
				return String(v);
			}
		};
		const plural = (v, one, many) => (v === 1 ? one : many);
		const parts = [];
		for (const key of Array.isArray(keys) ? keys : STAT_KEYS) {
			switch (key) {
				case "countries":
					parts.push({ key, value: n(stats.countries), label: plural(stats.countries, "country", "countries") });
					break;
				case "cities":
					parts.push({ key, value: n(stats.cities), label: plural(stats.cities, "city", "cities") });
					break;
				case "continents":
					parts.push({ key, value: `${stats.continents}/7`, label: "continents" });
					break;
				case "worldPercent":
					parts.push({ key, value: `${n(stats.worldPercent)}%`, label: "of the world" });
					break;
				case "tripsThisYear":
					parts.push({ key, value: n(stats.tripsThisYear), label: `${plural(stats.tripsThisYear, "trip", "trips")} in ${stats.year}` });
					break;
				case "distance":
					if (stats.distance !== null && stats.distance !== undefined) parts.push({ key, value: n(stats.distance), label: `${stats.units} traveled` });
					break;
				default:
			}
		}
		return parts;
	}

	return { formatMonth, monthNames, sortTrips, cellText, initials, paginate, shrinkPlan, statParts, STAT_KEYS };
}));
