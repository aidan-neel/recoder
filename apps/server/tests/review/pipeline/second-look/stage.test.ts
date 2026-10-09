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

/** One stubbed call: the lens assignment or second look it serves, the model it ran on, and its opening message. */
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
 * Answers `TWO_UNIT_DIFF`: `unit-1/correctness` raises "possible miss",
 * verifiers confirm, a second look reports nothing after `secondLookMs`.
 * Records every call.
 */
function stubReview(secondLookMs = 0): Call[] {
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

		const findings = unit === 'unit-1/correctness' ? [finding('possible miss')] : [];

		return modelReply({ message: 'ok', ...NOTHING, findings });
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

test('each unit gets one residual pass on the second model, outside the subagent cap, told what the review raised with its own unit first', async () => {
	useTwoModels();
	process.env.RECODER_RESIDUAL = '1';

	const calls = stubReview();
	const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 0 });

	const residual = calls.filter(isSecondLook);
	const first = residual.find((call) => call.stage === 'residual-1')!;
	const second = residual.find((call) => call.stage === 'residual-2')!;

	expect([...new Set(residual.map((call) => call.stage))].sort()).toEqual(['residual-1', 'residual-2']);
	expect([...new Set(residual.map((call) => call.model))]).toEqual(['worker']);
	expect(first.task).toContain("Already raised in this review, this unit's files first (1):");
	expect(first.task).toContain('possible miss (src/a.ts:1)');
	expect(second.task).toContain("Already raised in this review, this unit's files first (1):");
	expect(second.task).toContain('possible miss (src/a.ts:1)');

	const lastLens = Math.max(...calls.map((call, index) => (call.stage.startsWith('unit-') ? index : -1)));
	const firstResidual = calls.findIndex(isSecondLook);

	expect(firstResidual).toBeGreaterThan(lastLens);

	expect(
		result.assignments
			.filter((record) => record.role === 'subagent')
			.map((record) => [record.id, record.status, record.model])
	).toEqual([
		['residual-1', 'done', 'worker'],
		['residual-2', 'done', 'worker']
	]);
});

test('a second-look call slower than the per-call deadline answers within its own longer one, with no call made again', async () => {
	const policy = REVIEW_POLICY as { perCallDeadlineMs: number; secondLookCallDeadlineMs: number };
	const saved = { ...policy };

	policy.perCallDeadlineMs = 150;
	policy.secondLookCallDeadlineMs = 5000;
	useTwoModels();
	process.env.RECODER_RESIDUAL = '1';

	try {
		const instant = stubReview();

		await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 0 });

		const slow = stubReview(400);
		const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 0 });

		const secondLooks = (calls: Call[]) =>
			calls
				.filter(isSecondLook)
				.map((call) => call.stage)
				.sort();

		expect(secondLooks(slow)).toEqual(secondLooks(instant));

		expect(residualsDone(result)).toBe(true);
	} finally {
		policy.perCallDeadlineMs = saved.perCallDeadlineMs;
		policy.secondLookCallDeadlineMs = saved.secondLookCallDeadlineMs;
	}
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

		const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null, subagentCap: 0 });

		expect(residualsDone(result)).toBe(true);
	} finally {
		Object.assign(policy, saved);
	}
});
