import type { ObligationAnswer } from '@recoder/shared';
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, poolContext } from '../../../../src/review/pipeline/harness/context';
import { investigate } from '../../../../src/review/pipeline/obligations/investigate';
import { deriveObligationsStage } from '../../../../src/review/pipeline/obligations/stage';
import type { RunResult } from '../../../../src/sandbox/exec-sandbox';
import type { ExecWorkspace } from '../../../../src/sandbox/exec-workspace';
import { finding, modelReply, restoreAfterEach, useTestModel } from '../harness-fixtures';
import { ANSWER, investigatorReply, isolateEachTest, riskyReview, stubInvestigations } from './fixtures';

restoreAfterEach();
isolateEachTest();

/** How a command ends: its exit status and what it printed. */
type Ends = { exitCode: number; output: string };

/** A sandbox where the investigator's command ends as `head` says, and the same command on the merge base as `base` says. */
class FakeSandbox {
	deadlineAt = Number.POSITIVE_INFINITY;
	readonly baseRuns: string[] = [];

	constructor(
		private readonly head: Ends,
		private readonly base: Ends
	) {}

	async runInvestigation(): Promise<RunResult> {
		return { ...this.head, truncated: false, timedOut: false, elapsedMs: 1 };
	}

	async runOnBase(command: string): Promise<RunResult> {
		this.baseRuns.push(command);

		return { ...this.base, truncated: false, timedOut: false, elapsedMs: 1 };
	}
}

const DEFECT = { ...finding('pageSize(0) now returns 20 instead of 0', 'high'), file: 'src/page.ts', line: 2 };

/** A confirmed answer whose counterexample cites `evidenceId`. */
const confirmed = (evidenceId: string | null) => ({
	...ANSWER,
	result: 'confirmed',
	reason: 'Zero is a valid limit.',
	attemptedCounterexample: { input: 'pageSize(0)', evidenceId, observed: 'returns 20' }
});

/**
 * Investigates the risky change's first obligation with code running in
 * `sandbox`: the investigator runs `bun repro.ts` once, then gives `final`
 * the id of that run and answers with what it returns.
 */
async function investigateWith(sandbox: FakeSandbox, final: (runId: string) => Response) {
	useTestModel();
	process.env.RECODER_OBLIGATIONS = '1';

	const input = await riskyReview(mkdtempSync(join(tmpdir(), 'obligations-repo-')));
	const run = createRun(input);
	const calls: string[] = [];
	const answers: ObligationAnswer[] = [];
	const runId = () => [...run.evidence.records.values()].find((record) => record.kind === 'run')?.id ?? '';

	stubInvestigations(calls, () =>
		calls.length === 1
			? modelReply({ message: 'Running it.', actions: [{ action: 'run', command: 'bun repro.ts' }] })
			: final(runId())
	);

	await deriveObligationsStage(run);
	run.workspace = sandbox as unknown as ExecWorkspace;
	run.evidence.exec = run.workspace;

	const state = run.obligations!;

	await investigate(state.units[0], run.assignments, {
		...poolContext(run),
		maxTurns: state.maxTurns,
		obligationOf: (id) => state.derived!.find((obligation) => obligation.id === id)!,
		workspace: run.workspace,
		mergeBaseSha: input.revision!.mergeBaseSha,
		onAnswer: (answer) => answers.push(answer)
	});

	return { answer: answers[0], candidates: run.candidates };
}

test('a counterexample that fails on the changed code proves a confirmed answer, and its base run is recorded', async () => {
	const sandbox = new FakeSandbox(
		{ exitCode: 1, output: 'expected 0, received 20\n' },
		{ exitCode: 0, output: 'ok\n' }
	);

	const { answer, candidates } = await investigateWith(sandbox, (id) => investigatorReply(confirmed(id), [DEFECT]));

	expect(answer.result).toBe('confirmed');
	expect(answer.candidateId).toBe(candidates[0].candidateId);

	expect(answer.attemptedCounterexample).toMatchObject({
		command: 'bun repro.ts',
		base: { exitCode: 0, differs: true }
	});

	expect(sandbox.baseRuns).toEqual(['bun repro.ts']);
});

test('a passing run that prints something else on the merge base proves it too', async () => {
	const sandbox = new FakeSandbox(
		{ exitCode: 0, output: 'pageSize(0) = 20\n' },
		{ exitCode: 0, output: 'pageSize(0) = 0\n' }
	);

	const { answer } = await investigateWith(sandbox, (id) =>
		investigatorReply({ ...confirmed(id), reason: 'It prints "pageSize(0) = 20".' }, [DEFECT])
	);

	expect(answer.result).toBe('confirmed');
	expect(answer.attemptedCounterexample?.base).toEqual({ exitCode: 0, differs: true });
});

test('a passing run that ends the same way on the merge base leaves a confirmed answer unresolved', async () => {
	const sandbox = new FakeSandbox({ exitCode: 0, output: 'repro.ts\n' }, { exitCode: 0, output: 'repro.ts\n' });

	const { answer, candidates } = await investigateWith(sandbox, (id) => investigatorReply(confirmed(id), [DEFECT]));

	expect(answer.result).toBe('unresolved');

	expect(answer.reason).toStartWith(
		'Its counterexample `bun repro.ts` exited 0 and ends the same way on the merge base'
	);

	expect(answer.candidateId).toBeUndefined();
	expect(candidates).toEqual([]);
});

test('a confirmed answer that cites no run of its own is unresolved, even when it ran something', async () => {
	const sandbox = new FakeSandbox({ exitCode: 1, output: 'failed\n' }, { exitCode: 0, output: '' });

	const { answer, candidates } = await investigateWith(sandbox, () => investigatorReply(confirmed(null), [DEFECT]));

	expect(answer.result).toBe('unresolved');
	expect(answer.reason).toStartWith('Confirmed without citing a counterexample run of its own');
	expect(answer.attemptedCounterexample).toMatchObject({ command: null, evidenceId: null });
	expect(candidates).toEqual([]);
	expect(sandbox.baseRuns).toEqual([]);
});

test('an answer other than confirmed is not rerun on the merge base', async () => {
	const sandbox = new FakeSandbox({ exitCode: 0, output: 'pageSize(0) = 20\n' }, { exitCode: 0, output: '' });

	const { answer } = await investigateWith(sandbox, (id) =>
		investigatorReply({ ...ANSWER, attemptedCounterexample: { ...ANSWER.attemptedCounterexample, evidenceId: id } })
	);

	expect(answer.result).toBe('disproved');
	expect(answer.attemptedCounterexample).toMatchObject({ command: 'bun repro.ts' });
	expect(answer.attemptedCounterexample?.base).toBeUndefined();
	expect(sandbox.baseRuns).toEqual([]);
});

test('a confirmed answer whose every finding is rejected is unresolved and says why', async () => {
	const sandbox = new FakeSandbox({ exitCode: 1, output: 'expected 0, received 20\n' }, { exitCode: 0, output: '' });
	const elsewhere = { ...DEFECT, file: 'src/elsewhere.ts' };

	const { answer, candidates } = await investigateWith(sandbox, (id) => investigatorReply(confirmed(id), [elsewhere]));

	expect(candidates.map((candidate) => candidate.valid)).toEqual([false]);
	expect(answer.result).toBe('unresolved');
	expect(answer.reason).toStartWith(`Confirmed, but every finding was rejected (${candidates[0].dropReason})`);
	expect(answer.candidateId).toBeUndefined();
});
