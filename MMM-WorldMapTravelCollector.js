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
		home: null,

		// Data
		dataDir: "",
		sheetUrl: "", // a Google Sheet shared with File → Share → Publish to web → CSV
		sheetRefreshMinutes: 30,

		// Web editor at http://<mirror>:8080/MMM-WorldMapTravelCollector/
		editor: true,
		editorPin: "",
		homeRadiusKm: 50, // Timeline import: visits this close to home aren't trips

		// Look
		layout: "fullscreen", // "fullscreen" | "centered"
		maxWidth: "90%",
		maxHeight: "80%",
		theme: "digital", // "digital" | "analog"
		projection: "equalEarth", // map shape: "equalEarth" (curved edges) | "naturalEarth" (less curved) | "equirectangular" (flat rectangle) | "mercator"
		hideAntarctica: true,
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
		filters: ["all", "together", "solo"],
		defaultFilter: "all",
		rotateInterval: 30, // seconds between views; 0 = off
		touchPause: 120, // seconds rotation pauses after a tap or a command
		details: true, // tap a pin or a country to see its trips
		detailsTimeout: 20, // seconds before the details card closes by itself; 0 = stays open
		labels: {},

		// Stats
		showStats: true,
		stats: ["countries", "cities", "continents", "worldPercent", "tripsThisYear", "distance"],
		worldCountryCount: 195,
		distanceUnits: "km",

		// Ledger
		ledger: {
			enabled: true,
			rows: 5,
			columns: 4,
			sort: "newest", // "newest" | "oldest" | "alpha"
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
			// Keep showing the same view after a data refresh; on first load, start on defaultFilter.
			const current = this.currentView();
			const wanted = current ? current.id : this.config.defaultFilter;
			this.model = payload.model;
			this.error = null;
			const index = this.model.views.findIndex((v) => v.id === wanted);
			this.viewIndex = index >= 0 ? index : 0;
			this.render();
			this.startTimers();
		} else if (notification === "WMTC_ERROR") {
			this.error = payload.message;
			this.render();
		}
	},

	/**
	 * Commands from other modules (remote control, buttons, voice):
	 *   WMTC_SET_FILTER "together" | { filter: "solo:Sam" }
	 *   WMTC_NEXT_FILTER, WMTC_PREV_FILTER, WMTC_NEXT_PAGE
	 *   WMTC_SET_THEME "digital" | "analog"
	 */
	notificationReceived (notification, payload) {
		if (!/^WMTC_/.test(notification)) return;
		const value = payload && typeof payload === "object" ? payload.filter || payload.theme : payload;
		switch (notification) {
			case "WMTC_SET_FILTER":
				if (this.setView(value, true)) this.pause();
				break;
			case "WMTC_NEXT_FILTER":
				this.stepView(1);
				this.pause();
				break;
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
		this.render();
		if (changed && animate) this.fadeIn();
		return true;
	},

	stepView (delta) {
		if (!this.model || this.model.views.length < 2) return false;
		const n = this.model.views.length;
		return this.setView((this.viewIndex + delta + n) % n, true);
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
		this.ledgerEl.addEventListener("click", () => this.turnPage());
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
	},

	/** View chips double as the color key: tap one to switch views. */
	renderChips (view) {
		this.chipsEl.textContent = "";
		this.legendEl.textContent = "";
		if (!this.model || !this.config.showLegend) return;
		const views = this.model.views;
		if (views.length > 1) {
			views.forEach((v, i) => {
				const chip = el("button", i === this.viewIndex ? "wmtc-chip wmtc-chip-active" : "wmtc-chip");
				chip.type = "button";
				const color = this.viewColor(v.id);
				if (color) {
					const dot = el("span", "wmtc-dot");
					dot.style.setProperty("--wmtc-color", color);
					chip.append(dot);
				}
				chip.append(document.createTextNode(v.label));
				chip.addEventListener("click", (e) => {
					e.stopPropagation();
					this.setView(i, true);
					this.pause();
				});
				this.chipsEl.append(chip);
			});
		} else if (view) {
			// One traveler: a plain key of who's who.
			for (const name of this.model.travelers) this.legendEl.append(legendItem(name, this.colors.byName[name]));
		}
		const hasPlanned = view && this.config.showPlanned && (view.pins.some((p) => p.planned) || Object.values(view.countries).some((c) => c.state === "planned"));
		if (hasPlanned) this.legendEl.append(legendItem("Planned", null));
	},

	viewColor (id) {
		if (id === "all") return null;
		if (id === "together") return this.colors.together;
		const name = id.slice(id.indexOf(":") + 1);
		return this.colors.byName[name] || null;
	},

	renderStats (view) {
		this.statsEl.textContent = "";
		const parts = this.config.showStats && view ? WMTCLedger.statParts(view.stats, this.config.stats, this.locale) : [];
		this.statsEl.hidden = parts.length === 0 || !view.tripIds.length;
		for (const p of parts) {
			const item = el("span", `wmtc-stat wmtc-stat-${p.key}`);
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

		const rows = Math.max(1, Math.floor(l.rows) || 1);
		const columns = Math.max(1, Math.floor(l.columns) || 1);
		const baseFont = Math.round(this.scale.fontSize * 0.78 * 10) / 10;
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

	ledgerCell (trip, initials, isNewest) {
		const l = this.config.ledger;
		const text = WMTCLedger.cellText(trip, { showCountry: l.showCountry, showDays: l.showDays, dateFormat: l.dateFormat, locale: this.locale });
		const cell = el("div", "wmtc-cell");
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
		else if (rows) message = `${rows} row${rows === 1 ? "" : "s"} skipped. Open the trip editor to see why.`;
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
		const target = e.target && e.target.closest ? e.target : null;
		if (!target) return;
		if (target.closest(".wmtc-detail")) {
			if (target.closest(".wmtc-detail-close")) this.closeDetails();
			return;
		}
		const view = this.currentView();
		const pinKey = this.pinNear(e) || (target.closest("[data-pin]") ? target.closest("[data-pin]").getAttribute("data-pin") : null);
		const countryEl = pinKey ? null : target.closest("[data-code]");
		const pin = pinKey && view ? view.pins.find((p) => p.key === pinKey) : null;
		const country = countryEl && view ? view.countries[countryEl.getAttribute("data-code")] : null;
		if (pin) {
			const visible = [...this.mapEl.querySelectorAll(".wmtc-pin")].find((c) => c.getAttribute("data-pin") === pin.key);
			this.showDetails("pin", pin.tripIds, e, visible);
		} else if (country) this.showDetails("country", country.tripIds, e, countryEl);
		else this.closeDetails();
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
	showDetails (kind, tripIds, point, selectedEl) {
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
			if (v.note) li.append(el("div", "wmtc-detail-note", v.note));
			visits.append(li);
		}
		card.append(visits);
		if (d.more) card.append(el("div", "wmtc-detail-more", `+${d.more} more`));
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
		const timeout = Number(this.config.detailsTimeout);
		this.pausedUntil = Math.max(Date.now() + Math.max(0, Number(this.config.touchPause) || 0) * 1000, timeout > 0 ? Date.now() + timeout * 1000 : Infinity);
		if (timeout > 0) this.detailTimer = setTimeout(() => this.closeDetails(), timeout * 1000);
	},

	closeDetails () {
		clearTimeout(this.detailTimer);
		this.detailTimer = null;
		if (this.detailEl) this.detailEl.remove();
		this.detailEl = null;
		if (this.selectedEl) this.selectedEl.classList.remove("wmtc-selected");
		this.selectedEl = null;
		// A card that stayed open (detailsTimeout: 0) paused rotation indefinitely: count down from now instead.
		if (this.pausedUntil === Infinity) this.pause();
	},

	renderMap () {
		if (!this.mapEl) return;
		this.closeDetails();
		const old = this.mapEl.querySelector("svg");
		if (old) old.remove();

		const message = this.error || (!this.features ? "Loading map…" : !this.model ? "Loading trips…" : "");
		this.messageEl.textContent = message;
		if (!this.features) return;

		let box = this.mapEl.getBoundingClientRect();
		if (box.width < 10) return;
		const scale = WMTCLayout.scaleFor(box.width, box.height);
		const pad = scale.pinRadius * 2;
		const natural = this.naturalMapHeight(box.width, pad);
		if (Math.abs((parseFloat(this.mapEl.style.height) || 0) - natural) > 1) {
			this.mapEl.style.height = `${natural}px`;
			box = this.mapEl.getBoundingClientRect();
		}
		if (box.height < 10) return;
		const view = this.currentView();
		const analog = this.theme === "analog";

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
		if (analog) {
			svg.appendChild(watercolorFilter(filterId));
			const grid = path(d3.geoGraticule10());
			if (grid) svg.appendChild(svgEl("path", { d: grid, class: "wmtc-graticule" }));
		}

		const countryLayer = svgEl("g", { class: "wmtc-countries" });
		const states = view ? view.countries : {};
		const showPlanned = this.config.showPlanned;
		const fade = { enabled: Boolean(this.config.fadeByAge), strength: this.config.fadeStrength, unit: this.config.fadeUnit, amount: this.config.fadeAmount };
		const month = this.model && (this.model.today || this.model.currentMonth);
		const fadeStyle = (last) => {
			const f = WMTCLayout.fadeFactor(last, month, fade);
			return f < 1 ? `;--wmtc-fade:${f}` : "";
		};
		for (const f of this.features) {
			const d = path(f);
			if (!d) continue;
			const state = states[f.properties.iso2];
			const attrs = { d, class: "wmtc-country" };
			if (state && (state.state === "visited" || showPlanned)) {
				attrs.class += ` wmtc-${state.state}`;
				attrs["data-code"] = f.properties.iso2;
				attrs.style = `--wmtc-color:${WMTCLayout.colorFor(state.group, this.colors)}${state.state === "visited" ? fadeStyle(state.last) : ""}`;
				if (analog && state.state === "visited") attrs.filter = `url(#${filterId})`;
			}
			const p = svgEl("path", attrs);
			p.appendChild(svgEl("title", {}, f.properties.name));
			countryLayer.appendChild(p);
		}
		svg.appendChild(countryLayer);

		const pinLayer = svgEl("g", { class: "wmtc-pins" });
		const haloLayer = svgEl("g", { class: "wmtc-halos" });
		// Where each pin is drawn, so a tap can pick the nearest one (pins are small and often close together).
		this.pinPoints = [];
		for (const pin of view ? view.pins : []) {
			if (pin.planned && !showPlanned) continue;
			const xy = projection([pin.lon, pin.lat]);
			if (!xy || !Number.isFinite(xy[0])) continue;
			const r = WMTCLayout.pinRadius(scale.pinRadius, pin.visits);
			const color = WMTCLayout.colorFor(pin.group, this.colors);
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
		svg.append(haloLayer, pinLayer);
		this.mapEl.appendChild(svg);

		if (this.model && view && !view.tripIds.length && !this.error) {
			this.messageEl.textContent = Object.keys(this.model.trips).length ? "No trips in this view yet" : "No trips yet. Add some to data/trips.json";
		}
	}
});

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
