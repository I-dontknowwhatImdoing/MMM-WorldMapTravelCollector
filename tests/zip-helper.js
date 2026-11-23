"use strict";

const zlib = require("node:zlib");

/**
 * Build a small zip archive in memory for tests (stored or deflated entries).
 * @param {Array<{name: string, data: Buffer|string, store?: boolean}>} files
 */
function makeZip (files) {
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const f of files) {
		const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
		const body = f.store ? data : zlib.deflateRawSync(data);
		const name = Buffer.from(f.name, "utf8");
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x800, 6);
		local.writeUInt16LE(f.store ? 0 : 8, 8);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE((f.flags || 0) | 0x800, 8);
		central.writeUInt16LE(f.method ?? (f.store ? 0 : 8), 10);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(f.size ?? data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, name, body);
		centrals.push(central, name);
		offset += 30 + name.length + body.length;
	}
	const cd = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(files.length, 8);
	end.writeUInt16LE(files.length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, cd, end]);
}

module.exports = { makeZip };
