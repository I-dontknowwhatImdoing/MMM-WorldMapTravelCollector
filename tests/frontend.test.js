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
const Layout = require("../lib/layout");
global.WMTCLayout = Layout;
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
		expect(definition.def.defaults.ledger).toMatchObject({ rows: "auto", columns: 4, overflow: "cycle" });
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

	test("fadeByAge draws older places fainter; off by default", async () => {
		const m = await mount();
		data(m);
		expect($$(".wmtc-visited, .wmtc-pin").some((p) => p.getAttribute("style").includes("--wmtc-fade"))).toBe(false);

		const faded = await mount({ fadeByAge: true, fadeStrength: 0.6, fadeUnit: "years", fadeAmount: 10 });
		data(faded);
		const fadeOf = (el) => el.style.getPropertyValue("--wmtc-fade");
		const country = (name) => $$(".wmtc-country").find((p) => p.querySelector("title").textContent === name);
		const pin = (city) => $$(".wmtc-pin").find((p) => p.querySelector("title").textContent === city);
		// Today is Nov 2026: Lisbon Mar 2025 (20 months), Chicago Jun 2024 (29), Reykjavík Aug 2023 (39).
		expect(fadeOf(country("Portugal"))).toBe("0.9");
		expect(fadeOf(country("United States of America"))).toBe("0.855");
		expect(fadeOf(country("Iceland"))).toBe("0.805");
		expect(fadeOf(pin("Reykjavík"))).toBe("0.805");
		// Planned trips are never faded.
		expect(fadeOf(country("South Africa"))).toBe("");
		expect(fadeOf(pin("Cape Town"))).toBe("");

		// Months: 20 of 24 months for Lisbon; anything 24+ months old is fully faded.
		const months = await mount({ fadeByAge: true, fadeStrength: 0.6, fadeUnit: "months", fadeAmount: 24 });
		data(months);
		expect(fadeOf(country("Portugal"))).toBe("0.5");
		expect(fadeOf(country("Iceland"))).toBe("0.4");

		// Days: a 90-day fade leaves only very recent trips bright; all of these are older.
		const days = await mount({ fadeByAge: true, fadeStrength: 0.6, fadeUnit: "days", fadeAmount: 90 });
		data(days);
		expect(fadeOf(country("Portugal"))).toBe("0.4");
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
		for (const projection of ["mercator", "naturalEarth", "equirectangular", "equalEarth"]) {
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
		expect(text(".wmtc-footer")).toBe("2 rows skipped. Open the trip editor to see why.");
		data(m, { ...model, problems: [{}] });
		expect(text(".wmtc-footer")).toBe("1 row skipped. Open the trip editor to see why.");
		data(m, { ...model, problems: [{ row: 3 }, { source: "Google Sheet", row: 0, errors: ["The sheet isn't shared"] }] });
		expect(text(".wmtc-footer")).toBe("Google Sheet: The sheet isn't shared");
		data(m, { ...model, problems: [{ source: "trips.json", row: 0 }] });
		expect(text(".wmtc-footer")).toBe("trips.json: couldn't be read");
		const quiet = await mount({ showProblems: false });
		data(quiet, { ...model, problems: [{}] });
		expect(text(".wmtc-footer")).toBe("");
	});
});

describe("hidden module", () => {
	test("B8: new data while hidden doesn't restart rotation; showing it again does", async () => {
		const m = await mount({ rotateInterval: 30 });
		data(m);
		expect(Object.keys(m.timers)).toContain("rotate");
		m.hidden = true;
		m.suspend();
		expect(Object.keys(m.timers)).toEqual([]);
		data(m);
		expect(Object.keys(m.timers)).toEqual([]);
		m.hidden = false;
		m.resume();
		expect(Object.keys(m.timers)).toContain("rotate");
	});
});

