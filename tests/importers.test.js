"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { loadGeoData } = require("../lib/geodata");
const { isZip, readZip } = require("../lib/zip");
const places = require("../lib/import-places");
const timeline = require("../lib/import-timeline");
const { parseUpload, unpackFiles, packFiles, draftsFromRecords } = require("../lib/importers");
const { makeZip } = require("./zip-helper");

const geo = loadGeoData();
const NAMES = ["Alex", "Sam"];
const FIX = path.join(__dirname, "fixtures");
const file = (name) => ({ name, data: fs.readFileSync(path.join(FIX, name)) });
const BOSTON = { lat: 42.3601, lon: -71.0589, name: "Boston" };
const summary = (drafts) => drafts.map((d) => `${d.include ? "+" : "-"}${d.city || "?"}|${d.country}|${d.date}`);

describe("reverse geocoding", () => {
	test("finds the town a point is in, preferring the big city over a closer suburb", () => {
		expect(geo.geocoder.nearest(38.6979, -9.2066)).toMatchObject({ name: "Lisbon", country: "PT", matchedBy: "nearest" });
		expect(geo.geocoder.nearest(38.80, -9.38).name).toBe("Sintra");
		expect(geo.geocoder.nearest(48.8584, 2.2945).name).toBe("Paris");
		expect(geo.geocoder.nearest(64.1466, -21.9426).name).toBe("Reykjavík");
	});

	test("nothing nearby, bad input, and limiting to a country", () => {
		expect(geo.geocoder.nearest(0, -30)).toBeNull();
		expect(geo.geocoder.nearest(NaN, 1)).toBeNull();
		// A spot on the Portugal–Spain border, limited to Spain.
		expect(geo.geocoder.nearest(42.03, -8.64, { country: "ES" }).country).toBe("ES");
		// Falls back to the closest place when nothing is within the "prefer" distance.
		const far = geo.geocoder.nearest(64.0, -19.0, { maxKm: 200 });
		expect(far.country).toBe("IS");
		expect(far.km).toBeGreaterThan(0);
	});

	test("wraps around the date line", () => {
		expect(geo.geocoder.nearest(-18.1416, 178.4419).country).toBe("FJ");
		expect(geo.geocoder.nearest(-17.0, 179.99, { maxKm: 200 })).not.toBeNull();
	});
});

describe("zip", () => {
	test("reads stored and deflated files, skips folders", () => {
		const z = makeZip([{ name: "doc.kml", data: "<kml/>" }, { name: "pics/", data: "", store: true }, { name: "a.txt", data: "hi", store: true }]);
		expect(isZip(z)).toBe(true);
		expect(isZip(Buffer.from("PK"))).toBe(false);
		const entries = readZip(z);
		expect(entries.map((e) => e.name)).toEqual(["doc.kml", "a.txt"]);
		expect(entries[0].read().toString()).toBe("<kml/>");
		expect(entries[1].read().toString()).toBe("hi");
	});

	test("refuses damaged, encrypted, oversized and odd archives", () => {
		expect(() => readZip(Buffer.from("nope"))).toThrow("isn't a zip");
		const z = makeZip([{ name: "a.txt", data: "hello" }]);
		expect(() => readZip(z.subarray(0, z.length - 22))).toThrow("damaged or incomplete");
		const broken = Buffer.from(z);
		broken.writeUInt32LE(0, broken.length - 22 + 16); // central directory points at a local header
		expect(() => readZip(broken)).toThrow("damaged");
		expect(() => readZip(makeZip([{ name: "x", data: "a", flags: 1 }]))[0].read()).toThrow("password");
		expect(() => readZip(makeZip([{ name: "x", data: "a", method: 12 }]))[0].read()).toThrow("compression");
		expect(() => readZip(makeZip([{ name: "x", data: "abc" }]))[0].read(2)).toThrow("too big");
		// A file that unpacks to more than it claims (a "zip bomb") is stopped.
		expect(() => readZip(makeZip([{ name: "x", data: "a".repeat(5000), size: 10 }]))[0].read()).toThrow();
		const big = makeZip([{ name: "x", data: "a" }]);
		big.writeUInt16LE(0xffff, big.length - 22 + 10);
		expect(() => readZip(big)).toThrow("too big");
		// Two files, the second's local header damaged.
		const two = makeZip([{ name: "a", data: "1", store: true }, { name: "b", data: "2", store: true }]);
		two.writeUInt32LE(0, 32);
		expect(() => readZip(two)[1].read()).toThrow("damaged");
	});
});

