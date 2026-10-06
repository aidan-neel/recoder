import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../../src/review/pipeline/harness';
import { REVIEW_POLICY } from '../../../../src/review/session/review-policy';
import {
	NOTHING,
	confirmingVerifier,
	finding,
	isVerifier,
	modelReply,
	obligationOf,
	restoreAfterEach,
	useTestModel
} from '../harness-fixtures';
import { ANSWER, investigatorReply, isolateEachTest, riskyReview, stubInvestigations } from './fixtures';

restoreAfterEach();
isolateEachTest();

/** Obligations `src/page.ts`'s change sets off: a truthy default, a boundary and two removed guards. */
const DERIVED = 4;

const isObligation = (call: string) => call.startsWith('obligation-');

/** Reviews the risky change in a fresh repo and data directory, recording each model call by stage. */
async function review(investigator: Parameters<typeof stubInvestigations>[1] = () => investigatorReply(ANSWER)) {
	const calls: string[] = [];
	let saved: ReviewProgressCheckpoint | null = null;

	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-obligations-'));
	stubInvestigations(calls, investigator);

	const input = await riskyReview(mkdtempSync(join(tmpdir(), 'obligations-repo-')));

	const result = await runAdaptiveReview(input, {
		onCheckpoint: (checkpoint) => {
			saved = checkpoint;
		}
	});

	return { calls: calls.sort(), result, saved: saved as ReviewProgressCheckpoint | null };
}

test('with the flag unset nothing is derived or launched, and the model calls match a review with it off', async () => {
	useTestModel();
	delete process.env.RECODER_OBLIGATIONS;

	const unset = await review();

	process.env.RECODER_OBLIGATIONS = '0';

	const off = await review();

	process.env.RECODER_OBLIGATIONS = '1';

	const on = await review();

	expect(unset.calls).toEqual(off.calls);
	expect(unset.calls.filter(isObligation)).toEqual([]);
	expect(unset.result.obligations).toBeUndefined();
	expect(unset.saved && 'obligations' in unset.saved).toBe(false);
	expect(unset.result.assignments.filter((record) => record.role === 'obligation')).toEqual([]);
	expect(unset.result.summary).not.toContain('obligation');

	expect(on.calls.filter(isObligation)).toHaveLength(DERIVED);
	expect(on.calls.filter((call) => !isObligation(call))).toEqual(unset.calls);
});

test('each obligation is investigated once, and its fixed answer is saved with the tokens and time it took', async () => {
	useTestModel();
	process.env.RECODER_OBLIGATIONS = '1';

	const { calls, result, saved } = await review();

	expect(result.outcome).toBe('complete');
	expect(calls.filter(isObligation)).toEqual(['obligation-1', 'obligation-2', 'obligation-3', 'obligation-4']);

	const report = result.obligations!;

	expect(report.counts).toEqual({
		derived: DERIVED,
		launched: DERIVED,
		overCap: 0,
		notLaunched: 0,
		confirmed: 0,
		disproved: DERIVED,
		notApplicable: 0,
		unresolved: 0,
		verified: 0
	});

	expect(report.obligations.map((obligation) => obligation.trigger)).toEqual([
		'truthy-default',
		'boundary',
		'removed-guard',
		'removed-guard'
	]);

	const answer = report.answers.find((entry) => entry.obligationId === 'obligation-1')!;

	expect(answer).toMatchObject({
		contractEvidence: ANSWER.contractEvidence,
		inputPartition: ANSWER.inputPartition,
		expectedBehavior: ANSWER.expectedBehavior,
		attemptedCounterexample: { input: 'pageSize(0)', command: null, evidenceId: null, observed: 'returns 20' },
		result: 'disproved',
		reason: ANSWER.reason,
		evidenceIds: [],
		turns: 1,
		tokens: 42,
		maxTurns: 6,
		launched: true
	});

	expect(answer.elapsedMs).toBeGreaterThanOrEqual(0);
	expect(saved?.obligations?.answers).toEqual(report.answers);
	expect(result.summary).toContain('4 obligations derived, 4 investigated: 4 disproved.');

	const records = result.assignments.filter((record) => record.role === 'obligation');

	expect(records.map((record) => [record.id, record.status])).toEqual(
		report.answers.map((entry) => [entry.obligationId, 'done'])
	);
});

