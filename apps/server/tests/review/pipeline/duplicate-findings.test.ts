import { expect, test } from 'bun:test';
import {
	duplicateInput,
	duplicatePairs,
	mergeDuplicateVotes
} from '../../../src/review/pipeline/harness/duplicate-findings';
import { equivalentVote, provenFinding } from './duplicate-fixtures';

test('semantic restatements merge only for publication and retain the representative claim and its own proof', () => {
	const a = provenFinding('a');

	const b = {
		...provenFinding('b'),
		title: 'Calls after close violate the promise API',
		claim: {
			...a.claim!,
			trigger: 'a task is submitted after closing',
			consequence: 'An exception escapes synchronously'
		}
	};

	const findings = [a, b];
	const merged = mergeDuplicateVotes(findings, duplicatePairs(findings), { pairs: [equivalentVote('p0')] });

	expect(merged).toHaveLength(1);
	expect(merged[0].memberIds).toEqual(['a', 'b']);
	expect(merged[0].claim).toBe(a.claim);
	expect(merged[0].verification).toBe(a.verification);
	expect(merged[0].evidenceIds).toEqual(a.evidenceIds);
	expect(b.verification?.command).toBe('node b.js');
});

test('different overflow triggers keep their own proofs even when cause and consequence sound alike', () => {
	const a = provenFinding('d1', 'maxPending is zero while a running slot is free');
	const b = provenFinding('d2', 'drop-oldest evicts a pending task while all running slots are occupied');
	const findings = [a, b];

	expect(
		mergeDuplicateVotes(findings, duplicatePairs(findings), {
			pairs: [{ ...equivalentVote('p0'), sameTrigger: false }]
		})
	).toEqual(findings);
});

test('unknown missing repeated and malformed votes fail closed without losing findings', () => {
	const findings = [provenFinding('a'), provenFinding('b')];
	const pairs = duplicatePairs(findings);

	for (const raw of [
		null,
		{},
		{ pairs: [] },
		{ pairs: [equivalentVote('unknown')] },
		{ pairs: [equivalentVote('p0'), equivalentVote('p0')] },
		{ pairs: [{ ...equivalentVote('p0'), sameCause: 'true' }] }
	])
		expect(mergeDuplicateVotes(findings, pairs, raw)).toEqual(findings);
});

test('a report mentioning two defects cannot chain distinct findings through pairwise matches', () => {
	const findings = [provenFinding('a'), provenFinding('both'), provenFinding('b')];

	expect(
		mergeDuplicateVotes(findings, duplicatePairs(findings), {
			pairs: [equivalentVote('p0'), equivalentVote('p2')]
		}).map((finding) => finding.memberIds)
	).toEqual([['a', 'both'], ['b']]);
});

test('unproven detector and unrelated-location findings never receive a semantic merge', () => {
	const a = provenFinding('a');
	const b = provenFinding('b');

	for (const other of [
		{ ...b, verification: undefined },
		{ ...b, kind: 'quality' as const },
		{ ...b, file: 'other.js' },
		{ ...b, symbol: 'other', line: 200 },
		{ ...b, claim: undefined }
	])
		expect(duplicatePairs([a, other])).toEqual([]);
	expect(duplicatePairs([])).toEqual([]);
	expect(duplicateInput([a, b], duplicatePairs([a, b]))).toContain('node a.js');
	expect(duplicatePairs(Array.from({ length: 100 }, (_, i) => provenFinding(String(i))))).toHaveLength(64);
});
