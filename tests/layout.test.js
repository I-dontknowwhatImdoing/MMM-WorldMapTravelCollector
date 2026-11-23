"use strict";

const L = require("../lib/layout");

describe("cssSize", () => {
	test.each([
		["90%", "width", "90vw"],
		["80%", "height", "80vh"],
		["150%", "width", "100vw"],
		[800, "width", "800px"],
		["800px", "width", "800px"],
		["40rem", "width", "40rem"],
		["50vh", "height", "50vh"],
		["huge", "width", "FALLBACK"],
		[null, "width", "FALLBACK"],
		[-5, "width", "FALLBACK"]
	])("%p on %s -> %s", (value, axis, expected) => {
		expect(L.cssSize(value, axis, "FALLBACK")).toBe(expected);
	});
});

describe("scaleFor", () => {
	test("grows with the screen and stays within limits", () => {
		const pi = L.scaleFor(800, 480);
		const hd = L.scaleFor(1920, 1080);
		const uhd = L.scaleFor(3840, 2160);
		expect(pi.fontSize).toBeLessThan(hd.fontSize);
		expect(hd.fontSize).toBeLessThan(uhd.fontSize);
		expect(pi.pinRadius).toBeLessThan(uhd.pinRadius);
		expect(L.scaleFor(100, 100)).toEqual({ fontSize: 11, pinRadius: 2.5, lineWidth: 0.35 });
		expect(L.scaleFor(100000, 100000)).toEqual({ fontSize: 64, pinRadius: 18, lineWidth: 2 });
		expect(L.scaleFor(0, 0).fontSize).toBe(11);
	});

	test("portrait screens size by width", () => {
		expect(L.scaleFor(1080, 1920).fontSize).toBe(L.scaleFor(1080, 5000).fontSize);
	});
});

describe("pinRadius", () => {
	test("grows slowly with visits, capped at 2.2x", () => {
		expect(L.pinRadius(5, 1)).toBe(5);
		expect(L.pinRadius(5, 2)).toBe(7);
		expect(L.pinRadius(5, 0)).toBe(5);
		expect(L.pinRadius(5, 1000)).toBe(11);
	});
});

describe("fitBox", () => {
	test("fits an aspect ratio inside a box", () => {
		expect(L.fitBox(2000, 500, 2)).toEqual({ width: 1000, height: 500 });
		expect(L.fitBox(1000, 2000, 2)).toEqual({ width: 1000, height: 500 });
		expect(L.fitBox(0, 100, 2)).toEqual({ width: 0, height: 0 });
		expect(L.fitBox(100, 100, 0)).toEqual({ width: 0, height: 0 });
	});
});

describe("palette and colors", () => {
	test("config colors, fallbacks and together color", () => {
		const p = L.palette([{ name: "Alex", color: "#123456" }, "Sam", { name: "Kim", color: "not a color!" }, null, {}], "rgb(1,2,3)");
		expect(p.byName).toEqual({ Alex: "#123456", Sam: L.DEFAULT_COLORS[1], Kim: L.DEFAULT_COLORS[2] });
		expect(p.together).toBe("rgb(1,2,3)");
		expect(L.palette(undefined).together).toBe(L.DEFAULT_TOGETHER);
		expect(L.colorFor("Alex", p)).toBe("#123456");
		expect(L.colorFor("together", p)).toBe("rgb(1,2,3)");
		expect(L.colorFor("mixed", p)).toBe("rgb(1,2,3)");
	});

	test("isColor", () => {
		expect(L.isColor("#fff")).toBe(true);
		expect(L.isColor("hsl(10, 50%, 50%)")).toBe(true);
		expect(L.isColor("teal")).toBe(true);
		expect(L.isColor("red; background: url(x)")).toBe(false);
		expect(L.isColor(5)).toBe(false);
	});

	test("clamp", () => {
		expect(L.clamp(5, 0, 3)).toBe(3);
		expect(L.clamp(-1, 0, 3)).toBe(0);
	});
});

