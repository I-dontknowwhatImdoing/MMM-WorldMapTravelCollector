/**
 * @jest-environment jsdom
 */
"use strict";

/**
 * The phone editor page (editor/editor.js) running against a stand-in for the mirror's API.
 * Covers the page-only bugs from the pre-release review (B1, B2, B3, B6) and the phase 2 usability
 * changes (R6-R10, R13, E1-E8 in the release plan).
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
/** Per-test answers from the stand-in mirror: return { status, body } to override the default. */
let serve;
const flush = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// Standard in phone browsers, missing from jsdom.
window.scrollTo = () => {};
Element.prototype.scrollIntoView = function () {};
window.confirm = () => true;
global.TextEncoder = require("node:util").TextEncoder;

async function boot () {
	(0, eval)(SCRIPT);
	await flush();
	await flush();
}

beforeEach(async () => {
	requests = [];
	serve = () => undefined;
	localStorage.clear();
	document.body.innerHTML = BODY;
	global.fetch = jest.fn(async (url, opts = {}) => {
		const body = opts.body ? JSON.parse(opts.body) : undefined;
		const method = opts.method || "GET";
		requests.push({ url, method, body, headers: opts.headers || {} });
		const custom = serve(url, method, body, opts.headers || {});
		if (custom) return { ok: custom.status < 400, status: custom.status, json: async () => custom.body, blob: async () => new Blob([""]) };
		const answer = url.endsWith("api/state") ? JSON.parse(JSON.stringify(STATE))
			: url.includes("import/check") ? { results: [] }
				: url.includes("api/cities") ? []
					: { trip: trip({ id: "t_new", city: "Porto" }), combined: false };
		return { ok: true, status: 200, json: async () => answer };
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
	await boot();
});

/** Start the page again (after changing what the stand-in mirror answers). */
async function restart () {
	document.body.innerHTML = BODY;
	await boot();
}
const tab = (name) => $$(".tabs button").find((b) => b.dataset.tab === name).click();
const submit = async () => {
	$("form").dispatchEvent(new Event("submit", { cancelable: true }));
	await flush();
	await flush();
};

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

describe("R6: errors where you look", () => {
	test("each error shows under its field; the first is focused", async () => {
		serve = (url, method) => (method === "POST" && url.endsWith("api/trips") ? { status: 422, body: { errors: ["Country is missing", "Date is missing", "No travelers listed", "Something odd"] } } : undefined);
		tab("add");
		await submit();
		const errs = $$(".field-error").filter((e) => !e.hidden).map((e) => e.textContent);
		expect(errs).toEqual(["Country is missing", "Date is missing", "No travelers listed"]);
		expect($(".errors").hidden).toBe(false);
		expect($(".errors").textContent).toBe("Something odd");
		expect(document.activeElement).toBe($("input[list=country-list]"));
	});

	test("'Did you mean' suggestions are buttons that fill in the city", async () => {
		serve = (url, method) => (method === "POST" ? { status: 422, body: { errors: ["Unknown city 'Lisbn' in Portugal. Did you mean Lisbon, Linda-a-Velha?"] } } : undefined);
		tab("add");
		type($("input[placeholder='e.g. Lisbon']"), "Lisbn");
		await submit();
		const ideas = $$(".did-you-mean button").map((b) => b.textContent);
		expect(ideas).toEqual(["Lisbon", "Linda-a-Velha"]);
		$$(".did-you-mean button")[0].click();
		expect($("input[placeholder='e.g. Lisbon']").value).toBe("Lisbon");
		expect($$(".field-error").every((e) => e.hidden)).toBe(true);
	});
});

describe("R8: back, undo and repeat", () => {
	test("after adding, the form keeps country, month and people for the next place", async () => {
		tab("add");
		type($("input[list=country-list]"), "Portugal");
		type($("input[placeholder='e.g. Lisbon']"), "Porto");
		const [month, year] = $$(".when select").slice(1);
		month.value = "03";
		month.dispatchEvent(new Event("change"));
		year.value = "2025";
		year.dispatchEvent(new Event("change"));
		$$(".pill input")[0].click();
		await submit();
		await flush();
		expect($(".notice.good").textContent).toMatch(/^Added Porto, Portugal\. Add another place from this trip/);
		expect($("input[placeholder='e.g. Lisbon']").value).toBe("");
		expect($("input[list=country-list]").value).toBe("Portugal");
		expect($$(".when select").slice(1).map((x) => x.value)).toEqual(["03", "2025"]);
		expect($$(".pill.on").map((p) => p.dataset.name)).toEqual(["Alex"]);
		$$(".notice.good button")[0].click();
		expect($("input[list=country-list]").value).toBe("");
	});

	test("deleting offers Undo, which adds the trip back", async () => {
		$$(".row").find((r) => r.textContent.includes("Kyoto")).click();
		$$("button").find((b) => b.textContent === "Delete this trip").click();
		await flush();
		await flush();
		expect(requests.find((r) => r.method === "DELETE").url).toBe("api/trips/t_kyo");
		const undo = $(".toast-action");
		expect(undo.textContent).toBe("Undo");
		undo.click();
		await flush();
		expect(requests.filter((r) => r.method === "POST").at(-1).body).toMatchObject({ city: "Kyoto", country: "JP", date: "2024-10", travelers: ["Alex"] });
	});

	test("the phone's Back button returns to the previous editor screen", async () => {
		$$(".row").find((r) => r.textContent.includes("Kyoto")).click();
		expect($("#title").textContent).toBe("Edit trip");
		expect(history.state).toMatchObject({ tab: "add", editing: "t_kyo" });
		window.dispatchEvent(new PopStateEvent("popstate", { state: { tab: "trips", editing: null } }));
		expect($("#title").textContent).toBe("Trips");
		window.dispatchEvent(new PopStateEvent("popstate", { state: { tab: "add", editing: "t_kyo" } }));
		expect($("input[placeholder='e.g. Lisbon']").value).toBe("Kyoto");
		window.dispatchEvent(new PopStateEvent("popstate", { state: { tab: "add", editing: "t_gone" } }));
		expect($("#title").textContent).toBe("Trips");
		expect($$(".tabs button").find((b) => b.getAttribute("aria-current") === "page").dataset.tab).toBe("trips");
	});
});

describe("R6, R13, E4: import review", () => {
	const draft = (o) => ({ city: "Lisbon", country: "PT", date: "2025-03", start: "", days: "", travelers: [], lat: "", lon: "", note: "", hint: "", include: true, ...o });
	async function upload (result, checks) {
		uploadResult = result;
		serve = (url) => (url.includes("import/check") ? { status: 200, body: { results: checks } } : undefined);
		tab("import");
		const input = $("input[type=file]");
		Object.defineProperty(input, "files", { value: [{ name: "Timeline.json", arrayBuffer: async () => new ArrayBuffer(2) }] });
		input.dispatchEvent(new Event("change"));
		for (let i = 0; i < 40 && !$(".draft"); i++) await flush();
		await wait(400); // the review checks rows after a short pause
		await flush();
	}

	test("rows without people ask 'Who went?' first; Save explains what's missing", async () => {
		const missing = { ok: false, errors: ["No travelers listed"] };
		await upload({ kind: "timeline", label: "Google Maps Timeline", alsoFound: [], warnings: [], visits: 3, ignoredAtHome: 0, home: null, drafts: [draft({}), draft({ city: "Porto" })] }, [missing, missing]);
		expect($(".who-first h2").textContent).toBe("Who went on these trips?");
		expect($(".save-import").disabled).toBe(true);
		expect($(".save-note").textContent).toBe("To save these: pick who went (2 rows), or untick them.");
		expect($$(".draft-head input[type=checkbox]").map((b) => b.getAttribute("aria-label"))).toEqual(["Import Lisbon, Portugal", "Import Porto, Portugal"]);
		$(".who-first .pill input").click();
		$$(".who-first button").find((b) => b.textContent === "Set for all rows").click();
		await wait(400);
		const check = requests.filter((r) => r.url.includes("import/check")).at(-1);
		expect(check.body.rows.map((r) => r.travelers)).toEqual([["Alex"], ["Alex"]]);
		expect($(".who-first")).toBeNull();
	});

	test("rows already there say so; rows that add someone say who", async () => {
		const there = { travelers: ["Alex"] };
		await upload({ kind: "timeline", label: "Google Maps Timeline", alsoFound: [], warnings: [], visits: 2, ignoredAtHome: 0, home: null, drafts: [draft({ travelers: ["Alex"] }), draft({ city: "Porto", travelers: ["Sam"] })] },
			[{ ok: true, trip: {}, combinesWith: there, adds: [] }, { ok: true, trip: {}, combinesWith: there, adds: ["Sam"] }]);
		expect($$(".draft .status").map((x) => x.textContent)).toEqual(["Already there, nothing changes", "✓ Adds Sam to the trip already there"]);
		expect($(".save-import").textContent).toBe("Save 1 trip");
		expect($(".save-note").textContent).toBe("1 is already there.");
		serve = (url) => (url.includes("import/save") ? { status: 200, body: { added: 0, combined: 1, already: 1, rejected: [], total: 3 } } : undefined);
		$(".save-import").click();
		await flush();
		await flush();
		expect($("main").textContent).toContain("0 new trips added, 1 joined trip already there, 1 was already there.");
	});
});

describe("E1: PIN", () => {
	test("wrong PIN shows the tries left; a saved PIN that stopped working is explained and forgotten", async () => {
		localStorage.setItem("wmtc-pin", "1111");
		serve = (url, method, body, headers) => (url.endsWith("api/state") && headers["X-WMTC-Pin"] !== "4321" ? { status: 401, body: { error: headers["X-WMTC-Pin"] ? "Wrong PIN" : "Enter the editor PIN", pinRequired: true, triesLeft: 3 } } : undefined);
		await restart();
		expect($(".status.bad").textContent).toMatch(/saved on this phone no longer works/);
		expect(localStorage.getItem("wmtc-pin")).toBeNull();
		const input = $("input[type=password]");
		input.value = "0000";
		$("form").dispatchEvent(new Event("submit", { cancelable: true }));
		await flush();
		await flush();
		expect($(".status.bad").textContent).toBe("That's not the PIN. 3 tries left before a one-minute wait.");
		$("input[type=password]").value = "4321";
		$("form").dispatchEvent(new Event("submit", { cancelable: true }));
		await flush();
		await flush();
		expect($("#tabs").hidden).toBe(false);
		expect(localStorage.getItem("wmtc-pin")).toBe("4321");
	});

	test("after too many tries the PIN screen counts down", async () => {
		jest.useFakeTimers();
		serve = (url) => (url.endsWith("api/state") ? { status: 429, body: { error: "Too many wrong PINs", pinRequired: true, retryAfter: 2 } } : undefined);
		document.body.innerHTML = BODY;
		(0, eval)(SCRIPT);
		await jest.advanceTimersByTimeAsync(0);
		expect($(".status.bad").textContent).toBe("Too many wrong PINs. Try again in 2 seconds.");
		expect($("input[type=password]").disabled).toBe(true);
		await jest.advanceTimersByTimeAsync(2000);
		expect($(".status.bad").textContent).toBe("You can try again now.");
		expect($("input[type=password]").disabled).toBe(false);
		jest.useRealTimers();
	});
});

describe("R9, R10, E2: notices on the trips list", () => {
	test("trips.csv can be moved into the editor", async () => {
		serve = (url) => (url.includes("move-csv") ? { status: 200, body: { added: 1, combined: 0, already: 0, needFixing: 1, renamedTo: "trips.csv.moved-2026-11-23" } } : undefined);
		const move = $$("button").find((b) => b.textContent === "Move 1 trips into the editor");
		move.click();
		await flush();
		await flush();
		expect(requests.find((r) => r.url.includes("move-csv")).method).toBe("POST");
		expect($("#toast").textContent).toBe("Moved 1 trips into the editor; 1 needs fixing (listed at the top). trips.csv is now called trips.csv.moved-2026-11-23.");
	});

	test("with only read-only trips, the list explains instead of saying 'No trips yet'", async () => {
		serve = (url) => (url.endsWith("api/state") ? { status: 200, body: { ...STATE, trips: [], broken: [] } } : undefined);
		await restart();
		expect($(".empty p").textContent).toMatch(/come from a file or a sheet/);
	});

	test("no-PIN note until dismissed; sheet problems are shown", async () => {
		expect($("main").textContent).toContain("Anyone on your Wi-Fi can open this page");
		$$(".notice button").find((b) => b.textContent === "Got it").click();
		expect($("main").textContent).not.toContain("Anyone on your Wi-Fi");
		serve = (url) => (url.endsWith("api/state") ? { status: 200, body: { ...STATE, sheet: { ok: false, error: "Couldn't reach Google. Check the mirror's internet connection" } } } : undefined);
		await restart();
		expect($("main").textContent).not.toContain("Anyone on your Wi-Fi");
		expect($(".notice.bad").textContent).toMatch(/^Google Sheet: Couldn't reach Google/);
	});
});

describe("E3: unreadable rows open filled in", () => {
	test("date, country and known travelers come from the mirror's guess; unknown people are named", async () => {
		serve = (url) => (url.endsWith("api/state") ? { status: 200, body: { ...STATE, broken: [{ id: "row-5", raw: { city: "Porto", country: "Portugal", date: "May 2019", travelers: "Alex; Bob" }, errors: ["Unknown traveler 'Bob'"], guess: { date: "2019-05", start: "", country: "PT", travelers: ["Alex"], unknownTravelers: ["Bob"] } }] } } : undefined);
		await restart();
		$$(".row").find((r) => r.textContent.includes("Porto")).click();
		expect($$(".when select").slice(1).map((x) => x.value)).toEqual(["05", "2019"]);
		expect($("input[list=country-list]").value).toBe("Portugal");
		expect($$(".pill.on").map((p) => p.dataset.name)).toEqual(["Alex"]);
		expect($(".warn-text").textContent).toMatch(/^Bob isn't one of the travelers/);
	});
});

describe("R7, E8: city suggestions", () => {
	test("show region and size, keep a non-default pick's position, and work with arrow keys", async () => {
		serve = (url) => (url.includes("api/cities") ? { status: 200, body: [
			{ name: "Paris", country: "US", countryName: "United States", region: "TX", alias: "", isDefault: true, lat: 33.66, lon: -95.55, population: 24782 },
			{ name: "Paris", country: "US", countryName: "United States", region: "TN", alias: "", isDefault: false, lat: 36.3, lon: -88.33, population: 10150 }
		] } : undefined);
		tab("add");
		const city = $("input[placeholder='e.g. Lisbon']");
		type(city, "Paris");
		await wait(250);
		await flush();
		const items = $$(".suggest button");
		expect(items.map((b) => b.textContent)).toEqual(["Paris, TX · United States · 25k people", "Paris, TN · United States · 10k people"]);
		city.focus();
		city.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(document.activeElement).toBe(items[0]);
		$(".suggest").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
		expect(document.activeElement).toBe(items[1]);
		items[1].click();
		expect($(".spot-note").textContent).toBe("Using Paris, TN (10k people), not the best-known Paris.");
		$$(".pill input")[0].click();
		await submit();
		expect(requests.find((r) => r.method === "POST" && r.url.endsWith("api/trips")).body).toMatchObject({ city: "Paris", country: "US", lat: "36.3", lon: "-88.33" });
	});
});

describe("E7: backups", () => {
	test("each backup is compared with the list now; restoring counts readable trips", async () => {
		serve = (url, method) => {
			if (url.includes("api/backups") && method === "GET") return { status: 200, body: { backups: [{ name: "trips-a.json", savedAt: "2026-11-23T10:00:00.000Z", trips: 6 }, { name: "trips-b.json", savedAt: null, trips: 4 }] } };
			if (url.includes("restore")) return { status: 200, body: { restored: "trips-a.json", trips: 5, unreadable: 1 } };
			return undefined;
		};
		tab("more");
		await flush();
		await flush();
		expect($$(".list .row-sub").map((x) => x.textContent)).toEqual(["6 trips · 2 more than now", "4 trips · same as now"]);
		$$(".list button")[0].click();
		await flush();
		await flush();
		expect($("#toast").textContent).toBe("Restored 5 trips, plus 1 row to fix.");
	});
});
