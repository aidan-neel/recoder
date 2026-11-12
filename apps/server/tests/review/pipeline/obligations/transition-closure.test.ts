import type { ObligationAnswer } from '@recoder/shared';
import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRun, poolContext } from '../../../../src/review/pipeline/harness/context';
import { repoInventoryStage } from '../../../../src/review/pipeline/harness/repo-inventory-stage';
import { investigate } from '../../../../src/review/pipeline/obligations/investigate';
import { deriveObligationsStage } from '../../../../src/review/pipeline/obligations/stage';
import { git } from '../../../helpers/git';
import { restoreAfterEach, twoCommitRepo, useTestModel } from '../harness-fixtures';
import { ANSWER, file, investigatorReply, isolateEachTest, stubInvestigations } from './fixtures';

restoreAfterEach();
isolateEachTest();

/** A job started in a state the rest of the file never names, so the change moves it somewhere new. */
const JOB = file(
	'src/job.ts',
	[
		"export const INITIAL = { status: 'queued' };",
		'export function start(job: { status: string }) {',
		"\tjob.status = 'running';",
		'}'
	],
	[
		"export const INITIAL = { status: 'queued' };",
		'export function start(job: { status: string }) {',
		"\tjob.status = 'started';",
		'}'
	]
);

/** A disproved answer that checked one transition and cites `kinds` of contract evidence. */
function disproved(kinds: string[]) {
	return {
		...ANSWER,
		contractEvidence: kinds.map((kind) => ({ kind, location: 'src/job.ts:3', note: 'starts the job' })),
		inputPartition: [{ label: 'start', input: 'queued, then start()', expected: 'started' }],
		attemptedCounterexample: null,
		result: 'disproved',
		reason: 'Starting a queued job leaves it started.'
	};
}

/** Investigates the job change's state-transition obligation with no sandbox; the investigator gives `answer`. */
async function investigateTransition(answer: unknown): Promise<ObligationAnswer> {
	useTestModel();
	process.env.RECODER_OBLIGATIONS = '1';
	process.env.RECODER_OBLIGATIONS_TRANSITIONS = '1';

	const root = mkdtempSync(join(tmpdir(), 'obligations-transition-'));
	const { targetSha, headSha } = await twoCommitRepo(root, JOB);

	const run = createRun({
		diff: git(root, ['diff', targetSha, headSha]) + '\n',
		sandboxPath: root,
		revision: { checkoutPath: root, headSha, targetSha, mergeBaseSha: targetSha, targetRef: 'main' }
	});

	const answers: ObligationAnswer[] = [];

	stubInvestigations([], () => investigatorReply(answer));
	await repoInventoryStage(run);
	await deriveObligationsStage(run);

	const state = run.obligations;
	const obligation = state?.derived?.find((entry) => entry.trigger === 'state-transition');
	const unit = state?.units.find((entry) => entry.id === obligation?.id);

	if (!state || !obligation || !unit)
		throw new Error('The job change derived no state-transition obligation to investigate');

	await investigate(unit, run.assignments, {
		...poolContext(run),
		maxTurns: state.maxTurns,
		obligationOf: () => obligation,
		workspace: null,
		mergeBaseSha: targetSha,
		changes: () => ({ added: [], removed: [], symbols: [] }),
		onAnswer: (entry) => answers.push(entry)
	});

	return answers[0];
}

test('a disproved transition that cites only a passing test is left unresolved', async () => {
	const answer = await investigateTransition(disproved(['test']));

	expect(answer.result).toBe('unresolved');
});

test('a disproved transition that cites the source it traced stays disproved', async () => {
	const answer = await investigateTransition(disproved(['test', 'source']));

	expect(answer.result).toBe('disproved');
});

test('a disproved transition that names no transition it checked is left unresolved', async () => {
	const answer = await investigateTransition({ ...disproved(['source']), inputPartition: [] });

	expect(answer.result).toBe('unresolved');
});
