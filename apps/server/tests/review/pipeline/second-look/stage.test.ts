import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview } from '../../../../src/review/pipeline/harness';
import { REVIEW_POLICY } from '../../../../src/review/session/review-policy';
import {
	NOTHING,
	TWO_UNIT_DIFF,
	confirmingVerifier,
	finding,
	isVerifier,
	messagesOf,
	modelReply,
	restoreAfterEach,
	systemOf,
	unitOf,
	useTwoModels
} from '../harness-fixtures';

restoreAfterEach();

const FLAGS = ['RECODER_RESIDUAL', 'RECODER_CONTRACT_CHECKS'] as const;
const saved = Object.fromEntries(FLAGS.map((name) => [name, process.env[name]]));
const dataDir = process.env.RECODER_DATA_DIR;

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-second-look-'));
});

afterEach(() => {
	for (const name of FLAGS) {
		if (saved[name] === undefined) delete process.env[name];
		else process.env[name] = saved[name];
	}

	if (dataDir === undefined) delete process.env.RECODER_DATA_DIR;
	else process.env.RECODER_DATA_DIR = dataDir;
});

/** One stubbed call: the reviewer or second look it serves, the model it ran on, and its opening message. */
interface Call {
	stage: string;
	model: string;
	task: string;
}

/** Resolves after `ms`, or rejects as soon as `signal` aborts. */
function wait(ms: number, signal?: AbortSignal | null): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(resolve, ms);

		signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			reject(signal.reason);
		});
	});
}

/**
 * Answers `TWO_UNIT_DIFF`: `reviewer-1` raises "possible miss",
 * verifiers confirm, `reviewer-1` asks for `asks` subagents, a second look reports
 * nothing after `secondLookMs`.
 * Records every call.
 */
function stubReview(secondLookMs = 0, asks = 0): Call[] {
	const calls: Call[] = [];

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const task = String(messagesOf(init)[1]?.content ?? '');
		const model = String(JSON.parse(String(init?.body)).model);
		const secondLook = systemOf(init).includes('Role: second-look reviewer');
		const unit = unitOf(init);

		if (isVerifier(init)) {
			calls.push({ stage: 'verifier', model, task });

			return modelReply(confirmingVerifier(init));
		}

		calls.push({ stage: secondLook ? (/^Subagent (\S+):/m.exec(task)?.[1] ?? '?') : (unit ?? 'other'), model, task });

		if (secondLook && secondLookMs) await wait(secondLookMs, init?.signal);

		const findings = unit === 'reviewer-1' ? [finding('possible miss')] : [];

		const subagents = Array.from({ length: unit === 'reviewer-1' ? asks : 0 }, (_, index) => ({
			concern: `Ask ${index + 1}`,
			question: 'Is it handled?',
			scope: [{ path: 'src/a.ts', hunkIds: [] }],
			why: 'Needs a look across the repo.'
		}));

		return modelReply({ message: 'ok', ...NOTHING, findings, subagents });
	}) as unknown as typeof fetch;

	return calls;
}

/** Both residual passes of `TWO_UNIT_DIFF` ended with an answer, and no other subagent ran. */
function residualsDone(result: Awaited<ReturnType<typeof runAdaptiveReview>>): boolean {
	const subagents = result.assignments.filter((record) => record.role === 'subagent');

	return subagents.map((record) => `${record.id}=${record.status}`).join(' ') === 'residual-1=done residual-2=done';
}

const isSecondLook = (call: Call) => call.stage.startsWith('residual-') || call.stage.startsWith('contract-');

test('with the flags unset no second look runs, and the model calls match a review with them off', async () => {
	useTwoModels();

	for (const name of FLAGS) delete process.env[name];

	const unset = stubReview();

	await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 0 });

	for (const name of FLAGS) process.env[name] = '0';

	const off = stubReview();
	const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 0 });

	const stages = (calls: Call[]) => calls.map((call) => call.stage).sort();

	expect(stages(unset)).toEqual(stages(off));
	expect(unset.filter(isSecondLook)).toEqual([]);
	expect(result.assignments.every((record) => record.role === 'reviewer')).toBe(true);
});

test('each reviewer slice gets one residual pass on the second model, inside the subagent cap, told what the review raised with its own slice first', async () => {
	useTwoModels();
	process.env.RECODER_RESIDUAL = '1';

	const calls = stubReview();
	const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 3 });

	const residual = calls.filter(isSecondLook);
	const first = residual.find((call) => call.stage === 'residual-1')!;
	const second = residual.find((call) => call.stage === 'residual-2')!;

	expect([...new Set(residual.map((call) => call.stage))].sort()).toEqual(['residual-1', 'residual-2']);
	expect([...new Set(residual.map((call) => call.model))]).toEqual(['worker']);
	expect(first.task).toContain("Already raised in this review, this unit's files first (1):");
	expect(first.task).toContain('possible miss (src/a.ts:1)');
	expect(second.task).toContain("Already raised in this review, this unit's files first (1):");
	expect(second.task).toContain('possible miss (src/a.ts:1)');

	const lastReviewer = Math.max(...calls.map((call, index) => (call.stage.startsWith('reviewer-') ? index : -1)));
	const firstResidual = calls.findIndex(isSecondLook);

	expect(firstResidual).toBeGreaterThan(lastReviewer);

	expect(
		result.assignments
			.filter((record) => record.role === 'subagent')
			.map((record) => [record.id, record.status, record.model])
	).toEqual([
		['residual-1', 'done', 'worker'],
		['residual-2', 'done', 'worker']
	]);
});

test('second looks take only the room reviewers’ requests left under the subagent cap, and none runs with subagents off', async () => {
	useTwoModels();
	process.env.RECODER_RESIDUAL = '1';

	const ids = async (asks: number, subagentCap: 0 | 3) => {
		stubReview(0, asks);

		const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap });

		return result.assignments.filter((record) => record.role === 'subagent').map((record) => record.id);
	};

	expect(await ids(2, 3)).toEqual(['subagent-1', 'subagent-2', 'residual-1']);
	expect(await ids(3, 3)).toEqual(['subagent-1', 'subagent-2', 'subagent-3']);
	expect(await ids(0, 3)).toEqual(['residual-1', 'residual-2']);
	expect(await ids(2, 0)).toEqual([]);
});

test('a second look that starts after the review deadline has passed still runs its own clock and answers', async () => {
	const policy = REVIEW_POLICY as Record<string, number>;
	const names = ['analysisDeadlineMs', 'msPerAssignment', 'reserveMsForConsolidation', 'secondLookMaxMs'];
	const saved = Object.fromEntries(names.map((name) => [name, policy[name]]));

	policy.analysisDeadlineMs = 600;
	policy.msPerAssignment = 0;
	policy.reserveMsForConsolidation = 50;
	policy.secondLookMaxMs = 10_000;
	useTwoModels();
	process.env.RECODER_RESIDUAL = '1';

	try {
		stubReview(1200);

		const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 3 });

		expect(residualsDone(result)).toBe(true);
	} finally {
		Object.assign(policy, saved);
	}
});
