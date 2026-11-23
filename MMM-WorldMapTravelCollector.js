/* global Module, Log, d3, topojson, WMTCLayout, WMTCLedger, config */

/**
 * MMM-WorldMapTravelCollector
 * A world map of the places you've been, solo or together.
 * MIT licensed.
 */
Module.register("MMM-WorldMapTravelCollector", {
	defaults: {
		travelers: [],
		togetherColor: "#FFD54F",
		colorBy: "auto", // what map colors mean: "auto" (follows the group on screen: people, years or months) | "travelers" (together / each person) | "year" | "month" (Jan–Dec) | "season" (winter, spring, summer, autumn)
		yearColors: "gradient", // colorBy "year": "gradient" (oldest → newest) | "distinct" (a different color each year) | { 2025: "#E57373" }
		yearGradient: ["#5C6BC0", "#4DB6AC", "#FFD54F"], // gradient colors, oldest year first
		monthColors: [], // colorBy "month": 12 colors, January first, to replace the seasonal ones
		seasonColors: [], // colorBy "season": 4 colors, winter first
		hemisphere: "north", // colorBy "season": "south" makes December summer
		home: null,

		// Data
		dataDir: "",
		sheetUrl: "", // a Google Sheet shared with File → Share → Publish to web → CSV
		sheetRefreshMinutes: 30,

		// Web editor at http://<mirror>:8080/MMM-WorldMapTravelCollector/
		editor: true,
		editorPin: "",
		editorHosts: [], // extra names the editor may be opened by, e.g. ["mirror.example.net"]
		showEditorLink: "auto", // "Add trips from your phone" card with a QR code: "auto" (no trips yet, and 10 minutes after each start) | true (always) | false
		homeRadiusKm: 50, // Timeline import: visits this close to home aren't trips

		// Look
		layout: "fullscreen", // "fullscreen" | "centered"
		maxWidth: "90%",
		maxHeight: "80%",
		theme: "digital", // "digital" | "analog"
		contrast: "normal", // "high": brighter grey text and lines, for dim mirrors
		projection: "equalEarth", // map shape: "equalEarth" (curved edges) | "naturalEarth" (less curved) | "equirectangular" (flat rectangle) | "mercator"
		hideAntarctica: true,
		shadeCountries: false, // true: fill visited countries and outline planned ones; false: pins only (a trip without a city gets a pin in the middle of its country)
		animations: true,
		highlightNewest: true,
		fadeByAge: false, // places visited long ago are drawn fainter, recent ones in full color
		fadeStrength: 0.6, // 0 = no fading … 0.95 = the oldest places almost vanish
		fadeUnit: "years", // what fadeAmount counts: "years" | "months" | "days"
		fadeAmount: 10, // visits this many years/months/days ago (or more) get the full fade
		showPlanned: true,
		showLegend: true,
		showProblems: true,

		// Views
		views: ["all", "together", "solo", "years", "months"], // also "person", "year:2025", "month:3" (was called filters)
		viewGroups: true, // "People · Years · Months" tabs before the view buttons when views come from more than one group
		defaultView: "all", // the view to start on (was called defaultFilter)
		viewSwitcher: "auto", // "buttons" | "compact" (one ‹ 2025 › button) | "auto" (compact when the buttons don't fit on one line)
		rotateInterval: 30, // seconds between views; 0 = off
		touchPause: 120, // seconds rotation pauses after a tap or a command
		details: true, // tap a pin or a country to see its trips
		detailsTimeout: 20, // seconds before the details card closes by itself; 0 = stays open
		detailsNotes: true, // show trip notes on the details card (false keeps them off the mirror)
		detailsHint: true, // on touch screens, "Tap a place for details" until the first tap
		labels: {},

		// Stats
		showStats: true,
		stats: ["countries", "cities", "continents", "worldPercent", "tripsThisYear", "distance"], // more: "daysTraveled", "nextTrip", "lastTrip", "farthest", "newThisYear", "mostVisited", "longestTrip", "usStates"
		worldCountryCount: 195,
		distanceUnits: "km",

		// Ledger
		ledger: {
			enabled: true,
			rows: "auto", // a number, or "auto": 5, and more on tall screens when there are trips to fill them
			columns: "auto", // a number, or "auto": 4 on a wide screen, 2 on a tall (portrait) one
			sort: "newest", // "newest" (most recent first) | "oldest" (first trip first) | "alpha" (A–Z by city)
			overflow: "cycle", // "cycle" | "shrink"
			pageInterval: 15, // seconds, for "cycle"
			minFontSize: 10, // px, for "shrink"
			travelerMarker: "dots", // "dots" | "initials" | "color" | "none"
			showCountry: true,
			showDays: false,
			dateFormat: "MMM YYYY",
			showPlanned: false
		}
	},

	getScripts () {
		return [
			this.file("node_modules/d3-array/dist/d3-array.min.js"),
			this.file("node_modules/d3-geo/dist/d3-geo.min.js"),
			this.file("node_modules/topojson-client/dist/topojson-client.min.js"),
			this.file("lib/layout.js"),
			this.file("lib/ledger.js")
		];
	},

	getStyles () {
		return [this.file("css/wmtc.css")];
	},

	start () {
		// MagicMirror merges config shallowly, so fill in nested ledger options ourselves.
		this.config.ledger = Object.assign({}, this.defaults.ledger, this.config.ledger || {});
		// Before 1.0, views were called filters: the old names still work when the new ones aren't set.
		const unset = (key) => JSON.stringify(this.config[key]) === JSON.stringify(this.defaults[key]);
		if (Array.isArray(this.config.filters) && unset("views")) this.config.views = this.config.filters;
		if (typeof this.config.defaultFilter === "string" && unset("defaultView")) this.config.defaultView = this.config.defaultFilter;
		this.model = null;
		this.features = null;
		this.viewIndex = 0;
		this.page = 0;
		this.pageCount = 1;
		this.pausedUntil = 0;
		this.error = null;
		this.wrapper = null;
		this.timers = {};
		this.naturalHeights = {};
		this.theme = this.config.theme === "analog" ? "analog" : "digital";
		this.colors = WMTCLayout.palette(this.config.travelers, this.config.togetherColor);
		this.locale = (typeof config !== "undefined" && config && config.language) || (typeof navigator !== "undefined" && navigator.language) || "en";
		this.startedAt = Date.now();
		this.editorLink = null;
		this.hintDone = false;
		this.loadWorld();
		this.sendSocketNotification("WMTC_INIT", { identifier: this.identifier, config: this.config });
	},

	loadWorld () {
		return fetch(this.file("geo/countries-50m.json"))
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.json();
			})
			.then((world) => {
				const all = topojson.feature(world, world.objects.countries).features;
				this.features = this.config.hideAntarctica ? all.filter((f) => f.properties.iso2 !== "AQ") : all;
				this.naturalHeights = {};
				this.render();
			})
			.catch((err) => {
				this.error = `Couldn't load the world map (${err.message})`;
				Log.error(`[${this.name}] ${this.error}`);
				this.render();
			});
	},

	socketNotificationReceived (notification, payload) {
		if (!payload || payload.identifier !== this.identifier) return;
		if (notification === "WMTC_DATA") {
			// Keep showing the same view after a data refresh; on first load, start on defaultView.
			const current = this.currentView();
			const wanted = current ? current.id : this.config.defaultView;
			this.model = payload.model;
			this.error = null;
			const index = this.model.views.findIndex((v) => v.id === wanted);
			this.viewIndex = index >= 0 ? index : 0;
			this.render();
			// MagicMirror sets `hidden` while the module is hidden; resume() restarts the timers.
			if (!this.hidden) this.startTimers();
		} else if (notification === "WMTC_EDITOR") {
			this.editorLink = payload.editor || null;
			this.renderEditorCard();
			// "auto": the card goes away 10 minutes after the start, unless there are still no trips.
			clearTimeout(this.cardTimer);
			const left = this.startedAt + EDITOR_CARD_MS - Date.now();
			if (left > 0) this.cardTimer = setTimeout(() => this.renderEditorCard(), left + 50);
		} else if (notification === "WMTC_ERROR") {
			this.error = payload.message;
			this.render();
		}
	},

	/**
	 * Commands from other modules (remote control, buttons, voice):
	 *   WMTC_SET_VIEW "together" | { view: "solo:Sam" }
	 *   WMTC_NEXT_VIEW, WMTC_PREV_VIEW, WMTC_NEXT_PAGE
	 *   WMTC_SET_THEME "digital" | "analog"
	 * The names from before 1.0 (WMTC_SET_FILTER, { filter }, WMTC_NEXT_FILTER, WMTC_PREV_FILTER) still work.
	 */
	notificationReceived (notification, payload) {
		if (!/^WMTC_/.test(notification)) return;
		const value = payload && typeof payload === "object" ? payload.view || payload.filter || payload.theme : payload;
		switch (notification) {
			case "WMTC_SET_VIEW":
			case "WMTC_SET_FILTER":
				if (this.setView(value, true)) this.pause();
				break;
			case "WMTC_NEXT_VIEW":
			case "WMTC_NEXT_FILTER":
				this.stepView(1);
				this.pause();
				break;
			case "WMTC_PREV_VIEW":
			case "WMTC_PREV_FILTER":
				this.stepView(-1);
				this.pause();
				break;
			case "WMTC_NEXT_PAGE":
				this.turnPage();
				break;
			case "WMTC_SET_THEME":
				this.setTheme(value);
				break;
			default:
		}
	},

	suspend () {
		this.stopTimers();
		this.closeDetails();
	},

	resume () {
		this.startTimers();
	},

	currentView () {
		return this.model && this.model.views[this.viewIndex] ? this.model.views[this.viewIndex] : null;
	},

	/** Switch to a view by id ("together", "solo:Sam") or index. */
	setView (idOrIndex, animate) {
		if (!this.model) return false;
		const index = typeof idOrIndex === "number" ? idOrIndex : this.model.views.findIndex((v) => v.id === idOrIndex);
		if (index < 0 || index >= this.model.views.length) return false;
		const changed = index !== this.viewIndex;
		this.viewIndex = index;
		this.page = 0;
		// "All" belongs to every tab, so it keeps the tab on screen; any other view picks its own tab.
		const g = this.viewGroup(this.model.views[index].id);
		if (g) this.group = g;
		this.render();
		if (changed && animate) this.fadeIn();
		return true;
	},

	/** Next or previous view. With group tabs, it stays inside the group on screen (People, Years or Months). */
	stepView (delta) {
		if (!this.model) return false;
		const list = this.groupIndices();
		if (list.length < 2) return false;
		const n = list.length;
		const pos = Math.max(0, list.indexOf(this.viewIndex));
		return this.setView(list[(pos + delta + n) % n], true);
	},

	/** "people" (all, together, solo, person), "years" or "months". */
	/** "people" (together, solo, person), "years" or "months"; null for "all", which is in every group. */
	viewGroup (id) {
		if (id === "all") return null;
		if (String(id).startsWith("year:")) return "years";
		if (String(id).startsWith("month:")) return "months";
		return "people";
	},

	/** The groups the views come from, in order, when group tabs are on and there's more than one. */
	groups () {
		if (!this.model || this.config.viewGroups === false) return [];
		const list = [];
		for (const v of this.model.views) {
			const g = this.viewGroup(v.id);
			if (g && !list.includes(g)) list.push(g);
		}
		return list.length > 1 ? list : [];
	},

	/** The tab on screen (null when there are no tabs). */
	currentGroup () {
		const groups = this.groups();
		if (!groups.length) return null;
		if (groups.includes(this.group)) return this.group;
		// Not chosen yet (the start): the starting view's own tab, else the first. Remembered, so "All" keeps it.
		const view = this.currentView();
		const own = view && this.viewGroup(view.id);
		this.group = own && groups.includes(own) ? own : groups[0];
		return this.group;
	},

	/**
	 * Where a group opens: "All" when there is one (all trips, in that group's colors); else its first view with
	 * a trip already taken (not a planned-only year), else its first view.
	 */
	groupStart (group) {
		const views = this.model.views;
		const all = views.findIndex((v) => v.id === "all");
		if (all >= 0) return all;
		const inGroup = views.map((v, i) => (this.viewGroup(v.id) === group ? i : -1)).filter((i) => i >= 0);
		const visited = inGroup.find((i) => views[i].tripIds.some((id) => this.model.trips[id] && !this.model.trips[id].planned));
		return visited ?? inGroup[0];
	},

	/** Positions of the views in the current group, "All" included (all views when there are no tabs). */
	groupIndices () {
		const views = this.model ? this.model.views : [];
		const g = this.currentGroup();
		if (!g) return views.map((_, i) => i);
		return views.map((v, i) => (v.id === "all" || this.viewGroup(v.id) === g ? i : -1)).filter((i) => i >= 0);
	},

	setTheme (theme) {
		if (theme !== "digital" && theme !== "analog") return false;
		this.theme = theme;
		if (this.wrapper) {
			this.wrapper.classList.remove("wmtc-theme-digital", "wmtc-theme-analog");
			this.wrapper.classList.add(`wmtc-theme-${theme}`);
		}
		this.render();
		return true;
	},

	turnPage () {
		if (this.pageCount < 2) return false;
		this.page = (this.page + 1) % this.pageCount;
		this.renderLedger();
		this.fadeIn(this.ledgerEl);
		return true;
	},

	/** Pause automatic view rotation after someone interacts. */
	pause () {
		this.pausedUntil = Date.now() + Math.max(0, Number(this.config.touchPause) || 0) * 1000;
	},

	startTimers () {
		this.stopTimers();
		const rotate = Number(this.config.rotateInterval);
		if (rotate > 0 && this.model && this.model.views.length > 1) {
			this.timers.rotate = setInterval(() => {
				if (Date.now() >= this.pausedUntil) this.stepView(1);
			}, rotate * 1000);
		}
		const ledger = this.config.ledger;
		const pageEvery = Number(ledger.pageInterval);
		if (ledger.enabled && ledger.overflow !== "shrink" && pageEvery > 0) {
			this.timers.page = setInterval(() => this.turnPage(), pageEvery * 1000);
		}
	},

	stopTimers () {
		Object.values(this.timers).forEach((t) => clearInterval(t));
		this.timers = {};
	},

	fadeIn (node) {
		const target = node || this.bodyEl;
		if (!this.config.animations || !target) return;
		target.classList.remove("wmtc-fade-in");
		void target.offsetWidth; // restart the CSS animation
		target.classList.add("wmtc-fade-in");
	},

	getDom () {
		if (!this.wrapper) this.buildSkeleton();
		return this.wrapper;
	},

	buildSkeleton () {
		const c = this.config;
		const w = el("div", `wmtc wmtc-theme-${this.theme} wmtc-layout-${c.layout === "centered" ? "centered" : "fullscreen"}`);
		if (!c.animations) w.classList.add("wmtc-no-motion");
		if (c.contrast === "high") w.classList.add("wmtc-contrast-high");
		if (c.layout === "centered") {
			w.style.width = WMTCLayout.cssSize(c.maxWidth, "width", "90vw");
			w.style.height = WMTCLayout.cssSize(c.maxHeight, "height", "80vh");
		}

		this.headerEl = el("div", "wmtc-header");
		this.chipsEl = el("div", "wmtc-chips");
		this.legendEl = el("div", "wmtc-legend");
		this.headerEl.append(this.chipsEl, this.legendEl);

		this.bodyEl = el("div", "wmtc-body");
		this.mapEl = el("div", "wmtc-map");
		this.messageEl = el("div", "wmtc-message");
		this.mapEl.append(this.messageEl);
		this.mapEl.addEventListener("click", (e) => this.onMapClick(e));
		this.statsEl = el("div", "wmtc-stats");
		this.ledgerEl = el("div", "wmtc-ledger");
		// A tap on a place opens its card; anywhere else on the ledger (the page number) turns the page.
		this.ledgerEl.addEventListener("click", (e) => {
			const cell = this.config.details && e.target && e.target.closest ? e.target.closest(".wmtc-cell[data-trip]") : null;
			if (cell) this.showTripPlace(cell.getAttribute("data-trip"));
			else this.turnPage();
		});
		this.bodyEl.append(this.mapEl, this.statsEl, this.ledgerEl);

		this.footerEl = el("div", "wmtc-footer");
		w.append(this.headerEl, this.bodyEl, this.footerEl);

		if (typeof ResizeObserver !== "undefined") {
			let pending = false;
			this.resizeObserver = new ResizeObserver(() => {
				if (pending) return;
				pending = true;
				requestAnimationFrame(() => {
					pending = false;
					this.render();
				});
			});
			this.resizeObserver.observe(w);
		}
		this.wrapper = w;
	},

	render () {
		if (!this.wrapper) this.buildSkeleton();
		const view = this.currentView();
		const rect = this.wrapper.getBoundingClientRect();
		this.scale = WMTCLayout.scaleFor(rect.width, rect.height);
		this.wrapper.style.setProperty("--wmtc-font", `${this.scale.fontSize}px`);

		this.renderChips(view);
		this.renderStats(view);
		this.renderLedger();
		this.renderFooter();
		this.renderMap();
		this.renderEditorCard();
	},

	/** View chips double as the color key: tap one to switch views. */
	renderChips (view) {
		this.chipsEl.textContent = "";
		this.legendEl.textContent = "";
		this.compactSwitcher = false;
		if (!this.model || !this.config.showLegend) return;
		const all = this.model.views;
		// With group tabs, only the current group's buttons show (People, Years or Months).
		const entries = this.groupIndices().map((i) => ({ v: all[i], i }));
		const views = entries.map((e) => e.v);
		const groups = this.groups();
		const tabs = () => (groups.length ? this.chipsEl.append(this.renderGroupTabs(groups)) : null);
		if (all.length > 1) {
			const mode = this.config.viewSwitcher;
			tabs();
			if (mode !== "compact") this.renderChipButtons(entries);
			// Many views (one per year) wrap onto more lines and squeeze the map: show one ‹ 2025 › button instead.
			if (entries.length > 1 && (mode === "compact" || (mode !== "buttons" && this.chipsWrap()))) {
				this.chipsEl.textContent = "";
				tabs();
				this.renderSwitcher(entries);
				this.compactSwitcher = true;
			}
		} else if (view && this.colorBy() === "travelers") {
			// One traveler: a plain key of who's who.
			for (const name of this.model.travelers) this.legendEl.append(legendItem(name, this.colors.byName[name]));
		}
		// Year (or month) buttons already show their colors; only add a key when they don't.
		const by = this.colorBy();
		const chipsAreKey = !this.compactSwitcher && views.length > 1 && (by === "year" || by === "month") && views.some((v) => v.id.startsWith(by === "year" ? "year:" : "month:"));
		if (view && by !== "travelers" && !chipsAreKey) this.legendEl.append(...this.colorKey(view));
		const hasPlanned = view && this.config.showPlanned && (view.pins.some((p) => p.planned) || Object.values(view.countries).some((c) => c.state === "planned"));
		if (hasPlanned) this.legendEl.append(legendItem("Planned", null));
	},

	/** People · Years · Months: tapping one shows that group's views (and starts on its first). */
	renderGroupTabs (groups) {
		const box = el("div", "wmtc-groups");
		box.setAttribute("role", "tablist");
		const labels = this.config.labels || {};
		const names = { people: "People", years: "Years", months: "Months" };
		const current = this.currentGroup();
		for (const g of groups) {
			const tab = el("button", g === current ? "wmtc-group wmtc-group-active" : "wmtc-group", labels[g] || names[g]);
			tab.type = "button";
			tab.setAttribute("role", "tab");
			tab.setAttribute("aria-selected", String(g === current));
			tab.addEventListener("click", (e) => {
				e.stopPropagation();
				if (g !== current) {
					this.group = g;
					this.setView(this.groupStart(g), true);
				}
				this.pause();
			});
			box.append(tab);
		}
		return box;
	},

	renderChipButtons (entries) {
		entries.forEach(({ v, i }) => {
			const chip = el("button", i === this.viewIndex ? "wmtc-chip wmtc-chip-active" : "wmtc-chip");
			chip.type = "button";
			const color = this.viewColor(v.id);
			if (color) {
				const dot = el("span", "wmtc-dot");
				dot.style.setProperty("--wmtc-color", color);
				chip.append(dot);
			}
			chip.append(document.createTextNode(this.viewLabel(v)));
			chip.addEventListener("click", (e) => {
				e.stopPropagation();
				this.setView(i, true);
				this.pause();
			});
			this.chipsEl.append(chip);
		});
	},

	/** True when the view buttons take more than one line. */
	chipsWrap () {
		const chips = [...this.chipsEl.querySelectorAll(".wmtc-chip")];
		return chips.length > 1 && chips.some((c) => c.offsetTop > chips[0].offsetTop + 2);
	},

	/** One button for the current view, arrows either side, and a dot for each view. */
	renderSwitcher (entries) {
		const box = el("div", "wmtc-switcher");
		const step = (delta, symbol, label) => {
			const b = el("button", "wmtc-step", symbol);
			b.type = "button";
			b.setAttribute("aria-label", label);
			b.addEventListener("click", (e) => {
				e.stopPropagation();
				this.stepView(delta);
				this.pause();
			});
			return b;
		};
		const v = this.model.views[this.viewIndex];
		const pos = entries.findIndex((e) => e.i === this.viewIndex);
		const current = el("button", "wmtc-chip wmtc-chip-active wmtc-switcher-current");
		current.type = "button";
		const color = this.viewColor(v.id);
		if (color) {
			const dot = el("span", "wmtc-dot");
			dot.style.setProperty("--wmtc-color", color);
			current.append(dot);
		}
		current.append(document.createTextNode(this.viewLabel(v)));
		current.addEventListener("click", (e) => {
			e.stopPropagation();
			this.stepView(1);
			this.pause();
		});
		const where = el("span", "wmtc-switcher-dots");
		if (entries.length <= 20) {
			entries.forEach((_, n) => where.append(el("span", n === pos ? "wmtc-pos wmtc-pos-active" : "wmtc-pos")));
		} else {
			where.textContent = `${pos + 1} / ${entries.length}`;
		}
		box.append(step(-1, "‹", "Previous view"), current, step(1, "›", "Next view"), where);
		this.chipsEl.append(box);
	},

	/** The dot on a view chip: the view's color when the map uses that kind of color, else none. */
	viewColor (id) {
		const by = this.colorBy();
		if (id === "all") return null;
		if (id.startsWith("year:")) return by === "year" ? this.yearColor(id.slice(5)) : null;
		if (id.startsWith("month:")) {
			if (by === "season") return this.seasonColor(Number(id.slice(6)));
			return by === "month" ? WMTCLayout.monthColor(Number(id.slice(6)), this.config.monthColors) : null;
		}
		if (by !== "travelers") return null;
		if (id === "together") return this.colors.together;
		const name = id.slice(id.indexOf(":") + 1);
		return this.colors.byName[name] || null;
	},

	/** "auto" follows the group on screen: people → travelers, years → year, months → month. */
	colorBy () {
		if (["travelers", "year", "month", "season"].includes(this.config.colorBy)) return this.config.colorBy;
		const view = this.currentView();
		if (this.config.colorBy !== "auto" || !view) return "travelers";
		// "All" takes the colors of the tab it's shown in.
		const g = this.currentGroup() || this.viewGroup(view.id);
		return g === "years" ? "year" : g === "months" ? "month" : "travelers";
	},

	seasonColor (month) {
		return WMTCLayout.seasonColor(month, this.config.seasonColors, this.config.hemisphere);
	},

	yearColor (year) {
		return WMTCLayout.yearColor(year, (this.model && this.model.years) || [], { yearColors: this.config.yearColors, yearGradient: this.config.yearGradient });
	},

	/** Color for a country or pin: by who went (default), by the year, or by the month of its most recent visit. */
	placeColor (place) {
		const by = this.colorBy();
		if (by === "year" && place.when) return this.yearColor(place.when.slice(0, 4));
		if (by === "month" && place.when) return WMTCLayout.monthColor(Number(place.when.slice(5, 7)), this.config.monthColors);
		if (by === "season" && place.when) return this.seasonColor(Number(place.when.slice(5, 7)));
		return WMTCLayout.colorFor(place.group, this.colors);
	},

	/** "March" in the mirror's language for month views (the server only knows English). */
	viewLabel (v) {
		if (v.id.startsWith("month:") && !(this.config.labels && this.config.labels.month)) {
			return WMTCLedger.monthNames(this.locale, "long")[Number(v.id.slice(6)) - 1] || v.label;
		}
		return v.label;
	},

	/** What the colors mean, when they show years or months rather than people. */
	colorKey (view) {
		const by = this.colorBy();
		// Planned trips are drawn (dashed, in their color) unless showPlanned is off, so the key follows that.
		const isPlanned = (p) => p.state === "planned" || p.planned === true;
		const places = [...Object.values(view.countries), ...view.pins].filter((p) => p.when && (this.config.showPlanned || !isPlanned(p)));
		if (by === "season") {
			const seasons = new Set(places.map((p) => WMTCLayout.seasonOf(Number(p.when.slice(5, 7)), this.config.hemisphere)));
			const labels = this.config.labels || {};
			return [0, 1, 2, 3].filter((i) => seasons.has(i)).map((i) => {
				const name = WMTCLayout.SEASON_NAMES[i];
				return legendItem(labels[name.toLowerCase()] || name, WMTCLayout.seasonColor(this.firstMonthOf(i), this.config.seasonColors, this.config.hemisphere));
			});
		}
		if (by === "month") {
			const months = [...new Set(places.map((p) => Number(p.when.slice(5, 7))))].sort((a, b) => a - b);
			const names = WMTCLedger.monthNames(this.locale, "short");
			return months.map((m) => legendItem(names[m - 1].replace(/\.$/, ""), WMTCLayout.monthColor(m, this.config.monthColors)));
		}
		const years = (this.model.years || []).filter((y) => places.some((p) => p.when.startsWith(y)));
		if (!years.length) return [];
		if (this.config.yearColors === "distinct" || (this.config.yearColors && typeof this.config.yearColors === "object") || years.length < 3) {
			const shown = [...years].reverse();
			const items = shown.slice(0, 10).map((y) => legendItem(y, this.yearColor(y)));
			if (shown.length > 10) items.push(el("span", "wmtc-legend-item", "…"));
			return items;
		}
		// A gradient bar from the oldest to the newest year in this view.
		const bar = el("span", "wmtc-key-gradient");
		const steps = years.map((y, i) => `${this.yearColor(y)} ${Math.round((i / (years.length - 1)) * 100)}%`);
		bar.style.setProperty("background", `linear-gradient(to right, ${steps.join(", ")})`);
		const item = el("span", "wmtc-legend-item wmtc-key");
		item.append(document.createTextNode(years[0]), bar, document.createTextNode(years[years.length - 1]));
		return [item];
	},

	/** A month in a season (0 winter … 3 autumn), for its color. */
	firstMonthOf (season) {
		for (let m = 1; m <= 12; m++) if (WMTCLayout.seasonOf(m, this.config.hemisphere) === season) return m;
		return 1;
	},

	renderStats (view) {
		this.statsEl.textContent = "";
		const parts = this.config.showStats && view ? WMTCLedger.statParts(view.stats, this.config.stats, this.locale) : [];
		this.statsEl.hidden = parts.length === 0 || !view.tripIds.length;
		// The numbers follow the view on screen, so say which one when it isn't everything ("Alex only: 3 countries").
		if (parts.length && view.id !== "all" && this.model.views.length > 1) {
			const label = el("span", "wmtc-stat-view", `${this.viewLabel(view)}:`);
			const color = this.viewColor(view.id);
			if (color) label.style.setProperty("--wmtc-color", color);
			this.statsEl.append(label);
		}
		for (const p of parts) {
			const item = el("span", `wmtc-stat wmtc-stat-${p.key}`);
			if (p.before) item.append(document.createTextNode(`${p.before} `));
			item.append(el("span", "wmtc-stat-value", p.value), document.createTextNode(` ${p.label}`));
			this.statsEl.append(item);
		}
	},

	ledgerTrips (view) {
		const l = this.config.ledger;
		const trips = view.tripIds.map((id) => this.model.trips[id]).filter((t) => t && (l.showPlanned || !t.planned));
		return l.sort === "newest" ? trips : WMTCLedger.sortTrips(trips, l.sort);
	},

	renderLedger () {
		const l = this.config.ledger;
		const view = this.currentView();
		this.ledgerEl.textContent = "";
		const trips = l.enabled && view ? this.ledgerTrips(view) : [];
		this.ledgerEl.hidden = trips.length === 0;
		this.pageCount = 1;
		if (!trips.length) return;

		const columns = this.ledgerColumns();
		const baseFont = Math.round(this.scale.fontSize * 0.78 * 10) / 10;
		const rows = this.ledgerRows(trips.length, columns, baseFont);
		let pageTrips;
		let gridRows = rows;
		let font = baseFont;
		let more = 0;
		if (l.overflow === "shrink") {
			const plan = WMTCLedger.shrinkPlan({ count: trips.length, rows, columns, fontSize: baseFont, minFontSize: l.minFontSize });
			pageTrips = trips.slice(0, plan.shown);
			gridRows = plan.rows;
			font = plan.fontSize;
			more = plan.more;
		} else {
			const pages = WMTCLedger.paginate(trips, rows, columns);
			this.pageCount = pages.length;
			this.page = this.page % pages.length;
			pageTrips = pages[this.page];
		}

		this.ledgerEl.style.setProperty("--wmtc-ledger-font", `${font}px`);
		this.ledgerEl.style.setProperty("--wmtc-marker-slots", String(Math.max(1, ...pageTrips.map((t) => t.travelers.length))));
		this.ledgerEl.style.setProperty("--wmtc-ledger-height", `${(rows * baseFont * 1.75).toFixed(1)}px`);
		const grid = el("div", "wmtc-ledger-grid");
		grid.style.gridTemplateRows = `repeat(${gridRows}, 1fr)`;
		grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
		const initials = WMTCLedger.initials(this.model.travelers);
		const newestId = view.newestId;
		for (const t of pageTrips) grid.append(this.ledgerCell(t, initials, t.id === newestId && this.config.highlightNewest));
		if (more > 0) grid.append(el("div", "wmtc-cell wmtc-cell-more", `+${more} more`));
		this.ledgerEl.append(grid);
		if (this.pageCount > 1) this.ledgerEl.append(el("div", "wmtc-page", `${this.page + 1} / ${this.pageCount}`));
	},

	/** Columns in the ledger: a number as it is; "auto" is 4, or 2 on a tall screen so names fit. */
	ledgerColumns () {
		const wanted = this.config.ledger.columns;
		if (wanted !== "auto") return Math.max(1, Math.floor(wanted) || 1);
		const box = this.wrapper ? this.wrapper.getBoundingClientRect() : null;
		return box && box.height > box.width ? 2 : 4;
	},

	/**
	 * Rows in the ledger. A number is used as it is. "auto" is 5, or more when there's room under the map
	 * (portrait mirrors) and trips to fill it, up to 30; the map keeps its full size either way.
	 */
	ledgerRows (count, columns, rowFont) {
		const wanted = this.config.ledger.rows;
		if (wanted !== "auto") return Math.max(1, Math.floor(wanted) || 1);
		const MIN = 5;
		const MAX = 30;
		const needed = Math.ceil(count / columns);
		if (needed <= MIN || !this.features || !this.bodyEl) return MIN;
		const body = this.bodyEl.getBoundingClientRect();
		if (body.width < 10 || body.height < 10) return MIN;
		const pad = WMTCLayout.scaleFor(body.width, body.height).pinRadius * 2;
		const map = this.naturalMapHeight(body.width, pad);
		const stats = this.statsEl.hidden ? 0 : this.statsEl.getBoundingClientRect().height;
		const gaps = this.scale.fontSize * 0.7 * 2 + rowFont * 1.5; // body gaps, and the page number under the ledger
		const room = Math.floor((body.height - map - stats - gaps) / (rowFont * 1.75));
		return Math.max(MIN, Math.min(MAX, room, needed));
	},

	ledgerCell (trip, initials, isNewest) {
		const l = this.config.ledger;
		const text = WMTCLedger.cellText(trip, { showCountry: l.showCountry, showDays: l.showDays, dateFormat: l.dateFormat, locale: this.locale });
		const cell = el("div", "wmtc-cell");
		cell.setAttribute("data-trip", trip.id);
		if (trip.planned) cell.classList.add("wmtc-cell-planned");
		if (isNewest) cell.classList.add("wmtc-cell-newest");
		const groupColor = WMTCLayout.colorFor(trip.group, this.colors);

		if (l.travelerMarker === "dots" || l.travelerMarker === "initials") {
			const marker = el("span", "wmtc-marker");
			for (const name of trip.travelers) {
				const color = this.colors.byName[name] || this.colors.together;
				const m = l.travelerMarker === "dots" ? el("span", "wmtc-dot") : el("span", "wmtc-initial", initials[name] || name.charAt(0));
				m.style.setProperty("--wmtc-color", color);
				m.title = name;
				marker.append(m);
			}
			cell.append(marker);
		} else if (l.travelerMarker === "color") {
			cell.style.setProperty("--wmtc-cell-color", groupColor);
			cell.classList.add("wmtc-cell-tinted");
		}
		cell.append(el("span", "wmtc-place", text.place));
		if (text.days) cell.append(el("span", "wmtc-days", text.days));
		cell.append(el("span", "wmtc-date", text.date));
		cell.title = `${text.place}, ${text.date}${trip.travelers.length ? ` (${trip.travelers.join(", ")})` : ""}`;
		return cell;
	},

	renderFooter () {
		const problems = this.model && this.model.problems ? this.model.problems : [];
		const fileLevel = problems.find((p) => p && p.row === 0);
		const rows = problems.filter((p) => !p || p.row !== 0).length;
		let message = "";
		if (fileLevel) message = `${fileLevel.source}: ${(fileLevel.errors || [])[0] || "couldn't be read"}`;
		else if (rows) message = `${rows} trip${rows === 1 ? "" : "s"} can't be shown. Open the trip editor to see why.`;
		this.footerEl.textContent = this.config.showProblems ? message : "";
	},

	/** Height the map needs at a given width, so on tall screens the ledger sits right under it. */
	naturalMapHeight (width, pad) {
		const key = `${Math.round(width)}|${this.config.projection}`;
		if (this.naturalHeights[key]) return this.naturalHeights[key];
		const collection = { type: "FeatureCollection", features: this.features };
		const projection = makeProjection(this.config.projection).fitWidth(Math.max(1, width - pad * 2), collection);
		const b = d3.geoPath(projection).bounds(collection);
		const h = Math.ceil(b[1][1] - b[0][1] + pad * 2);
		this.naturalHeights[key] = h;
		return h;
	},

	/** A tap on the map: a pin or a country opens its details; anywhere else closes them. */
	onMapClick (e) {
		if (!this.config.details) return;
		if (!this.hintDone) {
			this.hintDone = true;
			if (this.messageEl.classList.contains("wmtc-message-hint")) this.setMessage("");
		}
		const target = e.target && e.target.closest ? e.target : null;
		if (!target) return;
		if (target.closest(".wmtc-detail")) {
			if (target.closest(".wmtc-detail-close")) this.closeDetails();
			const all = target.closest(".wmtc-detail-all");
			if (all) this.showCountry(all.getAttribute("data-code"), this.detailPoint);
			return;
		}
		const view = this.currentView();
		const pinKey = this.pinNear(e) || (target.closest("[data-pin]") ? target.closest("[data-pin]").getAttribute("data-pin") : null);
		const countryEl = pinKey ? null : target.closest("[data-code]");
		if (pinKey && pinKey.startsWith("country:")) return this.showCountry(pinKey.slice(8), e);
		const pin = pinKey && view ? view.pins.find((p) => p.key === pinKey) : null;
		const country = countryEl && view ? view.countries[countryEl.getAttribute("data-code")] : null;
		if (pin) this.showPin(pin, e);
		else if (country) this.showDetails("country", country.tripIds, e, countryEl);
		else this.closeDetails();
	},

	/** A city's card. Small countries are hard to tap, so it links to the whole country when there's more there. */
	showPin (pin, point) {
		const visible = [...this.mapEl.querySelectorAll(".wmtc-pin")].find((c) => c.getAttribute("data-pin") === pin.key);
		const view = this.currentView();
		const country = view && view.countries[pin.country];
		const more = country && country.tripIds.some((id) => !pin.tripIds.includes(id) && this.model.trips[id] && (this.config.showPlanned || !this.model.trips[id].planned));
		this.showDetails("pin", pin.tripIds, point, visible, more ? pin.country : null);
	},

	showCountry (code, point) {
		const view = this.currentView();
		const country = view && view.countries[code];
		if (!country) return;
		const path = this.mapEl.querySelector(`.wmtc-country[data-code="${code}"]`);
		this.showDetails("country", country.tripIds, point, path);
	},

	/** A tap on a place in the ledger opens that place's card on the map. */
	showTripPlace (tripId) {
		const view = this.currentView();
		const trip = this.model && this.model.trips[tripId];
		if (!view || !trip) return;
		const box = this.mapEl.getBoundingClientRect();
		const pin = view.pins.find((p) => p.tripIds.includes(tripId));
		const spot = pin && this.pinPoints ? this.pinPoints.find((p) => p.key === pin.key) : null;
		if (pin && spot) return this.showPin(pin, { clientX: box.left + spot.x, clientY: box.top + spot.y });
		const path = this.mapEl.querySelector(`.wmtc-country[data-code="${trip.country}"]`);
		const r = path ? path.getBoundingClientRect() : null;
		this.showCountry(trip.country, r && r.width ? { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 } : null);
	},

	/** The pin closest to a tap, if one is within finger reach. */
	pinNear (e) {
		if (!this.pinPoints || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY) || (e.clientX === 0 && e.clientY === 0)) return null;
		const box = this.mapEl.getBoundingClientRect();
		const x = e.clientX - box.left;
		const y = e.clientY - box.top;
		let best = null;
		let bestDist = Infinity;
		for (const p of this.pinPoints) {
			const dist = Math.hypot(p.x - x, p.y - y);
			if (dist <= p.reach && dist < bestDist) {
				best = p.key;
				bestDist = dist;
			}
		}
		return best;
	},

	/** Open the card for a place, next to where it was tapped. */
	showDetails (kind, tripIds, point, selectedEl, countryLink) {
		this.closeDetails();
		if (!this.model) return;
		const trips = (tripIds || []).map((id) => this.model.trips[id]).filter((t) => t && (this.config.showPlanned || !t.planned));
		if (!trips.length) return;
		const d = WMTCLedger.placeDetails(trips, { kind, dateFormat: this.config.ledger.dateFormat, locale: this.locale });

		const card = el("div", `wmtc-detail wmtc-detail-${kind}`);
		card.setAttribute("role", "dialog");
		const close = el("button", "wmtc-detail-close", "×");
		close.setAttribute("aria-label", "Close");
		close.type = "button";
		card.append(close, el("div", "wmtc-detail-title", d.title));
		if (d.facts.length) {
			const facts = el("ul", "wmtc-detail-facts");
			for (const f of d.facts) facts.append(el("li", "", f));
			card.append(facts);
		}
		const visits = el("ul", "wmtc-detail-visits");
		for (const v of d.visits) {
			const li = el("li", v.planned ? "wmtc-detail-visit wmtc-detail-planned" : "wmtc-detail-visit");
			li.append(el("span", "wmtc-detail-when", v.when));
			if (v.place) li.append(el("span", "wmtc-detail-place", v.place));
			if (v.detail) li.append(el("span", "wmtc-detail-info", v.detail));
			if (v.planned) li.append(el("span", "wmtc-detail-tag", "planned"));
			if (v.note && this.config.detailsNotes !== false) li.append(el("div", "wmtc-detail-note", v.note));
			visits.append(li);
		}
		card.append(visits);
		if (d.more) card.append(el("div", "wmtc-detail-more", `+${d.more} more`));
		if (countryLink) {
			const name = trips[0].countryName || countryLink;
			const all = el("button", "wmtc-detail-all", `See all of ${name} \u203a`);
			all.type = "button";
			all.setAttribute("data-code", countryLink);
			card.append(all);
		}
		this.detailPoint = point && Number.isFinite(point.clientX) ? { clientX: point.clientX, clientY: point.clientY } : null;
		this.mapEl.append(card);
		this.detailEl = card;

		// Place it beside the tap, flipped and kept inside the map when near an edge.
		const box = this.mapEl.getBoundingClientRect();
		const size = card.getBoundingClientRect();
		const x = (point && Number.isFinite(point.clientX) ? point.clientX : box.left + box.width / 2) - box.left;
		const y = (point && Number.isFinite(point.clientY) ? point.clientY : box.top + box.height / 2) - box.top;
		const gap = 14;
		let left = x + gap + size.width > box.width ? x - gap - size.width : x + gap;
		let top = y - size.height / 2;
		left = Math.max(4, Math.min(left, box.width - size.width - 4));
		top = Math.max(4, Math.min(top, box.height - size.height - 4));
		card.style.left = `${Math.round(left)}px`;
		card.style.top = `${Math.round(top)}px`;

		if (selectedEl) {
			selectedEl.classList.add("wmtc-selected");
			this.selectedEl = selectedEl;
		}
		// A tap anywhere else on the screen closes the card (taps on the map are handled by onMapClick).
		this.outsideTap = (ev) => {
			if (!this.mapEl.contains(ev.target)) this.closeDetails();
		};
		document.addEventListener("click", this.outsideTap, true);
		const timeout = Number(this.config.detailsTimeout);
		this.pausedUntil = Math.max(Date.now() + Math.max(0, Number(this.config.touchPause) || 0) * 1000, timeout > 0 ? Date.now() + timeout * 1000 : Infinity);
		if (timeout > 0) this.detailTimer = setTimeout(() => this.closeDetails(), timeout * 1000);
	},

	closeDetails () {
		if (this.outsideTap) document.removeEventListener("click", this.outsideTap, true);
		this.outsideTap = null;
		clearTimeout(this.detailTimer);
		this.detailTimer = null;
		if (this.detailEl) this.detailEl.remove();
		this.detailEl = null;
		if (this.selectedEl) this.selectedEl.classList.remove("wmtc-selected");
		this.selectedEl = null;
		// A card that stayed open (detailsTimeout: 0) paused rotation indefinitely: count down from now instead.
		if (this.pausedUntil === Infinity) this.pause();
	},

	setMessage (text, hint) {
		this.messageEl.textContent = text;
		this.messageEl.classList.toggle("wmtc-message-hint", Boolean(hint && text));
	},

	/**
	 * Draw the map. The countries' outlines are the slow part (about half a second on a Pi 4), so they are
	 * drawn once per size, map shape and theme; switching views only recolors them and redraws the pins.
	 */
	renderMap () {
		if (!this.mapEl) return;
		this.closeDetails();
		const message = this.error || (!this.features ? "Loading map…" : !this.model ? "Loading trips…" : "");
		this.setMessage(message);
		const dropMap = () => {
			if (this.mapBase) this.mapBase.svg.remove();
			this.mapBase = null;
		};
		if (!this.features) return dropMap();

		let box = this.mapEl.getBoundingClientRect();
		if (box.width < 10) return dropMap();
		const scale = WMTCLayout.scaleFor(box.width, box.height);
		const pad = scale.pinRadius * 2;
		const natural = this.naturalMapHeight(box.width, pad);
		if (Math.abs((parseFloat(this.mapEl.style.height) || 0) - natural) > 1) {
			this.mapEl.style.height = `${natural}px`;
			box = this.mapEl.getBoundingClientRect();
		}
		if (box.height < 10) return dropMap();
		const view = this.currentView();
		const analog = this.theme === "analog";

		const key = [Math.round(box.width), Math.round(box.height), this.config.projection, this.theme, this.features.length].join("|");
		if (!this.mapBase || this.mapBase.key !== key) {
			dropMap();
			this.mapBase = this.drawBase(key, box, scale, pad);
		}
		const { svg, projection, countryPaths, filterId } = this.mapBase;
		if (!svg.isConnected) this.mapEl.appendChild(svg);

		const states = view ? view.countries : {};
		const showPlanned = this.config.showPlanned;
		const fade = { enabled: Boolean(this.config.fadeByAge), strength: this.config.fadeStrength, unit: this.config.fadeUnit, amount: this.config.fadeAmount };
		const month = this.model && (this.model.today || this.model.currentMonth);
		const fadeStyle = (last) => {
			const f = WMTCLayout.fadeFactor(last, month, fade);
			return f < 1 ? `;--wmtc-fade:${f}` : "";
		};
		const shade = Boolean(this.config.shadeCountries);
		// Without shaded countries the pins carry the whole map, so they are drawn bigger.
		const pinBase = scale.pinRadius * (shade ? 1 : 1.6);
		for (const { el: p, code } of countryPaths) {
			const state = states[code];
			if (state && !shade && (state.state === "visited" || showPlanned)) {
				// Pins only: the country stays plain, but can still be tapped for its trips.
				p.setAttribute("class", "wmtc-country wmtc-has-trips");
				p.setAttribute("data-code", code);
				p.removeAttribute("style");
				p.removeAttribute("filter");
			} else if (state && (state.state === "visited" || showPlanned)) {
				p.setAttribute("class", `wmtc-country wmtc-${state.state}`);
				p.setAttribute("data-code", code);
				p.setAttribute("style", `--wmtc-color:${this.placeColor(state)}${state.state === "visited" ? fadeStyle(state.last) : ""}`);
				if (analog && state.state === "visited") p.setAttribute("filter", `url(#${filterId})`);
				else p.removeAttribute("filter");
			} else if (p.hasAttribute("data-code")) {
				p.setAttribute("class", "wmtc-country");
				p.removeAttribute("data-code");
				p.removeAttribute("style");
				p.removeAttribute("filter");
			}
		}

		svg.querySelectorAll(".wmtc-pins, .wmtc-halos").forEach((g) => g.remove());
		const pinLayer = svgEl("g", { class: "wmtc-pins" });
		const haloLayer = svgEl("g", { class: "wmtc-halos" });
		// Where each pin is drawn, so a tap can pick the nearest one (pins are small and often close together).
		this.pinPoints = [];
		for (const pin of view ? view.pins : []) {
			if (pin.planned && !showPlanned) continue;
			const xy = projection([pin.lon, pin.lat]);
			if (!xy || !Number.isFinite(xy[0])) continue;
			const r = WMTCLayout.pinRadius(pinBase, pin.visits);
			const color = this.placeColor(pin);
			const circle = svgEl("circle", {
				cx: xy[0].toFixed(1),
				cy: xy[1].toFixed(1),
				r,
				class: pin.planned ? "wmtc-pin wmtc-pin-planned" : "wmtc-pin",
				"data-pin": pin.key,
				style: `--wmtc-color:${color}${pin.planned ? "" : fadeStyle(pin.last)}`
			});
			circle.appendChild(svgEl("title", {}, `${pin.city}${pin.visits > 1 ? ` (${pin.visits} visits)` : ""}`));
			pinLayer.appendChild(circle);
			this.pinPoints.push({ key: pin.key, x: xy[0], y: xy[1], reach: Math.max(r + 6, scale.pinRadius * 3, 14) });
			if (pin.newest && this.config.highlightNewest) {
				haloLayer.appendChild(svgEl("circle", { cx: xy[0].toFixed(1), cy: xy[1].toFixed(1), r: r * 1.1, class: "wmtc-halo", style: `--wmtc-color:${color}` }));
			}
		}
		// Pins only: a country visited without a city (a road trip, "Iceland") gets its pin in the middle of the country.
		if (!shade && view) {
			const withPins = new Set(view.pins.map((p) => p.country));
			for (const [code, c] of Object.entries(view.countries)) {
				if (withPins.has(code) || (c.state === "planned" && !showPlanned)) continue;
				const xy = this.countryCenter(code);
				if (!xy) continue;
				const planned = c.state === "planned";
				const r = WMTCLayout.pinRadius(pinBase, 1);
				const color = this.placeColor(c);
				const key = `country:${code}`;
				const circle = svgEl("circle", {
					cx: xy[0].toFixed(1),
					cy: xy[1].toFixed(1),
					r,
					class: planned ? "wmtc-pin wmtc-pin-country wmtc-pin-planned" : "wmtc-pin wmtc-pin-country",
					"data-pin": key,
					style: `--wmtc-color:${color}${planned ? "" : fadeStyle(c.last)}`
				});
				const name = this.model.trips[c.tripIds[0]] ? this.model.trips[c.tripIds[0]].countryName : code;
				circle.appendChild(svgEl("title", {}, name));
				pinLayer.appendChild(circle);
				this.pinPoints.push({ key, x: xy[0], y: xy[1], reach: Math.max(r + 6, scale.pinRadius * 3, 14) });
				if (view.newestId && c.tripIds.includes(view.newestId) && this.config.highlightNewest) {
					haloLayer.appendChild(svgEl("circle", { cx: xy[0].toFixed(1), cy: xy[1].toFixed(1), r: r * 1.1, class: "wmtc-halo", style: `--wmtc-color:${color}` }));
				}
			}
		}
		svg.append(haloLayer, pinLayer);

		if (this.model && view && !view.tripIds.length && !this.error) {
			this.setMessage(Object.keys(this.model.trips).length ? "No trips in this view yet" : "No trips yet. Add some to data/trips.json");
		} else if (!this.messageEl.textContent && this.hintWanted()) {
			this.setMessage("Tap a place for details", true);
		}
	},

	/** The part of the map that only changes with its size, shape or theme: the countries' outlines. */
	drawBase (key, box, scale, pad) {
		const collection = { type: "FeatureCollection", features: this.features };
		const projection = makeProjection(this.config.projection);
		projection.fitExtent([[pad, pad], [box.width - pad, box.height - pad]], collection);
		const path = d3.geoPath(projection);
		const top = path.bounds(collection)[0][1];
		if (top > pad + 1) {
			const [tx, ty] = projection.translate();
			projection.translate([tx, ty - (top - pad)]);
		}

		const svg = svgEl("svg", { class: "wmtc-svg", width: box.width, height: box.height, viewBox: `0 0 ${box.width} ${box.height}` });
		svg.style.setProperty("--wmtc-line", `${scale.lineWidth}px`);
		const filterId = `wmtc-wash-${this.identifier}`;
		if (this.theme === "analog") {
			svg.appendChild(watercolorFilter(filterId));
			const grid = path(d3.geoGraticule10());
			if (grid) svg.appendChild(svgEl("path", { d: grid, class: "wmtc-graticule" }));
		}
		const countryLayer = svgEl("g", { class: "wmtc-countries" });
		const countryPaths = [];
		for (const f of this.features) {
			const d = path(f);
			if (!d) continue;
			const p = svgEl("path", { d, class: "wmtc-country" });
			p.appendChild(svgEl("title", {}, f.properties.name));
			countryLayer.appendChild(p);
			countryPaths.push({ el: p, code: f.properties.iso2, feature: f });
		}
		svg.appendChild(countryLayer);
		this.mapEl.appendChild(svg);
		return { key, svg, projection, path, countryPaths, filterId, centers: {} };
	},

	/** The middle of a country's largest piece of land (so France's pin is in France, not between its islands). */
	countryCenter (code) {
		const base = this.mapBase;
		if (!base) return null;
		if (code in base.centers) return base.centers[code];
		let best = null;
		let bestArea = -1;
		for (const { code: c, feature } of base.countryPaths) {
			if (c !== code || !feature.geometry) continue;
			const g = feature.geometry;
			const pieces = g.type === "MultiPolygon" ? g.coordinates.map((coordinates) => ({ type: "Polygon", coordinates })) : [g];
			for (const piece of pieces) {
				const area = d3.geoArea(piece);
				if (area > bestArea) {
					bestArea = area;
					best = piece;
				}
			}
		}
		const xy = best ? base.path.centroid(best) : null;
		base.centers[code] = xy && Number.isFinite(xy[0]) ? xy : null;
		return base.centers[code];
	},

	/** "Tap a place for details", on touch screens until the first tap. */
	hintWanted () {
		return Boolean(this.config.details && this.config.detailsHint !== false && !this.hintDone && isTouchScreen() && this.model && Object.keys(this.model.trips).length);
	},

	/**
	 * When to show "Add trips from your phone" (showEditorLink): "full" in the middle of the map when there
	 * are no trips yet, "corner" for the first 10 minutes after a start ("auto") or always (true), else none.
	 */
	editorCardMode () {
		const want = this.config.showEditorLink;
		if (!this.editorLink || !this.model || want === false || want === "false" || this.error) return null;
		if (!Object.keys(this.model.trips).length) return "full";
		if (want === true || want === "always" || Date.now() - this.startedAt < EDITOR_CARD_MS) return "corner";
		return null;
	},

	renderEditorCard () {
		if (this.startEl) this.startEl.remove();
		this.startEl = null;
		const mode = this.mapEl ? this.editorCardMode() : null;
		if (!mode) return;
		const link = this.editorLink;
		const card = el("div", `wmtc-start wmtc-start-${mode}`);
		if (link.reachable && link.qr) card.append(qrSvg(link.qr));
		const words = el("div", "wmtc-start-text");
		// The corner card is a small tag under the QR code; the full card (no trips yet) explains more.
		words.append(el("div", "wmtc-start-title", mode === "corner" && link.reachable ? "Scan to add trips" : "Add trips from your phone"));
		if (link.reachable) {
			if (mode === "full") words.append(el("div", "wmtc-start-help", "Scan the code, or open this address on a phone on the same Wi-Fi:"));
			words.append(urlLines(link.url));
		} else {
			words.append(el("div", "wmtc-start-help", link.reason === "network"
				? "The mirror isn't connected to a network, so phones can't open the trip editor yet."
				: "Phones can't open the trip editor yet: MagicMirror only lets the mirror itself in. See \u201cOpening the editor from your phone\u201d in this module's README."));
			// Its address tells the person setting up which home network to let in (192.168.1.20 → 192.168.1.0).
			const host = link.url && /^https?:\/\/([^/:]+|\[[^\]]+\])/.exec(link.url);
			if (host && link.reason !== "network") words.append(el("div", "wmtc-start-help", `This mirror's address: ${host[1]}`));
		}
		card.append(words);
		if (mode === "full") this.setMessage("");
		this.mapEl.append(card);
		this.startEl = card;
	}
});

