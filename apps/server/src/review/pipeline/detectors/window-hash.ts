/** Multiplier of the polynomial rolling hash (the FNV prime). */
const BASE = 0x01000193;

/**
 * The hash of every `width`-token window of `ids`, indexed by start, computed
 * in one pass with a rolling polynomial hash mod 2^32. Equal windows always
 * hash equal; callers compare tokens to rule out collisions.
 */
export function windowHashes(ids: number[], width: number): number[] {
	if (ids.length < width) return [];

	let power = 1;

	for (let k = 1; k < width; k++) power = Math.imul(power, BASE);

	let hash = 0;

	for (let k = 0; k < width; k++) hash = (Math.imul(hash, BASE) + ids[k]) >>> 0;

	const hashes = [hash];

	for (let start = 1; start + width <= ids.length; start++) {
		hash = (hash - Math.imul(ids[start - 1], power)) >>> 0;
		hash = (Math.imul(hash, BASE) + ids[start + width - 1]) >>> 0;
		hashes.push(hash);
	}

	return hashes;
}
