"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createTripBook } = require("./editing");
const { parseUpload, unpackFiles } = require("./importers");
const { mergeTrips } = require("./merge");
const { toCSV } = require("./csv");
const { resolveHome } = require("./service");

const EDITOR_DIR = path.join(__dirname, "..", "editor");
const STATIC = { "/": "index.html", "/editor.js": "editor.js", "/editor.css": "editor.css", "/icon.svg": "icon.svg" };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const JSON_LIMIT = 2 * 1024 * 1024;
const UPLOAD_LIMIT = 200 * 1024 * 1024;
const MAX_PIN_FAILURES = 5;
const LOCKOUT_MS = 60 * 1000;

class HttpError extends Error {
	constructor (status, message, extra = {}) {
		super(message);
		this.status = status;
		this.extra = extra;
	}
}

function travelerList (config) {
	return (Array.isArray(config.travelers) ? config.travelers : [])
		.map((t) => (typeof t === "string" ? { name: t } : t && t.name ? { name: String(t.name), color: t.color || null } : null))
		.filter(Boolean);
}

function readBody (req, limit) {
	// Express (MagicMirror) may already have parsed JSON bodies.
	if (req._body && req.body !== undefined) return Promise.resolve(req.body);
	return new Promise((resolve, reject) => {
		const declared = Number(req.headers["content-length"]);
		if (declared > limit) return reject(new HttpError(413, `That's too big to upload (limit ${Math.round(limit / 1048576)} MB)`));
		const chunks = [];
		let size = 0;
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new HttpError(413, `That's too big to upload (limit ${Math.round(limit / 1048576)} MB)`));
				req.destroy();
			} else chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

async function readJson (req) {
	const body = await readBody(req, JSON_LIMIT);
	if (!Buffer.isBuffer(body)) return body || {};
	if (!body.length) return {};
	try {
		return JSON.parse(body.toString("utf8"));
	} catch {
		throw new HttpError(400, "The request wasn't valid JSON");
	}
}

function sameText (a, b) {
	const x = Buffer.from(String(a));
	const y = Buffer.from(String(b));
	return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * The web editor: a phone-friendly page plus a small JSON API, served by MagicMirror at
 * http://<mirror>:8080/MMM-WorldMapTravelCollector/
 *
 * Works with MagicMirror's Express app (app.use(prefix, handler)) and with a plain Node
 * http server (the preview), so it never depends on Express features.
 *
 * @param {object} opts
 * @param {() => null | {config: object, dataDir: string, geo: object, service?: object}} opts.getContext
 *        the mirror's current settings; null until the mirror has started the module
 * @param {(event: string) => void} [opts.onSaved] called after trips.json changes
 * @param {() => Date} [opts.clock]
 * @param {string} [opts.editorDir]
 * @param {number} [opts.uploadLimit] bytes
 */
function createEditorHandler (opts) {
	const editorDir = opts.editorDir || EDITOR_DIR;
	const clock = opts.clock || (() => new Date());
	const uploadLimit = opts.uploadLimit || UPLOAD_LIMIT;
	const failures = new Map();

	function context () {
		const ctx = opts.getContext();
		if (!ctx) throw new HttpError(503, "The mirror hasn't started this module yet. Check that MagicMirror is running, then reload this page");
		if (ctx.config.editor === false) throw new HttpError(403, "The editor is turned off in the mirror's config (editor: false)");
		const travelerNames = travelerList(ctx.config).map((t) => t.name);
		const book = createTripBook({ file: path.join(ctx.dataDir, "trips.json"), ctx: { travelerNames, countries: ctx.geo.countries, geocoder: ctx.geo.geocoder }, clock });
		return { ...ctx, travelerNames, book };
	}

	function checkPin (req, ctx) {
		const pin = ctx.config.editorPin === undefined || ctx.config.editorPin === null ? "" : String(ctx.config.editorPin);
		if (!pin) return;
		const who = req.socket && req.socket.remoteAddress || "?";
		const f = failures.get(who) || { count: 0, until: 0 };
		const now = Date.now();
		if (f.until > now) throw new HttpError(429, `Too many wrong PINs. Try again in ${Math.ceil((f.until - now) / 1000)} seconds`, { pinRequired: true });
		const given = req.headers["x-wmtc-pin"];
		if (given !== undefined && sameText(given, pin)) {
			failures.delete(who);
			return;
		}
		if (given !== undefined && given !== "") {
			f.count++;
			if (f.count >= MAX_PIN_FAILURES) {
				f.count = 0;
				f.until = now + LOCKOUT_MS;
			}
			failures.set(who, f);
			throw new HttpError(401, "Wrong PIN", { pinRequired: true });
		}
		throw new HttpError(401, "Enter the editor PIN", { pinRequired: true });
	}

	function saved (ctx) {
		if (ctx.service && typeof ctx.service.refresh === "function") ctx.service.refresh();
		if (opts.onSaved) opts.onSaved("saved");
	}

	function currentMonth () {
		const d = clock();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
	}

	function state (ctx) {
		const { trips, broken } = ctx.book.load();
		const others = ctx.service && typeof ctx.service.readEachSource === "function" ? ctx.service.readEachSource().filter((s) => !s.editable) : [];
		const homeCfg = ctx.config.home;
		return {
			travelers: travelerList(ctx.config),
			togetherColor: ctx.config.togetherColor || "#FFD54F",
			countries: ctx.geo.countries.codes().map((c) => [c, ctx.geo.countries.name(c)]).sort((a, b) => a[1].localeCompare(b[1])),
			trips,
			broken,
			readOnly: others.map((s) => ({ source: s.name, trips: s.trips, problems: s.problems })),
			sheet: ctx.service && ctx.service.sheetStatus ? ctx.service.sheetStatus : null,
			pinRequired: Boolean(ctx.config.editorPin),
			home: homeCfg && homeCfg.city ? { city: String(homeCfg.city) } : resolveHome(homeCfg, ctx.geo) ? { city: "" } : null,
			homeRadiusKm: Number.isFinite(Number(ctx.config.homeRadiusKm)) ? Number(ctx.config.homeRadiusKm) : 50,
			currentMonth: currentMonth()
		};
	}

	async function api (req, url, ctx) {
		const method = req.method;
		const route = url.pathname.replace(/^\/api/, "");
		const send = (status, body) => ({ status, body });
		// Changes need this header. Browsers won't add it cross-site without permission we never
		// give, so another web page can't change your trips behind your back.
		if (method !== "GET" && req.headers["x-wmtc"] !== "1") throw new HttpError(403, "Missing editor header");

		if (method === "GET" && route === "/state") return send(200, state(ctx));

		if (method === "GET" && route === "/cities") {
			const country = url.searchParams.get("country") ? ctx.geo.countries.resolve(url.searchParams.get("country")) : null;
			const list = ctx.geo.geocoder.autocomplete(url.searchParams.get("q") || "", country || undefined, 8);
			return send(200, list.map((c) => ({ name: c.name, country: c.country, countryName: ctx.geo.countries.name(c.country), lat: c.lat, lon: c.lon, population: c.population })));
		}

		if (method === "POST" && route === "/trips") {
			const r = ctx.book.add(await readJson(req));
			if (!r.ok) return send(422, { errors: r.errors });
			saved(ctx);
			return send(200, { trip: r.trip, combined: r.combined });
		}

		const one = route.match(/^\/trips\/([\w-]+)$/);
		if (one && method === "PUT") {
			const r = ctx.book.update(one[1], await readJson(req));
			if (!r.ok) return send(r.notFound ? 404 : 422, { errors: r.errors });
			saved(ctx);
			return send(200, { trip: r.trip, combined: r.combined });
		}
		if (one && method === "DELETE") {
			if (!ctx.book.remove(one[1])) return send(404, { errors: ["That trip no longer exists"] });
			saved(ctx);
			return send(200, { deleted: one[1] });
		}

		if (method === "POST" && route === "/import/parse") {
			const body = await readBody(req, uploadLimit);
			if (!Buffer.isBuffer(body) || !body.length) throw new HttpError(400, "No file was received");
			let mapping;
			try {
				mapping = url.searchParams.get("mapping") ? JSON.parse(url.searchParams.get("mapping")) : undefined;
			} catch {
				mapping = undefined;
			}
			const radius = url.searchParams.get("homeRadiusKm");
			const home = resolveHome(ctx.config.home, ctx.geo);
			try {
				const result = parseUpload(unpackFiles(body), {
					geo: ctx.geo,
					travelerNames: ctx.travelerNames,
					home: home ? { ...home, name: ctx.config.home.city || "" } : null,
					homeRadiusKm: radius !== null && radius !== "" ? Number(radius) : ctx.config.homeRadiusKm,
					mapping,
					want: url.searchParams.get("want") || undefined
				});
				return send(200, result);
			} catch (err) {
				throw new HttpError(422, err.message);
			}
		}

		if (method === "POST" && (route === "/import/check" || route === "/import/save")) {
			const body = await readJson(req);
			const rows = Array.isArray(body.rows) ? body.rows : null;
			if (!rows) throw new HttpError(400, "No rows were sent");
			if (route === "/import/check") {
				return send(200, { results: ctx.book.checkMany(rows).map((r) => (r.ok ? { ok: true, trip: r.trip, combinesWith: r.combinesWith } : r)) });
			}
			const result = ctx.book.importMany(rows);
			if (result.added || result.combined) saved(ctx);
			return send(200, result);
		}

		if (method === "GET" && route === "/backups") return send(200, { backups: ctx.book.backups() });
		if (method === "POST" && route === "/backups/restore") {
			const body = await readJson(req);
			let count;
			try {
				count = ctx.book.restore(String(body.name || ""));
			} catch (err) {
				throw new HttpError(404, err.message);
			}
			saved(ctx);
			return send(200, { restored: body.name, trips: count });
		}

		if (method === "POST" && route === "/sheet/refresh") {
			if (!ctx.service || !ctx.service.sheetStatus) throw new HttpError(404, "No Google Sheet is set up (sheetUrl in the config)");
			await ctx.service.refreshSheet();
			return send(200, { sheet: ctx.service.sheetStatus });
		}

		if (method === "GET" && route === "/export.csv") {
			const lists = [ctx.book.load().trips];
			if (ctx.service && ctx.service.readEachSource) lists.push(...ctx.service.readEachSource().filter((s) => !s.editable).map((s) => s.trips));
			const all = mergeTrips(lists, ctx.travelerNames).trips.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
			return { status: 200, raw: toCSV(all), type: "text/csv; charset=utf-8", filename: `trips-${clock().toISOString().slice(0, 10)}.csv` };
		}

		throw new HttpError(404, "Unknown editor request");
	}

	function writeJson (res, status, body) {
		res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
		res.end(JSON.stringify(body));
	}

	/**
	 * @param {import("node:http").IncomingMessage & {originalUrl?: string}} req url relative to the mount point
	 * @param {import("node:http").ServerResponse} res
	 */
	return async function handler (req, res) {
		const url = new URL(req.url || "/", "http://editor.local");
		const full = req.originalUrl || req.url || "/";
		try {
			if (!url.pathname.startsWith("/api/")) {
				// Relative links in the page need the trailing slash: /MMM-WorldMapTravelCollector → .../
				if (url.pathname === "/" && !full.split("?")[0].endsWith("/")) {
					res.writeHead(301, { Location: `${full.split("?")[0]}/` });
					return res.end();
				}
				const file = STATIC[url.pathname];
				if (!file || req.method !== "GET") throw new HttpError(404, "Not found");
				const body = fs.readFileSync(path.join(editorDir, file));
				res.writeHead(200, {
					"Content-Type": TYPES[path.extname(file)],
					"Cache-Control": "no-cache",
					"X-Content-Type-Options": "nosniff",
					"Referrer-Policy": "no-referrer",
					"Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'"
				});
				return res.end(body);
			}
			const ctx = context();
			checkPin(req, ctx);
			const out = await api(req, url, ctx);
			if (out.raw !== undefined) {
				res.writeHead(out.status, { "Content-Type": out.type, "Content-Disposition": `attachment; filename="${out.filename}"`, "Cache-Control": "no-store" });
				return res.end(out.raw);
			}
			return writeJson(res, out.status, out.body);
		} catch (err) {
			const status = err instanceof HttpError ? err.status : 500;
			if (!(err instanceof HttpError) && opts.logger) opts.logger.warn(`Editor error: ${err.stack || err.message}`);
			if (res.headersSent) return res.end();
			if (!url.pathname.startsWith("/api/")) {
				res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
				return res.end(err.message);
			}
			return writeJson(res, status, { error: status === 500 ? `Something went wrong: ${err.message}` : err.message, ...(err.extra || {}) });
		}
	};
}

module.exports = { createEditorHandler, travelerList, HttpError };
