import { DEFAULT_TOKEN_BUDGET, type ReviewChatMessage } from '@recoder/shared';
import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview } from '../../../../src/review/pipeline/harness';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { partitionReviewers } from '../../../../src/review/pipeline/reviewers';
import { budgetLimits } from '../../../../src/review/session/review-policy';
import {
	NOTHING,
	TWO_REVIEWERS,
	TWO_UNIT_DIFF,
	confirmingVerifier,
	finding,
	isVerifier,
	messagesOf,
	modelReply,
	restoreAfterEach,
	stubFetch,
	stubModel,
	systemOf,
	unitOf,
	useTestModel
} from '../harness-fixtures';
import { restoreEnvAfterEach } from '../../../helpers/env';

restoreAfterEach();
restoreEnvAfterEach(['RECODER_REVIEW_VARIANT']);

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-variants-'));
});

const MISS = 'possible miss';

/** The reviewer assignments of a result as id and scope, the shape `partitionReviewers` plans. */
function plannedWork(assignments: { id: string; role: string; scope: unknown }[]) {
	return assignments.filter((record) => record.role === 'reviewer').map(({ id, scope }) => ({ id, scope }));
}

describe('with no variant', () => {
	test('the review plans exactly the current reviewers and makes no coordinator call', async () => {
		delete process.env.RECODER_REVIEW_VARIANT;
		useTestModel();

		const calls: string[] = [];

		stubModel(calls);

		const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null });

		const current = partitionReviewers(buildInventory(TWO_UNIT_DIFF, []), budgetLimits(DEFAULT_TOKEN_BUDGET));

		expect(plannedWork(result.assignments)).toEqual(current.map(({ id, scope }) => ({ id, scope })));
		expect(calls.filter((call) => call.includes('reviewer'))).toEqual(TWO_REVIEWERS);
		expect(calls).not.toContain('other');
	});
});

/** What a stubbed two-pass review sent: each reviewer's request bodies, and those sent once the first pass reported. */
interface TwoPasses {
	bodies: Map<string, string[]>;
	afterFirstPass: string[];
	/** Set by the review's `onCandidates` event once the first pass's finding is a candidate. */
	firstPassReported: boolean;
}

/**
 * Answers a review of `TWO_UNIT_DIFF`: the reviewers in `reporters` report the same miss on `src/a.ts` and every
 * verifier confirms. An independent reviewer keeps reading the diff until `firstPassReported` is set (or
 * `reviewer-1` answered with nothing), so some of its turns are built once the first pass's finding exists.
 */
function stubTwoPasses(reporters: string[]): TwoPasses {
	const seen: TwoPasses = { bodies: new Map(), afterFirstPass: [], firstPassReported: false };

	stubFetch((init) => {
		if (isVerifier(init)) return modelReply(confirmingVerifier(init));

		const unit = unitOf(init) ?? 'other';
		const body = String(init?.body);

		seen.bodies.set(unit, [...(seen.bodies.get(unit) ?? []), body]);

		if (unit.startsWith('independent-')) {
			if (seen.firstPassReported) seen.afterFirstPass.push(body);
			else return modelReply({ message: 'Reading.', actions: [{ action: 'readDiff', path: 'src/a.ts' }] });
		}

		const cited = /evidenceId=(ev_\d+)/.exec(body)?.[1];
		const findings = reporters.includes(unit) ? [finding(MISS, 'medium', cited ? [cited] : [])] : [];

		if (unit === 'reviewer-1' && !findings.length) seen.firstPassReported = true;

		return modelReply({ message: 'ok', ...NOTHING, examinedHunks: [], findings });
	});

	return seen;
}

/** Reviews `TWO_UNIT_DIFF` with `stubTwoPasses(reporters)`, telling the stub when the first pass has a candidate. */
async function reviewTwoPasses(reporters: string[]) {
	const seen = stubTwoPasses(reporters);

	const result = await runAdaptiveReview(
		{ diff: TWO_UNIT_DIFF, sandboxPath: null },
		{ onCandidates: (count) => (seen.firstPassReported ||= count > 0) }
	);

	return { seen, result };
}

