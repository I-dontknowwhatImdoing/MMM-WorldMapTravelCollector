"use strict";

const path = require("node:path");
const NodeHelper = require("node_helper");
const Log = require("logger");
const { loadGeoData } = require("./lib/geodata");
const { createTripService } = require("./lib/service");

const HOURLY = 60 * 60 * 1000;

module.exports = NodeHelper.create({
	start () {
		this.instances = new Map();
	},

	socketNotificationReceived (notification, payload) {
		if (notification !== "WMTC_INIT" || !payload || !payload.identifier) return;
		const { identifier, config } = payload;
		this.stopInstance(identifier);

		const dataDir = config.dataDir ? path.resolve(this.path, config.dataDir) : path.join(this.path, "data");
		const send = (model) => this.sendSocketNotification("WMTC_DATA", { identifier, model });
		let service;
		try {
			service = createTripService({
				dataDir,
				config,
				geo: loadGeoData(path.join(this.path, "geo")),
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
		this.instances.set(identifier, { service, timer });
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
