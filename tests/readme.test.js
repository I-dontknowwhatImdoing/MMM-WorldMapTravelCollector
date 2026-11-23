"use strict";

/**
 * The README is the module's manual: every option the module has must be in it, and the config
 * examples people copy must be valid JavaScript with options the module knows.
 */

const fs = require("node:fs");
const path = require("node:path");

const README = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");
let definition;
global.Module = { register: (name, def) => (definition = def) };
require("../MMM-WorldMapTravelCollector.js");
const { defaults } = definition;

/** Option names in the first column of README option tables (those headed "| Option |"): | `name` | or | `a`, `b` |. */
const optionTables = README.split(/\n(?=\| Option \|)/).slice(1).map((t) => t.split(/\n(?!\|)/)[0]);
const documented = new Set(optionTables.flatMap((t) => [...t.matchAll(/^\| (`[^|]+`) \|/gm)]).flatMap((m) => [...m[1].matchAll(/`([A-Za-z]+)`/g)].map((x) => x[1])));

describe("README", () => {
	test("documents every option, including the ledger's", () => {
		// The ledger's own options have their own table, introduced as `ledger: { ... }`.
		expect(README).toContain("`ledger: { columns: 2 }`");
		const missing = [...Object.keys(defaults), ...Object.keys(defaults.ledger)].filter((k) => k !== "ledger" && !documented.has(k));
		expect(missing).toEqual([]);
	});

	test("documents no options the module doesn't have", () => {
		const known = new Set([...Object.keys(defaults), ...Object.keys(defaults.ledger), "filters", "defaultFilter"]);
		const extra = [...documented].filter((k) => !known.has(k));
		expect(extra).toEqual([]);
	});

	test("lists every stat the module can show, and only those", () => {
		const { ALL_STATS, EXTRA_STATS } = require("../lib/stats");
		const table = README.split("\n| Stat |")[1].split(/\n(?!\|)/)[0];
		const names = [...table.matchAll(/^\| `"([A-Za-z]+)"` \|/gm)].map((m) => m[1]);
		expect(names).toEqual([...ALL_STATS, ...EXTRA_STATS]);
		expect(defaults.stats).toEqual(ALL_STATS);
	});

	test("the setups people copy are valid and only use real options", () => {
		const blocks = [...README.matchAll(/```javascript\n([\s\S]*?)```/g)].map((m) => m[1].replace(/^\t/gm, ""));
		const modules = blocks.filter((b) => /module: "MMM-WorldMapTravelCollector"/.test(b));
		expect(modules.length).toBeGreaterThanOrEqual(5);
		for (const code of modules) {
			const [entry] = new Function(`return [${code}];`)();
			expect(entry.module).toBe("MMM-WorldMapTravelCollector");
			for (const key of Object.keys(entry.config)) expect(Object.keys(defaults)).toContain(key);
			for (const key of Object.keys(entry.config.ledger || {})) expect(Object.keys(defaults.ledger)).toContain(key);
		}
	});
});