describe('the independent pass', () => {
	beforeEach(() => {
		process.env.RECODER_REVIEW_VARIANT = 'independent-pass';
		useTestModel();
	});

	test('a second reviewer reads each slice with the same scope and lenses', async () => {
		const { result } = await reviewTwoPasses([]);

		const byId = new Map(result.assignments.map((record) => [record.id, record]));

		expect(byId.get('independent-reviewer-1')?.scope).toEqual(byId.get('reviewer-1')?.scope);
		expect(byId.get('independent-reviewer-2')?.scope).toEqual(byId.get('reviewer-2')?.scope);
		expect(byId.get('independent-reviewer-1')?.status).toBe('done');
	});

	test("no independent reviewer's request holds the first pass's findings", async () => {
		const { seen } = await reviewTwoPasses(['reviewer-1']);

		const independent = [...seen.bodies.entries()].filter(([unit]) => unit.startsWith('independent-'));

		expect(seen.afterFirstPass.length).toBeGreaterThan(0);
		expect(independent.flatMap(([, sent]) => sent).some((body) => body.includes(MISS))).toBe(false);
	});

	test('a miss both passes report is published once', async () => {
		const { result } = await reviewTwoPasses(['reviewer-1', 'independent-reviewer-1']);

		const reported = result.assignments.filter((record) => record.candidateCount === 1).map((record) => record.id);

		expect(reported).toEqual(['reviewer-1', 'independent-reviewer-1']);
		expect(result.findings.map((entry) => entry.title)).toEqual([MISS]);
	});

	test('a miss only the independent pass reports is still published', async () => {
		const { result } = await reviewTwoPasses(['independent-reviewer-1']);

		expect(result.findings.map((entry) => entry.title)).toEqual([MISS]);
	});
});

describe('the specialist tree', () => {
	/** Answers the coordinator with `coordination` and every other call with nothing, keeping the reviewers' unit ids. */
	function stubTree(coordination: unknown, units: string[]): void {
		stubFetch((init) => {
			if (systemOf(init).includes('Role: coordinator')) return modelReply(coordination);
			if (isVerifier(init)) return modelReply(confirmingVerifier(init));

			const unit = unitOf(init);

			if (unit) units.push(unit);

			return modelReply({ message: 'ok', ...NOTHING, examinedHunks: [] });
		});
	}

	/** Reviews `TWO_UNIT_DIFF` and returns the ids of the reviewers it ran. */
	async function reviewersOfTree(): Promise<string[]> {
		const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null });

		return result.assignments.filter((record) => record.role === 'reviewer').map((record) => record.id);
	}

	beforeEach(() => {
		process.env.RECODER_REVIEW_VARIANT = 'specialist-tree';
		useTestModel();
	});

	test('specialists replace the slice reviewers and an omitted one runs nowhere', async () => {
		const units: string[] = [];

		stubTree({ dispatches: [], omitted: [{ specialist: 'performance', reason: 'no loops' }] }, units);

		const reviewers = await reviewersOfTree();

		expect(reviewers).toContain('specialist-correctness');
		expect(reviewers).not.toContain('specialist-performance');
		expect(reviewers.some((id) => id.startsWith('reviewer-'))).toBe(false);
		expect([...new Set(units)].sort()).toEqual([...reviewers].sort());
	});

	test('a coordinator reply that is not a plan keeps every specialist that fits', async () => {
		stubTree({ message: 'No issues', findings: [] }, []);

		expect(await reviewersOfTree()).toContain('specialist-performance');
	});

	test("the coordinator's decisions and the tasks it left unassigned are recorded in the conversation", async () => {
		const messages: Omit<ReviewChatMessage, 'at' | 'from'>[] = [];

		stubTree({ dispatches: [], omitted: [{ specialist: 'performance', reason: 'no loops' }] }, []);

		await runAdaptiveReview(
			{ diff: TWO_UNIT_DIFF, sandboxPath: null },
			{ onMessage: (message) => messages.push(message) }
		);

		const plan = messages.find((message) => message.id === 'message_specialist_plan')?.text ?? '';

		expect(plan).toContain('performance: omitted. The coordinator omitted it: no loops.');
		expect(plan).toContain('performance does not read reviewer-1');
	});

	test('the coordinator sees every slice the baseline would review', async () => {
		const seen: string[] = [];

		stubFetch((init) => {
			if (!systemOf(init).includes('Role: coordinator'))
				return modelReply({ message: 'ok', ...NOTHING, examinedHunks: [] });

			seen.push(String(messagesOf(init)[1]?.content ?? ''));

			return modelReply({ dispatches: [], omitted: [] });
		});

		await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null });

		expect(seen).toHaveLength(1);
		expect(seen[0]).toContain('reviewer-1');
		expect(seen[0]).toContain('reviewer-2');
	});
});
