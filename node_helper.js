"use strict";

const path = require("node:path");
const NodeHelper = require("node_helper");
const Log = require("logger");
const { loadGeoData } = require("./lib/geodata");
const { createTripService } = require("./lib/service");
const { createEditorHandler } = require("./lib/editor-server");
const { editorLink, qrPath } = require("./lib/editor-link");

const HOURLY = 60 * 60 * 1000;

/** What to do when phones can't reach the editor (the mirror's card says it in fewer words). */
const UNREACHABLE = {
	address: "MagicMirror only answers the mirror itself (address: \"localhost\"), so phones can't open the trip editor yet. Set address: \"0.0.0.0\" and add your home network to ipWhitelist in config.js; see \"Opening the editor from your phone\" in this module's README.",
	whitelist: "MagicMirror's ipWhitelist only lets the mirror itself in, so phones can't open the trip editor yet. Add your home network (e.g. \"192.168.1.0/24\") to ipWhitelist in config.js; see \"Opening the editor from your phone\" in this module's README.",
	network: "The mirror has no network address right now, so phones can't open the trip editor."
};

module.exports = NodeHelper.create({
	start () {
		this.instances = new Map();
		this.editorRoute = `/${this.name}`;
		if (this.expressApp) {
			const handler = createEditorHandler({
				getContext: () => this.editorContext(),
				logger: { warn: (m) => Log.warn(m) }
			});
			this.expressApp.use(this.editorRoute, (req, res) => handler(req, res));
			// MagicMirror's log already starts each line with the module's name.
			const link = this.editorLink();
			Log.info(`Trip editor: ${link.url || `http://<this mirror's address>:${(global.config && global.config.port) || 8080}${this.editorRoute}/`}`);
			if (!link.reachable) Log.warn(UNREACHABLE[link.reason]);
		}
	},

	/** The editor's address for phones, and whether MagicMirror lets them in (see lib/editor-link.js). */
	editorLink () {
		return editorLink({ mmConfig: global.config || {}, route: this.editorRoute });
	},

	/** The settings the web editor works with: the module instance started most recently. */
	editorContext () {
		const list = [...this.instances.values()];
		const latest = list[list.length - 1];
		return latest ? { config: latest.config, dataDir: latest.dataDir, geo: latest.geo, service: latest.service } : null;
	},

	/**
	 * This instance's entry in MagicMirror's own config file, found from its identifier
	 * ("module_<position in config.modules>_<module>"). The settings that guard the editor and the disk
	 * (editor, editorPin, dataDir) are taken from here, never from the browser's message: anyone who can
	 * reach MagicMirror's socket can send WMTC_INIT.
	 * @returns {object|null|undefined} the entry's config; null = no such entry; undefined = no MagicMirror config (preview, tests)
	 */
	trustedConfig (identifier) {
		const modules = global.config && Array.isArray(global.config.modules) ? global.config.modules : null;
		if (!modules) return undefined;
		const m = /^module_(\d+)_(.+)$/.exec(String(identifier));
		const entry = m ? modules[Number(m[1])] : null;
		if (!entry || entry.disabled === true || entry.module !== m[2] || String(entry.module).split("/").pop() !== this.name) return null;
		return entry.config && typeof entry.config === "object" ? entry.config : {};
	},

	socketNotificationReceived (notification, payload) {
		if (notification !== "WMTC_INIT" || !payload || !payload.identifier || !payload.config) return;
		const { identifier } = payload;
		const trusted = this.trustedConfig(identifier);
		if (trusted === null) {
			Log.warn(`Ignored a start request for ${String(identifier).slice(0, 80)}: it isn't in MagicMirror's config`);
			return;
		}
		const config = trusted ? { ...payload.config, editor: trusted.editor, editorPin: trusted.editorPin, editorHosts: trusted.editorHosts, dataDir: trusted.dataDir } : payload.config;
		this.stopInstance(identifier);

		const dataDir = config.dataDir ? path.resolve(this.path, config.dataDir) : path.join(this.path, "data");
		const send = (model) => this.sendSocketNotification("WMTC_DATA", { identifier, model });
		let service;
		let geo;
		try {
			geo = loadGeoData(path.join(this.path, "geo"));
			service = createTripService({
				dataDir,
				config,
				geo,
				onChange: send,
				logger: { warn: (m) => Log.warn(m), info: (m) => Log.info(m) }
			});
			send(service.load());
			service.watch();
		} catch (err) {
			Log.error(`Could not load trips: ${err.message}`);
			this.sendSocketNotification("WMTC_ERROR", { identifier, message: err.message });
			if (service) service.stop();
			return;
		}
		const timer = setInterval(() => service.refresh(), HOURLY);
		this.instances.set(identifier, { service, timer, config, dataDir, geo });
		if (this.expressApp && config.editor !== false) {
			// For the mirror's "Add trips from your phone" card (showEditorLink).
			const link = this.editorLink();
			const qr = link.url && link.reachable ? qrPath(link.url) : null;
			this.sendSocketNotification("WMTC_EDITOR", { identifier, editor: { ...link, qr } });
		}
	},

	stopInstance (identifier) {
		const existing = this.instances.get(identifier);
		if (!existing) return;
		existing.service.stop();
		clearInterval(existing.timer);
		this.instances.delete(identifier);
	},

	stop () {
		for (const id of [...this.instances.keys()]) this.stopInstance(id);
	}
});
