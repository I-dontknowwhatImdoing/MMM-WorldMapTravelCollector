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
		for (const c of children.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
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
	/**
	 * A short message at the bottom of the screen. `action` adds a button, e.g. { label: "Undo", run }.
	 */
	function toast (message, bad, action) {
		const t = document.getElementById("toast");
		t.replaceChildren(h("span", { text: message }));
		if (action) {
			t.append(h("button", { class: "toast-action", type: "button", text: action.label, onclick: () => {
				t.hidden = true;
				action.run();
			} }));
		}
		t.className = bad ? "toast bad" : "toast";
		t.hidden = false;
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => (t.hidden = true), action ? 6000 : bad ? 6000 : 3500);
	}

	/**
	 * Which form field an error from the mirror is about, so it can be shown next to that field.
	 * @returns {"country"|"city"|"when"|"who"|"days"|"spot"|null}
	 */
	function fieldOf (message) {
		const m = String(message).toLowerCase();
		if (/country/.test(m) && !/unknown city/.test(m)) return "country";
		if (/city/.test(m)) return "city";
		if (/date|month|has no \d|could be/.test(m)) return "when";
		if (/traveler/.test(m)) return "who";
		if (/^days/.test(m)) return "days";
		if (/latitude|longitude/.test(m)) return "spot";
		return null;
	}

	/** "Did you mean Lisbon, Linda-a-Velha?" → ["Lisbon", "Linda-a-Velha"] */
	function suggestionsIn (message) {
		const m = /Did you mean (.+)\?$/.exec(String(message));
		return m ? m[1].split(", ").map((s) => s.trim()).filter(Boolean) : [];
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
		if ((res.status === 401 || res.status === 429) && data.pinRequired) {
			showPin(data, Boolean(pin));
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

	let pinTyped = false;
	let lockTimer;
	/**
	 * Ask for the PIN. `data` is the mirror's answer: a wrong PIN says how many tries are left, and after
	 * five wrong tries the mirror waits a minute (`retryAfter`). `hadPin` = this request sent a PIN.
	 */
	function showPin (data, hadPin) {
		document.getElementById("tabs").hidden = true;
		clearInterval(lockTimer);
		const typed = pinTyped;
		pinTyped = false;
		// A saved PIN that stopped working: forget it, so it doesn't use up tries on every page load.
		if (hadPin) storage("wmtc-pin", null);
		const input = h("input", { type: "password", inputmode: "numeric", autocomplete: "current-password", "aria-label": "PIN" });
		const button = h("button", { class: "btn primary", type: "submit", text: "Open editor" });
		const status = h("p", { class: "status bad", role: "alert" });
		if (data.retryAfter) {
			let left = data.retryAfter;
			const tick = () => {
				status.textContent = `Too many wrong PINs. Try again in ${left} second${left === 1 ? "" : "s"}.`;
				input.disabled = button.disabled = left > 0;
				if (left <= 0) {
					clearInterval(lockTimer);
					status.textContent = "You can try again now.";
					input.focus();
				}
				left--;
			};
			tick();
			lockTimer = setInterval(tick, 1000);
		} else if (data.error === "Wrong PIN" && !typed) {
			status.textContent = "The PIN saved on this phone no longer works. It may have been changed on the mirror: enter the current one.";
		} else if (data.error === "Wrong PIN") {
			status.textContent = `That's not the PIN.${data.triesLeft ? ` ${data.triesLeft} ${data.triesLeft === 1 ? "try" : "tries"} left before a one-minute wait.` : ""}`;
		} else status.hidden = true;
		const form = h("form", { class: "card", onsubmit: async (e) => {
			e.preventDefault();
			storage("wmtc-pin", input.value);
			pinTyped = true;
			try {
				await reload();
				pinTyped = false;
				setTab(S.tab, { replace: true });
			} catch (err) {
				if (!err.quiet) failed(err);
			}
		} },
		h("h2", { text: "Enter the editor PIN" }),
		h("p", { class: "muted", text: "It's the editorPin from the mirror's config. This phone will remember it." }),
		status,
		h("label", { class: "field" }, h("span", { text: "PIN" }), input),
		button);
		main.replaceChildren(form);
		if (!input.disabled) input.focus();
	}

	function failed (err) {
		main.replaceChildren(h("div", { class: "notice bad" }, h("strong", { text: "Something went wrong. " }), err.message),
			h("button", { class: "btn", text: "Try again", onclick: start }));
	}

	/* ---------- tabs ---------- */

	/**
	 * Show a screen. Each one gets an entry in the phone's history, so the Back button steps back
	 * through the editor instead of leaving it. `replace` swaps the current entry (after a save).
	 */
	function setTab (tab, opts = {}) {
		S.tab = tab;
		for (const b of document.querySelectorAll(".tabs button")) {
			b.classList.toggle("active", b.dataset.tab === tab);
			if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
			else b.removeAttribute("aria-current");
		}
		document.getElementById("title").textContent = { trips: "Trips", add: S.editing ? "Edit trip" : "Add a trip", import: "Import", more: "More" }[tab];
		if (opts.history !== false) {
			const entry = { tab, editing: S.editing ? S.editing.id : null };
			try {
				if (opts.replace) history.replaceState(entry, "");
				else history.pushState(entry, "");
			} catch {
				// History isn't available in every embedded browser; the tabs still work.
			}
		}
		render();
		window.scrollTo(0, 0);
	}

	/** An import being reviewed that hasn't been saved: leaving it loses the review. */
	function importInProgress () {
		return S.tab === "import" && S.imp && S.imp.result && !S.imp.saved;
	}

	window.addEventListener("popstate", (e) => {
		const entry = e.state || { tab: "trips" };
		if (importInProgress() && entry.tab !== "import" && !confirm("Leave this import? Nothing has been saved yet.")) {
			history.pushState({ tab: "import", editing: null }, "");
			return;
		}
		if (entry.tab === "add" && entry.editing) {
			S.editing = S.data && (S.data.trips.find((t) => t.id === entry.editing) || null);
			if (!S.editing) entry.tab = "trips";
		} else if (entry.tab === "add") {
			S.editing = null;
		}
		setTab(entry.tab, { history: false });
	});

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
		const matches = (t) => {
			const q = S.search.trim().toLowerCase();
			return !q || [t.city, countryName(t.country), t.country, t.note, t.date, formatMonth(t.date), whenText(t), ...t.travelers].join(" ").toLowerCase().includes(q);
		};

		if (d.sheet && d.sheet.error) {
			out.push(h("div", { class: "notice bad" }, h("strong", { text: "Google Sheet: " }), d.sheet.error, ". ",
				h("button", { type: "button", class: "btn link inline", text: "Check it now", onclick: () => setTab("more") })));
		}
		if (!d.pinRequired && !storage("wmtc-pin-note-seen")) {
			const note = h("div", { class: "notice" },
				"Anyone on your Wi-Fi can open this page and change your trips. To ask for a PIN, add ",
				h("code", { text: "editorPin: \"1234\"" }), " (your own number) to the module in the mirror's config. ",
				h("button", { type: "button", class: "btn link inline", text: "Got it", onclick: () => {
					storage("wmtc-pin-note-seen", "1");
					note.remove();
				} }));
			out.push(note);
		}
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
			main.querySelectorAll("[data-source]").forEach((el) => {
				const src = d.readOnly.find((s) => s.source === el.dataset.source);
				if (src) el.replaceChildren(...tripGroups(src.trips.filter(matches), true));
			});
		});
		out.push(h("div", { class: "field" }, search));

		const groups = h("div", { class: "trip-groups" }, tripGroups(d.trips.filter(matches), false));
		out.push(groups);
		const readOnlyCount = d.readOnly.reduce((n, s) => n + s.trips.length, 0);
		if (!d.trips.length) {
			out.push(h("div", { class: "empty" },
				h("p", { text: readOnlyCount ? "None of your trips can be changed here yet: they come from a file or a sheet, listed below." : "No trips yet." }),
				h("div", { class: "actions" },
					h("button", { class: "btn primary grow", type: "button", text: "Add a trip", onclick: () => newTrip() }),
					h("button", { class: "btn grow", type: "button", text: "Import from a file", onclick: () => setTab("import") }))));
		}

		for (const src of d.readOnly) {
			if (!src.trips.length) continue;
			out.push(h("h3", { text: `From ${src.source}` }));
			if (src.source === "trips.csv") {
				out.push(h("div", { class: "notice good" },
					h("p", { text: `These ${src.trips.length} trips come from trips.csv, so they can't be changed here. Move them into the editor to change them on this phone. The file is renamed, not deleted.` }),
					h("button", { class: "btn primary", type: "button", text: `Move ${src.trips.length} trips into the editor`, onclick: (e) => moveCsv(e.target) })));
			} else {
				out.push(h("p", { class: "muted small", text: src.source === "Google Sheet" ? "These come from your Google Sheet. Change them there; the mirror picks it up on its next check." : `These come from ${src.source}. Change them in that file.` }));
			}
			out.push(h("div", { "data-source": src.source }, tripGroups(src.trips.filter(matches), true)));
		}
		main.replaceChildren(...out);
	}

	async function moveCsv (button) {
		button.disabled = true;
		try {
			const r = await api("POST", "/import/move-csv");
			await reload();
			render();
			const parts = [`Moved ${r.added + r.combined + r.already} trips into the editor`];
			if (r.needFixing) parts.push(`${r.needFixing} need${r.needFixing === 1 ? "s" : ""} fixing (listed at the top)`);
			toast(`${parts.join("; ")}. trips.csv is now called ${r.renamedTo}.`);
		} catch (err) {
			button.disabled = false;
			if (!err.quiet) toast(err.message, true);
		}
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
						h("div", { class: "row-title" }, place(t), planned ? [" ", h("span", { class: "badge", text: "planned" })] : null),
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
		// The raw row may carry its own id; the editor must address it by its position id (row-N).
		S.editing = broken ? { ...broken.raw, id: broken.id, broken: true, errors: broken.errors, guess: broken.guess } : trip;
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
				if (!Array.isArray(hits)) hits = [];
				if (mine !== seq) return;
				// "Paris, TX · United States · 25k people", "Munich (München) · Germany"
				list.replaceChildren(...hits.map((c) => h("li", { role: "option" }, h("button", { type: "button", onclick: () => {
					onPick(c);
					close();
					input.focus();
				} },
				h("strong", { text: c.name }),
				c.alias ? ` (${c.alias})` : "",
				c.region ? `, ${c.region}` : "",
				h("span", { class: "suggest-sub", text: ` · ${c.countryName} · ${people(c.population)}` })))));
				list.hidden = !hits.length;
			}, 180);
		});
		// Close when focus leaves both the box and the list (not when moving into the list).
		const leave = (e) => setTimeout(() => {
			if (!list.contains(document.activeElement) && document.activeElement !== input) close();
		}, e && e.type === "blur" ? 200 : 0);
		input.addEventListener("blur", leave);
		list.addEventListener("focusout", leave);
		const options = () => [...list.querySelectorAll("button")];
		input.addEventListener("keydown", (e) => {
			if (e.key === "Escape") close();
			else if (e.key === "ArrowDown" && !list.hidden && options().length) {
				e.preventDefault();
				options()[0].focus();
			}
		});
		list.addEventListener("keydown", (e) => {
			const all = options();
			const at = all.indexOf(document.activeElement);
			if (e.key === "ArrowDown" && at < all.length - 1) {
				e.preventDefault();
				all[at + 1].focus();
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				if (at > 0) all[at - 1].focus();
				else input.focus();
			} else if (e.key === "Escape") {
				close();
				input.focus();
			}
		});
		return list;
	}

	function renderForm () {
		const editing = S.editing;
		// An unreadable row opens with what the mirror could make of it ("May 2019" → May, 2019).
		const fromBroken = editing && editing.broken && editing.guess
			? { ...editing, date: editing.guess.date || "", start: editing.guess.start || "", country: editing.guess.country || editing.country || "", travelers: editing.guess.travelers || [] }
			: null;
		const t = S.formDraft || fromBroken || editing || { city: "", country: "", date: "", days: "", travelers: S.data.travelers.length === 1 ? [S.data.travelers[0].name] : [], note: "", lat: "", lon: "" };
		const v = {
			city: t.city || "",
			country: t.country ? countryName(countryCode(t.country)) : "",
			date: t.date || "",
			start: t.start || "",
			days: t.days ? String(t.days) : "",
			travelers: Array.isArray(t.travelers) ? [...t.travelers] : String(t.travelers || "").split(/[;,&]/).map((x) => x.trim()).filter(Boolean),
			note: t.note || "",
			lat: t.lat === null || t.lat === undefined ? "" : String(t.lat),
			lon: t.lon === null || t.lon === undefined ? "" : String(t.lon)
		};
		const keep = () => (S.formDraft = { ...v, id: editing && editing.id });

		// Each field has a place for its own error, right under it.
		const slot = () => h("div", { class: "field-error", hidden: true, role: "alert" });
		const slots = { country: slot(), city: slot(), when: slot(), who: slot(), days: slot(), spot: slot() };
		const general = h("ul", { class: "errors", hidden: true, role: "alert" });
		const inputs = {};
		const showErrors = (list) => {
			for (const el of Object.values(slots)) {
				el.replaceChildren();
				el.hidden = true;
			}
			general.replaceChildren();
			general.hidden = true;
			let first = null;
			for (const message of list) {
				const field = fieldOf(message);
				const target = field ? slots[field] : general;
				const ideas = field === "city" ? suggestionsIn(message) : [];
				const text = ideas.length ? message.replace(/\s*Did you mean .+\?$/, "") : message;
				target.append(h(field ? "p" : "li", {}, text, ideas.length ? h("span", { class: "did-you-mean" }, " Did you mean ", ideas.map((idea, n) => [n ? ", " : "", h("button", { type: "button", class: "btn link inline", text: idea, onclick: () => {
					city.value = v.city = idea;
					keep();
					showErrors([]);
				} })]), "?") : null));
				target.hidden = false;
				if (!first) first = field || "general";
			}
			if (first) {
				const el = first === "general" ? general : slots[first];
				el.scrollIntoView({ behavior: "smooth", block: "center" });
				if (inputs[first]) inputs[first].focus({ preventScroll: true });
			}
		};

		const countries = h("datalist", { id: "country-list" }, S.data.countries.map((c) => h("option", { value: c[1] })));
		const country = h("input", { type: "text", value: v.country, list: "country-list", placeholder: "e.g. Portugal", autocapitalize: "words" });
		inputs.country = country;
		country.addEventListener("input", () => {
			v.country = country.value;
			keep();
		});
		const city = h("input", { type: "text", value: v.city, placeholder: "e.g. Lisbon", autocapitalize: "words" });
		inputs.city = city;
		city.addEventListener("input", () => {
			v.city = city.value;
			keep();
		});
		const spotNote = h("small", { class: "hint spot-note", hidden: true });
		// Set once the coordinate boxes exist (below): a new place drops the old place's coordinates.
		let clearSpot = () => {};
		let setSpot = () => {};
		const suggest = cityField(city, () => country.value, (c) => {
			city.value = v.city = c.name;
			country.value = v.country = c.countryName;
			// Not the place this name usually means (Paris, TX rather than Paris, France): keep its exact position.
			if (c.isDefault) clearSpot();
			else setSpot(c);
			keep();
		});
		const day = dayPicker(v.start, "When");
		inputs.when = day;
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
		inputs.days = days;
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
		inputs.spot = lat;
		lat.addEventListener("input", () => {
			v.lat = lat.value;
			keep();
		});
		lon.addEventListener("input", () => {
			v.lon = lon.value;
			keep();
		});
		clearSpot = () => {
			spotNote.hidden = true;
			if (!v.lat && !v.lon) return;
			v.lat = v.lon = "";
			lat.value = lon.value = "";
			keep();
		};
		setSpot = (c) => {
			v.lat = lat.value = String(c.lat);
			v.lon = lon.value = String(c.lon);
			spotNote.textContent = `Using ${c.name}${c.region ? `, ${c.region}` : ""} (${people(c.population)}), not the best-known ${c.name}.`;
			spotNote.hidden = false;
		};
		city.addEventListener("input", () => clearSpot());
		country.addEventListener("input", () => clearSpot());

		const whoPills = travelerPills(v.travelers, (list) => {
			v.travelers = list;
			keep();
		});
		inputs.who = whoPills.querySelector("input");
		const unknown = editing && editing.guess && editing.guess.unknownTravelers && editing.guess.unknownTravelers.length ? editing.guess.unknownTravelers : [];

		const save = h("button", { class: "btn primary grow", type: "submit", text: editing ? "Save changes" : "Add trip" });
		const fresh = !editing && S.formDraft && S.lastAdded;
		const form = h("form", { class: "card", novalidate: true, onsubmit: async (e) => {
			e.preventDefault();
			showErrors([]);
			const body = { city: v.city, country: countryCode(v.country), date: v.date, start: v.start, days: v.days, travelers: v.travelers, note: v.note, lat: v.lat, lon: v.lon };
			save.disabled = true;
			try {
				const r = editing ? await api("PUT", `/trips/${encodeURIComponent(editing.id)}`, body) : await api("POST", "/trips", body);
				toast(r.combined ? `Combined with the ${place(r.trip)}, ${formatMonth(r.trip.date)} trip that was already there.` : editing ? "Saved. The mirror updates in a moment." : `Added ${place(r.trip)}. The mirror updates in a moment.`);
				await reload();
				if (editing) {
					S.formDraft = null;
					S.editing = null;
					setTab("trips", { replace: true });
				} else {
					// Ready for the next place on the same trip: same country, month and people.
					S.formDraft = { country: v.country, date: v.date, start: "", travelers: v.travelers, city: "", days: "", note: "", lat: "", lon: "" };
					S.lastAdded = place(r.trip);
					render();
					const next = main.querySelector("input[placeholder='e.g. Lisbon']");
					if (next) next.focus();
				}
			} catch (err) {
				if (!err.quiet) showErrors(err.errors || [err.message]);
			} finally {
				save.disabled = false;
			}
		} },
		fresh ? h("div", { class: "notice good" }, h("strong", { text: `Added ${S.lastAdded}.` }), " Add another place from this trip, or ",
			h("button", { type: "button", class: "btn link inline", text: "start a different trip", onclick: () => {
				S.formDraft = null;
				S.lastAdded = null;
				render();
			} }), ".") : null,
		editing && editing.broken ? h("div", { class: "notice" }, h("strong", { text: "This row can't be shown on the mirror: " }), editing.errors.join(". ")) : null,
		general,
		countries,
		h("label", { class: "field" }, h("span", { text: "Country" }), country, slots.country),
		h("label", { class: "field" }, h("span", { text: "City" }), city, suggest, spotNote, slots.city, h("small", { class: "hint", text: "Leave empty for a trip around the whole country, like a road trip." })),
		h("div", { class: "field" }, h("span", { class: "label", text: "When" }), h("div", { class: "when" }, day, when.month, when.year), slots.when,
			h("small", { class: "hint", text: "The day is optional. With it and the days there, the map knows exactly when the trip ended. A month after this one shows as a planned trip." })),
		h("div", { class: "field" }, h("span", { class: "label", text: "Who went" }), whoPills, slots.who,
			unknown.length ? h("small", { class: "hint warn-text", text: `${unknown.join(" and ")} ${unknown.length === 1 ? "isn't one of the travelers" : "aren't travelers"} in the mirror's config. Pick who went above, or add them to the config first.` }) : null),
		h("label", { class: "field" }, h("span", { text: "Days there" }), days, slots.days),
		h("label", { class: "field" }, h("span", { text: "Note" }), note),
		h("details", { open: Boolean(v.lat || v.lon) },
			h("summary", { text: "Exact location (optional)" }),
			h("p", { class: "muted small", text: "Only needed for small places the lookup can't find, or to pick a different town with the same name (Paris, Texas)." }),
			h("div", { class: "pair" },
				h("label", { class: "field" }, h("span", { text: "Latitude" }), lat),
				h("label", { class: "field" }, h("span", { text: "Longitude" }), lon)),
			slots.spot),
		h("div", { class: "actions" },
			save,
			editing ? h("button", { class: "btn", type: "button", text: "Cancel", onclick: () => {
				S.editing = null;
				S.formDraft = null;
				setTab("trips", { replace: true });
			} }) : null),
		editing ? h("div", { class: "actions" }, h("button", { class: "btn danger", type: "button", text: "Delete this trip", onclick: async () => {
			const label = `${v.city || v.country || "this trip"}${v.date ? `, ${formatMonth(v.date)}` : ""}`;
			if (!confirm(`Delete ${label}?`)) return;
			const before = { city: v.city, country: countryCode(v.country), date: v.date, start: v.start, days: v.days, travelers: v.travelers, note: v.note, lat: v.lat, lon: v.lon };
			try {
				await api("DELETE", `/trips/${encodeURIComponent(editing.id)}`);
				S.editing = null;
				S.formDraft = null;
				await reload();
				setTab("trips", { replace: true });
				// Unreadable rows can't be put back through the form; everything else gets an Undo.
				toast(`Deleted ${label}.`, false, editing.broken ? null : { label: "Undo", run: async () => {
					try {
						await api("POST", "/trips", before);
						await reload();
						render();
						toast(`${label} is back.`);
					} catch (err) {
						if (!err.quiet) toast(err.message, true);
					}
				} });
			} catch (err) {
				if (!err.quiet) showErrors([err.message]);
			}
		} })) : null);
		main.replaceChildren(form);
	}

	/** "25k people", "1.3M people" */
	function people (n) {
		const p = Number(n) || 0;
		if (p >= 1e6) return `${(p / 1e6).toFixed(1).replace(/\.0$/, "")}M people`;
		if (p >= 1e3) return `${Math.round(p / 1e3)}k people`;
		return p ? `${p} people` : "a small place";
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
				if ((xhr.status === 401 || xhr.status === 429) && data.pinRequired) {
					showPin(data, Boolean(pin));
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

	/** Short reasons for rows that can't be saved yet, e.g. "pick who went (3 rows)". */
	function reasonsFor (errors) {
		const counts = new Map();
		const label = (e) => {
			const field = fieldOf(e);
			if (field === "who") return "pick who went";
			if (field === "when") return "pick the month";
			if (field === "country") return "fill in the country";
			if (field === "city") return "check the city";
			return "fix a detail";
		};
		for (const list of errors) {
			for (const l of new Set(list.map(label))) counts.set(l, (counts.get(l) || 0) + 1);
		}
		return [...counts].map(([l, n]) => `${l} (${n} row${n === 1 ? "" : "s"})`);
	}

	function paintChecks () {
		const imp = S.imp;
		let good = 0;
		let already = 0;
		const problems = [];
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
			// A row whose trip is already there, with the same people, changes nothing.
			if (c.ok && c.combinesWith && !(c.adds || []).length) already++;
			else if (c.ok) good++;
			else problems.push(c.errors);
			if (!el) return;
			if (c.ok) {
				const adds = c.adds || [];
				el.className = c.combinesWith && !adds.length ? "status info" : "status ok";
				el.textContent = !c.combinesWith ? "✓ Ready"
					: adds.length ? `✓ Adds ${adds.join(" & ")} to the trip already there` : "Already there, nothing changes";
				if (d.hint) el.textContent += ` · ${d.hint}`;
			} else {
				el.className = "status bad";
				el.textContent = c.errors.join(". ");
			}
		});
		const btn = main.querySelector(".save-import");
		if (btn) {
			btn.disabled = !good;
			btn.textContent = good ? `Save ${good} trip${good === 1 ? "" : "s"}` : already && !problems.length ? "Nothing new to save" : "Nothing to save yet";
		}
		// Why some rows (or all) can't be saved, right next to the button.
		const note = main.querySelector(".save-note");
		if (note) {
			const reasons = reasonsFor(problems);
			const parts = [];
			if (reasons.length) parts.push(`To save ${good ? "the rest" : "these"}: ${reasons.join(", ")}, or untick them.`);
			if (already) parts.push(`${already} ${already === 1 ? "is" : "are"} already there.`);
			note.textContent = parts.join(" ");
		}
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
		const needWho = r.drafts.filter((d) => d.include && !d.travelers.length).length;
		if (needWho) {
			const pills = travelerPills(S.data.travelers.length === 1 ? [S.data.travelers[0].name] : [], () => {}, false);
			out.push(h("div", { class: "card who-first" },
				h("h2", { text: "Who went on these trips?" }),
				h("p", { class: "muted small", text: `${needWho} row${needWho === 1 ? " doesn't" : "s don't"} say. Pick the people and they're added to every row; you can still change single rows below.` }),
				pills,
				h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", text: "Set for all rows", onclick: () => {
					const list = [...pills.querySelectorAll("input")].map((b, i) => (b.checked ? S.data.travelers[i].name : null)).filter(Boolean);
					if (!list.length) return toast("Tick at least one person first", true);
					for (const d of r.drafts) if (!d.travelers.length) d.travelers = [...list];
					imp.who = list;
					renderReview();
					check();
				} }))));
		}
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
		out.push(h("div", { class: "sticky-actions" },
			h("div", { class: "sticky-row" }, save, h("button", { class: "btn", type: "button", text: "Start over", onclick: () => {
				S.imp = { who: imp.who };
				renderImport();
			} })),
			h("p", { class: "small save-note", "aria-live": "polite" })));
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
		const box = h("input", { type: "checkbox", checked: d.include, "aria-label": `Import ${[d.city, d.country ? countryName(countryCode(d.country)) : ""].filter(Boolean).join(", ") || d.note || "this row"}` });
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
			h("p", { text: [
				`${s.added} new trip${s.added === 1 ? "" : "s"} added`,
				s.combined ? `${s.combined} joined trip${s.combined === 1 ? "" : "s"} already there` : "",
				s.already ? `${s.already} ${s.already === 1 ? "was" : "were"} already there` : ""
			].filter(Boolean).join(", ") + "." }),
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

	/** "24 trips · 2 more than now" (rows in the backup compared with rows in the list now) */
	function backupSummary (rows) {
		const now = S.data.trips.length + S.data.broken.length;
		const diff = rows - now;
		const change = diff === 0 ? "same as now" : `${Math.abs(diff)} ${diff > 0 ? "more" : "fewer"} than now`;
		return `${rows} trip${rows === 1 ? "" : "s"} · ${change}`;
	}

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
						const res = await api("POST", "/sheet/refresh");
						await reload();
						if (res.sheet && res.sheet.error) toast(res.sheet.error, true);
						else {
							const fromSheet = S.data.readOnly.find((x) => x.source === "Google Sheet");
							toast(`Sheet checked: ${fromSheet ? fromSheet.trips.length : 0} trips.`);
						}
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
					h("div", { class: "row-sub", text: b.trips === null ? "Can't be read" : backupSummary(b.trips) })),
				h("button", { class: "btn", type: "button", text: "Restore", onclick: async () => {
					if (!confirm(`Put back the list from ${b.savedAt ? new Date(b.savedAt).toLocaleString() : b.name}? Your current list is backed up first.`)) return;
					try {
						const res = await api("POST", "/backups/restore", { name: b.name });
						await reload();
						toast(`Restored ${res.trips} trip${res.trips === 1 ? "" : "s"}${res.unreadable ? `, plus ${res.unreadable} row${res.unreadable === 1 ? "" : "s"} to fix` : ""}.`);
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
			setTab(S.tab, { replace: true });
		} catch (err) {
			if (!err.quiet) failed(err);
		}
	}

	for (const b of document.querySelectorAll(".tabs button")) {
		b.addEventListener("click", () => {
			if (importInProgress() && b.dataset.tab !== "import" && !confirm("Leave this import? Nothing has been saved yet.")) return;
			if (b.dataset.tab === "add" && S.tab !== "add") {
				if (!S.formDraft) S.editing = null;
			}
			setTab(b.dataset.tab);
		});
	}
	window.addEventListener("pageshow", (e) => e.persisted && start());
	start();
})();