describe("saved places", () => {
	test("coordinates and names from Google Maps links", () => {
		expect(places.coordsFromMapsUrl("https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x1!3d64.1417!4d-21.9266")).toEqual({ lat: 64.1417, lon: -21.9266 });
		expect(places.coordsFromMapsUrl("https://www.google.com/maps/place/X/@35.01,135.76,12z")).toEqual({ lat: 35.01, lon: 135.76 });
		expect(places.coordsFromMapsUrl("https://maps.google.com/?q=38.7,-9.1")).toEqual({ lat: 38.7, lon: -9.1 });
		expect(places.coordsFromMapsUrl("https://www.google.com/maps/search/-33.92,+18.42")).toEqual({ lat: -33.92, lon: 18.42 });
		expect(places.coordsFromMapsUrl("https://maps.google.com/?cid=123")).toBeNull();
		expect(places.coordsFromMapsUrl("https://maps.google.com/?q=0,0")).toBeNull();
		expect(places.coordsFromMapsUrl("https://maps.google.com/?q=95,10")).toBeNull();
		expect(places.coordsFromMapsUrl("%E0%A4%A")).toBeNull();
		expect(places.coordsFromMapsUrl(undefined)).toBeNull();
		expect(places.nameFromMapsUrl("https://www.google.com/maps/place/Torre+de+Bel%C3%A9m/data=!4m2")).toBe("Torre de Belém");
		expect(places.nameFromMapsUrl("https://maps.google.com/?cid=1")).toBe("");
	});

	test("addresses", () => {
		expect(places.placeFromAddress("Rua Augusta 24, 1100-053 Lisboa, Portugal", geo)).toMatchObject({ city: "Lisbon", country: "PT" });
		expect(places.placeFromAddress("68 Fukakusa, Fushimi Ward, Kyoto, 612-0882, Japan", geo, "JP")).toMatchObject({ city: "Kyoto", country: "JP" });
		expect(places.placeFromAddress("1 Main St, Nowhereville, Portugal", geo)).toEqual({ city: "", country: "PT" });
		expect(places.placeFromAddress("Some street, Atlantis", geo)).toBeNull();
		expect(places.placeFromAddress("", geo)).toBeNull();
		expect(places.placeFromAddress("Rua X, Porto", geo, "PT")).toMatchObject({ city: "Porto" });
	});

	test("coordinates far from any town give the country only", () => {
		expect(places.placeFromCoords(64.6, -17.5, geo)).toEqual({ city: "", country: "IS", far: true });
		expect(places.placeFromCoords(0, -30, geo)).toBeNull();
		expect(places.placeFromCoords(0, -30, geo, "PT")).toEqual({ city: "", country: "PT", far: true });
	});

	test("KML from My Maps: points, lines, entities, skipped items", () => {
		const r = places.placesFromKml(fs.readFileSync(path.join(FIX, "mymap.kml"), "utf8"), geo);
		expect(r.places.map((p) => [p.name, p.where.city])).toEqual([["Colosseum", "Rome"], ["Uffizi & friends", "Florence"], ["Drive along the coast", "La Spezia"]]);
		expect(r.places[0].note).toBe("Amazing & huge");
		expect(places.placesFromKml("<kml><Placemark><name>x</name><description>caf&amp;#233; &amp;#x41; &amp;bogus; &amp;#0;</description><Point><coordinates>12.49,41.89</coordinates></Point></Placemark></kml>", geo).places[0].note).toBe("café A &bogus; &#0;");
		expect(r.skipped).toBe(2);
		expect(() => places.placesFromKml("<html><body>hi</body></html>", geo)).toThrow("doesn't look like a KML");
		expect(() => places.placesFromKml("<kml><Placemark><name>x</name></kml", geo)).toThrow("couldn't be read");
		expect(places.placesFromKml("<kml><Placemark><name><![CDATA[Odd]]></name><Point><coordinates>abc</coordinates></Point></Placemark></kml>", geo).skipped).toBe(1);
	});

	test("one draft per city, with place names as the note", () => {
		const drafts = places.draftsFromPlaces([
			{ name: "A", note: "", where: { city: "Lisbon", country: "PT" } },
			{ name: "B", note: "x", where: { city: "Lisbon", country: "PT" } },
			{ name: "C", note: "", where: { city: "Lisbon", country: "PT" } },
			{ name: "D", note: "", where: { city: "Lisbon", country: "PT" } },
			{ name: "Lisbon", note: "", where: { city: "Lisbon", country: "PT" } },
			{ name: "Highlands", note: "", where: { city: "", country: "IS", far: true } },
			{ name: "Lost", note: "", where: null }
		]);
		expect(drafts.map((d) => [d.city, d.country, d.note, d.places])).toEqual([
			["", "IS", "Highlands", 1],
			["Lisbon", "PT", "A, B, C +1 more", 4],
			["", "", "Lost", 1]
		]);
		expect(drafts[0].hint).toMatch("country-level");
		expect(drafts[2].include).toBe(false);
	});
});