describe("fadeFactor", () => {
	const on = { enabled: true, strength: 0.6, unit: "years", amount: 10 };
	test("full color just visited and for planned trips; off means no fading", () => {
		expect(L.fadeFactor("2026-11", "2026-11-23", on)).toBe(1);
		expect(L.fadeFactor("2027-04", "2026-11-23", on)).toBe(1);
		expect(L.fadeFactor("2006-01", "2026-11-23", { ...on, enabled: false })).toBe(1);
		expect(L.fadeFactor("2006-01", "2026-11-23", null)).toBe(1);
		expect(L.fadeFactor(null, "2026-11-23", on)).toBe(1);
	});

	test("years: a straight line down to 1 - strength after `amount` years", () => {
		expect(L.fadeFactor("2021-11", "2026-11-23", on)).toBe(0.7);
		expect(L.fadeFactor("2016-11", "2026-11-23", on)).toBe(0.4);
		expect(L.fadeFactor("1990-01", "2026-11-23", on)).toBe(0.4);
		expect(L.fadeFactor("2021-11", "2026-11", on)).toBe(0.7); // a month alone works too
		expect(L.fadeFactor("2025-11", "2026-11-23", { enabled: true, strength: 1, amount: 1 })).toBe(0.05);
		expect(L.fadeFactor("2021-11", "2026-11-23", { enabled: true, strength: -1 })).toBe(1);
	});

	test("months", () => {
		const months = { ...on, unit: "months", amount: 24 };
		expect(L.fadeFactor("2025-11", "2026-11-23", months)).toBe(0.7);
		expect(L.fadeFactor("2026-10", "2026-11-23", months)).toBe(0.975);
		expect(L.fadeFactor("2020-01", "2026-11-23", months)).toBe(0.4);
	});

	test("days, counting a trip as the 15th of its month", () => {
		const days = { ...on, unit: "days", amount: 90 };
		expect(L.fadeAge("2026-10", "2026-11-23", "days")).toBe(39);
		expect(L.fadeFactor("2026-10", "2026-11-23", days)).toBe(0.74);
		expect(L.fadeFactor("2026-11", "2026-11-10", days)).toBe(1); // before the 15th: not yet "past"
		expect(L.fadeFactor("2026-11", "2026-11-30", days)).toBe(0.9);
		expect(L.fadeFactor("2026-01", "2026-11-23", days)).toBe(0.4);
		expect(L.fadeAge("2026-10", "2026-11", "days")).toBe(31);
		expect(L.fadeAge("soon", "2026-11-23", "days")).toBeNaN();
		expect(L.fadeAge("2026-10", "", "days")).toBeNaN();
	});

	test("missing or odd settings use the defaults (0.6 over 10 years)", () => {
		expect(L.fadeFactor("2016-11", "2026-11-23", { enabled: true })).toBe(0.4);
		expect(L.fadeFactor("2016-11", "2026-11-23", { enabled: true, strength: "lots", unit: "weeks", amount: 0 })).toBe(0.4);
		expect(L.fadeFactor("2016-11", "2026-11-23", { enabled: true, unit: "months", amount: "x" })).toBe(0.4);
		expect(L.FADE_UNITS).toEqual(["years", "months", "days"]);
		expect(L.monthIndex("2026-01")).toBe(2026 * 12);
		expect(L.monthIndex("soon")).toBeNaN();
	});
});

