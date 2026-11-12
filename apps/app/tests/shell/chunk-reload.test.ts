import { describe, expect, test } from 'bun:test';

import { reloadDue, reloadForChunk, type ReloadDeps } from '../../src/lib/shell/chunk-reload';

/** A tab's session storage and reload, at the given time, counting reloads. */
function tab(now: number, saved = new Map<string, string>()) {
	const counts = { reloads: 0 };

	const deps: ReloadDeps = {
		storage: {
			getItem: (key) => saved.get(key) ?? null,
			setItem: (key, value) => void saved.set(key, value)
		},
		reload: () => {
			counts.reloads++;
		},
		now
	};

	return { deps, saved, counts };
}

/** The error Turbopack throws when a chunk fails to load. */
function lostChunk(): Error {
	const error = new Error('Failed to load chunk /_next/static/chunks/abc.js');

	error.name = 'ChunkLoadError';

	return error;
}

describe('reloadForChunk', () => {
	test('reloads once for a lost chunk, and not again for a second loss right after', () => {
		const first = tab(1_000_000);

		expect(reloadForChunk(lostChunk(), first.deps)).toBe(true);
		expect(first.counts.reloads).toBe(1);

		const after = tab(1_010_000, first.saved);

		expect(reloadDue(lostChunk(), after.deps)).toBe(false);
		expect(reloadForChunk(lostChunk(), after.deps)).toBe(false);
		expect(after.counts.reloads).toBe(0);
	});

	test('reloads again once the last reload is half a minute old', () => {
		const first = tab(1_000_000);

		reloadForChunk(lostChunk(), first.deps);

		const later = tab(1_030_000, first.saved);

		expect(reloadForChunk(lostChunk(), later.deps)).toBe(true);
		expect(later.counts.reloads).toBe(1);
	});

	test('leaves any other error to the error page', () => {
		const { deps, counts, saved } = tab(1_000_000);

		expect(reloadForChunk(new TypeError('Cannot read properties of undefined'), deps)).toBe(false);
		expect(reloadForChunk('Failed to load chunk', deps)).toBe(false);
		expect(counts.reloads).toBe(0);
		expect(saved.size).toBe(0);
	});

	test('does not reload when session storage is blocked, so a broken tab never loops', () => {
		const { deps, counts } = tab(1_000_000);

		deps.storage.setItem = () => {
			throw new Error('SecurityError');
		};

		expect(reloadForChunk(lostChunk(), deps)).toBe(false);
		expect(counts.reloads).toBe(0);
	});
});
