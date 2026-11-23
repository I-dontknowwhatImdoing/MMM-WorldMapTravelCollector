/**
 * @jest-environment jsdom
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildViewModel } = require("../lib/viewmodel");
const { loadGeoData } = require("../lib/geodata");
const { NOW, trip } = require("./helpers");

// The low-detail world keeps these tests fast; the module code is the same at any detail level.
const META = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "geo", "countries-meta.json"), "utf8"));
const WORLD = JSON.parse(fs.readFileSync(require.resolve("world-atlas/countries-110m.json"), "utf8"));
const byNumeric = Object.fromEntries(Object.entries(META).map(([code, m]) => [m.numeric, code]));
for (const g of WORLD.objects.countries.geometries) g.properties.iso2 = byNumeric[g.id] || null;

// Load the same browser builds MagicMirror loads, the way a <script> tag would.
for (const file of ["d3-array/dist/d3-array.min.js", "d3-geo/dist/d3-geo.min.js", "topojson-client/dist/topojson-client.min.js"]) {
	(0, eval)(fs.readFileSync(path.join(__dirname, "..", "node_modules", file), "utf8"));
}
global.WMTCLayout = require("../lib/layout");
global.WMTCLedger = require("../lib/ledger");
global.Log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
global.config = { language: "en" };
let definition;
global.Module = { register: (name, def) => (definition = { name, def }) };
require("../MMM-WorldMapTravelCollector.js");

Element.prototype.getBoundingClientRect = function () {
	return { width: 1200, height: 700, top: 0, left: 0, right: 1200, bottom: 700, x: 0, y: 0 };
};

const geo = loadGeoData();
const trips = [
	trip({ id: "lis", city: "Lisbon", country: "PT", date: "2025-03", days: 5 }),
	trip({ id: "rey", city: "Reykjavík", country: "IS", date: "2023-08", travelers: ["Sam"], lat: 64.1, lon: -21.9 }),
	trip({ id: "chi", city: "Chicago", country: "US", date: "2024-06", travelers: ["Alex"], lat: 41.85, lon: -87.65 }),
	trip({ id: "cpt", city: "Cape Town", country: "ZA", date: "2027-04", lat: -33.92, lon: 18.42 })
];
const names = ["Alex", "Sam"];
const build = (list, opts = {}) => ({ ...buildViewModel(list, { travelerNames: names, now: NOW, countries: geo.countries, ...opts }), problems: [] });
const model = build(trips);

const flush = () => new Promise((r) => setTimeout(r, 0));
const mounted = [];

async function mount (cfg = {}, { fetchImpl } = {}) {
	global.fetch = fetchImpl || jest.fn(async () => ({ ok: true, json: async () => WORLD }));
	const m = Object.create(definition.def);
	m.name = definition.name;
	m.identifier = "module_1";
	m.defaults = definition.def.defaults;
	m.config = { ...definition.def.defaults, travelers: [{ name: "Alex", color: "#4FC3F7" }, { name: "Sam", color: "#F48FB1" }], ...cfg };
	m.file = (p) => `/modules/x/${p}`;
	m.sent = [];
	m.sendSocketNotification = (n, p) => m.sent.push([n, p]);
	m.start();
	document.body.innerHTML = "";
	document.body.append(m.getDom());
	await flush();
	await flush();
	mounted.push(m);
	return m;
}

afterEach(() => {
	mounted.splice(0).forEach((m) => m.stopTimers());
	jest.useRealTimers();
});

const data = (m, mdl = model) => m.socketNotificationReceived("WMTC_DATA", { identifier: m.identifier, model: mdl });
const $$ = (sel) => [...document.querySelectorAll(sel)];
const text = (sel) => (document.querySelector(sel) || {}).textContent;
const activeChip = () => text(".wmtc-chip-active");

describe("module definition", () => {
	test("registers with defaults, scripts and styles", () => {
		expect(definition.name).toBe("MMM-WorldMapTravelCollector");
		const m = Object.create(definition.def);
		m.file = (p) => p;
		expect(m.getScripts()).toEqual(expect.arrayContaining(["node_modules/d3-geo/dist/d3-geo.min.js", "lib/layout.js", "lib/ledger.js"]));
		expect(m.getStyles()).toEqual(["css/wmtc.css"]);
		expect(definition.def.defaults.ledger).toMatchObject({ rows: 5, columns: 4, overflow: "cycle" });
	});

	test("partial ledger config is filled in from defaults", async () => {
		const m = await mount({ ledger: { rows: 2 } });
		expect(m.config.ledger).toMatchObject({ rows: 2, columns: 4, sort: "newest" });
	});
});

describe("map", () => {
	test("asks the helper for data and shows loading messages", async () => {
		const m = await mount();
		expect(m.sent).toEqual([["WMTC_INIT", { identifier: "module_1", config: m.config }]]);
		expect(text(".wmtc-message")).toBe("Loading trips…");
		expect($$(".wmtc-country").length).toBeGreaterThan(150);
	});

	test("draws shading, pins, planned trips and the newest-trip halo", async () => {
		const m = await mount();
		data(m);
		expect($$(".wmtc-country.wmtc-visited")).toHaveLength(3);
		expect($$(".wmtc-country.wmtc-planned")).toHaveLength(1);
		expect($$(".wmtc-pin")).toHaveLength(4);
		expect($$(".wmtc-pin-planned")).toHaveLength(1);
		expect($$(".wmtc-halo")).toHaveLength(1);
		const usa = $$(".wmtc-country.wmtc-visited").find((p) => p.querySelector("title").textContent === "United States of America");
		expect(usa.getAttribute("style")).toBe("--wmtc-color:#4FC3F7");
		expect(text(".wmtc-message")).toBe("");
		expect(document.querySelector(".wmtc").style.getPropertyValue("--wmtc-font")).toMatch(/px$/);
		expect(document.querySelector(".wmtc-map").style.height).toMatch(/px$/);
	});

	test("Antarctica is hidden by default and can be shown", async () => {
		await mount();
		expect($$(".wmtc-country title").some((t) => t.textContent === "Antarctica")).toBe(false);
		await mount({ hideAntarctica: false });
		expect($$(".wmtc-country title").some((t) => t.textContent === "Antarctica")).toBe(true);
	});

	test("planned trips can be hidden", async () => {
		const m = await mount({ showPlanned: false });
		data(m);
		expect($$(".wmtc-pin-planned")).toHaveLength(0);
		expect($$(".wmtc-country.wmtc-planned")).toHaveLength(0);
		expect($$(".wmtc-legend-item")).toHaveLength(0);
	});

	test("halo and motion can be turned off", async () => {
		const m = await mount({ highlightNewest: false, animations: false });
		data(m);
		expect($$(".wmtc-halo")).toHaveLength(0);
		expect($$(".wmtc-cell-newest")).toHaveLength(0);
		expect(document.querySelector(".wmtc").classList.contains("wmtc-no-motion")).toBe(true);
		m.setView("together", true);
		expect(document.querySelector(".wmtc-body").classList.contains("wmtc-fade-in")).toBe(false);
	});

	test("projections", async () => {
		for (const projection of ["mercator", "naturalEarth", "equalEarth"]) {
			const m = await mount({ projection });
			data(m);
			expect($$(".wmtc-pin")).toHaveLength(4);
		}
	});

	test("does not draw into a zero-size box", async () => {
		const original = Element.prototype.getBoundingClientRect;
		Element.prototype.getBoundingClientRect = () => ({ width: 0, height: 0 });
		const m = await mount();
		data(m);
		expect(document.querySelector(".wmtc-svg")).toBeNull();
		Element.prototype.getBoundingClientRect = () => ({ width: 500, height: 0 });
		m.renderMap();
		expect(document.querySelector(".wmtc-svg")).toBeNull();
		Element.prototype.getBoundingClientRect = original;
		m.renderMap();
		expect(document.querySelector(".wmtc-svg")).not.toBeNull();
	});

	test("map download failure is shown", async () => {
		await mount({}, { fetchImpl: jest.fn(async () => ({ ok: false, status: 404 })) });
		expect(text(".wmtc-message")).toBe("Couldn't load the world map (HTTP 404)");
		expect(Log.error).toHaveBeenCalled();
	});

	test("empty states", async () => {
		const m = await mount();
		data(m, build([]));
		expect(text(".wmtc-message")).toBe("No trips yet. Add some to data/trips.json");
		expect(document.querySelector(".wmtc-ledger").hidden).toBe(true);
		expect(document.querySelector(".wmtc-stats").hidden).toBe(true);
		data(m);
		m.setView("solo:Sam");
		data(m, build([trips[2]]));
		expect(text(".wmtc-message")).toBe("No trips in this view yet");
	});

	test("errors and messages for other instances", async () => {
		const m = await mount();
		m.socketNotificationReceived("WMTC_DATA", { identifier: "someone_else", model });
		m.socketNotificationReceived("WMTC_DATA", null);
		expect($$(".wmtc-pin")).toHaveLength(0);
		m.socketNotificationReceived("WMTC_ERROR", { identifier: m.identifier, message: "Could not read trips.json" });
		expect(text(".wmtc-message")).toBe("Could not read trips.json");
		data(m);
		expect(text(".wmtc-message")).toBe("");
	});

	test("centered layout sizes itself from the config", async () => {
		await mount({ layout: "centered", maxWidth: "70%", maxHeight: 500 });
		const w = document.querySelector(".wmtc");
		expect(w.classList.contains("wmtc-layout-centered")).toBe(true);
		expect(w.style.width).toBe("70vw");
		expect(w.style.height).toBe("500px");
	});

	test("reports skipped rows unless turned off", async () => {
		const m = await mount();
		data(m, { ...model, problems: [{}, {}] });
		expect(text(".wmtc-footer")).toBe("2 rows skipped. Check your trips file.");
		data(m, { ...model, problems: [{}] });
		expect(text(".wmtc-footer")).toBe("1 row skipped. Check your trips file.");
		const quiet = await mount({ showProblems: false });
		data(quiet, { ...model, problems: [{}] });
		expect(text(".wmtc-footer")).toBe("");
	});
});

describe("view chips", () => {
	test("one chip per view with the traveler colors; planned key", async () => {
		const m = await mount();
		data(m);
		expect($$(".wmtc-chip").map((c) => c.textContent)).toEqual(["All", "Together", "Alex only", "Sam only"]);
		expect($$(".wmtc-chip .wmtc-dot").map((d) => d.style.getPropertyValue("--wmtc-color"))).toEqual(["#FFD54F", "#4FC3F7", "#F48FB1"]);
		expect(activeChip()).toBe("All");
		expect($$(".wmtc-legend-item").map((e) => e.textContent)).toEqual(["Planned"]);
	});

	test("tapping a chip switches view and pauses rotation", async () => {
		const m = await mount();
		data(m);
		$$(".wmtc-chip")[3].click();
		expect(activeChip()).toBe("Sam only");
		expect($$(".wmtc-pin")).toHaveLength(1);
		expect(m.pausedUntil).toBeGreaterThan(Date.now() + 100000);
		expect(document.querySelector(".wmtc-body").classList.contains("wmtc-fade-in")).toBe(true);
	});

	test("single traveler: no chips, a simple key", async () => {
		const m = await mount({ travelers: ["Alex"] });
		data(m, build([trips[2]], { travelerNames: ["Alex"] }));
		expect($$(".wmtc-chip")).toHaveLength(0);
		expect($$(".wmtc-legend-item").map((e) => e.textContent)).toEqual(["Alex"]);
	});

	test("legend can be turned off", async () => {
		const m = await mount({ showLegend: false });
		data(m);
		expect($$(".wmtc-chip")).toHaveLength(0);
		expect($$(".wmtc-legend-item")).toHaveLength(0);
	});

	test("person views get the person's color; unknown names get none", async () => {
		const m = await mount();
		expect(m.viewColor("person:Sam")).toBe("#F48FB1");
		expect(m.viewColor("solo:Nobody")).toBeNull();
		expect(m.viewColor("all")).toBeNull();
	});
});

describe("switching views", () => {
	test("setView by id or index, keeps view across refreshes", async () => {
		const m = await mount();
		expect(m.setView("all")).toBe(false); // no data yet
		data(m);
		expect(m.setView("solo:Sam")).toBe(true);
		expect(activeChip()).toBe("Sam only");
		expect(m.setView(1)).toBe(true);
		expect(activeChip()).toBe("Together");
		expect(m.setView("nope")).toBe(false);
		expect(m.setView(99)).toBe(false);
		data(m);
		expect(activeChip()).toBe("Together");
	});

	test("starts on the configured default view", async () => {
		const m = await mount({ defaultFilter: "together" });
		data(m);
		expect(activeChip()).toBe("Together");
		const m2 = await mount({ defaultFilter: "solo:Nobody" });
		data(m2);
		expect(activeChip()).toBe("All");
	});

	test("rotates on a timer and pauses after interaction", async () => {
		const m = await mount({ rotateInterval: 10, touchPause: 60 });
		jest.useFakeTimers({ now: Date.now() });
		data(m);
		jest.advanceTimersByTime(10000);
		expect(activeChip()).toBe("Together");
		jest.advanceTimersByTime(30000);
		expect(activeChip()).toBe("All"); // wrapped around after Sam only
		m.notificationReceived("WMTC_NEXT_FILTER");
		expect(activeChip()).toBe("Together");
		jest.advanceTimersByTime(50000);
		expect(activeChip()).toBe("Together"); // paused
		jest.advanceTimersByTime(20000);
		expect(activeChip()).not.toBe("Together");
	});

	test("no rotation when turned off or with one view; suspend and resume", async () => {
		const m = await mount({ rotateInterval: 0 });
		data(m);
		expect(m.timers.rotate).toBeUndefined();
		const m2 = await mount({ rotateInterval: 5 });
		data(m2);
		expect(m2.timers.rotate).toBeDefined();
		m2.suspend();
		expect(m2.timers).toEqual({});
		m2.resume();
		expect(m2.timers.rotate).toBeDefined();
		const solo = await mount({ travelers: ["Alex"] });
		data(solo, build([trips[2]], { travelerNames: ["Alex"] }));
		expect(solo.timers.rotate).toBeUndefined();
		expect(solo.stepView(1)).toBe(false);
	});

	test("commands from other modules", async () => {
		const m = await mount();
		data(m);
		m.notificationReceived("WMTC_SET_FILTER", "together");
		expect(activeChip()).toBe("Together");
		m.notificationReceived("WMTC_SET_FILTER", { filter: "solo:Alex" });
		expect(activeChip()).toBe("Alex only");
		m.notificationReceived("WMTC_PREV_FILTER");
		expect(activeChip()).toBe("Together");
		m.notificationReceived("WMTC_SET_FILTER", "nonsense");
		expect(activeChip()).toBe("Together");
		m.notificationReceived("CLOCK_MINUTE", {});
		m.notificationReceived("WMTC_UNKNOWN", {});
		m.notificationReceived("WMTC_SET_THEME", "analog");
		expect(document.querySelector(".wmtc").classList.contains("wmtc-theme-analog")).toBe(true);
		m.notificationReceived("WMTC_SET_THEME", { theme: "digital" });
		expect(document.querySelector(".wmtc").classList.contains("wmtc-theme-digital")).toBe(true);
		expect(m.setTheme("neon")).toBe(false);
	});
});

describe("ledger", () => {
	test("lists visited trips newest first, with traveler dots", async () => {
		const m = await mount();
		data(m);
		expect($$(".wmtc-place").map((e) => e.textContent)).toEqual(["Lisbon, Portugal", "Chicago, United States", "Reykjavík, Iceland"]);
		expect($$(".wmtc-date").map((e) => e.textContent)).toEqual(["Mar 2025", "Jun 2024", "Aug 2023"]);
		const first = $$(".wmtc-cell")[0];
		expect([...first.querySelectorAll(".wmtc-dot")].map((d) => d.title)).toEqual(["Alex", "Sam"]);
		expect(first.classList.contains("wmtc-cell-newest")).toBe(true);
		expect(first.title).toBe("Lisbon, Portugal, Mar 2025 (Alex, Sam)");
		expect(document.querySelector(".wmtc-ledger").style.getPropertyValue("--wmtc-marker-slots")).toBe("2");
	});

	test("options: planned trips, days, no country, initials, sort", async () => {
		const m = await mount({ ledger: { showPlanned: true, showDays: true, showCountry: false, travelerMarker: "initials", sort: "alpha", dateFormat: "MM/YYYY" } });
		data(m);
		expect($$(".wmtc-place").map((e) => e.textContent)).toEqual(["Cape Town", "Chicago", "Lisbon", "Reykjavík"]);
		expect($$(".wmtc-cell-planned")).toHaveLength(1);
		expect($$(".wmtc-days").map((e) => e.textContent)).toEqual(["5d"]);
		expect($$(".wmtc-initial").map((e) => e.textContent)).toEqual(["A", "S", "A", "A", "S", "S"]);
		expect(text(".wmtc-date")).toBe("04/2027");
	});

	test("color and none markers", async () => {
		const m = await mount({ ledger: { travelerMarker: "color" } });
		data(m);
		const cell = $$(".wmtc-cell")[0];
		expect(cell.classList.contains("wmtc-cell-tinted")).toBe(true);
		expect(cell.style.getPropertyValue("--wmtc-cell-color")).toBe("#FFD54F");
		const m2 = await mount({ ledger: { travelerMarker: "none" } });
		data(m2);
		expect($$(".wmtc-marker")).toHaveLength(0);
	});

	test("cycle: pages turn on a timer and on tap", async () => {
		const many = Array.from({ length: 9 }, (_, i) => trip({ id: `t${i}`, city: "Porto", country: "PT", date: `2020-0${i + 1}` }));
		const m = await mount({ ledger: { rows: 2, columns: 2, pageInterval: 5 } });
		jest.useFakeTimers({ now: Date.now() });
		data(m, build(many));
		expect($$(".wmtc-cell")).toHaveLength(4);
		expect(text(".wmtc-page")).toBe("1 / 3");
		jest.advanceTimersByTime(5000);
		expect(text(".wmtc-page")).toBe("2 / 3");
		document.querySelector(".wmtc-ledger").click();
		expect(text(".wmtc-page")).toBe("3 / 3");
		expect($$(".wmtc-cell")).toHaveLength(1);
		m.notificationReceived("WMTC_NEXT_PAGE");
		expect(text(".wmtc-page")).toBe("1 / 3");
		m.setView("together");
		expect(text(".wmtc-page")).toBe("1 / 3");
	});

	test("shrink: everything on one page, smaller text, +N more past the minimum", async () => {
		const many = Array.from({ length: 30 }, (_, i) => trip({ id: `t${i}`, city: "Porto", country: "PT", date: `20${10 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}` }));
		const m = await mount({ ledger: { rows: 2, columns: 2, overflow: "shrink", minFontSize: 6 } });
		data(m, build(many));
		expect(document.querySelector(".wmtc-page")).toBeNull();
		expect(text(".wmtc-cell-more")).toMatch(/^\+\d+ more$/);
		expect(m.timers.page).toBeUndefined();
		expect(m.turnPage()).toBe(false);
	});

	test("ledger can be turned off", async () => {
		const m = await mount({ ledger: { enabled: false } });
		data(m);
		expect(document.querySelector(".wmtc-ledger").hidden).toBe(true);
		expect(m.timers.page).toBeUndefined();
	});
});

describe("stats", () => {
	test("shows the chosen stats for the current view", async () => {
		const m = await mount({ stats: ["countries", "cities", "distance"] });
		data(m);
		expect($$(".wmtc-stat").map((e) => e.textContent)).toEqual(["3 countries", "3 cities"]);
		m.setView("solo:Sam");
		expect($$(".wmtc-stat").map((e) => e.textContent)).toEqual(["1 country", "1 city"]);
	});

	test("can be turned off", async () => {
		const m = await mount({ showStats: false });
		data(m);
		expect(document.querySelector(".wmtc-stats").hidden).toBe(true);
	});
});

describe("analog theme", () => {
	test("paper class, graticule and watercolor wash", async () => {
		const m = await mount({ theme: "analog" });
		data(m);
		expect(document.querySelector(".wmtc").classList.contains("wmtc-theme-analog")).toBe(true);
		expect(document.querySelector(".wmtc-graticule")).not.toBeNull();
		expect(document.querySelector("filter#wmtc-wash-module_1")).not.toBeNull();
		expect($$(".wmtc-visited").every((p) => p.getAttribute("filter") === "url(#wmtc-wash-module_1)")).toBe(true);
	});

	test("digital has neither", async () => {
		const m = await mount();
		data(m);
		expect(document.querySelector(".wmtc-graticule")).toBeNull();
		expect($$(".wmtc-visited").some((p) => p.hasAttribute("filter"))).toBe(false);
	});
});
