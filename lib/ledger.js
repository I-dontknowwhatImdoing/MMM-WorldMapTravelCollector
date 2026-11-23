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
	 * Exact dates of a trip: "14 Mar 2025", "14–18 Mar 2025", "28 Mar – 2 Apr 2025",
	 * "30 Dec 2025 – 3 Jan 2026". Month names follow the locale.
	 * @param {string} start "YYYY-MM-DD"
	 * @param {string|null} [end] "YYYY-MM-DD"
	 * @param {string} [locale]
	 */
	function formatRange (start, end, locale) {
		const parse = (s) => {
			const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
			return m ? { y: m[1], m: Number(m[2]), d: Number(m[3]) } : null;
		};
		const a = parse(start);
		if (!a) return String(start || "");
		const b = parse(end) || a;
		const mon = (x) => monthNames(locale, "short")[x.m - 1].replace(/\.$/, "");
		if (a.y === b.y && a.m === b.m) return a.d === b.d ? `${a.d} ${mon(a)} ${a.y}` : `${a.d}–${b.d} ${mon(a)} ${a.y}`;
		if (a.y === b.y) return `${a.d} ${mon(a)} – ${b.d} ${mon(b)} ${a.y}`;
		return `${a.d} ${mon(a)} ${a.y} – ${b.d} ${mon(b)} ${b.y}`;
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

	/** "Alex", "Alex & Sam", "Alex, Sam & Jo". */
	function joinNames (names) {
		if (names.length < 2) return names.join("");
		return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
	}

	function plural (n, word) {
		return `${n} ${word}${n === 1 ? "" : "s"}`;
	}

	/**
	 * What the card shows when someone taps a pin (one city) or a country on the map.
	 *
	 * @param {Array<{city: string, countryName: string, date: string, days?: number|null, travelers: string[], planned?: boolean, note?: string}>} trips
	 *        the place's trips in the current view, newest first
	 * @param {{kind: "pin"|"country", dateFormat?: string, locale?: string, maxVisits?: number}} opts
	 * @returns {{title: string, facts: string[], visits: Array<{when: string, place: string, detail: string, note: string, planned: boolean}>, more: number}}
	 */
	function placeDetails (trips, opts) {
		const o = opts || {};
		const kind = o.kind === "country" ? "country" : "pin";
		const fmt = (d) => formatMonth(d, o.dateFormat, o.locale);
		const max = Number.isFinite(o.maxVisits) && o.maxVisits > 0 ? o.maxVisits : 6;
		const done = trips.filter((t) => !t.planned);
		const planned = trips.filter((t) => t.planned);
		const first = trips[0] || {};
		const title = kind === "country" ? first.countryName || "" : first.city ? `${first.city}, ${first.countryName}` : first.countryName || "";

		const facts = [];
		// A pin with one visit says it all in its visit line; a summary would only repeat it.
		if (kind === "pin" && trips.length < 2) {
			return { title, facts, visits: visitLines(trips.slice(0, max), kind, fmt, o.locale), more: Math.max(0, trips.length - max) };
		}
		const word = kind === "country" ? "trip" : "visit";
		const counts = [plural(done.length, word)];
		if (kind === "country") {
			const cities = new Set(done.filter((t) => t.city).map((t) => t.city));
			if (cities.size) counts.push(`${cities.size} ${cities.size === 1 ? "city" : "cities"}`);
		}
		const days = done.reduce((sum, t) => sum + (Number(t.days) || 0), 0);
		if (days) counts.push(`${plural(days, "day")} in total`);
		if (done.length) facts.push(counts.join(" · "));

		if (done.length > 1) {
			facts.push(`First ${fmt(done[done.length - 1].date)} · Latest ${fmt(done[0].date)}`);
		} else if (done.length === 1) facts.push(`Visited ${fmt(done[0].date)}`);
		if (planned.length) facts.push(`Next: ${fmt(planned[planned.length - 1].date)} (planned)`);

		if (kind === "country") {
			const who = [];
			for (const t of trips) for (const n of t.travelers || []) if (!who.includes(n)) who.push(n);
			if (who.length) facts.push(`With ${joinNames(who)}`);
			const byCity = new Map();
			for (const t of done) if (t.city) byCity.set(t.city, (byCity.get(t.city) || 0) + 1);
			if (byCity.size > 1) {
				const list = [...byCity].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([c, n]) => (n > 1 ? `${c} (${n})` : c));
				facts.push(`Cities: ${list.slice(0, 8).join(", ")}${list.length > 8 ? ` +${list.length - 8} more` : ""}`);
			}
		}

		return { title, facts, visits: visitLines(trips.slice(0, max), kind, fmt, o.locale), more: Math.max(0, trips.length - max) };
	}

	function visitLines (trips, kind, fmt, locale) {
		return trips.map((t) => ({
			when: t.start ? formatRange(t.start, t.end, locale) : fmt(t.date),
			place: kind === "country" ? t.city || "Around the country" : "",
			detail: [t.days ? plural(Number(t.days), "day") : "", joinNames(t.travelers || [])].filter(Boolean).join(" · "),
			note: t.note || "",
			planned: Boolean(t.planned)
		}));
	}

	return { formatMonth, formatRange, monthNames, sortTrips, cellText, initials, paginate, shrinkPlan, statParts, placeDetails, joinNames, STAT_KEYS };
}));
