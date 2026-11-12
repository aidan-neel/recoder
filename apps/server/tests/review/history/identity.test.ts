import { expect, test } from 'bun:test';
import { diffFiles } from '../../../src/review/history/code-change';
import { defectIdentity, sameDefect } from '../../../src/review/history/identity';
import { CRASH_CLAIM, FIRST_PUSH, STALE_CLAIM, UNRELATED_PUSH, cacheFinding } from './fixtures';

const first = diffFiles(FIRST_PUSH);
const later = diffFiles(UNRELATED_PUSH);

test('a defect keeps its identity when its line moves', () => {
	const before = defectIdentity(cacheFinding('a', STALE_CLAIM), first);
	const after = defectIdentity(cacheFinding('b', STALE_CLAIM, { line: 22 }), later);

	expect(sameDefect(before, after)).toBe(true);
});

test('a defect keeps its identity when it is filed under another category', () => {
	const before = defectIdentity(cacheFinding('a', STALE_CLAIM), first);

	const after = defectIdentity(
		cacheFinding('b', STALE_CLAIM, { category: 'readability', message: `[readability] ${STALE_CLAIM.consequence}` }),
		first
	);

	expect(sameDefect(before, after)).toBe(true);
});

test('two different defects in one symbol keep separate identities', () => {
	const stale = defectIdentity(cacheFinding('a', STALE_CLAIM), first);
	const crash = defectIdentity(cacheFinding('b', CRASH_CLAIM), first);

	expect(sameDefect(stale, crash)).toBe(false);
});
