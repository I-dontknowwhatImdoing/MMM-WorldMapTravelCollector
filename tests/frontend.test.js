/**
 * @jest-environment jsdom
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildViewModel } = require("../lib/viewmodel");
const { loadGeoData } = require("../lib/geodata");
const { NOW, trip } = require("./helpers");

const WORLD = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "geo", "countries-50m.json"), "utf8"));

// Load the same browser builds MagicMirror loads, the way a <script> tag would.
for (const file of ["d3-array/dist/d3-array.min.js", "d3-geo/dist/d3-geo.min.js", "topojson-client/dist/topojson-client.min.js"]) {
	(0, eval)(fs.readFileSync(path.join(__dirname, "..", "node_modules", file), "utf8"));
}
global.WMTCLayout = require("../lib/layout");
global.Log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
let definition;
global.Module = { register: (name, def) => (definition = { name, def }) };
require("../MMM-WorldMapTravelCollector.js");

Element.prototype.getBoundingClientRect = function () {
	return { width: 1200, height: 700, top: 0, left: 0, right: 1200, bottom: 700, x: 0, y: 0 };
};

const geo = loadGeoData();
const trips = [
	trip({ id: "lis", city: "Lisbon", country: "PT", date: "2025-03" }),
	trip({ id: "rey", city: "Reykjavík", country: "IS", date: "2023-08", travelers: ["Sam"], lat: 64.1, lon: -21.9 }),
	trip({ id: "chi", city: "Chicago", country: "US", date: "2024-06", travelers: ["Alex"], lat: 41.85, lon: -87.65 }),
	trip({ id: "cpt", city: "Cape Town", country: "ZA", date: "2027-04", lat: -33.92, lon: 18.42 })
];
const model = buildViewModel(trips, { travelerNames: ["Alex", "Sam"], now: NOW, countries: geo.countries });

const flush = () => new Promise((r) => setTimeout(r, 0));

async function mount (config = {}, { fetchImpl } = {}) {
	global.fetch = fetchImpl || jest.fn(async () => ({ ok: true, json: async () => WORLD }));
	const m = Object.create(definition.def);
	m.name = definition.name;
	m.identifier = "module_1";
	m.config = { ...definition.def.defaults, travelers: [{ name: "Alex", color: "#4FC3F7" }, { name: "Sam", color: "#F48FB1" }], ...config };
	m.file = (p) => `/modules/x/${p}`;
	m.sent = [];
	m.sendSocketNotification = (n, p) => m.sent.push([n, p]);
	m.start();
	document.body.innerHTML = "";
	document.body.append(m.getDom());
	await flush();
	await flush();
	return m;
}

const data = (m, extra = {}) => m.socketNotificationReceived("WMTC_DATA", { identifier: m.identifier, model: { ...model, problems: [], ...extra } });
const $$ = (sel) => [...document.querySelectorAll(sel)];

describe("front end", () => {
	test("registers with defaults, scripts and styles", () => {
		expect(definition.name).toBe("MMM-WorldMapTravelCollector");
		const m = Object.create(definition.def);
		m.file = (p) => p;
		expect(m.getScripts()).toEqual(expect.arrayContaining(["node_modules/d3-geo/dist/d3-geo.min.js", "lib/layout.js"]));
		expect(m.getStyles()).toEqual(["css/wmtc.css"]);
		expect(definition.def.defaults.filters).toEqual(["all", "together", "solo"]);
	});

	test("asks the helper for data on start and shows loading messages", async () => {
		const m = await mount();
		expect(m.sent).toEqual([["WMTC_INIT", { identifier: "module_1", config: m.config }]]);
		expect(document.querySelector(".wmtc-message").textContent).toBe("Loading trips…");
		expect($$(".wmtc-country").length).toBeGreaterThan(200);
	});

	test("draws shading, pins, planned trips and the newest-trip halo", async () => {
		const m = await mount();
		data(m);
		expect($$(".wmtc-country.wmtc-visited")).toHaveLength(3);
		expect($$(".wmtc-country.wmtc-planned")).toHaveLength(1);
		expect($$(".wmtc-pin")).toHaveLength(4);
		expect($$(".wmtc-pin-planned")).toHaveLength(1);
		expect($$(".wmtc-halo")).toHaveLength(1);
		expect(document.querySelector(".wmtc-title").textContent).toBe("All");
		expect($$(".wmtc-legend-item").map((e) => e.textContent)).toEqual(["Alex", "Sam", "Together", "Planned"]);
		const usa = $$(".wmtc-country.wmtc-visited").find((p) => p.querySelector("title").textContent === "United States of America");
		expect(usa.getAttribute("style")).toBe("--wmtc-color:#4FC3F7");
		expect(document.querySelector(".wmtc-message").textContent).toBe("");
		expect(document.querySelector(".wmtc").style.getPropertyValue("--wmtc-font")).toMatch(/px$/);
	});

	test("Antarctica is hidden by default and can be shown", async () => {
		await mount();
		expect($$(".wmtc-country title").some((t) => t.textContent === "Antarctica")).toBe(false);
		await mount({ hideAntarctica: false });
		expect($$(".wmtc-country title").some((t) => t.textContent === "Antarctica")).toBe(true);
	});

	test("switching views", async () => {
		const m = await mount();
		data(m);
		expect(m.setView("solo:Sam")).toBe(true);
		expect(document.querySelector(".wmtc-title").textContent).toBe("Sam only");
		expect($$(".wmtc-pin")).toHaveLength(1);
		expect($$(".wmtc-legend-item").map((e) => e.textContent)).toEqual(["Sam"]);
		expect(m.setView(1)).toBe(true);
		expect(document.querySelector(".wmtc-title").textContent).toBe("Together");
		expect(m.setView("nope")).toBe(false);
		expect(m.setView(99)).toBe(false);
		// New data keeps the current view
		data(m);
		expect(document.querySelector(".wmtc-title").textContent).toBe("Together");
	});

	test("setView before data does nothing", async () => {
		const m = await mount();
		expect(m.setView("all")).toBe(false);
	});

	test("starts on the configured default view", async () => {
		const m = await mount({ defaultFilter: "together" });
		data(m);
		expect(document.querySelector(".wmtc-title").textContent).toBe("Together");
		const m2 = await mount({ defaultFilter: "solo:Nobody" });
		data(m2);
		expect(document.querySelector(".wmtc-title").textContent).toBe("All");
	});

	test("planned trips can be hidden", async () => {
		const m = await mount({ showPlanned: false });
		data(m);
		expect($$(".wmtc-pin-planned")).toHaveLength(0);
		expect($$(".wmtc-country.wmtc-planned")).toHaveLength(0);
		expect($$(".wmtc-legend-item").map((e) => e.textContent)).not.toContain("Planned");
	});

	test("legend and halo can be turned off; motion can be turned off", async () => {
		const m = await mount({ showLegend: false, highlightNewest: false, animations: false });
		data(m);
		expect($$(".wmtc-legend-item")).toHaveLength(0);
		expect($$(".wmtc-halo")).toHaveLength(0);
		expect(document.querySelector(".wmtc").classList.contains("wmtc-no-motion")).toBe(true);
	});

	test("reports skipped rows unless turned off", async () => {
		const m = await mount();
		data(m, { problems: [{}, {}] });
		expect(document.querySelector(".wmtc-footer").textContent).toBe("2 rows skipped. Check your trips file.");
		data(m, { problems: [{}] });
		expect(document.querySelector(".wmtc-footer").textContent).toBe("1 row skipped. Check your trips file.");
		const quiet = await mount({ showProblems: false });
		data(quiet, { problems: [{}] });
		expect(document.querySelector(".wmtc-footer").textContent).toBe("");
	});

	test("empty states", async () => {
		const m = await mount();
		const empty = buildViewModel([], { travelerNames: ["Alex", "Sam"], now: NOW, countries: geo.countries });
		m.socketNotificationReceived("WMTC_DATA", { identifier: m.identifier, model: { ...empty, problems: [] } });
		expect(document.querySelector(".wmtc-message").textContent).toBe("No trips yet. Add some to data/trips.json");
		data(m);
		m.setView("solo:Sam");
		const onlyAlex = buildViewModel([trips[2]], { travelerNames: ["Alex", "Sam"], now: NOW, countries: geo.countries });
		m.socketNotificationReceived("WMTC_DATA", { identifier: m.identifier, model: { ...onlyAlex, problems: [] } });
		expect(document.querySelector(".wmtc-message").textContent).toBe("No trips in this view yet");
	});

	test("errors and messages for other instances", async () => {
		const m = await mount();
		m.socketNotificationReceived("WMTC_DATA", { identifier: "someone_else", model });
		m.socketNotificationReceived("WMTC_DATA", null);
		expect($$(".wmtc-pin")).toHaveLength(0);
		m.socketNotificationReceived("WMTC_ERROR", { identifier: m.identifier, message: "Could not read trips.json" });
		expect(document.querySelector(".wmtc-message").textContent).toBe("Could not read trips.json");
		data(m);
		expect(document.querySelector(".wmtc-message").textContent).toBe("");
	});

	test("map download failure is shown", async () => {
		await mount({}, { fetchImpl: jest.fn(async () => ({ ok: false, status: 404 })) });
		expect(document.querySelector(".wmtc-message").textContent).toBe("Couldn't load the world map (HTTP 404)");
		expect(Log.error).toHaveBeenCalled();
	});

	test("centered layout sizes itself from the config", async () => {
		await mount({ layout: "centered", maxWidth: "70%", maxHeight: 500 });
		const w = document.querySelector(".wmtc");
		expect(w.classList.contains("wmtc-layout-centered")).toBe(true);
		expect(w.style.width).toBe("70vw");
		expect(w.style.height).toBe("500px");
	});

	test("projections", async () => {
		for (const projection of ["mercator", "naturalEarth", "equalEarth"]) {
			const m = await mount({ projection });
			data(m);
			expect($$(".wmtc-pin")).toHaveLength(4);
		}
	});

	test("three or more travelers show a Shared legend entry", async () => {
		const names = ["Alex", "Sam", "Kim"];
		const m = await mount({ travelers: names });
		const big = buildViewModel([trip({ travelers: names })], { travelerNames: names, now: NOW, countries: geo.countries });
		m.socketNotificationReceived("WMTC_DATA", { identifier: m.identifier, model: { ...big, problems: [] } });
		expect($$(".wmtc-legend-item").map((e) => e.textContent)).toEqual(["Shared"]);
	});

	test("does not draw into a zero-size box", async () => {
		const original = Element.prototype.getBoundingClientRect;
		Element.prototype.getBoundingClientRect = () => ({ width: 0, height: 0 });
		const m = await mount();
		data(m);
		expect(document.querySelector(".wmtc-svg")).toBeNull();
		Element.prototype.getBoundingClientRect = original;
		m.renderMap();
		expect(document.querySelector(".wmtc-svg")).not.toBeNull();
	});

	test("analog theme class is applied", async () => {
		await mount({ theme: "analog" });
		expect(document.querySelector(".wmtc").classList.contains("wmtc-theme-analog")).toBe(true);
	});
});
