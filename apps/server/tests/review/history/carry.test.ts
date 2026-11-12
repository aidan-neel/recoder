import { expect, test } from 'bun:test';
import type { Finding } from '@recoder/shared';
import { carryHistory } from '../../../src/review/history/carry';
import { diffFiles } from '../../../src/review/history/code-change';
import {
	CRASH_CLAIM,
	FIRST_PUSH,
	REVERTED_PUSH,
	STALE_CLAIM,
	TOUCHING_PUSH,
	UNRELATED_PUSH,
	cacheFinding
} from './fixtures';

const DECIDED = { state: 'dismissed', reason: 'not-worth-fixing', decidedAt: '2026-11-01T00:00:00.000Z' } as const;

const earlier = cacheFinding('old-stale', STALE_CLAIM, { decision: DECIDED });
const previous = { headSha: 'sha-1', findings: [earlier], diff: diffFiles(FIRST_PUSH) };

/** The review at `sha-2` of a push with `diff`, raising `findings` and hiding `unconfirmed`. */
function pushed(diff: string, findings: Finding[], unconfirmed: Finding[] = []) {
	return { headSha: 'sha-2', findings, unconfirmed, diff: diffFiles(diff) };
}

test('an unrelated commit carries a raised finding forward with its id and decision, so it is not posted again', () => {
	const raised = cacheFinding('fresh', STALE_CLAIM, { line: 22 });

	const { findings, resolved } = carryHistory(previous, pushed(UNRELATED_PUSH, [raised]));

	expect(findings).toMatchObject([
		{ id: 'old-stale', line: 22, decision: DECIDED, history: { firstSeenSha: 'sha-1', state: 'carried' } }
	]);

	expect(resolved).toEqual([]);
});

test('a finding the new review did not raise is carried and moves with its untouched code', () => {
	const { findings } = carryHistory(previous, pushed(UNRELATED_PUSH, []));

	expect(findings).toMatchObject([{ id: 'old-stale', line: 22, decision: DECIDED, history: { state: 'carried' } }]);
});

test('a finding raised again after a commit touched its code is rechecked and open again', () => {
	const raised = cacheFinding('fresh', STALE_CLAIM, { line: 13 });

	const [rechecked] = carryHistory(previous, pushed(TOUCHING_PUSH, [raised])).findings;

	expect(rechecked).toMatchObject({
		id: 'old-stale',
		line: 13,
		history: { firstSeenSha: 'sha-1', state: 'rechecked' }
	});

	expect(rechecked?.decision).toBeUndefined();
});

test('a verifier refuting the defect after a commit touched its code resolves it with the verifier reason', () => {
	const refuted = cacheFinding('hidden', STALE_CLAIM, {
		line: 13,
		verification: { status: 'unverified', outcome: 'refuted', reason: 'the new guard reloads expired entries' }
	});

	const { findings, resolved } = carryHistory(previous, pushed(TOUCHING_PUSH, [], [refuted]));

	expect(findings).toEqual([]);

	expect(resolved).toEqual([
		{ finding: earlier, reason: 'the new guard reloads expired entries', resolvedAtSha: 'sha-2' }
	]);
});

test('a touched finding nothing new speaks to stays, carried where it was', () => {
	const { findings, resolved } = carryHistory(previous, pushed(TOUCHING_PUSH, []));

	expect(findings).toMatchObject([{ id: 'old-stale', line: 12, decision: DECIDED, history: { state: 'carried' } }]);
	expect(resolved).toEqual([]);
});

test('a finding whose file the pull request no longer changes is resolved', () => {
	const { findings, resolved } = carryHistory(previous, pushed(REVERTED_PUSH, []));

	expect(findings).toEqual([]);
	expect(resolved).toMatchObject([{ finding: { id: 'old-stale' }, resolvedAtSha: 'sha-2' }]);
});

test('a different defect in the same symbol is new at this head and leaves the earlier one carried', () => {
	const crash = cacheFinding('crash', CRASH_CLAIM, { line: 22 });

	const { findings } = carryHistory(previous, pushed(UNRELATED_PUSH, [crash]));

	expect(findings.map((finding) => [finding.id, finding.history])).toEqual([
		['crash', { firstSeenSha: 'sha-2', state: 'new' }],
		['old-stale', { firstSeenSha: 'sha-1', state: 'carried' }]
	]);
});
