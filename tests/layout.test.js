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
