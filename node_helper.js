"use strict";

const path = require("node:path");
const NodeHelper = require("node_helper");
const Log = require("logger");
const { loadGeoData } = require("./lib/geodata");
const { createTripService } = require("./lib/service");
const { createEditorHandler } = require("./lib/editor-server");

const HOURLY = 60 * 60 * 1000;

module.exports = NodeHelper.create({
	start () {
		this.instances = new Map();
		this.editorRoute = `/${this.name}`;
		if (this.expressApp) {
			const handler = createEditorHandler({
				getContext: () => this.editorContext(),
				logger: { warn: (m) => Log.warn(`[${this.name}] ${m}`) }
			});
			this.expressApp.use(this.editorRoute, (req, res) => handler(req, res));
			Log.info(`[${this.name}] Trip editor at http://<this mirror's address>:${(global.config && global.config.port) || 8080}${this.editorRoute}/`);
		}
	},

	/** The settings the web editor works with: the module instance started most recently. */
	editorContext () {
		const list = [...this.instances.values()];
		const latest = list[list.length - 1];
		return latest ? { config: latest.config, dataDir: latest.dataDir, geo: latest.geo, service: latest.service } : null;
	},

	socketNotificationReceived (notification, payload) {
		if (notification !== "WMTC_INIT" || !payload || !payload.identifier) return;
		const { identifier, config } = payload;
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
				logger: { warn: (m) => Log.warn(`[${this.name}] ${m}`), info: (m) => Log.info(`[${this.name}] ${m}`) }
			});
			send(service.load());
			service.watch();
		} catch (err) {
			Log.error(`[${this.name}] Could not load trips: ${err.message}`);
			this.sendSocketNotification("WMTC_ERROR", { identifier, message: err.message });
			if (service) service.stop();
			return;
		}
		const timer = setInterval(() => service.refresh(), HOURLY);
		this.instances.set(identifier, { service, timer, config, dataDir, geo });
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
