"use strict";

const { editorLink, lanAddress, qrPath, isLoopback } = require("../lib/editor-link");

const wifi = { wlan0: [{ address: "fe80::1", family: "IPv6", internal: false }, { address: "192.168.1.20", family: "IPv4", internal: false }] };
const route = "/MMM-WorldMapTravelCollector";

describe("R1: where phones open the editor", () => {
	test("MagicMirror's defaults only let the mirror itself in", () => {
		expect(editorLink({ mmConfig: { address: "localhost", port: 8080, ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1"] }, route, env: {}, interfaces: wifi }))
			.toEqual({ url: "http://192.168.1.20:8080/MMM-WorldMapTravelCollector/", reachable: false, reason: "address" });
		expect(editorLink({ mmConfig: {}, route, env: {}, interfaces: wifi }).reason).toBe("address");
		expect(editorLink({ mmConfig: { address: "" }, route, env: {}, interfaces: wifi }).reason).toBe("address");
	});

	test("listening on the network, but the whitelist still only has the mirror", () => {
		const r = editorLink({ mmConfig: { address: "0.0.0.0", ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1"] }, route, env: {}, interfaces: wifi });
		expect(r).toMatchObject({ reachable: false, reason: "whitelist" });
	});

	test("open to the home network", () => {
		expect(editorLink({ mmConfig: { address: "0.0.0.0", ipWhitelist: [] }, route, env: {}, interfaces: wifi })).toEqual({ url: "http://192.168.1.20:8080/MMM-WorldMapTravelCollector/", reachable: true, reason: "" });
		expect(editorLink({ mmConfig: { address: "::", ipWhitelist: ["192.168.1.0/24"] }, route, env: {}, interfaces: wifi }).reachable).toBe(true);
		// A fixed address in MagicMirror's config is used as it is; MM_PORT wins over the config's port.
		expect(editorLink({ mmConfig: { address: "192.168.1.50", port: 8080 }, route, env: { MM_PORT: "9000" }, interfaces: wifi }).url).toBe("http://192.168.1.50:9000/MMM-WorldMapTravelCollector/");
		expect(editorLink({ mmConfig: { address: "fd00::5" }, route, env: {}, interfaces: wifi }).url).toBe("http://[fd00::5]:8080/MMM-WorldMapTravelCollector/");
	});

	test("no network at all", () => {
		expect(editorLink({ mmConfig: { address: "0.0.0.0", ipWhitelist: [] }, route, env: {}, interfaces: {} })).toEqual({ url: null, reachable: false, reason: "network" });
	});

	test("home-network addresses on real network cards come first", () => {
		expect(lanAddress({
			docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
			eth0: [{ address: "203.0.113.4", family: 4, internal: false }],
			wlan0: [{ address: "10.0.0.7", family: "IPv4", internal: false }],
			lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }]
		})).toBe("10.0.0.7");
		expect(lanAddress({ eth0: [{ address: "203.0.113.4", family: "IPv4", internal: false }] })).toBe("203.0.113.4");
		expect(() => lanAddress()).not.toThrow();
	});

	test("loopback spellings", () => {
		for (const v of ["localhost", "127.0.0.1", "127.0.1.1", "::1", "::ffff:127.0.0.1", "", undefined, "127.0.0.0/8"]) expect(isLoopback(v)).toBe(true);
		for (const v of ["0.0.0.0", "192.168.1.0/24", "::ffff:192.168.1.2"]) expect(isLoopback(v)).toBe(false);
	});
});

describe("QR code as an SVG path", () => {
	test("a square of dark runs, one unit high", () => {
		const { size, d } = qrPath("http://192.168.1.20:8080/MMM-WorldMapTravelCollector/");
		expect(size).toBe(33); // version 4
		const runs = d.match(/M\d+ \d+h\d+v1h-\d+z/g);
		expect(runs.join("")).toBe(d);
		// The three finder squares: the top-left one starts with a 7-wide run.
		expect(d.startsWith("M0 0h7v1h-7z")).toBe(true);
	});
});