/** An address that may wrap, but only after a "/" (never in the middle of a word). */
function urlLines (url) {
	const box = el("div", "wmtc-start-url");
	String(url).split(/(?<=[^:/]\/)/).forEach((part, i) => {
		if (i) box.append(document.createElement("wbr"));
		box.append(el("span", "wmtc-nowrap", part)); // no break at the "-" in "MMM-World…"
	});
	return box;
}

/** How long "auto" shows the editor's address after a start. */
const EDITOR_CARD_MS = 10 * 60 * 1000;

function isTouchScreen () {
	if (typeof window === "undefined") return false;
	const coarse = typeof window.matchMedia === "function" && window.matchMedia("(any-pointer: coarse)").matches;
	return Boolean(coarse || (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0));
}

/** A QR code drawn from the path the node helper made: black squares on a white square, as scanners expect. */
function qrSvg (qr) {
	const quiet = 2;
	const size = qr.size + quiet * 2;
	const svg = svgEl("svg", { class: "wmtc-qr", viewBox: `${-quiet} ${-quiet} ${size} ${size}`, "shape-rendering": "crispEdges", role: "img", "aria-label": "QR code for the trip editor" });
	svg.append(svgEl("rect", { x: -quiet, y: -quiet, width: size, height: size, fill: "#fff" }), svgEl("path", { d: qr.d, fill: "#000" }));
	return svg;
}

