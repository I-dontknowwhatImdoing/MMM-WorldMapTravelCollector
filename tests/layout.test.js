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
