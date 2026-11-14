import { createHash, timingSafeEqual } from 'node:crypto';

/** Compares two secrets in constant time whatever their lengths, by comparing their digests. */
export function sameSecret(secret: string, candidate: string | undefined): boolean {
	const digest = (value: string) => createHash('sha256').update(value).digest();

	return candidate !== undefined && timingSafeEqual(digest(secret), digest(candidate));
}
