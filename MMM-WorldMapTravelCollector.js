/* global Module, Log, d3, topojson, WMTCLayout */

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

		// Look
		layout: "fullscreen", // "fullscreen" | "centered"
		maxWidth: "90%",
		maxHeight: "80%",
		theme: "digital", // "digital" | "analog" (analog arrives in milestone 3)
		projection: "equalEarth", // "equalEarth" | "naturalEarth" | "mercator"
		hideAntarctica: true,
		animations: true,
		highlightNewest: true,
		showPlanned: true,
		showLegend: true,
		showProblems: true,

		// Views
		filters: ["all", "together", "solo"],
		defaultFilter: "all",
		labels: {},

		// Stats
		worldCountryCount: 195,
		distanceUnits: "km"
	},

	getScripts () {
		return [
			this.file("node_modules/d3-array/dist/d3-array.min.js"),
			this.file("node_modules/d3-geo/dist/d3-geo.min.js"),
			this.file("node_modules/topojson-client/dist/topojson-client.min.js"),
			this.file("lib/layout.js")
		];
	},

	getStyles () {
		return [this.file("css/wmtc.css")];
	},

	start () {
		this.model = null;
		this.features = null;
		this.viewIndex = 0;
		this.error = null;
		this.wrapper = null;
		this.colors = WMTCLayout.palette(this.config.travelers, this.config.togetherColor);
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
		} else if (notification === "WMTC_ERROR") {
			this.error = payload.message;
			this.render();
		}
	},

	currentView () {
		return this.model && this.model.views[this.viewIndex] ? this.model.views[this.viewIndex] : null;
	},

	/** Switch to a view by id ("together", "solo:Sam") or index. */
	setView (idOrIndex) {
		if (!this.model) return false;
		const index = typeof idOrIndex === "number" ? idOrIndex : this.model.views.findIndex((v) => v.id === idOrIndex);
		if (index < 0 || index >= this.model.views.length) return false;
		this.viewIndex = index;
		this.render();
		return true;
	},

	getDom () {
		if (!this.wrapper) this.buildSkeleton();
		return this.wrapper;
	},

	buildSkeleton () {
		const c = this.config;
		const w = document.createElement("div");
		w.className = `wmtc wmtc-theme-${c.theme === "analog" ? "analog" : "digital"} wmtc-layout-${c.layout === "centered" ? "centered" : "fullscreen"}`;
		if (!c.animations) w.classList.add("wmtc-no-motion");
		if (c.layout === "centered") {
			w.style.width = WMTCLayout.cssSize(c.maxWidth, "width", "90vw");
			w.style.height = WMTCLayout.cssSize(c.maxHeight, "height", "80vh");
		}

		this.headerEl = el("div", "wmtc-header");
		this.titleEl = el("div", "wmtc-title");
		this.legendEl = el("div", "wmtc-legend");
		this.headerEl.append(this.titleEl, this.legendEl);

		this.mapEl = el("div", "wmtc-map");
		this.messageEl = el("div", "wmtc-message");
		this.footerEl = el("div", "wmtc-footer");
		w.append(this.headerEl, this.mapEl, this.footerEl);
		this.mapEl.append(this.messageEl);

		if (typeof ResizeObserver !== "undefined") {
			let pending = false;
			this.resizeObserver = new ResizeObserver(() => {
				if (pending) return;
				pending = true;
				requestAnimationFrame(() => {
					pending = false;
					this.renderMap();
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
		const scale = WMTCLayout.scaleFor(rect.width, rect.height);
		this.wrapper.style.setProperty("--wmtc-font", `${scale.fontSize}px`);

		this.titleEl.textContent = view && this.model.views.length > 1 ? view.label : "";
		this.renderLegend(view);
		this.renderFooter();
		this.renderMap();
	},

	renderLegend (view) {
		const legend = this.legendEl;
		legend.textContent = "";
		if (!this.config.showLegend || !this.model) return;
		const names = this.model.travelers;
		const groups = new Set();
		if (view) {
			Object.values(view.countries).forEach((c) => groups.add(c.group));
			view.pins.forEach((p) => groups.add(p.group));
		}
		const items = [];
		names.forEach((n) => {
			if (groups.has(n)) items.push([n, WMTCLayout.colorFor(n, this.colors), false]);
		});
		if (["together", "mixed", "group"].some((g) => groups.has(g))) {
			items.push([names.length > 2 ? "Shared" : "Together", this.colors.together, false]);
		}
		const hasPlanned = view && this.config.showPlanned && (view.pins.some((p) => p.planned) || Object.values(view.countries).some((c) => c.state === "planned"));
		if (hasPlanned) items.push(["Planned", "currentColor", true]);
		for (const [label, color, planned] of items) {
			const item = el("span", "wmtc-legend-item");
			const dot = el("span", planned ? "wmtc-dot wmtc-dot-planned" : "wmtc-dot");
			dot.style.setProperty("--wmtc-color", color);
			item.append(dot, document.createTextNode(label));
			legend.append(item);
		}
	},

	renderFooter () {
		const problems = this.model && this.model.problems ? this.model.problems.length : 0;
		this.footerEl.textContent = this.config.showProblems && problems ? `${problems} row${problems === 1 ? "" : "s"} skipped. Check your trips file.` : "";
	},

	renderMap () {
		if (!this.mapEl) return;
		const old = this.mapEl.querySelector("svg");
		if (old) old.remove();

		const message = this.error || (!this.features ? "Loading map…" : !this.model ? "Loading trips…" : "");
		this.messageEl.textContent = message;
		if (!this.features) return;

		const box = this.mapEl.getBoundingClientRect();
		if (box.width < 10 || box.height < 10) return;
		const scale = WMTCLayout.scaleFor(box.width, box.height);
		const view = this.currentView();

		const collection = { type: "FeatureCollection", features: this.features };
		const projection = makeProjection(this.config.projection);
		const pad = scale.pinRadius * 2;
		projection.fitExtent([[pad, pad], [box.width - pad, box.height - pad]], collection);
		const path = d3.geoPath(projection);
		// On tall screens, sit the map at the top so the space below is free for the ledger.
		const top = path.bounds(collection)[0][1];
		if (top > pad + 1) {
			const [tx, ty] = projection.translate();
			projection.translate([tx, ty - (top - pad)]);
		}

		const svg = svgEl("svg", { class: "wmtc-svg", width: box.width, height: box.height, viewBox: `0 0 ${box.width} ${box.height}` });
		svg.style.setProperty("--wmtc-line", `${scale.lineWidth}px`);

		const countryLayer = svgEl("g", { class: "wmtc-countries" });
		const states = view ? view.countries : {};
		const showPlanned = this.config.showPlanned;
		for (const f of this.features) {
			const d = path(f);
			if (!d) continue;
			const state = states[f.properties.iso2];
			const attrs = { d, class: "wmtc-country" };
			if (state && (state.state === "visited" || showPlanned)) {
				attrs.class += ` wmtc-${state.state}`;
				attrs.style = `--wmtc-color:${WMTCLayout.colorFor(state.group, this.colors)}`;
			}
			const p = svgEl("path", attrs);
			p.appendChild(svgEl("title", {}, f.properties.name));
			countryLayer.appendChild(p);
		}
		svg.appendChild(countryLayer);

		const pinLayer = svgEl("g", { class: "wmtc-pins" });
		const haloLayer = svgEl("g", { class: "wmtc-halos" });
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
				style: `--wmtc-color:${color}`
			});
			circle.appendChild(svgEl("title", {}, `${pin.city}${pin.visits > 1 ? ` (${pin.visits} visits)` : ""}`));
			pinLayer.appendChild(circle);
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
	return d3.geoEqualEarth();
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
