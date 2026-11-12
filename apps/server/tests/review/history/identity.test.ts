import type { FindingClaim } from '@recoder/shared';
import { expect, test } from 'bun:test';
import { diffFiles } from '../../../src/review/history/code-change';
import { defectIdentity, sameDefect } from '../../../src/review/history/identity';
import {
	CRASH_CLAIM,
	FIRST_PUSH,
	PAGE_PUSH,
	STALE_CLAIM,
	UNRELATED_PUSH,
	cacheFinding,
	negativeArgumentFinding
} from './fixtures';

const first = diffFiles(FIRST_PUSH);
const later = diffFiles(UNRELATED_PUSH);

/** The claim of a missing check on `operand`, with a trigger that names the function it is in. */
function pageCallClaim(operand: 'limit' | 'offset'): FindingClaim {
	return {
		trigger: `page() is called with a negative ${operand}`,
		executionPath: [],
		consequence: 'the slice counts from the end and returns the wrong rows',
		violatedContract: 'page arguments are validated before use'
	};
}

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

test('the same missing check on two different arguments keeps separate identities', () => {
	const paged = diffFiles(PAGE_PUSH);
	const limit = defectIdentity(negativeArgumentFinding('a', 'limit'), paged);
	const offset = defectIdentity(negativeArgumentFinding('b', 'offset'), paged);

	expect(sameDefect(limit, offset)).toBe(false);
});

test('a defect outside any symbol keeps its identity when a later review words its trigger with other words of the same line', () => {
	const before = defectIdentity(cacheFinding('a', STALE_CLAIM, { symbol: undefined }), first);

	const reworded = defectIdentity(
		cacheFinding(
			'b',
			{ ...STALE_CLAIM, trigger: 'cache.get(key) finds an expired entry' },
			{ title: 'Stale cache entry returned', symbol: undefined }
		),
		first
	);

	expect(sameDefect(before, reworded)).toBe(true);
});

test('the same missing check on two arguments stays apart when both triggers name the function', () => {
	const paged = diffFiles(PAGE_PUSH);
	const limit = defectIdentity(negativeArgumentFinding('a', 'limit', { claim: pageCallClaim('limit') }), paged);
	const offset = defectIdentity(negativeArgumentFinding('b', 'offset', { claim: pageCallClaim('offset') }), paged);

	expect(sameDefect(limit, offset)).toBe(false);
});
