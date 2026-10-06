import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAdaptiveReview, type ReviewProgressCheckpoint } from '../../../../src/review/pipeline/harness';
import { modelReply, restoreAfterEach, useTestModel } from '../harness-fixtures';
import { ANSWER, investigatorReply, isolateEachTest, riskyReview, stall, stubInvestigations } from './fixtures';

restoreAfterEach();
isolateEachTest();

const newRepo = () => riskyReview(mkdtempSync(join(tmpdir(), 'obligations-repo-')));

/** An investigator that only ever asks to read more. */
const keepsReading = () => modelReply({ message: 'Reading.', actions: [{ action: 'readDiff', path: 'src/page.ts' }] });

test('an investigation that runs out of turns is done and unresolved, and the review completes', async () => {
	useTestModel();
	process.env.RECODER_OBLIGATIONS = '1';
	process.env.RECODER_OBLIGATION_CAP = '1';
	process.env.RECODER_OBLIGATION_TURNS = '4';

	const prompts: string[] = [];

	stubInvestigations([], (_id, init) => {
		prompts.push(JSON.parse(init?.body as string).messages.at(-1).content);

		return keepsReading();
	});

	const result = await runAdaptiveReview(await newRepo());

	expect(result.outcome).toBe('complete');

	const [answer] = result.obligations!.answers;

	expect(answer).toMatchObject({
		result: 'unresolved',
		launched: true,
		turns: 4,
		maxTurns: 4,
		attemptedCounterexample: null
	});

	expect(answer.reason).toStartWith('No answer within 4 turns');
	expect(prompts.map((prompt) => prompt.startsWith('This is your final turn'))).toEqual([false, false, true, true]);
	expect(result.assignments.find((record) => record.role === 'obligation')?.status).toBe('done');
	expect(result.obligations!.counts).toMatchObject({ launched: 1, unresolved: 1 });
	expect(result.summary).toContain('1 unresolved');
});

test('cancelling the review stops a running investigation without recording an answer for it', async () => {
	useTestModel();
	process.env.RECODER_OBLIGATIONS = '1';
	process.env.RECODER_OBLIGATION_CAP = '1';

	const controller = new AbortController();
	let saved: ReviewProgressCheckpoint | null = null;

	stubInvestigations([], (_id, init) => {
		queueMicrotask(() => controller.abort());

		return stall(init);
	});

	const input = await newRepo();

	const result = await runAdaptiveReview(
		{ ...input, signal: controller.signal },
		{
			onCheckpoint: (checkpoint) => {
				saved = checkpoint;
			}
		}
	);

	expect(result.outcome).toBe('failed');

	const state = (saved as ReviewProgressCheckpoint | null)?.obligations;

	expect(state?.units).toHaveLength(1);
	expect(state?.answers).toEqual([]);
});

test('a resumed review investigates only the obligations left unanswered and keeps the saved answers', async () => {
	useTestModel();
	process.env.RECODER_OBLIGATIONS = '1';
	process.env.RECODER_OBLIGATION_CAP = '2';

	const controller = new AbortController();
	const answered: string[] = [];
	const derivedIn: string[] = [];
	let saved: ReviewProgressCheckpoint | null = null;

	stubInvestigations([], (id, init) => {
		if (answered.length) return stall(init);
		answered.push(id);

		return investigatorReply(ANSWER);
	});

	const input = await newRepo();

	const first = await runAdaptiveReview(
		{ ...input, signal: controller.signal },
		{
			onTask: (task) => derivedIn.push(task.id),
			onCheckpoint: (checkpoint) => {
				saved = checkpoint;
				if (checkpoint.obligations?.answers.length) controller.abort();
			}
		}
	);

	expect(first.outcome).toBe('failed');
	expect(derivedIn).toContain('obligations');

	const checkpoint = saved as unknown as ReviewProgressCheckpoint;
	const state = checkpoint.obligations!;
	const [kept] = state.answers;

	expect(state.units).toHaveLength(2);
	expect(state.answers.map((answer) => answer.obligationId)).toEqual(answered);

	const second: string[] = [];
	const resumedTasks: string[] = [];

	stubInvestigations(second, () => investigatorReply({ ...ANSWER, result: 'not-applicable' }));

	const resumed = await runAdaptiveReview(
		{ ...input, resume: checkpoint },
		{ onTask: (task) => resumedTasks.push(task.id) }
	);

	const rest = state.units.map((unit) => unit.id).filter((id) => id !== kept.obligationId);

	expect(second.filter((call) => call.startsWith('obligation-'))).toEqual(rest);
	expect(resumedTasks).not.toContain('obligations');
	expect(resumed.obligations!.obligations).toEqual(state.derived!);
	expect(resumed.obligations!.answers[0]).toEqual(kept);

	expect(resumed.obligations!.answers.map((answer) => [answer.obligationId, answer.result])).toEqual([
		[kept.obligationId, 'disproved'],
		[rest[0], 'not-applicable']
	]);
});