describe("color by year or month", () => {
	const colorOf = (sel) => document.querySelector(sel).style.getPropertyValue("--wmtc-color");
	const pt = ".wmtc-country[data-code='PT']";
	const chipDots = () => $$(".wmtc-chip").map((c) => [c.textContent, c.querySelector(".wmtc-dot") ? c.querySelector(".wmtc-dot").style.getPropertyValue("--wmtc-color") : null]);

	test("year gradient on the map, with a key when the view chips are about people", async () => {
		const m = await mount({ colorBy: "year" });
		data(m);
		// Years with trips: 2023, 2024, 2025, 2027. Portugal (2025) sits two thirds along the gradient.
		expect(colorOf(pt)).toBe(Layout.yearColor("2025", ["2023", "2024", "2025", "2027"]));
		expect(colorOf(".wmtc-country[data-code='ZA']")).toBe("#FFD54F"); // planned 2027: newest
		expect(colorOf(".wmtc-pin[data-pin='lisbon|PT']")).toBe(colorOf(pt));
		// People chips lose their dots: the map isn't colored by people.
		expect(chipDots().every(([, c]) => c === null)).toBe(true);
		expect(text(".wmtc-key")).toBe("20232027");
		expect(document.querySelector(".wmtc-key-gradient").style.background).toContain("linear-gradient");
	});

	test("distinct year colors and year views: the chips are the key", async () => {
		const m = await mount({ colorBy: "year", yearColors: "distinct", filters: ["all", "years"] });
		data(m, build(trips, { filters: ["all", "years"] }));
		expect(chipDots()).toEqual([
			["All", null],
			["2027", Layout.DEFAULT_COLORS[0]],
			["2025", Layout.DEFAULT_COLORS[1]],
			["2024", Layout.DEFAULT_COLORS[2]],
			["2023", Layout.DEFAULT_COLORS[3]]
		]);
		expect($$(".wmtc-key")).toHaveLength(0);
		expect(colorOf(pt)).toBe(Layout.DEFAULT_COLORS[1]);
		m.setView("year:2024");
		expect($$(".wmtc-country.wmtc-visited")).toHaveLength(1);
	});

	test("few years or chosen colors show a swatch per year", async () => {
		const m = await mount({ colorBy: "year", yearColors: { 2025: "#E57373" } });
		data(m);
		expect(colorOf(pt)).toBe("#E57373");
		expect($$(".wmtc-legend-item").map((i) => i.textContent)).toEqual(["2027", "2025", "2024", "2023", "Planned"]);
		const few = await mount({ colorBy: "year" });
		data(few, build(trips.slice(0, 2)));
		expect($$(".wmtc-legend-item").map((i) => i.textContent)).toEqual(["2025", "2023"]);
	});

	test("month colors and month views, in the mirror's language", async () => {
		const m = await mount({ colorBy: "month", filters: ["all", "months"] });
		m.locale = "de";
		data(m, build(trips, { filters: ["all", "months"] }));
		expect($$(".wmtc-chip").map((c) => c.textContent)).toEqual(["All", "März", "April", "Juni", "August"]);
		expect(colorOf(pt)).toBe(Layout.monthColor(3));
		expect($$(".wmtc-key")).toHaveLength(0);

		const key = await mount({ colorBy: "month", monthColors: Array(12).fill("#123456") });
		data(key);
		expect(colorOf(pt)).toBe("#123456");
		expect($$(".wmtc-legend-item").map((i) => i.textContent)).toEqual(["Mar", "Apr", "Jun", "Aug", "Planned"]);
		const hidden = await mount({ colorBy: "month", showPlanned: false });
		data(hidden);
		expect($$(".wmtc-legend-item").map((i) => i.textContent)).toEqual(["Mar", "Jun", "Aug"]);
	});

	test("custom month labels and the one-traveler key", async () => {
		const m = await mount({ filters: ["all", "months"], labels: { month: "{name}!" } });
		data(m, build(trips, { filters: ["all", "months"], labels: { month: "{name}!" } }));
		expect($$(".wmtc-chip").map((c) => c.textContent)).toContain("March!");
		const solo = await mount({ travelers: [{ name: "Alex", color: "#4FC3F7" }], colorBy: "year" });
		data(solo, build(trips.filter((t) => t.travelers.join() === "Alex"), { travelerNames: ["Alex"] }));
		expect($$(".wmtc-legend-item").map((i) => i.textContent)).toEqual(["2024"]);
	});
});

