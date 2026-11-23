"use strict";

const zlib = require("node:zlib");

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** True when the bytes start like a zip file (KMZ, Google Takeout). */
function isZip (buf) {
	return Buffer.isBuffer(buf) && buf.length >= 4 && buf.readUInt32LE(0) === LOCAL;
}

/**
 * List the files in a zip archive. Enough for KMZ and Google Takeout exports:
 * stored and deflated entries, no encryption, no zip64.
 * @param {Buffer} buf
 * @returns {Array<{name: string, size: number, read: (maxBytes?: number) => Buffer}>}
 */
function readZip (buf) {
	if (!isZip(buf)) throw new Error("This isn't a zip file");
	let eocd = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
		if (buf.readUInt32LE(i) === EOCD) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error("The zip file is damaged or incomplete");
	const count = buf.readUInt16LE(eocd + 10);
	let offset = buf.readUInt32LE(eocd + 16);
	if (offset === 0xffffffff || count === 0xffff) throw new Error("This zip file is too big. Unzip it and upload the files inside instead");
	const entries = [];
	for (let n = 0; n < count; n++) {
		if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CENTRAL) throw new Error("The zip file is damaged");
		const flags = buf.readUInt16LE(offset + 8);
		const method = buf.readUInt16LE(offset + 10);
		const compressedSize = buf.readUInt32LE(offset + 20);
		const size = buf.readUInt32LE(offset + 24);
		const nameLen = buf.readUInt16LE(offset + 28);
		const extraLen = buf.readUInt16LE(offset + 30);
		const commentLen = buf.readUInt16LE(offset + 32);
		const localOffset = buf.readUInt32LE(offset + 42);
		const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", offset + 46, offset + 46 + nameLen);
		offset += 46 + nameLen + extraLen + commentLen;
		if (name.endsWith("/")) continue;
		entries.push({
			name,
			size,
			read (maxBytes = 300 * 1024 * 1024) {
				if (flags & 0x1) throw new Error(`${name} is password-protected`);
				if (size > maxBytes) throw new Error(`${name} is too big to read`);
				if (buf.readUInt32LE(localOffset) !== LOCAL) throw new Error("The zip file is damaged");
				const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
				const data = buf.subarray(start, start + compressedSize);
				if (method === 0) return Buffer.from(data);
				if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: Math.max(size, 1) });
				throw new Error(`${name} uses a compression this module can't read`);
			}
		});
	}
	return entries;
}

module.exports = { isZip, readZip };
