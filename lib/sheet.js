"use strict";

const fs = require("node:fs");

/**
 * Turn whatever Google Sheets link someone pastes into one that returns CSV.
 *  - "Publish to web" links (.../d/e/2PACX.../pubhtml or /pub?output=csv) → output=csv
 *  - normal edit links (.../d/<id>/edit#gid=123) → /export?format=csv&gid=123
 *    (this needs the sheet shared as "Anyone with the link")
 * Any other URL is used as-is, so a CSV hosted elsewhere works too.
 * @param {string} url
 * @returns {string|null}
 */
function sheetCsvUrl (url) {
	const raw = String(url || "").trim();
	if (!raw) return null;
	let u;
	try {
		u = new URL(raw);
	} catch {
		return null;
	}
	if (!/^https?:$/.test(u.protocol)) return null;
	if (u.hostname !== "docs.google.com" || !u.pathname.startsWith("/spreadsheets/")) return u.toString();
	const published = u.pathname.match(/^\/spreadsheets\/d\/e\/([^/]+)/);
	if (published) {
		const out = new URL(`https://docs.google.com/spreadsheets/d/e/${published[1]}/pub`);
		const gid = u.searchParams.get("gid") || (u.hash.match(/gid=(\d+)/) || [])[1];
		if (gid) out.searchParams.set("gid", gid);
		out.searchParams.set("single", "true");
		out.searchParams.set("output", "csv");
		return out.toString();
	}
	const normal = u.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
	if (!normal) return u.toString();
	const out = new URL(`https://docs.google.com/spreadsheets/d/${normal[1]}/export`);
	out.searchParams.set("format", "csv");
	const gid = u.searchParams.get("gid") || (u.hash.match(/gid=(\d+)/) || [])[1];
	if (gid) out.searchParams.set("gid", gid);
	return out.toString();
}

/**
 * A Google Sheet (or any CSV link) as a read-only trip source.
 * The last good copy is kept in cacheFile, so trips still show after a reboot without internet.
 *
 * @param {object} opts
 * @param {string} opts.url
 * @param {string} opts.cacheFile
 * @param {typeof fetch} [opts.fetch]
 * @param {number} [opts.timeoutMs]
 * @param {() => Date} [opts.clock]
 */
function createSheetSource (opts) {
	const url = sheetCsvUrl(opts.url);
	const doFetch = opts.fetch || globalThis.fetch;
	const clock = opts.clock || (() => new Date());
	let text = null;
	const status = { url, ok: false, checkedAt: null, changedAt: null, error: url ? null : "The sheet link isn't a web address" };

	try {
		if (fs.existsSync(opts.cacheFile)) text = fs.readFileSync(opts.cacheFile, "utf8");
	} catch {
		text = null;
	}

	return {
		get text () {
			return text;
		},
		get status () {
			return { ...status };
		},
		/**
		 * Download the sheet. Resolves true when its contents changed.
		 * Never rejects: problems are kept in status.error and the last good copy stays in use.
		 */
		async refresh () {
			if (!url) return false;
			status.checkedAt = clock().toISOString();
			try {
				const res = await doFetch(url, { redirect: "follow", signal: AbortSignal.timeout(opts.timeoutMs || 20000) });
				if (!res.ok) throw new Error(res.status === 404 ? "The sheet wasn't found. Check the link" : res.status === 401 || res.status === 403 ? "The sheet isn't shared. In Google Sheets use File → Share → Publish to web, and pick CSV" : `Google answered with error ${res.status}`);
				const body = await res.text();
				const type = String(res.headers && res.headers.get ? res.headers.get("content-type") || "" : "");
				if (/text\/html/i.test(type) || /^\s*<(!doctype|html)/i.test(body)) {
					throw new Error("The link gave a web page, not CSV. In Google Sheets use File → Share → Publish to web, and pick CSV");
				}
				status.ok = true;
				status.error = null;
				if (body === text) return false;
				text = body;
				status.changedAt = status.checkedAt;
				try {
					fs.writeFileSync(opts.cacheFile, body);
				} catch {
					// A read-only disk only costs us the offline copy.
				}
				return true;
			} catch (err) {
				status.ok = false;
				status.error = err.name === "TimeoutError" ? "The sheet took too long to download" : err.message;
				return false;
			}
		}
	};
}

module.exports = { sheetCsvUrl, createSheetSource };
