import { expect, test } from 'bun:test';
import { harnessCallbacks } from '../../../../src/commands/pipeline-callbacks';
import { runAdaptiveReview } from '../../../../src/review/pipeline/harness';
import { reviewEventBuffer } from '../../../../src/review/session/events';
import { reviewProgress } from '../../../../src/store';
import { envFlag } from '../../../helpers/env-flag';
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
envFlag('RECODER_REVIEWER_TOOLS', 'read');

const revision = { headSha: 'head', mergeBaseSha: 'base' };
const input = { diff: DIFF, sandboxPath: null, subagentCap: 1 as const };

async function stageEvents(id: string) {
	const events = await reviewEventBuffer(id);

	return events.filter((event) => event.type === 'step' && event.data?.stage);
}

test('a zero-duration verification is reported once between subagents and consolidation', async () => {
	useTestModel(4);

	const verified = Promise.withResolvers<void>();

	stubFetch(async (init) => {
		const system = systemOf(init);

		if (system.startsWith('You verify one code quality finding')) return modelReply(confirmingVerifier(init));
		if (system.includes('Role: subagent')) await verified.promise;
		if (unitOf(init) !== 'reviewer-1') return modelReply(NOTHING);

		return modelReply({
			...NOTHING,
			findings: [{ ...finding('Replace the magic value'), category: 'readability', smell: 'magic-value' }],
			subagents: [
				{
					concern: 'Check callers',
					question: 'Do callers rely on the old value?',
					scope: [{ path: 'src/a.ts', hunkIds: [] }],
					why: 'The callers are outside this change.'
				}
			]
		});
	});

	const id = crypto.randomUUID();
	const callbacks = harnessCallbacks(id, revision);

	const result = await runAdaptiveReview(input, {
		...callbacks,
		onCandidate: (candidate) => {
			callbacks?.onCandidate?.(candidate);
			if (candidate.state === 'proven') verified.resolve();
		}
	});

	expect(result.funnel?.verified).toBe(1);

	const stages = await stageEvents(id);

	expect(stages.map((event) => event.data?.stage)).toEqual([
		'understand',
		'reviewing',
		'subagents',
		'verify',
		'consolidation'
	]);

	expect((await reviewProgress.get(id))?.stage).toBe('consolidation');
});

test('a review with no claims still consolidates without reporting verification', async () => {
	useTestModel();
	stubFetch(() => modelReply(NOTHING));

	const id = crypto.randomUUID();
	const result = await runAdaptiveReview(input, harnessCallbacks(id, revision));

	expect(result.outcome).toBe('complete');
	expect(result.funnel?.raised).toBe(0);

	expect((await stageEvents(id)).map((event) => event.data?.stage)).toEqual([
		'understand',
		'reviewing',
		'consolidation'
	]);
});