describe("timeline", () => {
	test("reads coordinates and times in every format", () => {
		expect(timeline.parseLatLng("38.7223°, -9.1393°")).toEqual({ lat: 38.7223, lon: -9.1393 });
		expect(timeline.parseLatLng("geo:38.7,-9.1")).toEqual({ lat: 38.7, lon: -9.1 });
		expect(timeline.parseLatLng({ latitudeE7: 387223000, longitudeE7: -91393000 })).toEqual({ lat: 38.7223, lon: -9.1393 });
		expect(timeline.parseLatLng({ latLng: "1°, 2°" })).toEqual({ lat: 1, lon: 2 });
		expect(timeline.parseLatLng({ lat: 1, lng: 2 })).toEqual({ lat: 1, lon: 2 });
		expect(timeline.parseLatLng({ other: 1 })).toBeNull();
		expect(timeline.parseLatLng("0°, 0°")).toBeNull();
		expect(timeline.parseLatLng("nonsense")).toBeNull();
		expect(timeline.parseLatLng(null)).toBeNull();

		expect(timeline.parseTime("2025-03-01T23:30:00.000-05:00").day).toBe("2025-03-01");
		expect(timeline.parseTime("2025-03-01T23:30:00Z").day).toBe("2025-03-01");
		expect(timeline.parseTime("2025-03-01T23:30:00Z", 60).day).toBe("2025-03-02");
		expect(timeline.parseTime("1573225200000").day).toBe("2019-11-08");
		expect(timeline.parseTime(1573225200000).ms).toBe(1573225200000);
		expect(timeline.parseTime("nope")).toBeNull();
		expect(timeline.parseTime("")).toBeNull();
		expect(timeline.daysBetween("2025-02-27", "2025-03-02")).toEqual(["2025-02-27", "2025-02-28", "2025-03-01", "2025-03-02"]);
	});

	test("phone export: trips by city and month, home and layovers handled", () => {
		const data = JSON.parse(fs.readFileSync(path.join(FIX, "timeline-phone.json"), "utf8"));
		const { visits, format } = timeline.visitsFromTimeline(data);
		expect(format).toBe("phone");
		const r = timeline.draftsFromVisits(visits, { geo, home: BOSTON });
		expect(summary(r.drafts)).toEqual(["-Frankfurt am Main|DE|2025-03", "+Lisbon|PT|2025-03", "+Sintra|PT|2025-03", "+Kyoto|JP|2024-10"]);
		const lisbon = r.drafts.find((d) => d.city === "Lisbon");
		expect(lisbon.days).toBe("4"); // 2, 3, 4 and 5 March
		expect(lisbon.hours).toBeCloseTo(72.2, 1); // the nested visit isn't counted twice
		expect(r.drafts[0].hint).toMatch("Short stop (1.5 h)");
		expect(r.ignoredAtHome).toBe(2);
		expect(r.homeGuessed).toBe(false);
	});

	test("home radius can be changed, and home is guessed when the config has none", () => {
		const { visits } = timeline.visitsFromTimeline(JSON.parse(fs.readFileSync(path.join(FIX, "timeline-phone.json"), "utf8")));
		const wide = timeline.draftsFromVisits(visits, { geo, home: { lat: 38.72, lon: -9.14 }, homeRadiusKm: 40 });
		// With home in Lisbon, the 2-hour stop at Boston's airport becomes a trip; the HOME-tagged visit doesn't.
		expect(summary(wide.drafts)).toEqual(["+Boston|US|2025-03", "-Frankfurt am Main|DE|2025-03", "+Kyoto|JP|2024-10"]);
		const guessed = timeline.draftsFromVisits(visits, { geo, homeRadiusKm: "nonsense" });
		// The most hours were in Lisbon, so this person's "home" is guessed as Lisbon.
		expect(guessed.home.name).toBe("Lisbon");
		expect(guessed.homeGuessed).toBe(true);
		expect(timeline.draftsFromVisits([], { geo })).toEqual({ drafts: [], home: null, homeGuessed: false, ignoredAtHome: 0 });
	});

	test("short stops of a few minutes are dropped; under an hour shows minutes", () => {
		const v = (start, end) => ({ lat: 41.9, lon: 12.5, start: timeline.parseTime(start), end: timeline.parseTime(end), type: "" });
		const r = timeline.draftsFromVisits([v("2024-05-01T10:00:00Z", "2024-05-01T10:45:00Z"), v("2024-06-01T10:00:00Z", "2024-06-01T10:10:00Z")], { geo, home: BOSTON });
		expect(r.drafts).toHaveLength(1);
		expect(r.drafts[0].hint).toMatch("45 min");
	});

	test("older iPhone export and old Takeout monthly files", () => {
		const ios = timeline.visitsFromTimeline(JSON.parse(fs.readFileSync(path.join(FIX, "timeline-ios.json"), "utf8")));
		expect(ios.format).toBe("phone-ios");
		expect(summary(timeline.draftsFromVisits(ios.visits, { geo, home: BOSTON }).drafts)).toEqual(["+Marrakesh|MA|2025-10", "+Lisbon|PT|2025-03"]);
		const old = timeline.visitsFromTimeline(JSON.parse(fs.readFileSync(path.join(FIX, "2019_NOVEMBER.json"), "utf8")));
		expect(old.format).toBe("takeout");
		expect(old.visits).toHaveLength(3);
		const r = timeline.draftsFromVisits(old.visits, { geo, home: BOSTON });
		expect(summary(r.drafts)).toEqual(["+Buenos Aires|AR|2019-11", "+Cusco|PE|2019-11"]);
		expect(timeline.visitsFromTimeline({ something: 1 }).format).toBeNull();
		expect(timeline.visitsFromTimeline({ timelineObjects: [null, { placeVisit: { location: {}, centerLatE7: 387223000, centerLngE7: -91393000, duration: { startTimestamp: "2020-01-01T00:00:00Z", endTimestamp: "2020-01-01T05:00:00Z" } } }] }).visits).toHaveLength(1);
	});
});

