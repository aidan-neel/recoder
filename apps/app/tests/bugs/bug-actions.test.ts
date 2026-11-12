import { describe, expect, test } from 'bun:test';
import type { FindingDecision, Review } from '@recoder/shared';
import { createStore } from 'zustand/vanilla';

import type { ApiClient } from '../../src/lib/api/client';
import { ApiError } from '../../src/lib/api/http';
import type { DecisionInput } from '../../src/lib/api/reviews';
import { createBugActions } from '../../src/lib/bugs/bug-actions';
import { initialSession, type SessionData } from '../../src/lib/pull/session-state';
import { createListStore } from '../../src/lib/pulls/list-store';
import { createSampleApi } from '../../src/lib/sample/sample-api';
import { SAMPLE_REVIEW } from '../../src/lib/sample/sample-review';

const BUG = 'sample-f1';

const OTHER_BUG = 'sample-f2';

/** Bug actions on the sample review through `client`, with the session state they write to. */
function actionsOn(client: ApiClient) {
	const state = createStore<SessionData>(() => ({ ...initialSession({}), review: structuredClone(SAMPLE_REVIEW) }));
	const actions = createBugActions({ client, list: createListStore(client), state, repoId: 'sample-api', number: 214 });
	const decisionOf = (id: string) => state.getState().review?.findings.find((finding) => finding.id === id)?.decision;

	return { actions, state, decisionOf };
}

/** A client whose first decision waits until the test settles it; later ones save at once. */
function firstDecisionHeld() {
	const held = Promise.withResolvers<FindingDecision>();
	let calls = 0;

	const client: ApiClient = {
		...createSampleApi(),
		decide: async (_reviewId: string, _findingId: string, input: DecisionInput) => {
			calls += 1;

			if (calls === 1) return held.promise;

			return { ...input, decidedAt: '2026-10-13T10:00:00.000Z' };
		}
	};

	return { client, held };
}

describe('deciding on a finding while an earlier decision is in flight', () => {
	test('an earlier decision that fails after a newer one leaves the newer decision on screen', async () => {
		const { client, held } = firstDecisionHeld();
		const { actions, decisionOf } = actionsOn(client);
		const accepted = actions.accept(BUG);
		const dismissed = actions.dismiss(BUG, 'wrong');

		await Promise.resolve();
		held.reject(new ApiError('The server is busy.', 503));

		await expect(accepted).rejects.toThrow('The server is busy.');
		await dismissed;

		expect(decisionOf(BUG)).toMatchObject({ state: 'dismissed', reason: 'wrong' });
	});

	test('the finding shows as pending until its last write settles', async () => {
		const { client, held } = firstDecisionHeld();
		const { actions, state } = actionsOn(client);
		const accepted = actions.accept(BUG);
		const dismissed = actions.dismiss(BUG, 'wrong');

		await Promise.resolve();
		await Promise.resolve();

		expect(state.getState().pendingBugs.has(BUG)).toBe(true);

		held.resolve({ state: 'accepted', decidedAt: '2026-10-13T10:00:00.000Z' });
		await Promise.all([accepted, dismissed]);

		expect(state.getState().pendingBugs.has(BUG)).toBe(false);
	});
});

describe('posting a finding', () => {
	test('a post that answers after another finding was accepted keeps that decision', async () => {
		const held = Promise.withResolvers<Review>();
		const client: ApiClient = { ...createSampleApi(), postFinding: () => held.promise };
		const { actions, decisionOf, state } = actionsOn(client);
		const posted = actions.post(BUG);

		await actions.accept(OTHER_BUG);
		held.resolve(await createSampleApi().postFinding(SAMPLE_REVIEW.id, BUG));
		await posted;

		expect(decisionOf(OTHER_BUG)).toMatchObject({ state: 'accepted' });
		expect(state.getState().review?.findingComments?.[BUG]).toBeDefined();
	});
});
