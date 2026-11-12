import { expect, test } from 'bun:test';
import type { Finding } from '@recoder/shared';
import { carryHistory } from '../../../src/review/history/carry';
import { diffFiles } from '../../../src/review/history/code-change';
import {
	CRASH_CLAIM,
	FIRST_PUSH,
	LIMIT_GUARD_PUSH,
	PAGE_PUSH,
	REVERTED_PUSH,
	STALE_CLAIM,
	TOUCHING_PUSH,
	UNRELATED_PUSH,
	cacheFinding,
	negativeArgumentFinding
} from './fixtures';

const DECIDED = { state: 'dismissed', reason: 'not-worth-fixing', decidedAt: '2026-11-01T00:00:00.000Z' } as const;

const earlier = cacheFinding('old-stale', STALE_CLAIM, { decision: DECIDED });
const previous = { headSha: 'sha-1', findings: [earlier], diff: diffFiles(FIRST_PUSH) };

/** The review at `sha-2` of a push with `diff`, raising `findings` and hiding `unconfirmed`, with no topic quieted. */
function pushed(diff: string, findings: Finding[], unconfirmed: Finding[] = []) {
	return { headSha: 'sha-2', findings, unconfirmed, diff: diffFiles(diff), quietedTopics: new Set<string>() };
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

test('refuting one argument check resolves only that defect and keeps the same check on another argument', () => {
	const limit = negativeArgumentFinding('old-limit', 'limit');
	const offset = negativeArgumentFinding('old-offset', 'offset');
	const paged = { headSha: 'sha-1', findings: [limit, offset], diff: diffFiles(PAGE_PUSH) };

	const refuted = negativeArgumentFinding('hidden', 'limit', {
		line: 3,
		verification: { status: 'unverified', outcome: 'refuted', reason: 'a negative limit now throws' }
	});

	const { findings, resolved } = carryHistory(paged, pushed(LIMIT_GUARD_PUSH, [], [refuted]));

	expect(resolved.map((entry) => entry.finding.id)).toEqual(['old-limit']);
	expect(findings.map((finding) => finding.id)).toEqual(['old-offset']);
});

const QUIET_TOPIC = { id: 'category:correctness', label: 'Correctness' };

/** The earlier review holding one finding of `QUIET_TOPIC`, quieted when it was raised, with `overrides`. */
function quietedBefore(overrides: Partial<Finding> = {}) {
	const finding = cacheFinding('old-quiet', STALE_CLAIM, { topic: { ...QUIET_TOPIC, quieted: true }, ...overrides });

	return { headSha: 'sha-1', findings: [finding], diff: diffFiles(FIRST_PUSH) };
}

test('a carried finding quieted before is shown when no person approved quieting its topic now', () => {
	const [carried] = carryHistory(quietedBefore(), pushed(UNRELATED_PUSH, [])).findings;

	expect(carried?.topic).toEqual(QUIET_TOPIC);
});

test('a carried finding is quieted when a person approved quieting its topic', () => {
	const next = { ...pushed(UNRELATED_PUSH, []), quietedTopics: new Set([QUIET_TOPIC.id]) };

	const [carried] = carryHistory(quietedBefore({ topic: QUIET_TOPIC }), next).findings;

	expect(carried?.topic).toEqual({ ...QUIET_TOPIC, quieted: true });
});

test('a carried finding a run proved is shown even when its topic is approved for quieting', () => {
	const next = { ...pushed(UNRELATED_PUSH, []), quietedTopics: new Set([QUIET_TOPIC.id]) };
	const proven = quietedBefore({ verification: { status: 'verified', method: 'run', reason: 'the test fails' } });

	const [carried] = carryHistory(proven, next).findings;

	expect(carried?.topic).toEqual(QUIET_TOPIC);
});
