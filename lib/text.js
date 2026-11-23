"use strict";

/**
 * Normalize a place name for matching: case-, accent- and punctuation-insensitive.
 * "São Paulo" -> "sao paulo", "St. John's" -> "saint johns", "Ho-Chi-Minh" -> "ho chi minh"
 * @param {string} value
 * @returns {string}
 */
function normalizeName (value) {
	if (value === undefined || value === null) return "";
	return String(value)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/ß/g, "ss")
		.replace(/[ø]/g, "o")
		.replace(/[æ]/g, "ae")
		.replace(/[đ]/g, "d")
		.replace(/[ł]/g, "l")
		.replace(/['’`]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.replace(/\b(st|ste)\b/g, (m) => (m === "st" ? "saint" : "sainte"))
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Levenshtein edit distance, capped for speed.
 * @param {string} a
 * @param {string} b
 * @param {number} [max] stop early once the distance is known to exceed max
 * @returns {number}
 */
function editDistance (a, b, max = Infinity) {
	if (a === b) return 0;
	if (Math.abs(a.length - b.length) > max) return max + 1;
	let prev = new Array(b.length + 1);
	for (let j = 0; j <= b.length; j++) prev[j] = j;
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
			if (cur[j] < rowMin) rowMin = cur[j];
		}
		if (rowMin > max) return max + 1;
		prev = cur;
	}
	return prev[b.length];
}

module.exports = { normalizeName, editDistance };
