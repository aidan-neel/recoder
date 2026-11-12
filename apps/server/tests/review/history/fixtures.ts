import type { Finding, FindingClaim } from '@recoder/shared';

/** The hunk a finding sits in: a cache read that returns an expired entry. */
const READ_HUNK = [
	' export function read(key: string) {',
	'+\tconst entry = cache.get(key);',
	'+\treturn entry.value;',
	' }'
];

/** A one-file pull request diff holding `hunks`, each a start line on both sides and its lines. */
function diffOf(file: string, hunks: { start: number; lines: string[] }[]): string {
	const body = hunks.flatMap(({ start, lines }) => {
		const oldCount = lines.filter((line) => !line.startsWith('+')).length;
		const newCount = lines.filter((line) => !line.startsWith('-')).length;

		return [`@@ -${start},${oldCount} +${start},${newCount} @@`, ...lines];
	});

	return [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, ...body, ''].join('\n');
}

/** The pull request at its first push: the cache read at line 10. */
export const FIRST_PUSH = diffOf('src/cache.ts', [{ start: 10, lines: READ_HUNK }]);

/** A later push that only adds an import at the top, which moves the read down to line 20. */
export const UNRELATED_PUSH = diffOf('src/cache.ts', [
	{ start: 1, lines: ["+import { log } from './log';"] },
	{ start: 20, lines: READ_HUNK }
]);

/** A later push that adds a guard inside the read. */
export const TOUCHING_PUSH = diffOf('src/cache.ts', [
	{
		start: 10,
		lines: [
			' export function read(key: string) {',
			'+\tconst entry = cache.get(key);',
			'+\tif (!entry || entry.expired) return load(key);',
			'+\treturn entry.value;',
			' }'
		]
	}
]);

/** A later push that no longer changes the cache file at all. */
export const REVERTED_PUSH = diffOf('src/other.ts', [{ start: 1, lines: ['+export const other = 1;'] }]);

export const STALE_CLAIM: FindingClaim = {
	trigger: 'a read after the entry expired',
	executionPath: [],
	consequence: 'the caller gets the stale cached value',
	violatedContract: 'expired entries are never served'
};

export const CRASH_CLAIM: FindingClaim = {
	trigger: 'a read of a key that was never cached',
	executionPath: [],
	consequence: 'entry is undefined and reading value throws a TypeError',
	violatedContract: 'a cache miss falls back to loading the key'
};

/** A finding in `read` of the cache file, at `line`, with `claim`. */
export function cacheFinding(id: string, claim: FindingClaim, overrides: Partial<Finding> = {}): Finding {
	return {
		id,
		title: claim === STALE_CLAIM ? 'Expired entry is served' : 'Cache miss throws',
		file: 'src/cache.ts',
		line: 12,
		severity: 'warning',
		message: `[correctness] ${claim.consequence}`,
		category: 'correctness',
		symbol: 'read',
		claim,
		...overrides
	};
}
