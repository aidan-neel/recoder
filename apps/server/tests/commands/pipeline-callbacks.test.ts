import { ORCHESTRATOR_ID, emptyReviewProgress, type ReviewChatMessage } from '@recoder/shared';
import { beforeEach, expect, test } from 'bun:test';
import { harnessCallbacks } from '../../src/commands/pipeline-callbacks';
import { runAdaptiveReview } from '../../src/review/pipeline/harness';
import { reviewProgress } from '../../src/store';
import { restoreEnvAfterEach } from '../helpers/env';
import {
	NOTHING,
	TWO_UNIT_DIFF,
	modelReply,
	restoreAfterEach,
	stubFetch,
	unitOf,
	useTestModel
} from '../review/pipeline/harness-fixtures';

restoreAfterEach();
restoreEnvAfterEach(['RECODER_REVIEW_VARIANT']);

beforeEach(() => {
	process.env.RECODER_REVIEW_VARIANT = 'independent-pass';
	useTestModel();
});

const BRIEF = 'Focus on the parser.';
const FIRST_PASS = 'The parser drops the last line of the file.';

/** A finished discussion message in the orchestrator's conversation, `forwardedFrom` a reviewer's when shared. */
function said(id: string, from: ReviewChatMessage['from'], text: string, forwardedFrom?: string): ReviewChatMessage {
	return {
		id,
		assignmentId: ORCHESTRATOR_ID,
		from,
		text,
		at: new Date().toISOString(),
		status: 'done',
		discussion: true,
		...(forwardedFrom ? { forwardedFrom } : {})
	};
}

/**
 * Runs an independent-pass review that reads its discussion through `harnessCallbacks`, while the orchestrator's
 * conversation holds the developer's brief, a reply shared from `reviewer-1` and the orchestrator relaying it.
 * Returns every reviewer's request bodies by unit.
 */
async function reviewWithDiscussion(): Promise<Map<string, string[]>> {
	const reviewId = crypto.randomUUID();

	await reviewProgress.set({
		...emptyReviewProgress(reviewId),
		messages: [
			said('brief', 'user', BRIEF),
			said('shared_reply', 'assistant', FIRST_PASS, 'Reviewer 1'),
			said('relay', 'assistant', `Reviewer 1 says: ${FIRST_PASS}`)
		]
	});

	const bodies = new Map<string, string[]>();

	stubFetch((init) => {
		const unit = unitOf(init) ?? 'other';

		bodies.set(unit, [...(bodies.get(unit) ?? []), String(init?.body)]);

		return modelReply({ message: 'ok', ...NOTHING, examinedHunks: [] });
	});

	const callbacks = harnessCallbacks(reviewId, { headSha: 'head', mergeBaseSha: 'base' });

	await runAdaptiveReview({ diff: TWO_UNIT_DIFF, sandboxPath: null }, { getDiscussion: callbacks?.getDiscussion });

	return bodies;
}

test("an independent reviewer reads the developer's brief but no reply that carries the first pass", async () => {
	const bodies = await reviewWithDiscussion();

	const independent = (bodies.get('independent-reviewer-1') ?? []).join('\n');

	expect(independent).toContain(BRIEF);
	expect(independent).not.toContain(FIRST_PASS);
});

test("a first-pass reviewer reads the orchestrator's whole discussion", async () => {
	const bodies = await reviewWithDiscussion();

	expect((bodies.get('reviewer-2') ?? []).join('\n')).toContain(FIRST_PASS);
});
