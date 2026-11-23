#!/usr/bin/env node
"use strict";

/**
 * Preview the module in a normal browser, without MagicMirror.
 *
 *   npm run preview                  # http://localhost:8099
 *   PORT=9000 npm run preview
 *
 * Uses data/trips.json if you have one, otherwise a temporary copy of the example trips.
 * URL options: ?view=together&theme=digital&layout=centered&config={"projection":"mercator"}
 * The trip editor runs at http://localhost:8099/MMM-WorldMapTravelCollector/
 */

const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const path = require("node:path");
const { loadGeoData } = require("../lib/geodata");
const { createTripService } = require("../lib/service");
const { createEditorHandler } = require("../lib/editor-server");
const { importRecords, recordsFromText } = require("../lib/pipeline");

const ROOT = path.join(__dirname, "..");
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

const PREVIEW_DEFAULTS = {
	travelers: [{ name: "Alex", color: "#4FC3F7" }, { name: "Sam", color: "#F48FB1" }],
	home: { city: "Boston", country: "US" }
};

function exampleDataDir () {
	const own = path.join(ROOT, "data");
	if (fs.existsSync(path.join(own, "trips.json")) || fs.existsSync(path.join(own, "trips.csv"))) return own;
	// A temporary trips.json (not .csv), so the editor can change the sample trips.
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wmtc-preview-"));
	const { records } = recordsFromText(fs.readFileSync(path.join(ROOT, "data", "trips.example.csv"), "utf8"), "x.csv");
	importRecords({ file: path.join(tmp, "trips.json"), records, travelerNames: PREVIEW_DEFAULTS.travelers.map((t) => t.name), geo: loadGeoData() });
	return tmp;
}

function previewPage () {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>MMM-WorldMapTravelCollector preview</title>
<style>
	html, body { margin: 0; height: 100%; background: #000; color: #fff; font-family: "Roboto Condensed", "Arial Narrow", sans-serif; }
	.region-centered { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
</style>
<script>
	window.Log = { info () {}, log () {}, warn: console.warn.bind(console), error: console.error.bind(console) };
	window.Module = { register (name, def) { window.__wmtc = { name, def }; } };
</script>
<script src="/node_modules/d3-array/dist/d3-array.min.js"></script>
<script src="/node_modules/d3-geo/dist/d3-geo.min.js"></script>
<script src="/node_modules/topojson-client/dist/topojson-client.min.js"></script>
<script src="/lib/layout.js"></script>
<script src="/lib/ledger.js"></script>
<script src="/MMM-WorldMapTravelCollector.js"></script>
<link rel="stylesheet" href="/css/wmtc.css">
</head><body>
<script>
	const q = new URLSearchParams(location.search);
	const extra = q.get("config") ? JSON.parse(q.get("config")) : {};
	const { name, def } = window.__wmtc;
	const m = Object.create(def);
	m.name = name;
	m.identifier = "preview_1";
	m.config = Object.assign({}, def.defaults, ${JSON.stringify(PREVIEW_DEFAULTS)}, extra);
	if (q.get("theme")) m.config.theme = q.get("theme");
	if (q.get("layout")) m.config.layout = q.get("layout");
	m.file = (p) => "/" + p;
	m.sendSocketNotification = (n, payload) => {
		if (n !== "WMTC_INIT") return;
		fetch("/__model?config=" + encodeURIComponent(JSON.stringify(payload.config)))
			.then((r) => r.json())
			.then((model) => {
				m.socketNotificationReceived("WMTC_DATA", { identifier: m.identifier, model });
				if (q.get("view")) m.setView(q.get("view"));
				document.body.dataset.ready = "1";
			});
	};
	m.start();
	const host = m.config.layout === "centered" ? Object.assign(document.createElement("div"), { className: "region-centered" }) : document.body;
	if (host !== document.body) document.body.append(host);
	host.append(m.getDom());
	window.wmtc = m;
</script>
</body></html>`;
}

const EDITOR_PREFIX = "/MMM-WorldMapTravelCollector";

function createServer ({ dataDir = exampleDataDir(), clock, config: extraConfig = {} } = {}) {
	const geo = loadGeoData();
	const editorConfig = { ...PREVIEW_DEFAULTS, ...extraConfig };
	const editorService = createTripService({ dataDir, config: editorConfig, geo, clock });
	const editor = createEditorHandler({ getContext: () => ({ config: editorConfig, dataDir, geo, service: editorService }), clock });
	return http.createServer((req, res) => {
		const url = new URL(req.url, "http://localhost");
		if (url.pathname === EDITOR_PREFIX || url.pathname.startsWith(`${EDITOR_PREFIX}/`)) {
			// Same shape as Express's app.use(prefix, handler) in MagicMirror.
			req.originalUrl = req.url;
			req.url = req.url.slice(EDITOR_PREFIX.length) || "/";
			return editor(req, res);
		}
		try {
			if (url.pathname === "/") {
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				return res.end(previewPage());
			}
			if (url.pathname === "/__model") {
				const config = JSON.parse(url.searchParams.get("config") || "{}");
				const model = createTripService({ dataDir, config, geo, clock }).load();
				res.writeHead(200, { "Content-Type": "application/json" });
				return res.end(JSON.stringify(model));
			}
			const file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
			if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
				res.writeHead(404);
				return res.end("Not found");
			}
			res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
			fs.createReadStream(file).pipe(res);
		} catch (err) {
			res.writeHead(500);
			res.end(err.message);
		}
	});
}

if (require.main === module) {
	const port = Number(process.env.PORT) || 8099;
	const fixed = process.env.PREVIEW_DATE ? new Date(process.env.PREVIEW_DATE) : null;
	createServer({ clock: fixed ? () => fixed : undefined }).listen(port, () => {
		console.log(`Preview running at http://localhost:${port}`);
		console.log(`Trip editor at http://localhost:${port}${EDITOR_PREFIX}/`);
	});
}

module.exports = { createServer, previewPage };