function makeProjection (name) {
	if (name === "mercator") return d3.geoMercator();
	if (name === "naturalEarth") return d3.geoNaturalEarth1();
	if (name === "equirectangular") return d3.geoEquirectangular();
	return d3.geoEqualEarth();
}

/** A soft, uneven edge for country fills in the Analog theme. Drawn once per render. */
function watercolorFilter (id) {
	const defs = svgEl("defs", {});
	const filter = svgEl("filter", { id, x: "-5%", y: "-5%", width: "110%", height: "110%" });
	filter.append(
		svgEl("feTurbulence", { type: "fractalNoise", baseFrequency: "0.04", numOctaves: "2", seed: "7", result: "noise" }),
		svgEl("feDisplacementMap", { in: "SourceGraphic", in2: "noise", scale: "3", xChannelSelector: "R", yChannelSelector: "G" })
	);
	defs.append(filter);
	return defs;
}

function legendItem (label, color) {
	const item = el("span", "wmtc-legend-item");
	const dot = el("span", color ? "wmtc-dot" : "wmtc-dot wmtc-dot-planned");
	if (color) dot.style.setProperty("--wmtc-color", color);
	item.append(dot, document.createTextNode(label));
	return item;
}

function el (tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function svgEl (tag, attrs, text) {
	const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
	for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
	if (text !== undefined) node.textContent = text;
	return node;
}