describe("year and month colors", () => {
	const years = ["2018", "2019", "2020", "2021", "2022"];
	test("gradient: oldest to newest through the stops", () => {
		expect(L.yearColor("2018", years)).toBe("#5C6BC0");
		expect(L.yearColor("2020", years)).toBe("#4DB6AC");
		expect(L.yearColor("2022", years)).toBe("#FFD54F");
		expect(L.yearColor(2019, years, { yearGradient: ["#000000", "#ffffff"] })).toBe("#404040");
		expect(L.yearColor("2020", ["2020"])).toBe("#FFD54F"); // one year: the newest color
		expect(L.yearColor("2020", [], { yearGradient: ["nope"] })).toBe("#FFD54F");
		expect(L.gradientAt(["#123456"], 0.3)).toBe("#123456");
		expect(L.gradientAt(["nope"], 0.3)).toBe("#FFD54F");
		expect(L.gradientAt(["#000", "#fff"], 2)).toBe("#FFFFFF");
	});
	test("distinct: newest years first, repeating after the palette runs out", () => {
		expect(L.yearColor("2022", years, { yearColors: "distinct" })).toBe(L.DEFAULT_COLORS[0]);
		expect(L.yearColor("2021", years, { yearColors: "distinct" })).toBe(L.DEFAULT_COLORS[1]);
		expect(L.yearColor("2018", years, { yearColors: "distinct", palette: ["#111", "#222"] })).toBe("#111");
		expect(L.yearColor("1999", years, { yearColors: "distinct" })).toBe(L.DEFAULT_COLORS[0]);
	});
	test("chosen colors for some years; the rest use the gradient", () => {
		const custom = { yearColors: { 2020: "#E57373", 2021: "not a color" } };
		expect(L.yearColor("2020", years, custom)).toBe("#E57373");
		expect(L.yearColor("2021", years, custom)).toBe(L.yearColor("2021", years));
	});
	test("months follow the seasons, and can be replaced", () => {
		expect(L.monthColor(1)).toBe(L.DEFAULT_MONTH_COLORS[0]);
		expect(L.monthColor(12)).toBe(L.DEFAULT_MONTH_COLORS[11]);
		const mine = Array.from({ length: 12 }, (_, i) => `#0000${String(i + 10)}`);
		expect(L.monthColor(3, mine)).toBe("#000012");
		expect(L.monthColor(3, ["#fff"])).toBe(L.DEFAULT_MONTH_COLORS[2]);
		expect(L.monthColor("x")).toBe(L.DEFAULT_MONTH_COLORS[0]);
	});
});

describe("R4: colors people with color blindness can tell apart", () => {
	// Machado et al. 2009 simulation matrices (severity 1) on linear RGB, then CIELAB and ΔE76.
	const SIM = {
		normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
		protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
		deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
		tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]]
	};
	const lab = (hex, kind) => {
		const lin = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
		const [r, g, b] = SIM[kind].map((row) => Math.min(1, Math.max(0, row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
		const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
		const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
		const Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
		const Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
		return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
	};
	const closest = (colors, kind) => {
		let min = Infinity;
		const labs = colors.map((c) => lab(c, kind));
		for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) min = Math.min(min, Math.hypot(...labs[i].map((v, k) => v - labs[j][k])));
		return min;
	};

	test("every pair of month colors differs by ΔE 20 or more, also for red-green color blindness", () => {
		for (const kind of ["normal", "protan", "deutan"]) expect(closest(L.DEFAULT_MONTH_COLORS, kind)).toBeGreaterThanOrEqual(20);
		expect(closest(L.DEFAULT_MONTH_COLORS, "tritan")).toBeGreaterThanOrEqual(15);
		// The old palette failed: November and December were ΔE 5 apart for green-weak eyes.
		expect(closest(["#BA68C8", "#7986CB"], "deutan")).toBeLessThan(6);
	});

	test("season colors are far apart for every kind of color vision", () => {
		for (const kind of Object.keys(SIM)) expect(closest(L.DEFAULT_SEASON_COLORS, kind)).toBeGreaterThanOrEqual(15);
		for (const kind of ["normal", "protan", "deutan"]) expect(closest(L.DEFAULT_SEASON_COLORS, kind)).toBeGreaterThanOrEqual(30);
	});

	test("seasons by month, north and south", () => {
		expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => L.seasonOf(m)).join("")).toBe("001112223330");
		expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => L.seasonOf(m, "south")).join("")).toBe("223330001112");
		expect(L.seasonOf("x")).toBe(0);
		expect(L.seasonColor(7)).toBe(L.DEFAULT_SEASON_COLORS[2]);
		expect(L.seasonColor(7, ["#111", "#222", "#333", "#444"], "south")).toBe("#111");
		expect(L.seasonColor(7, ["#111"])).toBe(L.DEFAULT_SEASON_COLORS[2]);
	});
});