describe("details card", () => {
	const click = (target, coords = {}) => target.dispatchEvent(new MouseEvent("click", { bubbles: true, ...coords }));
	const country = (code) => document.querySelector(`.wmtc-country[data-code='${code}']`);

	test("tapping a pin shows its visits; the nearest pin wins", async () => {
		const m = await mount();
		data(m);
		const lisbon = m.pinPoints.find((p) => p.key === "lisbon|PT");
		click(document.querySelector(".wmtc-svg"), { clientX: lisbon.x + 3, clientY: lisbon.y - 2 });
		expect(text(".wmtc-detail-title")).toBe("Lisbon, Portugal");
		expect(text(".wmtc-detail-visit")).toBe("Mar 20255 days · Alex & Sam");
		expect($$(".wmtc-pin.wmtc-selected")).toHaveLength(1);
		expect(document.querySelector(".wmtc-detail").style.left).toMatch(/px$/);
		// Without coordinates (keyboard, assistive tech), the pin itself is used.
		click(document.querySelector(".wmtc-pin[data-pin='chicago|US']"));
		expect(text(".wmtc-detail-title")).toBe("Chicago, United States");
		expect($$(".wmtc-detail")).toHaveLength(1);
	});

	test("tapping a country shows its summary; planned trips are marked", async () => {
		const m = await mount();
		data(m);
		click(country("PT"));
		expect(text(".wmtc-detail-title")).toBe("Portugal");
		expect($$(".wmtc-detail-facts li").map((li) => li.textContent)).toEqual(["1 trip · 1 city · 5 days in total", "Visited Mar 2025", "With Alex & Sam"]);
		expect(country("PT").classList.contains("wmtc-selected")).toBe(true);
		click(country("ZA"));
		expect(text(".wmtc-detail-tag")).toBe("planned");
		expect($$(".wmtc-detail-planned")).toHaveLength(1);
		expect(country("PT").classList.contains("wmtc-selected")).toBe(false);
	});

	test("closes with ×, a tap elsewhere, a redraw, hiding the module, or after detailsTimeout", async () => {
		const m = await mount({ detailsTimeout: 5 });
		data(m);
		click(country("PT"));
		click(document.querySelector(".wmtc-detail-title"));
		expect($$(".wmtc-detail")).toHaveLength(1);
		click(document.querySelector(".wmtc-detail-close"));
		expect($$(".wmtc-detail")).toHaveLength(0);

		click(country("PT"));
		click(document.querySelector(".wmtc-svg"));
		expect($$(".wmtc-detail")).toHaveLength(0);

		click(country("IS"));
		m.setView("together");
		expect($$(".wmtc-detail")).toHaveLength(0);

		click(country("PT"));
		m.suspend();
		expect($$(".wmtc-detail")).toHaveLength(0);

		jest.useFakeTimers();
		click(country("PT"));
		jest.advanceTimersByTime(4900);
		expect($$(".wmtc-detail")).toHaveLength(1);
		jest.advanceTimersByTime(200);
		expect($$(".wmtc-detail")).toHaveLength(0);
	});

	test("pauses rotation while open; detailsTimeout 0 keeps it open until closed", async () => {
		const m = await mount({ detailsTimeout: 0, touchPause: 60 });
		data(m);
		click(country("PT"));
		expect(m.pausedUntil).toBe(Infinity);
		click(document.querySelector(".wmtc-detail-close"));
		expect(m.pausedUntil).toBeGreaterThan(Date.now() + 50000);
		expect(m.pausedUntil).toBeLessThan(Infinity);
	});

	test("respects showPlanned, details: false, and taps before data arrives", async () => {
		const hidden = await mount({ showPlanned: false });
		data(hidden);
		hidden.showDetails("country", ["cpt"]);
		expect($$(".wmtc-detail")).toHaveLength(0);

		const off = await mount({ details: false });
		data(off);
		click(country("PT"));
		expect($$(".wmtc-detail")).toHaveLength(0);

		const early = await mount();
		early.showDetails("pin", ["lis"]);
		early.onMapClick({ target: null });
		click(document.querySelector(".wmtc-country"));
		expect($$(".wmtc-detail")).toHaveLength(0);
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
		const m = await mount({ defaultView: "together" });
		data(m);
		expect(activeChip()).toBe("Together");
		const m2 = await mount({ defaultView: "solo:Nobody" });
		data(m2);
		expect(activeChip()).toBe("All");
	});

	test("the names from before 1.0 (filters, defaultFilter) still work; the new ones win", async () => {
		const old = await mount({ filters: ["all", "years"], defaultFilter: "year:2024" });
		expect(old.config).toMatchObject({ views: ["all", "years"], defaultView: "year:2024" });
		expect(old.sent[0][1].config.views).toEqual(["all", "years"]);
		data(old, build(trips, { filters: ["all", "years"] }));
		expect(activeChip()).toBe("2024");
		const both = await mount({ filters: ["all"], views: ["all", "solo"], defaultFilter: "all", defaultView: "solo:Sam" });
		expect(both.config).toMatchObject({ views: ["all", "solo"], defaultView: "solo:Sam" });
		const neither = await mount({ filters: "nope", defaultFilter: 3 });
		expect(neither.config).toMatchObject({ views: ["all", "together", "solo"], defaultView: "all" });
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
		// The names since 1.0.
		m.notificationReceived("WMTC_SET_VIEW", { view: "solo:Sam" });
		expect(activeChip()).toBe("Sam only");
		m.notificationReceived("WMTC_NEXT_VIEW");
		expect(activeChip()).toBe("All");
		m.notificationReceived("WMTC_PREV_VIEW");
		expect(activeChip()).toBe("Sam only");
		m.notificationReceived("WMTC_SET_VIEW", "together");
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

describe("phase 3: getting started (R1)", () => {
	const link = { url: "http://192.168.1.20:8080/MMM-WorldMapTravelCollector/", reachable: true, reason: "", qr: { size: 21, d: "M0 0h7v1h-7z" } };
	const editor = (m, e = link) => m.socketNotificationReceived("WMTC_EDITOR", { identifier: m.identifier, editor: e });
	const empty = { ...build([]), problems: [] };

	test("no trips yet: the map says to add them from a phone, with a QR code and the address", async () => {
		const m = await mount();
		data(m, empty);
		editor(m);
		expect(document.querySelector(".wmtc-start-full")).not.toBeNull();
		expect(text(".wmtc-start-title")).toBe("Add trips from your phone");
		expect(text(".wmtc-start-url")).toBe(link.url);
		expect(document.querySelector(".wmtc-qr path").getAttribute("d")).toBe("M0 0h7v1h-7z");
		expect(document.querySelector(".wmtc-qr").getAttribute("viewBox")).toBe("-2 -2 25 25");
		expect(text(".wmtc-message")).toBe("");
		// Still there after a redraw, and gone once there are trips (after the first 10 minutes).
		m.render();
		expect($$(".wmtc-start")).toHaveLength(1);
		m.startedAt -= 11 * 60 * 1000;
		data(m);
		expect($$(".wmtc-start")).toHaveLength(0);
	});

	test("with trips: a corner card for the first 10 minutes, then nothing", async () => {
		const m = await mount();
		jest.useFakeTimers();
		data(m);
		editor(m);
		expect(document.querySelector(".wmtc-start-corner")).not.toBeNull();
		jest.advanceTimersByTime(10 * 60 * 1000 + 100);
		expect($$(".wmtc-start")).toHaveLength(0);
	});

	test("showEditorLink true keeps it; false never shows it, even with no trips", async () => {
		const always = await mount({ showEditorLink: true });
		data(always);
		always.startedAt -= 60 * 60 * 1000;
		editor(always);
		expect($$(".wmtc-start-corner")).toHaveLength(1);
		const never = await mount({ showEditorLink: false });
		data(never, empty);
		editor(never);
		expect($$(".wmtc-start")).toHaveLength(0);
		expect(text(".wmtc-message")).toBe("No trips yet. Add some to data/trips.json");
	});

	test("when phones can't reach the editor, it says so instead of showing a code", async () => {
		const m = await mount();
		data(m, empty);
		editor(m, { url: link.url, reachable: false, reason: "address", qr: null });
		expect($$(".wmtc-qr")).toHaveLength(0);
		expect(text(".wmtc-start-help")).toMatch(/only lets the mirror itself in.*README/);
		editor(m, { url: null, reachable: false, reason: "network", qr: null });
		expect(text(".wmtc-start-help")).toMatch(/isn't connected to a network/);
	});

	test("nothing before the node helper says where the editor is (editor: false)", async () => {
		const m = await mount();
		data(m, empty);
		expect($$(".wmtc-start")).toHaveLength(0);
	});
});

describe("phase 3: readable, color-blind-safe colors (R2, R4)", () => {
	const colorOf = (sel) => document.querySelector(sel).style.getPropertyValue("--wmtc-color");

	test("contrast: high", async () => {
		await mount({ contrast: "high" });
		expect(document.querySelector(".wmtc").classList.contains("wmtc-contrast-high")).toBe(true);
		await mount();
		expect(document.querySelector(".wmtc").classList.contains("wmtc-contrast-high")).toBe(false);
	});

	test("colorBy season: four colors, a key, month buttons in their season's color", async () => {
		const m = await mount({ colorBy: "season", views: ["all", "months"] });
		data(m, build(trips, { filters: ["all", "months"] }));
		expect(colorOf(".wmtc-country[data-code='PT']")).toBe(Layout.DEFAULT_SEASON_COLORS[1]); // March: spring
		expect(colorOf(".wmtc-country[data-code='IS']")).toBe(Layout.DEFAULT_SEASON_COLORS[2]); // August: summer
		expect($$(".wmtc-legend-item").map((i) => i.textContent)).toEqual(["Spring", "Summer", "Planned"]);
		expect($$(".wmtc-chip .wmtc-dot").map((d) => d.style.getPropertyValue("--wmtc-color"))).toEqual([
			Layout.DEFAULT_SEASON_COLORS[1], Layout.DEFAULT_SEASON_COLORS[1], Layout.DEFAULT_SEASON_COLORS[2], Layout.DEFAULT_SEASON_COLORS[2]
		]);
	});

	test("southern hemisphere, chosen colors and names", async () => {
		const m = await mount({ colorBy: "season", hemisphere: "south", seasonColors: ["#111111", "#222222", "#333333", "#444444"], labels: { autumn: "Fall" }, showPlanned: false });
		data(m);
		expect(colorOf(".wmtc-country[data-code='PT']")).toBe("#444444"); // March in the south: autumn
		// March: autumn; June and August: winter (April 2027 is planned, and hidden here).
		expect($$(".wmtc-legend-item").map((i) => i.textContent)).toEqual(["Winter", "Fall"]);
	});
});

describe("phase 3: compact view switcher (R3)", () => {
	const yearModel = () => build(trips, { filters: ["all", "years"] });

	test("compact: one button for the view, arrows and a dot per view", async () => {
		const m = await mount({ viewSwitcher: "compact", colorBy: "year", views: ["all", "years"] });
		data(m, yearModel());
		expect($$(".wmtc-switcher")).toHaveLength(1);
		expect(text(".wmtc-switcher-current")).toBe("All");
		expect($$(".wmtc-pos")).toHaveLength(5);
		document.querySelector("[aria-label='Next view']").click();
		expect(text(".wmtc-switcher-current")).toBe("2027");
		expect(document.querySelector(".wmtc-pos-active")).toBe($$(".wmtc-pos")[1]);
		document.querySelector("[aria-label='Previous view']").click();
		document.querySelector("[aria-label='Previous view']").click();
		expect(text(".wmtc-switcher-current")).toBe("2023");
		document.querySelector(".wmtc-switcher-current").click();
		expect(text(".wmtc-switcher-current")).toBe("All");
		expect(m.pausedUntil).toBeGreaterThan(Date.now());
		// The buttons no longer show every year's color, so a key does.
		expect($$(".wmtc-key")).toHaveLength(1);
	});

	test("auto: buttons while they fit on one line, compact once they wrap", async () => {
		const m = await mount({ views: ["all", "years"] });
		data(m, yearModel());
		expect($$(".wmtc-switcher")).toHaveLength(0);
		const spy = jest.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function () {
			return this.classList.contains("wmtc-chip") ? [...this.parentNode.children].indexOf(this) * 12 : 0;
		});
		try {
			m.render();
			expect($$(".wmtc-switcher")).toHaveLength(1);
			const buttons = await mount({ views: ["all", "years"], viewSwitcher: "buttons" });
			data(buttons, yearModel());
			expect($$(".wmtc-switcher")).toHaveLength(0);
			expect($$(".wmtc-chip")).toHaveLength(5);
		} finally {
			spy.mockRestore();
		}
	});

	test("many views: a count instead of dots", async () => {
		const many = Array.from({ length: 22 }, (_, i) => trip({ id: `t${i}`, city: "Lisbon", country: "PT", date: `${2000 + i}-05` }));
		const m = await mount({ viewSwitcher: "compact", views: ["all", "years"] });
		data(m, build(many, { filters: ["all", "years"] }));
		expect(text(".wmtc-switcher-dots")).toBe("1 / 23");
	});
});

describe("phase 3: touch hint and a private card (R5)", () => {
	const click = (target, coords = {}) => target.dispatchEvent(new MouseEvent("click", { bubbles: true, ...coords }));

	test("touch screens get a hint until the first tap", async () => {
		Object.defineProperty(navigator, "maxTouchPoints", { value: 5, configurable: true });
		try {
			const m = await mount();
			data(m);
			expect(text(".wmtc-message")).toBe("Tap a place for details");
			click(document.querySelector(".wmtc-svg"), { clientX: 5, clientY: 5 });
			expect(text(".wmtc-message")).toBe("");
			m.render();
			expect(text(".wmtc-message")).toBe("");
			const off = await mount({ detailsHint: false });
			data(off);
			expect(text(".wmtc-message")).toBe("");
		} finally {
			delete navigator.maxTouchPoints;
		}
	});

	test("no hint without a touch screen", async () => {
		const m = await mount();
		data(m);
		expect(text(".wmtc-message")).toBe("");
	});

	test("detailsNotes: false keeps notes off the card; a tap anywhere else closes it", async () => {
		const noted = trips.map((t) => (t.id === "lis" ? { ...t, note: "Anniversary" } : t));
		const m = await mount({ detailsNotes: false });
		data(m, build(noted));
		const lisbon = m.pinPoints.find((p) => p.key === "lisbon|PT");
		click(document.querySelector(".wmtc-svg"), { clientX: lisbon.x, clientY: lisbon.y });
		expect(text(".wmtc-detail-title")).toBe("Lisbon, Portugal");
		expect($$(".wmtc-detail-note")).toHaveLength(0);
		click(document.querySelector(".wmtc-stats"));
		expect($$(".wmtc-detail")).toHaveLength(0);

		const shown = await mount();
		data(shown, build(noted));
		click(document.querySelector(".wmtc-svg"), { clientX: lisbon.x, clientY: lisbon.y });
		expect(text(".wmtc-detail-note")).toBe("Anniversary");
	});
});

describe("phase 3: speed and room (M1, M3)", () => {
	test("switching views recolors the map instead of drawing the world again", async () => {
		const m = await mount();
		data(m);
		const svg = document.querySelector(".wmtc-svg");
		const spain = [...document.querySelectorAll(".wmtc-country")].find((p) => p.querySelector("title").textContent === "Spain");
		m.setView("solo:Sam");
		expect(document.querySelector(".wmtc-svg")).toBe(svg);
		expect($$(".wmtc-svg")).toHaveLength(1);
		expect($$(".wmtc-country.wmtc-visited").map((p) => p.getAttribute("data-code"))).toEqual(["IS"]);
		expect(document.querySelector(".wmtc-country[data-code='PT']")).toBeNull();
		expect($$(".wmtc-pin")).toHaveLength(1);
		m.setView("all");
		expect($$(".wmtc-country.wmtc-visited")).toHaveLength(3);
		expect(spain.isConnected).toBe(true);
		// A new theme draws it again.
		m.setTheme("analog");
		expect(document.querySelector(".wmtc-svg")).not.toBe(svg);
		expect($$(".wmtc-svg")).toHaveLength(1);
		expect(document.querySelector(".wmtc-country[data-code='PT']").getAttribute("filter")).toMatch(/^url\(#wmtc-wash-/);
	});

	test("ledger rows: \"auto\" fills a tall screen when there are trips for it, a number stays fixed", async () => {
		const many = Array.from({ length: 40 }, (_, i) => trip({ id: `t${i}`, city: "Lisbon", country: "PT", date: `${2000 + (i % 20)}-${String((i % 12) + 1).padStart(2, "0")}` }));
		const rowsOf = () => document.querySelector(".wmtc-ledger-grid").style.gridTemplateRows;
		const tall = (m) => {
			m.bodyEl.getBoundingClientRect = () => ({ width: 1000, height: 1700, top: 0, left: 0 });
			m.statsEl.getBoundingClientRect = () => ({ width: 1000, height: 30, top: 0, left: 0 });
		};
		const m = await mount();
		tall(m);
		data(m, build(many));
		expect(rowsOf()).toBe("repeat(10, 1fr)"); // 40 trips in 4 columns
		data(m, build(many.slice(0, 12)));
		expect(rowsOf()).toBe("repeat(5, 1fr)");
		const lots = Array.from({ length: 90 }, (_, i) => trip({ id: `u${i}`, city: "Lisbon", country: "PT", date: `${1990 + (i % 30)}-0${(i % 9) + 1}` }));
		data(m, build(lots));
		expect(rowsOf()).toBe("repeat(23, 1fr)"); // 90 trips, 4 columns

		const fixed = await mount({ ledger: { rows: 3 } });
		tall(fixed);
		data(fixed, build(many));
		expect(rowsOf()).toBe("repeat(3, 1fr)");
		// Landscape: no room under the map, so 5.
		const wide = await mount();
		data(wide, build(many));
		expect(rowsOf()).toBe("repeat(5, 1fr)");
	});
});
