import type { ObligationAnswer } from '@recoder/shared';
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunResult } from '../../../../src/sandbox/exec-sandbox';
import type { ExecWorkspace, QueueWatcher } from '../../../../src/sandbox/exec-workspace';
import { createRun, poolContext } from '../../../../src/review/pipeline/harness/context';
import { investigate } from '../../../../src/review/pipeline/obligations/investigate';
import { deriveObligationsStage } from '../../../../src/review/pipeline/obligations/stage';
import { advanceClock, freezeClockEachTest } from '../../../helpers/manual-clock';
import { modelReply, restoreAfterEach, useTestModel } from '../harness-fixtures';
import { ANSWER, investigatorReply, isolateEachTest, riskyReview, stubInvestigations } from './fixtures';

restoreAfterEach();
isolateEachTest();
freezeClockEachTest();

/** A sandbox whose command queue holds each run for as long as `hold` takes, telling the run's owner as it goes. */
class HeldQueue {
	deadlineAt = Number.POSITIVE_INFINITY;
	private readonly watchers = new Map<string, QueueWatcher>();

	constructor(private readonly hold: () => Promise<void>) {}

	watchQueue(owner: string, watcher: QueueWatcher): () => void {
		this.watchers.set(owner, watcher);

		return () => this.watchers.delete(owner);
	}

	async run(_command: string, _timeoutMs: number, _signal?: AbortSignal, owner = ''): Promise<RunResult> {
		const watcher = this.watchers.get(owner);

		watcher?.queued();
		await this.hold();
		watcher?.started();
		watcher?.finished();

		return { exitCode: 0, output: 'pageSize(0) = 20\n', truncated: false, timedOut: false, elapsedMs: 0 };
	}
}

/**
 * Investigates the first obligation of the risky change with the clock
 * frozen, the sandbox queue holding its one run while `wait` moves the clock
 * on. The investigator runs a counterexample, then answers.
 */
async function investigateHeld(wait: (deadlineAt: number) => void) {
	useTestModel();
	process.env.RECODER_OBLIGATIONS = '1';

	const input = await riskyReview(mkdtempSync(join(tmpdir(), 'obligations-repo-')));
	const turns: string[] = [];
	const answers: ObligationAnswer[] = [];

	stubInvestigations(turns, () =>
		turns.length === 1
			? modelReply({ message: 'Running it.', actions: [{ action: 'run', command: 'bun repro.ts' }] })
			: investigatorReply(ANSWER)
	);

	const run = createRun(input);
	const workspace = new HeldQueue(async () => wait(run.investigationDeadline));

	await deriveObligationsStage(run);
	run.workspace = workspace as unknown as ExecWorkspace;
	run.evidence.exec = run.workspace;

	const state = run.obligations!;

	await investigate(state.units[0], run.assignments, {
		...poolContext(run),
		timeBoxMs: 45_000,
		obligationOf: (id) => state.derived!.find((obligation) => obligation.id === id)!,
		workspace: run.workspace,
		mergeBaseSha: null,
		onAnswer: (answer) => answers.push(answer)
	});

	return { turns, answer: answers[0] };
}

test('a call held in the sandbox queue longer than the time box does not use it up', async () => {
	const { turns, answer } = await investigateHeld(() => advanceClock(60_000));

	expect(turns).toEqual(['obligation-1', 'obligation-1']);

	expect(answer).toMatchObject({
		result: 'disproved',
		reason: ANSWER.reason,
		launched: true,
		elapsedMs: 60_000,
		queuedMs: 60_000,
		workingMs: 0,
		turns: 2,
		tokens: 42
	});

	expect(answer.attemptedCounterexample?.command).toBe('bun repro.ts');
});

test('the review deadline still stops an investigation whose call waited in the queue past it', async () => {
	const { turns, answer } = await investigateHeld((deadlineAt) => advanceClock(deadlineAt + 1_000 - Date.now()));

	expect(turns).toEqual(['obligation-1']);
	expect(answer).toMatchObject({ result: 'unresolved', workingMs: 0, turns: 1, launched: true });
	expect(answer.reason).toContain('Investigation deadline reached');
	expect(answer.queuedMs).toBeGreaterThan(45_000);
});
