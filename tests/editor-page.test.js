/**
 * @jest-environment jsdom
 */
"use strict";

/**
 * The phone editor page (editor/editor.js) running against a stand-in for the mirror's API.
 * Covers the page-only bugs from the pre-release review: B1 (stale coordinates), B2 (live search),
 * B3 (column matching) and B6 (fixing unreadable rows that carry an id).
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const BODY = fs.readFileSync(path.join(ROOT, "editor", "index.html"), "utf8").match(/<body>([\s\S]*)<\/body>/)[1];
const SCRIPT = fs.readFileSync(path.join(ROOT, "editor", "editor.js"), "utf8");

const trip = (o) => ({ city: "", country: "PT", date: "2025-03", start: null, days: null, travelers: ["Alex"], lat: null, lon: null, note: "", ...o });
const STATE = {
	travelers: [{ name: "Alex", color: "#4FC3F7" }, { name: "Sam", color: "#F48FB1" }],
	togetherColor: "#FFD54F",
	countries: [["JP", "Japan"], ["PT", "Portugal"], ["US", "United States"]],
	trips: [
		trip({ id: "t_lis", city: "Lisbon" }),
		trip({ id: "t_kyo", city: "Kyoto", country: "JP", date: "2024-10" }),
		trip({ id: "t_tx", city: "Paris", country: "US", date: "2021-09", lat: 33.66, lon: -95.55, note: "Paris, Texas" })
	],
	broken: [{ id: "row-4", raw: { id: "t_b", city: "Lisbn", country: "PT", date: "2025-03", travelers: ["Alex"] }, errors: ["Unknown city 'Lisbn' in Portugal. Did you mean Lisbon?"] }],
	readOnly: [{ source: "trips.csv", trips: [trip({ id: "t_rome", city: "Rome", country: "IT", date: "2022-09" })], problems: [] }],
	sheet: null,
	pinRequired: false,
	home: null,
	homeRadiusKm: 50,
	currentMonth: "2026-11"
};

let requests;
let uploadResult;
const flush = () => new Promise((r) => setTimeout(r, 0));
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// Standard in phone browsers, missing from jsdom.
window.scrollTo = () => {};
global.TextEncoder = require("node:util").TextEncoder;

beforeEach(async () => {
	requests = [];
	document.body.innerHTML = BODY;
	global.fetch = jest.fn(async (url, opts = {}) => {
		requests.push({ url, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : undefined });
		const body = url.endsWith("api/state") ? JSON.parse(JSON.stringify(STATE)) : url.includes("import/check") ? { results: [] } : { trip: trip({ id: "t_new", city: "Porto" }), combined: false };
		return { ok: true, status: 200, json: async () => body };
	});
	global.XMLHttpRequest = class {
		open (method, url) {
			this.url = url;
			this.upload = {};
		}
		setRequestHeader () {}
		send () {
			this.status = 200;
			this.responseText = JSON.stringify(uploadResult);
			setTimeout(() => this.onload(), 0);
		}
	};
	(0, eval)(SCRIPT);
	await flush();
	await flush();
});

const type = (input, value) => {
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
};
const rowTitles = () => $$(".row .row-title").map((r) => r.textContent);

test("B2: search filters while typing, the editable and the read-only lists alike", () => {
	expect(rowTitles()).toEqual(expect.arrayContaining(["Lisbon, Portugal", "Kyoto, Japan", "Rome, IT"]));
	const search = $("input[type=search]");
	type(search, "kyoto");
	expect(rowTitles().filter((t) => !t.startsWith("Lisbn"))).toEqual(["Kyoto, Japan"]);
	type(search, "rome");
	expect(rowTitles().filter((t) => !t.startsWith("Lisbn"))).toEqual(["Rome, IT"]);
	type(search, "");
	expect(rowTitles().length).toBe(5);
});

test("B6: an unreadable row that has its own id is fixed by its position", async () => {
	$$(".row").find((r) => r.textContent.includes("Lisbn")).click();
	const city = $("input[placeholder='e.g. Lisbon']");
	type(city, "Lisbon");
	$("form").dispatchEvent(new Event("submit", { cancelable: true }));
	await flush();
	const put = requests.find((r) => r.method === "PUT");
	expect(put.url).toBe("api/trips/row-4");
});

test("B1: changing the city drops coordinates that belonged to the old place", async () => {
	$$(".row").find((r) => r.textContent.includes("Paris")).click();
	expect($("details").open).toBe(true);
	type($("input[placeholder='e.g. Lisbon']"), "Dallas");
	$("form").dispatchEvent(new Event("submit", { cancelable: true }));
	await flush();
	const put = requests.find((r) => r.method === "PUT");
	expect(put.url).toBe("api/trips/t_tx");
	expect(put.body).toMatchObject({ city: "Dallas", lat: "", lon: "" });

	// Editing only the note keeps hand-set coordinates.
	requests.length = 0;
	$$(".tabs button").find((b) => b.dataset.tab === "trips").click();
	$$(".row").find((r) => r.textContent.includes("Paris")).click();
	type($("textarea"), "Paris, Texas!");
	$("form").dispatchEvent(new Event("submit", { cancelable: true }));
	await flush();
	expect(requests.find((r) => r.method === "PUT").body).toMatchObject({ lat: "33.66", lon: "-95.55" });
});

test("B3: the column-matching panel shows a drop-down per column", async () => {
	uploadResult = {
		kind: "trips", label: "Trips file", alsoFound: [], warnings: [],
		drafts: [{ city: "Lisbon", country: "PT", date: "2025-03", start: "", days: "", travelers: ["Alex"], lat: "", lon: "", note: "", hint: "", include: true }],
		csv: { headers: ["Stadt", "Land", "Datum", "Personen"], mapping: { Stadt: null, Land: null, Datum: null, Personen: null }, missing: ["country", "date", "travelers"] }
	};
	$$(".tabs button").find((b) => b.dataset.tab === "import").click();
	const input = $("input[type=file]");
	// jsdom's File has no arrayBuffer(); phones' browsers do.
	const file = { name: "trips.csv", arrayBuffer: async () => new TextEncoder().encode("Stadt;Land\nLisboa;PT\n").buffer };
	Object.defineProperty(input, "files", { value: [file] });
	input.dispatchEvent(new Event("change"));
	for (let i = 0; i < 40 && !$(".mapping"); i++) await flush();
	const panel = $(".mapping");
	expect(panel ? "" : $("main").textContent).toBe("");
	expect(panel.textContent).not.toContain("[object");
	expect(panel.querySelectorAll("select")).toHaveLength(4);
	expect([...panel.querySelectorAll("span")].map((s) => s.textContent)).toEqual(["Stadt", "Land", "Datum", "Personen"]);
});
