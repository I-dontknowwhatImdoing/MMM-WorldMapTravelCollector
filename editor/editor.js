/* MMM-WorldMapTravelCollector trip editor. Plain browser JavaScript, no build step. */
"use strict";

(function () {
	const S = {
		data: null, // /api/state
		tab: "trips",
		search: "",
		editing: null, // trip being edited (null = new)
		formDraft: null, // unsaved form values while switching tabs
		imp: null // import in progress
	};
	const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(undefined, { month: "short" }).format(new Date(2000, i, 15)));
	const longMonths = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(undefined, { month: "long" }).format(new Date(2000, i, 15)));
	const main = document.getElementById("main");

	/* ---------- small helpers ---------- */

	/** Build an element. Text always goes in as text, never as HTML. */
	function h (tag, attrs, ...children) {
		const el = document.createElement(tag);
		for (const [k, v] of Object.entries(attrs || {})) {
			if (v === undefined || v === null || v === false) continue;
			if (k === "class") el.className = v;
			else if (k === "text") el.textContent = v;
			else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
			else if (k === "style") for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
			else if (k in el && typeof v !== "string") el[k] = v;
			else el.setAttribute(k, v === true ? "" : v);
		}
		for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
		return el;
	}

	function storage (key, value) {
		try {
			if (value === undefined) return localStorage.getItem(key);
			if (value === null) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
		} catch {
			return null;
		}
		return null;
	}

	let toastTimer;
	function toast (message, bad) {
		const t = document.getElementById("toast");
		t.textContent = message;
		t.className = bad ? "toast bad" : "toast";
		t.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (t.hidden = true), bad ? 6000 : 3500);
	}

	function countryName (code) {
		const hit = S.data && S.data.countries.find((c) => c[0] === code);
		return hit ? hit[1] : code;
	}

	function countryCode (text) {
		const t = String(text || "").trim().toLowerCase();
		if (!t) return "";
		const hit = S.data.countries.find((c) => c[1].toLowerCase() === t || c[0].toLowerCase() === t);
		return hit ? hit[0] : String(text).trim();
	}

	function formatMonth (ym) {
		const m = /^(\d{4})-(\d{2})$/.exec(ym || "");
		return m ? `${months[Number(m[2]) - 1]} ${m[1]}` : ym || "No date";
	}

	/** The last day of a trip with a start day: start + days, counting the start as day one. */
	function endOf (start, days) {
		const d = new Date(`${start}T12:00:00Z`);
		d.setUTCDate(d.getUTCDate() + Math.max(1, Number(days) || 1) - 1);
		return d.toISOString().slice(0, 10);
	}

	/** "Mar 2025", or with a start day "14–18 Mar 2025" / "28 Mar – 1 Apr 2025". */
	function whenText (t) {
		if (!t.start || !/^\d{4}-\d{2}-\d{2}$/.test(t.start)) return formatMonth(t.date);
		const end = endOf(t.start, t.days);
		const [y1, m1, d1] = t.start.split("-").map(Number);
		const [y2, m2, d2] = end.split("-").map(Number);
		if (y1 === y2 && m1 === m2) return `${d1 === d2 ? d1 : `${d1}–${d2}`} ${months[m1 - 1]} ${y1}`;
		if (y1 === y2) return `${d1} ${months[m1 - 1]} – ${d2} ${months[m2 - 1]} ${y1}`;
		return `${d1} ${months[m1 - 1]} ${y1} – ${d2} ${months[m2 - 1]} ${y2}`;
	}

	/** An optional day (1–31) to go with a month picker. */
	function dayPicker (start, label) {
		const day = /^\d{4}-\d{2}-(\d{2})$/.exec(start || "");
		return h("select", { "aria-label": `${label}: day (optional)` },
			h("option", { value: "", text: "Day" }),
			Array.from({ length: 31 }, (_, i) => {
				const v = String(i + 1).padStart(2, "0");
				return h("option", { value: v, text: String(i + 1), selected: Boolean(day && day[1] === v) });
			}));
	}

	function startFrom (date, day) {
		return day && /^\d{4}-\d{2}$/.test(date || "") ? `${date}-${day}` : "";
	}

	function colorOf (name) {
		const t = S.data.travelers.find((x) => x.name === name);
		return (t && t.color) || "#8aa0b0";
	}

	function dots (travelers) {
		return h("span", { class: "dots", "aria-hidden": "true" }, travelers.map((n) => h("span", { class: "dot", style: { background: colorOf(n) } })));
	}

	function place (t) {
		const country = countryName(t.country);
		return t.city ? `${t.city}, ${country}` : country;
	}

	/* ---------- talking to the mirror ---------- */

	async function api (method, path, body, opts = {}) {
		const headers = { "X-WMTC": "1" };
		const pin = storage("wmtc-pin");
		if (pin) headers["X-WMTC-Pin"] = pin;
		let payload;
		if (body !== undefined) {
			headers["Content-Type"] = "application/json";
			payload = JSON.stringify(body);
		}
		let res;
		try {
			res = await fetch(`api${path}`, { method, headers, body: payload });
		} catch {
			throw new Error("Can't reach the mirror. Is it on, and is this phone on the same Wi-Fi?");
		}
		if (opts.raw && res.ok) return res;
		const data = await res.json().catch(() => ({}));
		if (res.status === 401 && data.pinRequired) {
			showPin(data.error);
			throw Object.assign(new Error(data.error), { quiet: true });
		}
		if (!res.ok) throw Object.assign(new Error(data.error || (data.errors || []).join(". ") || `Error ${res.status}`), { status: res.status, errors: data.errors });
		return data;
	}

	async function reload () {
		S.data = await api("GET", "/state");
		document.getElementById("tabs").hidden = false;
		const n = S.data.trips.length + S.data.readOnly.reduce((a, s) => a + s.trips.length, 0);
		const countries = new Set([...S.data.trips, ...S.data.readOnly.flatMap((s) => s.trips)].map((t) => t.country)).size;
		document.getElementById("summary").textContent = `${n} trip${n === 1 ? "" : "s"} · ${countries} countr${countries === 1 ? "y" : "ies"}`;
	}

	function showPin (message) {
		document.getElementById("tabs").hidden = true;
		const input = h("input", { type: "password", inputmode: "numeric", autocomplete: "current-password", "aria-label": "PIN" });
		const form = h("form", { class: "card", onsubmit: async (e) => {
			e.preventDefault();
			storage("wmtc-pin", input.value);
			try {
				await reload();
				render();
			} catch (err) {
				if (!err.quiet) failed(err);
			}
		} },
		h("h2", { text: "Enter the editor PIN" }),
		h("p", { class: "muted", text: "It's the editorPin from the mirror's config. This phone will remember it." }),
		message && message !== "Enter the editor PIN" ? h("p", { class: "status bad", text: message }) : null,
		h("label", { class: "field" }, input),
		h("button", { class: "btn primary", type: "submit", text: "Open editor" }));
		main.replaceChildren(form);
		input.focus();
	}

	function failed (err) {
		main.replaceChildren(h("div", { class: "notice bad" }, h("strong", { text: "Something went wrong. " }), err.message),
			h("button", { class: "btn", text: "Try again", onclick: start }));
	}

	/* ---------- tabs ---------- */

	function setTab (tab) {
		S.tab = tab;
		for (const b of document.querySelectorAll(".tabs button")) b.classList.toggle("active", b.dataset.tab === tab);
		document.getElementById("title").textContent = { trips: "Trips", add: S.editing ? "Edit trip" : "Add a trip", import: "Import", more: "More" }[tab];
		render();
		window.scrollTo(0, 0);
	}

	function render () {
		if (!S.data) return;
		if (S.tab === "trips") return renderTrips();
		if (S.tab === "add") return renderForm();
		if (S.tab === "import") return renderImport();
		return renderMore();
	}

	/* ---------- trips list ---------- */

	function renderTrips () {
		const out = [];
		const d = S.data;
		const q = S.search.trim().toLowerCase();
		const matches = (t) => !q || [t.city, countryName(t.country), t.country, t.note, t.date, formatMonth(t.date), ...t.travelers].join(" ").toLowerCase().includes(q);

		if (d.broken.length) {
			out.push(h("div", { class: "notice" },
				h("strong", { text: `${d.broken.length} row${d.broken.length === 1 ? "" : "s"} in trips.json can't be shown on the mirror.` }),
				" Tap one to fix it."));
			out.push(h("div", { class: "list" }, d.broken.map((b) => h("button", { class: "row", type: "button", onclick: () => editTrip(null, b) },
				h("span", { class: "dots" }, h("span", { class: "badge warn", text: "!" })),
				h("span", { class: "row-main" },
					h("div", { class: "row-title", text: [b.raw.city, b.raw.country, b.raw.date].filter(Boolean).join(", ") || `Row ${b.id.slice(4)}` }),
					h("div", { class: "row-sub", text: b.errors.join(". ") })),
				h("span", { class: "chev", text: "›" })))));
		}

		const search = h("input", { type: "search", placeholder: "Search places, years, people", value: S.search, "aria-label": "Search trips" });
		search.addEventListener("input", () => {
			S.search = search.value;
			const list = main.querySelector(".trip-groups");
			if (list) list.replaceChildren(...tripGroups(d.trips.filter(matches), false));
		});
		out.push(h("div", { class: "field" }, search));

		const groups = h("div", { class: "trip-groups" }, tripGroups(d.trips.filter(matches), false));
		out.push(groups);
		if (!d.trips.length) {
			out.push(h("div", { class: "empty" },
				h("p", { text: "No trips yet." }),
				h("div", { class: "actions" },
					h("button", { class: "btn primary grow", text: "Add a trip", onclick: () => newTrip() }),
					h("button", { class: "btn grow", text: "Import from a file", onclick: () => setTab("import") }))));
		}

		for (const src of d.readOnly) {
			if (!src.trips.length) continue;
			out.push(h("h3", { text: `From ${src.source}` }));
			out.push(h("p", { class: "muted small", text: src.source === "Google Sheet" ? "These come from your Google Sheet. Change them there; the mirror picks it up on its next check." : `These come from ${src.source}. Change them in that file.` }));
			out.push(h("div", {}, tripGroups(src.trips.filter(matches), true)));
		}
		main.replaceChildren(...out);
	}

	function tripGroups (trips, locked) {
		const byYear = new Map();
		for (const t of [...trips].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.city || "").localeCompare(b.city || "")))) {
			const y = t.date.slice(0, 4);
			if (!byYear.has(y)) byYear.set(y, []);
			byYear.get(y).push(t);
		}
		if (!byYear.size && S.search) return [h("p", { class: "empty", text: "No trips match." })];
		const out = [];
		for (const [year, list] of byYear) {
			out.push(h("h3", { text: year }));
			out.push(h("div", { class: "list" }, list.map((t) => {
				const planned = t.date > S.data.currentMonth;
				const sub = [whenText(t), t.days ? `${t.days} day${t.days === 1 ? "" : "s"}` : "", t.travelers.join(" & ")].filter(Boolean).join(" · ");
				return h(locked ? "div" : "button", { class: locked ? "row locked" : "row", type: locked ? null : "button", onclick: locked ? null : () => editTrip(t) },
					dots(t.travelers),
					h("span", { class: "row-main" },
						h("div", { class: "row-title" }, place(t), planned ? h("span", { class: "badge", text: "planned" }) : null),
						h("div", { class: "row-sub", text: sub })),
					h("span", { class: "chev", text: locked ? "🔒" : "›" }));
			})));
		}
		return out;
	}

	/* ---------- add / edit form ---------- */

	function newTrip () {
		S.editing = null;
		S.formDraft = null;
		setTab("add");
	}

	function editTrip (trip, broken) {
		S.editing = broken ? { id: broken.id, broken: true, errors: broken.errors, ...broken.raw } : trip;
		S.formDraft = null;
		setTab("add");
	}

	function yearOptions (selected) {
		const now = new Date().getFullYear();
		const years = [];
		for (let y = now + 5; y >= 1950; y--) years.push(y);
		if (selected && !years.includes(Number(selected))) years.push(Number(selected));
		return years.map((y) => h("option", { value: String(y), text: String(y), selected: String(y) === String(selected) }));
	}

	function monthPicker (value, onChange, label) {
		const m = /^(\d{4})-(\d{2})$/.exec(value || "");
		const month = h("select", { "aria-label": `${label || "Date"}: month` },
			h("option", { value: "", text: "Month" }),
			longMonths.map((name, i) => h("option", { value: String(i + 1).padStart(2, "0"), text: name, selected: m && Number(m[2]) === i + 1 })));
		const year = h("select", { "aria-label": `${label || "Date"}: year` }, h("option", { value: "", text: "Year" }), yearOptions(m ? m[1] : ""));
		const fire = () => onChange(month.value && year.value ? `${year.value}-${month.value}` : "");
		month.addEventListener("change", fire);
		year.addEventListener("change", fire);
		return { month, year, el: h("div", { class: "pair" }, month, year) };
	}

	function travelerPills (selected, onChange, small) {
		const set = new Set(selected);
		const wrap = h("div", { class: "pills", role: "group", "aria-label": "Who went" });
		const paint = () => {
			for (const label of wrap.querySelectorAll(".pill")) {
				const on = set.has(label.dataset.name);
				label.classList.toggle("on", on);
				label.querySelector("input").checked = on;
			}
		};
		for (const t of S.data.travelers) {
			const box = h("input", { type: "checkbox", checked: set.has(t.name) });
			box.addEventListener("change", () => {
				if (box.checked) set.add(t.name);
				else set.delete(t.name);
				paint();
				onChange(S.data.travelers.map((x) => x.name).filter((n) => set.has(n)));
			});
			wrap.append(h("label", { class: small ? "pill small" : "pill", "data-name": t.name, style: { "--pill": t.color || "#8aa0b0" } },
				box, h("span", { class: "dot", style: { background: t.color || "#8aa0b0" } }), t.name));
		}
		paint();
		return wrap;
	}

	function cityField (input, getCountry, onPick) {
		const list = h("ul", { class: "suggest", hidden: true, role: "listbox" });
		let timer;
		let seq = 0;
		const close = () => (list.hidden = true);
		input.setAttribute("autocomplete", "off");
		input.addEventListener("input", () => {
			clearTimeout(timer);
			const q = input.value.trim();
			if (q.length < 2) return close();
			timer = setTimeout(async () => {
				const mine = ++seq;
				let hits;
				try {
					const cc = countryCode(getCountry());
					hits = await api("GET", `/cities?q=${encodeURIComponent(q)}${/^[A-Z]{2}$/.test(cc) ? `&country=${cc}` : ""}`);
				} catch {
					hits = [];
				}
				if (mine !== seq) return;
				list.replaceChildren(...hits.map((c) => h("li", {}, h("button", { type: "button", onclick: () => {
					onPick(c);
					close();
				} }, h("strong", { text: c.name }), `, ${c.countryName}`))));
				list.hidden = !hits.length;
			}, 180);
		});
		input.addEventListener("blur", () => setTimeout(close, 200));
		input.addEventListener("keydown", (e) => {
			if (e.key === "Escape") close();
		});
		return list;
	}

	function renderForm () {
		const t = S.formDraft || S.editing || { city: "", country: "", date: "", days: "", travelers: S.data.travelers.length === 1 ? [S.data.travelers[0].name] : [], note: "", lat: "", lon: "" };
		const v = {
			city: t.city || "",
			country: t.country ? countryName(countryCode(t.country)) : "",
			date: t.date || "",
			start: t.start || "",
			days: t.days ? String(t.days) : "",
			travelers: Array.isArray(t.travelers) ? [...t.travelers] : String(t.travelers || "").split(/[;,&]/).map((s) => s.trim()).filter(Boolean),
			note: t.note || "",
			lat: t.lat === null || t.lat === undefined ? "" : String(t.lat),
			lon: t.lon === null || t.lon === undefined ? "" : String(t.lon)
		};
		const keep = () => (S.formDraft = { ...v, id: S.editing && S.editing.id });
		const errorsBox = h("ul", { class: "errors", hidden: true });
		const showErrors = (list) => {
			errorsBox.replaceChildren(...list.map((e) => h("li", { text: e })));
			errorsBox.hidden = !list.length;
		};

		const countries = h("datalist", { id: "country-list" }, S.data.countries.map((c) => h("option", { value: c[1] })));
		const country = h("input", { type: "text", value: v.country, list: "country-list", placeholder: "e.g. Portugal", autocapitalize: "words" });
		country.addEventListener("input", () => {
			v.country = country.value;
			keep();
		});
		const city = h("input", { type: "text", value: v.city, placeholder: "e.g. Lisbon", autocapitalize: "words" });
		city.addEventListener("input", () => {
			v.city = city.value;
			keep();
		});
		const suggest = cityField(city, () => country.value, (c) => {
			city.value = v.city = c.name;
			country.value = v.country = c.countryName;
			keep();
		});
		const day = dayPicker(v.start, "When");
		const when = monthPicker(v.date, (val) => {
			v.date = val;
			v.start = startFrom(v.date, day.value);
			keep();
		}, "When");
		day.addEventListener("change", () => {
			v.start = startFrom(v.date, day.value);
			keep();
		});
		const days = h("input", { type: "number", inputmode: "numeric", min: "1", max: "3650", value: v.days, placeholder: "Optional" });
		days.addEventListener("input", () => {
			v.days = days.value;
			keep();
		});
		const note = h("textarea", { placeholder: "Optional, e.g. Anniversary" }, v.note);
		note.addEventListener("input", () => {
			v.note = note.value;
			keep();
		});
		const lat = h("input", { type: "text", inputmode: "decimal", value: v.lat, placeholder: "e.g. 33.66" });
		const lon = h("input", { type: "text", inputmode: "decimal", value: v.lon, placeholder: "e.g. -95.55" });
		lat.addEventListener("input", () => {
			v.lat = lat.value;
			keep();
		});
		lon.addEventListener("input", () => {
			v.lon = lon.value;
			keep();
		});

		const editing = S.editing;
		const save = h("button", { class: "btn primary grow", type: "submit", text: editing ? "Save changes" : "Add trip" });
		const form = h("form", { class: "card", novalidate: true, onsubmit: async (e) => {
			e.preventDefault();
			showErrors([]);
			const body = { city: v.city, country: countryCode(v.country), date: v.date, start: v.start, days: v.days, travelers: v.travelers, note: v.note, lat: v.lat, lon: v.lon };
			save.disabled = true;
			try {
				const r = editing ? await api("PUT", `/trips/${encodeURIComponent(editing.id)}`, body) : await api("POST", "/trips", body);
				toast(r.combined ? `Combined with the ${place(r.trip)}, ${formatMonth(r.trip.date)} trip that was already there.` : editing ? "Saved. The mirror updates in a moment." : `Added ${place(r.trip)}. The mirror updates in a moment.`);
				S.formDraft = null;
				await reload();
				if (editing) {
					S.editing = null;
					setTab("trips");
				} else render();
			} catch (err) {
				if (!err.quiet) showErrors(err.errors || [err.message]);
			} finally {
				save.disabled = false;
			}
		} },
		editing && editing.broken ? h("div", { class: "notice" }, h("strong", { text: "This row can't be read: " }), editing.errors.join(". ")) : null,
		errorsBox,
		countries,
		h("label", { class: "field" }, h("span", { text: "Country" }), country),
		h("label", { class: "field" }, h("span", { text: "City" }), city, suggest, h("small", { class: "hint", text: "Leave empty for a trip around the whole country, like a road trip." })),
		h("div", { class: "field" }, h("span", { class: "label", text: "When" }), h("div", { class: "when" }, day, when.month, when.year),
			h("small", { class: "hint", text: "The day is optional. With it and the days there, the map knows exactly when the trip ended. A month after this one shows as a planned trip." })),
		h("div", { class: "field" }, h("span", { class: "label", text: "Who went" }), travelerPills(v.travelers, (list) => {
			v.travelers = list;
			keep();
		})),
		h("label", { class: "field" }, h("span", { text: "Days there" }), days),
		h("label", { class: "field" }, h("span", { text: "Note" }), note),
		h("details", { open: Boolean(v.lat || v.lon) },
			h("summary", { text: "Exact location (optional)" }),
			h("p", { class: "muted small", text: "Only needed for small places the lookup can't find, or to pick a different town with the same name (Paris, Texas)." }),
			h("div", { class: "pair" },
				h("label", { class: "field" }, h("span", { text: "Latitude" }), lat),
				h("label", { class: "field" }, h("span", { text: "Longitude" }), lon))),
		h("div", { class: "actions" },
			save,
			editing ? h("button", { class: "btn", type: "button", text: "Cancel", onclick: () => {
				S.editing = null;
				S.formDraft = null;
				setTab("trips");
			} }) : null),
		editing ? h("div", { class: "actions" }, h("button", { class: "btn danger", type: "button", text: "Delete this trip", onclick: async () => {
			if (!confirm(`Delete ${v.city || v.country || "this trip"}${v.date ? `, ${formatMonth(v.date)}` : ""}? A backup is kept.`)) return;
			try {
				await api("DELETE", `/trips/${encodeURIComponent(editing.id)}`);
				toast("Deleted.");
				S.editing = null;
				S.formDraft = null;
				await reload();
				setTab("trips");
			} catch (err) {
				if (!err.quiet) showErrors([err.message]);
			}
		} })) : null);
		main.replaceChildren(form);
	}

	/* ---------- import ---------- */

	function packFiles (files) {
		return Promise.all(files.map((f) => f.arrayBuffer())).then((buffers) => {
			const parts = [];
			const enc = new TextEncoder();
			files.forEach((f, i) => {
				const name = enc.encode(f.name);
				const head = new DataView(new ArrayBuffer(4));
				head.setUint32(0, name.length, true);
				const size = new DataView(new ArrayBuffer(4));
				size.setUint32(0, buffers[i].byteLength, true);
				parts.push(head.buffer, name, size.buffer, buffers[i]);
			});
			return new Blob(parts);
		});
	}

	/** Upload with progress (fetch can't report upload progress). */
	function upload (blob, query, onProgress) {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open("POST", `api/import/parse?${query}`);
			xhr.setRequestHeader("X-WMTC", "1");
			xhr.setRequestHeader("Content-Type", "application/octet-stream");
			const pin = storage("wmtc-pin");
			if (pin) xhr.setRequestHeader("X-WMTC-Pin", pin);
			xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
			xhr.onload = () => {
				let data;
				try {
					data = JSON.parse(xhr.responseText);
				} catch {
					data = {};
				}
				if (xhr.status === 401 && data.pinRequired) {
					showPin(data.error);
					return reject(Object.assign(new Error(data.error), { quiet: true }));
				}
				if (xhr.status >= 200 && xhr.status < 300) resolve(data);
				else reject(new Error(data.error || `Error ${xhr.status}`));
			};
			xhr.onerror = () => reject(new Error("The upload didn't reach the mirror. Check the Wi-Fi and try again"));
			xhr.send(blob);
		});
	}

	async function parseFiles (files, extra = {}) {
		const imp = S.imp || {};
		S.imp = { ...imp, files, busy: true, progress: 0, error: null, ...extra };
		renderImport();
		try {
			const blob = await packFiles(files);
			const params = new URLSearchParams();
			if (S.imp.want) params.set("want", S.imp.want);
			if (S.imp.mapping) params.set("mapping", JSON.stringify(S.imp.mapping));
			if (S.imp.homeRadiusKm !== undefined) params.set("homeRadiusKm", String(S.imp.homeRadiusKm));
			const result = await upload(blob, params.toString(), (p) => {
				S.imp.progress = p;
				const bar = main.querySelector(".progress > div");
				if (bar) bar.style.setProperty("width", `${Math.round(p * 100)}%`);
				const label = main.querySelector(".progress-label");
				if (label) label.textContent = p < 1 ? `Uploading… ${Math.round(p * 100)}%` : "Reading the file…";
			});
			const who = S.imp.who || [];
			for (const d of result.drafts) if (!d.travelers.length && who.length) d.travelers = [...who];
			S.imp = { ...S.imp, busy: false, result, checks: [], saved: null };
			renderImport();
			check();
		} catch (err) {
			if (err.quiet) return;
			S.imp = { ...S.imp, busy: false, error: err.message };
			renderImport();
		}
	}

	function draftBody (d) {
		return { city: d.city, country: countryCode(d.country), date: d.date, start: d.start || "", days: d.days, travelers: d.travelers, lat: d.lat, lon: d.lon, note: d.note };
	}

	let checkTimer;
	function check () {
		clearTimeout(checkTimer);
		checkTimer = setTimeout(async () => {
			const imp = S.imp;
			if (!imp || !imp.result) return;
			const ticked = imp.result.drafts.map((d, i) => [d, i]).filter(([d]) => d.include);
			try {
				const r = await api("POST", "/import/check", { rows: ticked.map(([d]) => draftBody(d)) });
				if (S.imp !== imp) return;
				imp.checks = [];
				ticked.forEach(([, i], n) => (imp.checks[i] = r.results[n]));
				paintChecks();
			} catch (err) {
				if (!err.quiet) toast(err.message, true);
			}
		}, 350);
	}

	function paintChecks () {
		const imp = S.imp;
		let good = 0;
		let bad = 0;
		imp.result.drafts.forEach((d, i) => {
			const el = main.querySelector(`[data-draft="${i}"] .status`);
			const c = imp.checks[i];
			if (!d.include) {
				if (el) {
					el.className = "status info";
					el.textContent = d.hint || "Won't be imported";
				}
				return;
			}
			if (!c) return;
			if (c.ok) good++;
			else bad++;
			if (!el) return;
			if (c.ok) {
				el.className = "status ok";
				el.textContent = c.combinesWith ? `✓ Joins the trip already there (${c.combinesWith.travelers.join(" & ")})` : "✓ Ready";
				if (d.hint) el.textContent += ` · ${d.hint}`;
			} else {
				el.className = "status bad";
				el.textContent = c.errors.join(". ");
			}
		});
		const btn = main.querySelector(".save-import");
		if (btn) {
			btn.disabled = !good;
			btn.textContent = good ? `Save ${good} trip${good === 1 ? "" : "s"}` : "Nothing to save yet";
		}
		const note = main.querySelector(".save-note");
		if (note) note.textContent = bad ? `${bad} need${bad === 1 ? "s" : ""} fixing or unticking` : "";
	}

	function renderImport () {
		const imp = S.imp;
		if (imp && imp.saved) return renderImportDone();
		if (imp && (imp.busy || imp.result)) return imp.busy ? renderImportBusy() : renderReview();
		const input = h("input", { type: "file", multiple: true, accept: ".csv,.tsv,.txt,.json,.geojson,.kml,.kmz,.zip" });
		input.addEventListener("change", () => input.files.length && parseFiles([...input.files], { want: undefined, mapping: undefined }));
		const who = imp && imp.who ? imp.who : [];
		main.replaceChildren(
			imp && imp.error ? h("div", { class: "notice bad", text: imp.error }) : null,
			h("div", { class: "card" },
				h("h2", { text: "Whose trips are these?" }),
				h("p", { class: "muted small", text: "Used for rows that don't say who went. You can change any row before saving." }),
				travelerPills(who, (list) => (S.imp = { ...(S.imp || {}), who: list }))),
			h("label", { class: "drop" },
				h("strong", { text: "Choose a file to import" }),
				h("div", { class: "muted small", text: "Spreadsheet (CSV), Google Maps Timeline, saved places, My Maps (KML/KMZ) or a whole Google Takeout zip. Nothing is saved until you review it." }),
				input),
			h("h3", { text: "Where do I get these files?" }),
			help("Google Maps Timeline (Android)", [
				"Phone Settings → Location → Location services → Timeline → Export Timeline data.",
				"Save Timeline.json, then choose it here. Visits near home are left out, and each city and month becomes one trip."
			]),
			help("Google Maps Timeline (iPhone)", [
				"Google Maps app → your picture → Settings → Personal content → Export Timeline data.",
				"Older history from Google Takeout works too: the \"Semantic Location History\" folder, or the whole zip."
			]),
			help("Saved places and starred places", [
				"Go to takeout.google.com, choose only \"Maps (your places)\" and \"Saved\", and export.",
				"Choose the zip here. Places become one trip per city with no date yet: you fill in the month before saving.",
				"Places on a \"Want to go\" list start unticked."
			]),
			help("Google My Maps", ["Open the map → ⋮ menu → Export to KML/KMZ → choose the whole map. Then choose the file here."]),
			help("A spreadsheet", ["Save it as CSV. Columns like city, country, date, days, travelers and note are recognized, and you can match up the others after choosing the file."]));
	}

	function help (title, lines) {
		return h("details", { class: "card" }, h("summary", { text: title }), lines.map((l) => h("p", { class: "small", text: l })));
	}

	function renderImportBusy () {
		const p = S.imp.progress || 0;
		main.replaceChildren(h("div", { class: "card" },
			h("h2", { text: S.imp.files.map((f) => f.name).join(", ") }),
			h("div", { class: "progress" }, h("div", { style: { width: `${Math.round(p * 100)}%` } })),
			h("p", { class: "muted progress-label", text: p < 1 ? `Uploading… ${Math.round(p * 100)}%` : "Reading the file…" })));
	}

	function renderReview () {
		const imp = S.imp;
		const r = imp.result;
		const out = [];
		const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;
		const source = { trips: "file", timeline: "Google Maps Timeline", places: "saved places" }[r.kind] || "file";
		let about = `${plural(r.drafts.length, "trip")} found in your ${source}`;
		if (r.kind === "timeline") {
			about += ` (${plural(r.visits || 0, "visit")}; ${plural(r.ignoredAtHome || 0, "visit")} near home left out)`;
		} else if (r.kind === "places") about += ` (${plural(r.places || 0, "place")}, grouped by city)`;
		out.push(h("div", { class: "notice good" }, h("strong", { text: about }),
			r.home ? h("div", { class: "small", text: r.home.guessed ? `Home looks like ${r.home.name}, where you spent the most time. Set home in the mirror's config if that's wrong.` : `Home: ${r.home.name || "from your config"}.` }) : null,
			r.kind === "places" ? h("div", { class: "small", text: "Saved places don't have dates. Pick the month you were there on each row, or for all ticked rows at once below." }) : null,
			r.warnings.length ? h("ul", {}, r.warnings.map((w) => h("li", { class: "small", text: w }))) : null));
		if (r.alsoFound.length) {
			out.push(h("div", { class: "toolbar" }, h("span", { class: "muted small", text: "This upload also has:" }),
				r.alsoFound.map((k) => h("button", { class: "btn link", type: "button", text: { trips: "a trips file", timeline: "Timeline history", places: "saved places" }[k], onclick: () => parseFiles(imp.files, { want: k }) }))));
		}
		if (r.kind === "timeline") {
			const radius = h("input", { type: "number", min: "0", max: "500", value: String(imp.homeRadiusKm ?? S.data.homeRadiusKm) });
			out.push(h("details", { class: "card" }, h("summary", { text: "Home area" }),
				h("label", { class: "field" }, h("span", { text: "Leave out visits within this many km of home" }), radius),
				h("button", { class: "btn", type: "button", text: "Read again", onclick: () => parseFiles(imp.files, { homeRadiusKm: Number(radius.value) }) })));
		}
		if (r.csv) {
			const fields = ["", "city", "country", "date", "days", "travelers", "lat", "lon", "note"];
			const names = { "": "(ignore)", city: "City", country: "Country", date: "Date", days: "Days", travelers: "Who went", lat: "Latitude", lon: "Longitude", note: "Note" };
			const mapping = { ...r.csv.mapping };
			out.push(h("details", { class: "card", open: r.csv.missing.length > 0 }, h("summary", { text: "Columns" }),
				r.csv.missing.length ? h("p", { class: "small status bad", text: `No column found for: ${r.csv.missing.join(", ")}. Pick one below, or set them per row.` }) : null,
				h("div", { class: "mapping" }, r.csv.headers.map((col) => {
					const sel = h("select", { "aria-label": `Column ${col}` }, fields.map((f) => h("option", { value: f, text: names[f], selected: (mapping[col] || "") === f })));
					sel.addEventListener("change", () => (mapping[col] = sel.value || null));
					return [h("span", { class: "small", text: col || "(no name)" }), sel];
				})),
				h("div", { class: "actions" }, h("button", { class: "btn", type: "button", text: "Use these columns", onclick: () => parseFiles(imp.files, { mapping }) }))));
		}

		// Changes for all ticked rows at once.
		const bulkWho = travelerPills([], () => {}, true);
		const bulkDate = monthPicker("", () => {}, "Date for ticked rows");
		out.push(h("details", { class: "card", open: r.kind === "places" },
			h("summary", { text: "Change all ticked rows" }),
			h("div", { class: "field" }, h("span", { class: "label", text: "Who went" }), bulkWho),
			h("div", { class: "actions" }, h("button", { class: "btn", type: "button", text: "Set who went", onclick: () => {
				const list = [...bulkWho.querySelectorAll("input")].map((b, i) => (b.checked ? S.data.travelers[i].name : null)).filter(Boolean);
				for (const d of r.drafts) if (d.include) d.travelers = [...list];
				renderReview();
				check();
			} })),
			h("div", { class: "field" }, h("span", { class: "label", text: "Month" }), bulkDate.el),
			h("div", { class: "actions" }, h("button", { class: "btn", type: "button", text: "Set month", onclick: () => {
				if (!bulkDate.month.value || !bulkDate.year.value) return toast("Pick a month and a year first", true);
				for (const d of r.drafts) {
					if (!d.include) continue;
					d.date = `${bulkDate.year.value}-${bulkDate.month.value}`;
					d.start = ""; // the old day belonged to the old month
				}
				renderReview();
				check();
			} })),
			h("div", { class: "toolbar" },
				h("button", { class: "btn link", type: "button", text: "Tick all", onclick: () => tickAll(true) }),
				h("button", { class: "btn link", type: "button", text: "Untick all", onclick: () => tickAll(false) }))));

		out.push(h("div", {}, r.drafts.map((d, i) => draftCard(d, i))));
		const save = h("button", { class: "btn primary grow save-import", type: "button", disabled: true, text: "Checking…", onclick: saveImport });
		out.push(h("div", { class: "sticky-actions" }, save, h("button", { class: "btn", type: "button", text: "Start over", onclick: () => {
			S.imp = { who: imp.who };
			renderImport();
		} })));
		out.push(h("p", { class: "muted small save-note" }));
		main.replaceChildren(...out);
		if (imp.checks && imp.checks.length) paintChecks();
	}

	function tickAll (on) {
		for (const d of S.imp.result.drafts) d.include = on;
		renderReview();
		check();
	}

	function draftCard (d, i) {
		const changed = () => check();
		const box = h("input", { type: "checkbox", checked: d.include, "aria-label": "Import this row" });
		const card = h("div", { class: d.include ? "draft" : "draft off", "data-draft": String(i) });
		box.addEventListener("change", () => {
			d.include = box.checked;
			card.classList.toggle("off", !d.include);
			changed();
		});
		const city = h("input", { type: "text", value: d.city, placeholder: "City", "aria-label": "City" });
		city.addEventListener("input", () => {
			d.city = city.value;
			changed();
		});
		const country = h("input", { type: "text", value: d.country ? countryName(countryCode(d.country)) : "", placeholder: "Country", list: "country-list-import", "aria-label": "Country" });
		country.addEventListener("input", () => {
			d.country = country.value;
			changed();
		});
		const day = dayPicker(d.start, "Start");
		const when = monthPicker(d.date, (val) => {
			d.date = val;
			d.start = startFrom(d.date, day.value);
			changed();
		}, "Month");
		day.addEventListener("change", () => {
			d.start = startFrom(d.date, day.value);
			changed();
		});
		const days = h("input", { type: "number", min: "1", value: d.days, placeholder: "Days", "aria-label": "Days" });
		days.addEventListener("input", () => {
			d.days = days.value;
			changed();
		});
		card.append(
			h("div", { class: "draft-head" }, box,
				h("div", { class: "row-main" },
					h("div", { class: "row-title", text: [d.city, d.country ? countryName(countryCode(d.country)) : ""].filter(Boolean).join(", ") || "Unknown place" }),
					d.note ? h("div", { class: "row-sub", text: d.note }) : null,
					d.hours ? h("div", { class: "row-sub", text: `${d.hours} hours over ${d.days} day${d.days === "1" ? "" : "s"}` }) : null)),
			h("div", { class: "draft-body" },
				h("div", { class: "pair" }, city, country),
				h("div", { class: "pair-4" }, day, when.month, when.year, days),
				travelerPills(d.travelers, (list) => {
					d.travelers = list;
					changed();
				}, true),
				h("div", { class: "status info", text: d.include ? "Checking…" : d.hint || "Won't be imported" })));
		if (i === 0) card.append(h("datalist", { id: "country-list-import" }, S.data.countries.map((c) => h("option", { value: c[1] }))));
		return card;
	}

	async function saveImport () {
		const r = S.imp.result;
		const rows = r.drafts.filter((d, i) => d.include && S.imp.checks[i] && S.imp.checks[i].ok).map(draftBody);
		if (!rows.length) return;
		const btn = main.querySelector(".save-import");
		btn.disabled = true;
		btn.textContent = "Saving…";
		try {
			S.imp.saved = await api("POST", "/import/save", { rows });
			await reload();
			renderImport();
		} catch (err) {
			btn.disabled = false;
			if (!err.quiet) toast(err.message, true);
			paintChecks();
		}
	}

	function renderImportDone () {
		const s = S.imp.saved;
		main.replaceChildren(h("div", { class: "card" },
			h("h2", { text: "Imported" }),
			h("p", { text: `${s.added} new trip${s.added === 1 ? "" : "s"} added${s.combined ? `, ${s.combined} combined with trips already there` : ""}.` }),
			s.combined ? h("p", { class: "muted small", text: "When two people import the same city and month, the trip becomes a together trip." }) : null,
			h("p", { class: "muted small", text: "The mirror updates in a moment. A backup of the old list was kept (More → Backups)." }),
			h("div", { class: "actions" },
				h("button", { class: "btn primary grow", type: "button", text: "See trips", onclick: () => {
					S.imp = null;
					setTab("trips");
				} }),
				h("button", { class: "btn grow", type: "button", text: "Import another", onclick: () => {
					S.imp = { who: S.imp.who };
					renderImport();
				} }))));
	}

	/* ---------- more: sheet, download, backups ---------- */

	async function renderMore () {
		const d = S.data;
		const out = [];
		if (d.sheet) {
			const s = d.sheet;
			out.push(h("div", { class: "card" },
				h("h2", { text: "Google Sheet" }),
				h("p", { class: s.error ? "status bad" : "status ok", text: s.error ? s.error : s.ok ? "Connected." : "Not checked yet." }),
				s.checkedAt ? h("p", { class: "muted small", text: `Last checked ${new Date(s.checkedAt).toLocaleString()}.` }) : null,
				h("button", { class: "btn", type: "button", text: "Check the sheet now", onclick: async (e) => {
					e.target.disabled = true;
					try {
						await api("POST", "/sheet/refresh");
						await reload();
						toast("Sheet checked.");
						renderMore();
					} catch (err) {
						if (!err.quiet) toast(err.message, true);
						e.target.disabled = false;
					}
				} })));
		}
		out.push(h("div", { class: "card" },
			h("h2", { text: "Download all trips" }),
			h("p", { class: "muted small", text: "A CSV file you can open in Excel, Numbers or Google Sheets, or keep as a copy." }),
			h("button", { class: "btn", type: "button", text: "Download CSV", onclick: async () => {
				try {
					const res = await api("GET", "/export.csv", undefined, { raw: true });
					const url = URL.createObjectURL(await res.blob());
					const a = h("a", { href: url, download: `trips-${new Date().toISOString().slice(0, 10)}.csv` });
					document.body.append(a);
					a.click();
					a.remove();
					setTimeout(() => URL.revokeObjectURL(url), 5000);
				} catch (err) {
					if (!err.quiet) toast(err.message, true);
				}
			} })));
		const backups = h("div", { class: "list" }, h("p", { class: "muted small row", text: "Loading…" }));
		out.push(h("h2", { text: "Backups" }),
			h("p", { class: "muted small", text: "Every save keeps a copy of the list from before, up to the last 10. Restoring one keeps a copy of the current list too." }),
			backups);
		main.replaceChildren(...out);
		try {
			const r = await api("GET", "/backups");
			if (S.tab !== "more") return;
			backups.replaceChildren(...(r.backups.length ? r.backups.map((b) => h("div", { class: "row locked" },
				h("span", { class: "row-main" },
					h("div", { class: "row-title", text: b.savedAt ? new Date(b.savedAt).toLocaleString() : b.name }),
					h("div", { class: "row-sub", text: b.trips === null ? "Can't be read" : `${b.trips} trip${b.trips === 1 ? "" : "s"}` })),
				h("button", { class: "btn", type: "button", text: "Restore", onclick: async () => {
					if (!confirm(`Put back the list from ${b.savedAt ? new Date(b.savedAt).toLocaleString() : b.name}? Your current list is backed up first.`)) return;
					try {
						const res = await api("POST", "/backups/restore", { name: b.name });
						await reload();
						toast(`Restored ${res.trips} trips.`);
						renderMore();
					} catch (err) {
						if (!err.quiet) toast(err.message, true);
					}
				} }))) : [h("p", { class: "row locked muted small", text: "No backups yet. One is made the first time you save." })]));
		} catch (err) {
			if (!err.quiet) backups.replaceChildren(h("p", { class: "row locked status bad", text: err.message }));
		}
	}

	/* ---------- start ---------- */

	async function start () {
		main.replaceChildren(h("p", { class: "loading", text: "Loading your trips…" }));
		try {
			await reload();
			setTab(S.tab);
		} catch (err) {
			if (!err.quiet) failed(err);
		}
	}

	for (const b of document.querySelectorAll(".tabs button")) {
		b.addEventListener("click", () => {
			if (b.dataset.tab === "add" && S.tab !== "add") {
				if (!S.formDraft) S.editing = null;
			}
			setTab(b.dataset.tab);
		});
	}
	window.addEventListener("pageshow", (e) => e.persisted && start());
	start();
})();
