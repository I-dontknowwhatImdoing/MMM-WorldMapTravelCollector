/**
 * Sizing and color helpers shared by the browser (loaded by MagicMirror as a script, exposed as
 * window.WMTCLayout) and Node (required by the tests).
 */
(function (root, factory) {
	if (typeof module === "object" && module.exports) module.exports = factory();
	else root.WMTCLayout = factory();
}(typeof self !== "undefined" ? self : this, function () {
	"use strict";

	const DEFAULT_COLORS = ["#4FC3F7", "#F48FB1", "#AED581", "#FFB74D", "#BA68C8", "#4DB6AC", "#E57373", "#90A4AE"];
	const DEFAULT_TOGETHER = "#FFD54F";

	function clamp (value, min, max) {
		return Math.min(max, Math.max(min, value));
	}

	/**
	 * Turn a config size into CSS. Percentages are of the screen (vw / vh), because MagicMirror
	 * regions shrink to fit their content and can't be used as a reference.
	 * @param {string|number} value e.g. "90%", 800, "800px", "40rem"
	 * @param {"width"|"height"} axis
	 * @param {string} fallback
	 */
	function cssSize (value, axis, fallback) {
		if (typeof value === "number" && Number.isFinite(value) && value > 0) return `${value}px`;
		if (typeof value !== "string") return fallback;
		const v = value.trim();
		const pct = v.match(/^(\d+(?:\.\d+)?)%$/);
		if (pct) return `${clamp(Number(pct[1]), 1, 100)}${axis === "width" ? "vw" : "vh"}`;
		if (/^\d+(?:\.\d+)?(px|vw|vh|rem|em)$/.test(v)) return v;
		return fallback;
	}

	/**
	 * Font, pin and line sizes that scale with the space the module gets, so a 7-inch screen
	 * and a 4K TV both look right.
	 * @param {number} width module width in px
	 * @param {number} height module height in px
	 */
	function scaleFor (width, height) {
		const w = Math.max(1, width || 0);
		const h = Math.max(1, height || 0);
		// Size by area, so portrait and landscape screens of the same size get the same text,
		// but never wider than a narrow screen can hold.
		const base = Math.min(w * 1.25, Math.sqrt(w * h));
		return {
			fontSize: Math.round(clamp(base / 42, 11, 64)),
			pinRadius: Math.round(clamp(base / 190, 2.5, 18) * 10) / 10,
			lineWidth: Math.round(clamp(base / 1650, 0.35, 2) * 100) / 100
		};
	}

	/**
	 * Pin radius for a number of visits: grows slowly, up to 2.2x the base size.
	 * @param {number} base
	 * @param {number} visits
	 */
	function pinRadius (base, visits) {
		const n = Math.max(1, visits || 1);
		return Math.round(base * Math.min(2.2, 1 + 0.4 * Math.log2(n)) * 10) / 10;
	}

	/**
	 * The largest box with the map's aspect ratio that fits the space.
	 * @param {number} width
	 * @param {number} height
	 * @param {number} aspect width / height of the map
	 */
	function fitBox (width, height, aspect) {
		if (!(width > 0) || !(height > 0) || !(aspect > 0)) return { width: 0, height: 0 };
		if (width / height > aspect) return { width: Math.floor(height * aspect), height: Math.floor(height) };
		return { width: Math.floor(width), height: Math.floor(width / aspect) };
	}

	/**
	 * Colors per traveler, plus the together color. Travelers without a color get one from a
	 * palette that reads well on black.
	 * @param {Array<string|{name: string, color?: string}>} travelers
	 * @param {string} [togetherColor]
	 * @returns {{byName: Record<string, string>, together: string}}
	 */
	function palette (travelers, togetherColor) {
		const byName = {};
		(travelers || []).forEach((t, i) => {
			const name = typeof t === "string" ? t : t && t.name;
			if (!name) return;
			const color = t && typeof t === "object" && isColor(t.color) ? t.color : DEFAULT_COLORS[i % DEFAULT_COLORS.length];
			byName[name] = color;
		});
		return { byName, together: isColor(togetherColor) ? togetherColor : DEFAULT_TOGETHER };
	}

	/**
	 * Color for a map group: a traveler's name, or "together" / "mixed" / "group".
	 * @param {string} group
	 * @param {{byName: Record<string, string>, together: string}} colors
	 */
	function colorFor (group, colors) {
		return colors.byName[group] || colors.together;
	}

	/** "2025-03" → months since year 0, or NaN. */
	function monthIndex (ym) {
		const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
		return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : NaN;
	}

	const FADE_UNITS = ["years", "months", "days"];

	/**
	 * How long ago a trip was, in years, months or days. Trips only have a month, so for days a trip
	 * counts as the 15th of its month.
	 * @param {string} lastDate "YYYY-MM"
	 * @param {string} now "YYYY-MM-DD" (or "YYYY-MM", read as the 15th)
	 * @param {"years"|"months"|"days"} unit
	 */
	function fadeAge (lastDate, now, unit) {
		if (unit === "days") {
			const t = /^(\d{4})-(\d{2})$/.exec(String(lastDate || ""));
			const n = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(now || ""));
			if (!t || !n) return NaN;
			const then = Date.UTC(Number(t[1]), Number(t[2]) - 1, 15);
			const today = Date.UTC(Number(n[1]), Number(n[2]) - 1, n[3] ? Number(n[3]) : 15);
			return Math.floor((today - then) / 86400000);
		}
		const months = monthIndex(String(now || "").slice(0, 7)) - monthIndex(lastDate);
		return unit === "months" ? months : months / 12;
	}

	/**
	 * How strongly to draw a place visited in lastDate: 1 = full color (just visited), down to
	 * 1 - strength for visits `amount` years/months/days ago or more, in a straight line between.
	 * @param {string|null} lastDate "YYYY-MM" of the most recent visit
	 * @param {string} now today as "YYYY-MM-DD" (or "YYYY-MM")
	 * @param {{enabled: boolean, strength?: number, unit?: "years"|"months"|"days", amount?: number}} opts
	 * @returns {number} between 0.05 and 1
	 */
	function fadeFactor (lastDate, now, opts) {
		if (!opts || !opts.enabled) return 1;
		const unit = FADE_UNITS.includes(opts.unit) ? opts.unit : "years";
		const age = fadeAge(lastDate, now, unit);
		if (!(age > 0)) return 1;
		const s = Number(opts.strength);
		const strength = clamp(Number.isFinite(s) ? s : 0.6, 0, 0.95);
		const a = Number(opts.amount);
		const amount = Number.isFinite(a) && a > 0 ? a : 10;
		return Math.round((1 - strength * Math.min(1, age / amount)) * 1000) / 1000;
	}

	/** Oldest → newest, for colorBy "year" with yearColors "gradient". */
	const DEFAULT_YEAR_GRADIENT = ["#5C6BC0", "#4DB6AC", "#FFD54F"];
	/** January → December, following the seasons (northern hemisphere). */
	const DEFAULT_MONTH_COLORS = ["#64B5F6", "#4DD0E1", "#4DB6AC", "#81C784", "#AED581", "#FFF176", "#FFD54F", "#FFB74D", "#FF8A65", "#E57373", "#BA68C8", "#7986CB"];

	function hexToRgb (hex) {
		let h = String(hex || "").trim().replace(/^#/, "");
		if (h.length === 3) h = h.split("").map((c) => c + c).join("");
		if (!/^[0-9a-f]{6}$/i.test(h)) return null;
		return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
	}

	/**
	 * A color part-way along a list of color stops (t from 0 to 1).
	 * @param {string[]} stops hex colors
	 * @param {number} t
	 */
	function gradientAt (stops, t) {
		const rgb = stops.map(hexToRgb).filter(Boolean);
		if (!rgb.length) return DEFAULT_YEAR_GRADIENT[DEFAULT_YEAR_GRADIENT.length - 1];
		if (rgb.length === 1) return toHex(rgb[0]);
		const x = clamp(Number(t) || 0, 0, 1) * (rgb.length - 1);
		const i = Math.min(Math.floor(x), rgb.length - 2);
		const f = x - i;
		return toHex(rgb[i].map((c, k) => c + (rgb[i + 1][k] - c) * f));
	}

	function toHex (rgb) {
		return "#" + rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("").toUpperCase();
	}

	/**
	 * Color for a year.
	 * @param {string|number} year
	 * @param {string[]} years every year with trips, oldest first
	 * @param {{yearColors?: "gradient"|"distinct"|Record<string, string>, yearGradient?: string[], palette?: string[]}} [opts]
	 *        yearColors as an object sets chosen years' colors; the other years use the gradient
	 */
	function yearColor (year, years, opts) {
		const o = opts || {};
		const y = String(year);
		const mode = o.yearColors;
		if (mode && typeof mode === "object" && isColor(mode[y])) return mode[y];
		const list = (years || []).map(String);
		if (mode === "distinct") {
			const palette = Array.isArray(o.palette) && o.palette.length ? o.palette : DEFAULT_COLORS;
			// Newest years first, so the recent ones never share a color.
			const index = [...list].reverse().indexOf(y);
			return palette[Math.max(0, index) % palette.length];
		}
		const stops = Array.isArray(o.yearGradient) && o.yearGradient.some((c) => hexToRgb(c)) ? o.yearGradient : DEFAULT_YEAR_GRADIENT;
		const first = Number(list[0]);
		const last = Number(list[list.length - 1]);
		const t = list.length > 1 && last > first ? (Number(y) - first) / (last - first) : 1;
		return gradientAt(stops, t);
	}

	/**
	 * Color for a calendar month (1–12).
	 * @param {number} month
	 * @param {string[]} [colors] 12 colors, January first, to replace the seasonal ones
	 */
	function monthColor (month, colors) {
		const list = Array.isArray(colors) && colors.length === 12 && colors.every(isColor) ? colors : DEFAULT_MONTH_COLORS;
		return list[(Math.round(Number(month)) - 1 + 1200) % 12] || list[0];
	}

	function isColor (value) {
		return typeof value === "string" && /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i.test(value.trim());
	}

	return { DEFAULT_COLORS, DEFAULT_TOGETHER, clamp, cssSize, scaleFor, pinRadius, fitBox, palette, colorFor, isColor, monthIndex, fadeAge, fadeFactor, FADE_UNITS, gradientAt, yearColor, monthColor, DEFAULT_YEAR_GRADIENT, DEFAULT_MONTH_COLORS };
}));
