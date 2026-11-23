"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

jest.mock("node_helper", () => ({ create: (def) => def }), { virtual: true });
jest.mock("logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }), { virtual: true });

const Log = require("logger");
const helperDef = require("../node_helper");

function makeHelper () {
	const helper = Object.create(helperDef);
	helper.name = "MMM-WorldMapTravelCollector";
	helper.path = path.join(__dirname, "..");
	helper.sent = [];
	helper.sendSocketNotification = (n, p) => helper.sent.push([n, p]);
	helper.start();
	return helper;
}

describe("node_helper", () => {
	let dir;
	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "wmtc-helper-"));
		fs.writeFileSync(path.join(dir, "trips.json"), JSON.stringify([{ city: "Lisbon", country: "PT", date: "2025-03", travelers: "Alex" }, { city: "Lisbn", country: "PT", date: "2025-03", travelers: "Alex" }]));
	});
	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	test("answers WMTC_INIT with the view model for that instance", () => {
		const h = makeHelper();
		h.socketNotificationReceived("WMTC_INIT", { identifier: "m1", config: { travelers: ["Alex"], dataDir: dir } });
		expect(h.sent).toHaveLength(1);
		const [n, payload] = h.sent[0];
		expect(n).toBe("WMTC_DATA");
		expect(payload.identifier).toBe("m1");
		expect(payload.model.views[0].tripIds).toHaveLength(1);
		expect(payload.model.problems).toHaveLength(1);
		expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining("[MMM-WorldMapTravelCollector] trips.json row 2"));
		h.stop();
		expect(h.instances.size).toBe(0);
	});

	test("re-init replaces the old watcher; other notifications are ignored", () => {
		const h = makeHelper();
		h.socketNotificationReceived("SOMETHING_ELSE", {});
		h.socketNotificationReceived("WMTC_INIT", null);
		h.socketNotificationReceived("WMTC_INIT", { config: {} });
		expect(h.sent).toHaveLength(0);
		h.socketNotificationReceived("WMTC_INIT", { identifier: "m1", config: { travelers: ["Alex"], dataDir: dir } });
		const first = h.instances.get("m1");
		h.socketNotificationReceived("WMTC_INIT", { identifier: "m1", config: { travelers: ["Alex"], dataDir: dir } });
		expect(h.instances.get("m1")).not.toBe(first);
		expect(h.instances.size).toBe(1);
		h.stopInstance("missing");
		h.stop();
	});

	test("defaults to the module's data folder", () => {
		const h = makeHelper();
		h.socketNotificationReceived("WMTC_INIT", { identifier: "m2", config: { travelers: ["Alex"] } });
		expect(h.sent[0][0]).toBe("WMTC_DATA");
		h.stop();
	});

	test("sends WMTC_ERROR if loading throws", () => {
		jest.isolateModules(() => {
			jest.doMock("../lib/service", () => ({
				createTripService: () => ({ load: () => { throw new Error("disk on fire"); }, stop: jest.fn() })
			}));
			const def = require("../node_helper");
			const h = Object.create(def);
			h.name = "MMM-WorldMapTravelCollector";
			h.path = path.join(__dirname, "..");
			h.sent = [];
			h.sendSocketNotification = (n, p) => h.sent.push([n, p]);
			h.start();
			h.socketNotificationReceived("WMTC_INIT", { identifier: "m3", config: { travelers: ["Alex"], dataDir: dir } });
			expect(h.sent).toEqual([["WMTC_ERROR", { identifier: "m3", message: "disk on fire" }]]);
			expect(h.instances.size).toBe(0);
			expect(Log.error).toHaveBeenCalledWith("[MMM-WorldMapTravelCollector] Could not load trips: disk on fire");
		});
	});

	test("odd config values fall back to defaults", () => {
		const h = makeHelper();
		h.socketNotificationReceived("WMTC_INIT", { identifier: "m4", config: { travelers: "Alex", filters: 5, dataDir: dir } });
		expect(h.sent[0][0]).toBe("WMTC_DATA");
		expect(h.sent[0][1].model.views.map((v) => v.id)).toEqual(["all"]);
		h.stop();
	});

	test("mounts the trip editor on MagicMirror's web server", async () => {
		const routes = [];
		const def = require("../node_helper");
		const h = Object.create(def);
		h.name = "MMM-WorldMapTravelCollector";
		h.path = path.join(__dirname, "..");
		h.sent = [];
		h.sendSocketNotification = (n, p) => h.sent.push([n, p]);
		h.expressApp = { use: (route, fn) => routes.push([route, fn]) };
		h.start();
		expect(routes.map((r) => r[0])).toEqual(["/MMM-WorldMapTravelCollector"]);
		expect(Log.info).toHaveBeenCalledWith(expect.stringContaining("Trip editor at http://<this mirror's address>:8080/MMM-WorldMapTravelCollector/"));
		expect(h.editorContext()).toBeNull();

		h.socketNotificationReceived("WMTC_INIT", { identifier: "m1", config: { travelers: ["Alex"], dataDir: dir } });
		h.socketNotificationReceived("WMTC_INIT", { identifier: "m2", config: { travelers: ["Alex", "Sam"], dataDir: dir } });
		expect(h.editorContext().config.travelers).toEqual(["Alex", "Sam"]);
		expect(h.editorContext().dataDir).toBe(dir);

		// The mounted function answers like the editor does.
		const res = { headers: null, body: null, headersSent: false, writeHead (status, headers) {
			this.status = status;
			this.headers = headers;
		}, end (body) {
			this.body = body;
		} };
		await routes[0][1]({ method: "GET", url: "/api/state", headers: {}, socket: {} }, res);
		expect(res.status).toBe(200);
		expect(JSON.parse(res.body).travelers).toEqual([{ name: "Alex" }, { name: "Sam" }]);
		h.stop();
	});
});
