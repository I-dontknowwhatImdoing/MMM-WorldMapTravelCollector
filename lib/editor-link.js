"use strict";

const os = require("node:os");
const qrcode = require("qrcode-generator");

/** Addresses that mean "only this computer". */
const isLoopback = (value) => {
	const v = String(value ?? "").trim().toLowerCase();
	return v === "" || v === "localhost" || v === "::1" || /^(::ffff:)?127\./.test(v);
};

const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const isVirtual = (name) => /^(docker|br-|veth|virbr|tun|tap|tailscale|zt|utun|lo)/i.test(name);

/**
 * This computer's address on the home network: the one a phone on the same Wi-Fi can reach.
 * Private addresses on real network cards (wlan0, eth0) come first.
 * @param {ReturnType<typeof os.networkInterfaces>} [interfaces]
 * @returns {string|null}
 */
function lanAddress (interfaces = os.networkInterfaces()) {
	const found = [];
	for (const [name, list] of Object.entries(interfaces || {})) {
		for (const a of list || []) {
			if (a.internal || !(a.family === "IPv4" || a.family === 4) || isLoopback(a.address)) continue;
			found.push({ name, address: a.address, rank: (isPrivate(a.address) ? 0 : 2) + (isVirtual(name) ? 1 : 0) });
		}
	}
	found.sort((a, b) => a.rank - b.rank);
	return found.length ? found[0].address : null;
}

/**
 * Where a phone opens the trip editor, and whether MagicMirror will let it in.
 * MagicMirror's own defaults only answer the mirror itself (address "localhost" and an ipWhitelist of
 * 127.0.0.1), so on a fresh install a phone gets a bare "403". This spots that, so the mirror can say so.
 * @param {object} opts
 * @param {object} [opts.mmConfig] MagicMirror's config (address, port, ipWhitelist)
 * @param {string} opts.route where the editor is mounted, e.g. "/MMM-WorldMapTravelCollector"
 * @param {object} [opts.env] environment (MM_PORT overrides the port, as in MagicMirror)
 * @param {object} [opts.interfaces] network interfaces, for tests
 * @returns {{url: string|null, reachable: boolean, reason: ""|"address"|"whitelist"|"network"}}
 */
function editorLink ({ mmConfig = {}, route, env = process.env, interfaces } = {}) {
	const port = Number(env.MM_PORT || mmConfig.port || 8080);
	const address = mmConfig.address === undefined ? "localhost" : String(mmConfig.address).trim();
	const everywhere = address === "0.0.0.0" || address === "::";
	const lan = lanAddress(interfaces);
	const host = !everywhere && !isLoopback(address) ? address : lan;
	const url = host ? `http://${host.includes(":") ? `[${host}]` : host}:${port}${route}/` : null;
	const whitelist = mmConfig.ipWhitelist;
	let reason = "";
	if (isLoopback(address)) reason = "address";
	else if (Array.isArray(whitelist) && whitelist.length > 0 && whitelist.every(isLoopback)) reason = "whitelist";
	else if (!url) reason = "network";
	return { url, reachable: reason === "", reason };
}

/**
 * A QR code as one SVG path (dark squares, one unit each), so the mirror's browser needs no QR library.
 * @param {string} text
 * @returns {{size: number, d: string}}
 */
function qrPath (text) {
	const qr = qrcode(0, "M");
	qr.addData(text);
	qr.make();
	const size = qr.getModuleCount();
	let d = "";
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (!qr.isDark(y, x)) continue;
			let run = 1;
			while (x + run < size && qr.isDark(y, x + run)) run++;
			d += `M${x} ${y}h${run}v1h-${run}z`;
			x += run - 1;
		}
	}
	return { size, d };
}

module.exports = { editorLink, lanAddress, qrPath, isLoopback };