describe("parseUpload", () => {
	const opts = { geo, travelerNames: NAMES };

	test("a trips CSV with odd headers, unknown travelers and a column mapping", () => {
		const csv = Buffer.from("Place,Nation,When,Who,Extra\nLisboa,Portugal,March 2025,both,x\nKyoto,JP,2024-10,Bob,\n,Atlantis,someday,,\n");
		const r = parseUpload([{ name: "mine.csv", data: csv }], opts);
		expect(r.kind).toBe("trips");
		expect(r.csv.mapping).toEqual({ Place: "city", Nation: "country", When: "date", Who: "travelers", Extra: null });
		expect(r.drafts[0]).toMatchObject({ city: "Lisboa", country: "PT", date: "2025-03", travelers: NAMES, include: true });
		expect(r.drafts[1].hint).toBe("Not in your travelers list: Bob");
		expect(r.drafts[2]).toMatchObject({ country: "Atlantis", date: "someday" });

		const remapped = parseUpload([{ name: "mine.csv", data: csv }], { ...opts, mapping: { Extra: "note", Who: "" } });
		expect(remapped.csv.mapping.Extra).toBe("note");
		expect(remapped.csv.mapping.Who).toBeNull();
		expect(remapped.csv.missing).toEqual(["travelers"]);
		expect(remapped.drafts[0]).toMatchObject({ note: "x", travelers: [] });
	});

	test("several CSVs are combined; trips JSON works too", () => {
		const a = Buffer.from("city,country,date,travelers\nLisbon,PT,2025-03,Alex\n");
		const b = Buffer.from("city,country,date,travelers\nPorto,PT,2025-03,Sam\n");
		const json = Buffer.from(JSON.stringify({ trips: [{ city: "Rome", country: "IT", date: "2022-09", travelers: ["Alex"] }] }));
		const r = parseUpload([{ name: "a.csv", data: a }, { name: "b.csv", data: b }, { name: "c.json", data: json }], opts);
		expect(r.drafts.map((d) => d.city)).toEqual(["Rome", "Lisbon", "Porto"]);
		expect(parseUpload([{ name: "noext", data: Buffer.from("[{\"city\":\"Rome\",\"country\":\"IT\"}]") }], opts).drafts[0].city).toBe("Rome");
		expect(draftsFromRecords([{ country: null, travelers: null }], NAMES, geo)[0]).toMatchObject({ country: "", travelers: [] });
	});

	test("timeline files, alone or several together", () => {
		const r = parseUpload([file("timeline-phone.json")], { ...opts, home: BOSTON });
		expect(r).toMatchObject({ kind: "timeline", label: "Google Maps Timeline", alsoFound: [], visits: 8, ignoredAtHome: 2, home: { name: "Boston", guessed: false } });
		const many = parseUpload([file("timeline-ios.json"), file("2019_NOVEMBER.json")], { ...opts, home: BOSTON, homeRadiusKm: 50 });
		expect(many.drafts.map((d) => d.city)).toEqual(["Marrakesh", "Lisbon", "Buenos Aires", "Cusco"]);
		const empty = parseUpload([{ name: "Timeline.json", data: Buffer.from("{\"semanticSegments\":[]}") }], opts);
		expect(empty.warnings).toContain("The Timeline file had no visits in it");
		expect(empty.home).toBeNull();
	});

	test("saved places from GeoJSON, CSV lists and KML; wish lists start unticked", () => {
		const r = parseUpload([file("Saved Places.json"), file("Want to go.csv"), file("Favorite places.csv"), file("mymap.kml")], opts);
		expect(r.kind).toBe("places");
		expect(r.places).toBe(12);
		expect(summary(r.drafts)).toEqual(["-Reykjavík|IS|", "+Florence|IT|", "+La Spezia|IT|", "+Rome|IT|", "+Kyoto|JP|", "+Lisbon|PT|", "-Cape Town|ZA|", "-?||", "-?||"]);
		expect(r.drafts[0].hint).toMatch("Want to go");
		expect(r.drafts.find((d) => d.city === "Lisbon").note).toBe("Torre de Belém, Pastelaria, Café, with a comma");
		expect(r.warnings).toEqual(["2 map items had no usable location and were skipped"]);
		expect(r.drafts.every((d) => d.date === "" && d.travelers.length === 0)).toBe(true);
	});

	test("KMZ and a whole Google Takeout zip", () => {
		const kml = fs.readFileSync(path.join(FIX, "mymap.kml"));
		const kmz = parseUpload([{ name: "Our trips.kmz", data: makeZip([{ name: "doc.kml", data: kml }, { name: "images/x.png", data: "png" }]) }], opts);
		expect(kmz.drafts.map((d) => d.city)).toEqual(["Florence", "La Spezia", "Rome"]);
		expect(kmz.warnings).toEqual(["2 map items had no usable location and were skipped"]);

		const takeout = makeZip([
			{ name: "Takeout/Location History/Semantic Location History/2019/2019_NOVEMBER.json", data: fs.readFileSync(path.join(FIX, "2019_NOVEMBER.json")) },
			{ name: "Takeout/Location History/Records.json", data: "{\"locations\":[]}" },
			{ name: "Takeout/Maps (your places)/Saved Places.json", data: fs.readFileSync(path.join(FIX, "Saved Places.json")) },
			{ name: "Takeout/Saved/Want to go.csv", data: fs.readFileSync(path.join(FIX, "Want to go.csv")) },
			{ name: "Takeout/Maps/My labeled places/Labeled places.json", data: "{}" },
			{ name: "Takeout/archive_browser.html", data: "<html></html>" }
		]);
		const t = parseUpload([{ name: "takeout-20261123.zip", data: takeout }], { ...opts, home: BOSTON });
		expect(t.kind).toBe("timeline");
		expect(t.alsoFound).toEqual(["places"]);
		expect(t.warnings[0]).toMatch("Records.json is raw location points");
		const p = parseUpload([{ name: "takeout.zip", data: takeout }], { ...opts, want: "places" });
		expect(p.kind).toBe("places");
		expect(p.alsoFound).toEqual(["timeline"]);

		expect(() => parseUpload([{ name: "empty.zip", data: makeZip([{ name: "Takeout/archive_browser.html", data: "x" }]) }], opts)).toThrow("has no Google Maps or trip files inside");
		expect(() => parseUpload([{ name: "x.kmz", data: makeZip([{ name: "a.png", data: "x" }]) }], opts)).toThrow("has no map inside");
	});

	test("files it can't use are explained", () => {
		expect(() => parseUpload([], opts)).toThrow("No file was received");
		expect(() => parseUpload([{ name: "x.json", data: Buffer.from("{bad") }], opts)).toThrow("isn't valid JSON");
		expect(() => parseUpload([{ name: "x.json", data: Buffer.from("{\"hello\":1}") }], opts)).toThrow("isn't a file this module knows");
		expect(() => parseUpload([{ name: "x.csv", data: Buffer.from("") }], opts)).toThrow("is empty");
		expect(() => parseUpload([{ name: "x.kml", data: Buffer.from("<kml><Placemark>") }], opts)).toThrow("couldn't be read");
		// Text that only looks like JSON falls back to CSV.
		expect(parseUpload([{ name: "notes", data: Buffer.from("{city},country\nRome,IT\n") }], opts).kind).toBe("trips");
	});
});

describe("upload packing", () => {
	test("round trip, including names with accents", () => {
		const files = [{ name: "Saved Places.json", data: Buffer.from("{}") }, { name: "Café.csv", data: Buffer.from("a,b") }];
		const back = unpackFiles(packFiles(files));
		expect(back.map((f) => [f.name, f.data.toString()])).toEqual([["Saved Places.json", "{}"], ["Café.csv", "a,b"]]);
		expect(unpackFiles(Buffer.alloc(0))).toEqual([]);
	});

	test("cut-off uploads are refused", () => {
		const packed = packFiles([{ name: "a.csv", data: Buffer.from("hello") }]);
		expect(() => unpackFiles(packed.subarray(0, packed.length - 2))).toThrow("cut off");
		expect(() => unpackFiles(packed.subarray(0, 2))).toThrow("cut off");
		const huge = Buffer.alloc(8);
		huge.writeUInt32LE(5000, 0);
		expect(() => unpackFiles(huge)).toThrow("cut off");
	});
});