test('an investigator cannot spawn subagents: asking for one adds no model call', async () => {
	useTestModel();
	process.env.RECODER_OBLIGATIONS = '1';

	const ask = {
		concern: 'Callers',
		question: 'Who passes 0?',
		scope: [{ path: 'src/page.ts', hunkIds: [] }],
		why: 'Repo-wide'
	};

	const reply = { message: 'done', ...NOTHING, subagents: [ask], obligation: ANSWER };

	const { calls, result } = await review(() => modelReply(reply));
	const plain = await review();

	expect(result.outcome).toBe('complete');
	expect(result.obligations!.counts).toMatchObject({ launched: DERIVED, disproved: DERIVED });
	expect(calls).toEqual(plain.calls);
	expect(result.assignments.filter((record) => record.role === 'subagent')).toEqual([]);
});

test('a confirmed counterexample becomes an ordinary candidate that the verifier proves', async () => {
	useTestModel();
	process.env.RECODER_OBLIGATIONS = '1';

	const defect = { ...finding('pageSize(0) now returns 20 instead of 0', 'high'), file: 'src/page.ts', line: 2 };

	const { result } = await review((id) =>
		id === 'obligation-1'
			? investigatorReply({ ...ANSWER, result: 'confirmed', reason: 'Zero is a valid limit.' }, [defect])
			: investigatorReply(ANSWER)
	);

	const report = result.obligations!;
	const answer = report.answers.find((entry) => entry.obligationId === 'obligation-1')!;

	expect(answer.result).toBe('confirmed');
	expect(answer.candidateId).toBeString();
	expect(report.counts).toMatchObject({ confirmed: 1, disproved: DERIVED - 1, verified: 1 });
	expect(result.findings.map((item) => [item.file, item.title])).toEqual([['src/page.ts', defect.title]]);
	expect(result.summary).toContain('1 confirmed, 3 disproved');
});

test('the cap limits how many obligations are investigated and counts the rest as over the cap', async () => {
	useTestModel();
	process.env.RECODER_OBLIGATIONS = '1';
	process.env.RECODER_OBLIGATION_CAP = '1';

	const { calls, result } = await review();

	expect(new Set(calls.filter(isObligation)).size).toBe(1);
	expect(result.obligations!.cap).toBe(1);
	expect(result.obligations!.counts).toMatchObject({ derived: DERIVED, launched: 1, overCap: DERIVED - 1 });

	process.env.RECODER_OBLIGATION_CAP = '0';

	const none = await review();

	expect(none.calls.filter(isObligation)).toEqual([]);
	expect(none.result.obligations!.counts).toMatchObject({ derived: DERIVED, launched: 0, overCap: DERIVED });
});

test("investigations run in the lens reviewers' pool, so no more agents run at once than it allows", async () => {
	useTestModel(64);
	process.env.RECODER_OBLIGATIONS = '1';

	const filler = (tag: string) =>
		Array.from({ length: 140 }, (_, line) => `// ${tag}${String(line).padEnd(96, 'x')}`).join('\n') + '\n';

	const input = await riskyReview(mkdtempSync(join(tmpdir(), 'obligations-repo-')), {
		'src/x.ts': filler('x'),
		'src/y.ts': filler('y'),
		'lib/z.ts': filler('z')
	});

	let running = 0;
	let most = 0;

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		if (isVerifier(init)) return modelReply(confirmingVerifier(init));

		running++;
		most = Math.max(most, running);
		await Bun.sleep(100);
		running--;

		return obligationOf(init) ? investigatorReply(ANSWER) : modelReply({ message: 'ok', ...NOTHING });
	}) as unknown as typeof fetch;

	const result = await runAdaptiveReview(input);
	const agents = result.assignments.filter((record) => record.role === 'reviewer' || record.role === 'obligation');

	expect(agents.length).toBeGreaterThan(REVIEW_POLICY.maxConcurrentAssignments);
	expect(result.obligations!.counts).toMatchObject({ launched: DERIVED });
	expect(most).toBeLessThanOrEqual(REVIEW_POLICY.maxConcurrentAssignments);
});
