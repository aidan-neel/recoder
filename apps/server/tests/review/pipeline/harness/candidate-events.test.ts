import { expect, test } from 'bun:test';
import type { ReviewCandidate, ReviewTask } from '@recoder/shared';
import { harnessCallbacks } from '../../../../src/commands/pipeline-callbacks';
import { runAdaptiveReview } from '../../../../src/review/pipeline/harness';
import { restoreCandidateProgress, reviewEventBuffer } from '../../../../src/review/session/events';
import { reviewCheckpoints } from '../../../../src/store';
import {
	confirmingVerifier,
	DIFF,
	finding,
	modelReply,
	NOTHING,
	restoreAfterEach,
	stubFetch,
	systemOf,
	unitOf,
	useTestModel
} from '../harness-fixtures';

restoreAfterEach();

const readability = { ...finding('Replace the magic value'), category: 'readability', smell: 'magic-value' };
const revision = { headSha: 'head', mergeBaseSha: 'base' };
const input = { diff: DIFF, sandboxPath: null, subagentCap: 0 as const };

async function reviewCandidates(findings: (typeof readability)[]) {
	useTestModel();

	stubFetch((init) => {
		if (systemOf(init).startsWith('You verify one code quality finding')) return modelReply(confirmingVerifier(init));

		return modelReply(unitOf(init) === 'reviewer-1' ? { ...NOTHING, findings } : NOTHING);
	});

	const id = crypto.randomUUID();

	await runAdaptiveReview(input, harnessCallbacks(id, revision));

	const events = await reviewEventBuffer(id);

	return {
		id,
		candidates: events
			.filter((event) => event.type === 'candidate')
			.map((event) => event.data!.candidate as ReviewCandidate),
		tasks: events.filter((event) => event.type === 'task').map((event) => event.data!.task as ReviewTask)
	};
}

test('a reviewer raises a candidate that follows its verifier lane and ends with the task verdict', async () => {
	const invalid = { ...readability, title: 'Missing evidence', evidenceIds: ['ev_999'] };
	const { candidates, tasks } = await reviewCandidates([readability, invalid]);
	const history = candidates.filter((candidate) => candidate.id === 'c1');
	const [raised, verifying, proven] = history;
	const task = tasks.filter((task) => task.id === 'verify:c1').at(-1);

	expect(history.map((candidate) => candidate.state)).toEqual(['raised', 'verifying', 'proven']);

	expect(raised).toMatchObject({
		title: readability.title,
		path: 'src/a.ts',
		line: 1,
		tier: 'warning',
		raisedBy: 'reviewer-1',
		raisedAt: expect.any(String)
	});

	expect(verifying).toMatchObject({ raisedAt: raised.raisedAt, verifierId: 'verifier-1' });

	expect(task).toMatchObject({
		status: 'done',
		candidateId: 'c1',
		verifierId: 'verifier-1',
		message: 'Traced through the code'
	});

	expect(proven).toMatchObject({
		raisedAt: raised.raisedAt,
		verifierId: task!.verifierId,
		message: task!.message,
		settledAt: expect.any(String)
	});

	const rejected = candidates.filter((candidate) => candidate.id === 'c2');

	expect(rejected.map((candidate) => candidate.state)).toEqual(['raised', 'dropped']);

	expect(rejected[1]).toMatchObject({
		dropStage: 'evidence',
		message: 'cited evidence was not provided',
		settledAt: expect.any(String)
	});

	expect(tasks.some((task) => task.candidateId === 'c2')).toBe(false);
});

test('consolidation emits a merge against the representative candidate id', async () => {
	const { candidates } = await reviewCandidates([readability, readability]);
	const droppedIntoLead = candidates.filter((candidate) => candidate.state === 'merged');

	expect(droppedIntoLead).toEqual([
		expect.objectContaining({ id: 'c2', mergedInto: 'c1', settledAt: expect.any(String) })
	]);
});

test('resuming a checkpoint leaves the persisted verdict, lane, and original raise intact', async () => {
	const { id, candidates } = await reviewCandidates([readability]);
	const resume = (await reviewCheckpoints.get(id))!;
	const retained = new Set(resume.candidates.map((candidate) => candidate.candidateId));
	const candidateProgress = await restoreCandidateProgress(id, retained);

	await runAdaptiveReview({ ...input, resume, candidateProgress }, harnessCallbacks(id, revision));

	const events = await reviewEventBuffer(id);

	expect(events.filter((event) => event.type === 'candidate').map((event) => event.data!.candidate)).toEqual(
		candidates
	);
});
