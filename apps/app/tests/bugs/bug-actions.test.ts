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
function actionsOn(client: ApiClient, wait?: (ms: number) => Promise<void>) {
	const state = createStore<SessionData>(() => ({ ...initialSession({}), review: structuredClone(SAMPLE_REVIEW) }));

	const actions = createBugActions({
		client,
		list: createListStore(client),
		state,
		repoId: 'sample-api',
		number: 214,
		wait
	});

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

describe('posting the review', () => {
	test('a post the forge refused shows the failure the server recorded', async () => {
		const recorded: Review = {
			...structuredClone(SAMPLE_REVIEW),
			findingsReview: { state: 'failed', error: 'GitHub refused the review.', updatedAt: '2026-10-13T10:00:00.000Z' }
		};

		const client: ApiClient = {
			...createSampleApi(),
			postFindings: () => Promise.reject(new ApiError('GitHub refused the review.', 502)),
			review: async () => recorded
		};

		const { actions, state } = actionsOn(client);

		await expect(actions.postAll()).rejects.toThrow('GitHub refused the review.');

		expect(state.getState()).toMatchObject({
			postingAll: false,
			review: { findingsReview: { state: 'failed', error: 'GitHub refused the review.' } }
		});
	});

	test('a failed post whose record cannot be read still reports the post failure', async () => {
		const client: ApiClient = {
			...createSampleApi(),
			postFindings: () => Promise.reject(new ApiError('GitHub refused the review.', 502)),
			review: () => Promise.reject(new ApiError('The server is busy.', 503))
		};

		const { actions } = actionsOn(client);

		await expect(actions.postAll()).rejects.toThrow('GitHub refused the review.');
	});
});

/** A client whose first decision is refused with a 409 and whose later ones save at once. */
function decideConflictsOnce() {
	let calls = 0;

	const client: ApiClient = {
		...createSampleApi(),
		decide: async (_reviewId: string, _findingId: string, input: DecisionInput) => {
			calls += 1;

			if (calls === 1) throw new ApiError('no diff yet', 409);

			return { ...input, decidedAt: '2026-10-13T10:00:00.000Z' };
		}
	};

	return { client, calls: () => calls };
}

describe('a decision the server could not save yet', () => {
	/** Lets every queued microtask run, without waiting on a clock. */
	const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

	test('a 409 then a success saves the decision and the finding ends decided', async () => {
		const { client, calls } = decideConflictsOnce();
		const { actions, decisionOf } = actionsOn(client, () => Promise.resolve());

		await actions.accept(BUG);

		expect(calls()).toBe(2);
		expect(decisionOf(BUG)).toMatchObject({ state: 'accepted' });
	});

	test('two 409s roll the finding back and show the reason', async () => {
		let calls = 0;

		const client: ApiClient = {
			...createSampleApi(),
			decide: async () => {
				calls += 1;
				throw new ApiError('no diff yet', 409);
			}
		};

		const { actions, decisionOf } = actionsOn(client, () => Promise.resolve());

		await expect(actions.accept(BUG)).rejects.toThrow('No diff yet.');

		expect(calls).toBe(2);
		expect(decisionOf(BUG)).toBeUndefined();
	});

	test('a failure that is not a 409 is not sent again', async () => {
		let calls = 0;

		const client: ApiClient = {
			...createSampleApi(),
			decide: async () => {
				calls += 1;
				throw new ApiError('The server is busy.', 503);
			}
		};

		const { actions } = actionsOn(client, () => Promise.resolve());

		await expect(actions.accept(BUG)).rejects.toThrow('The server is busy.');

		expect(calls).toBe(1);
	});

	test('the finding stays pending during the retry wait', async () => {
		const gate = Promise.withResolvers<void>();
		const { client, calls } = decideConflictsOnce();
		const { actions, state } = actionsOn(client, () => gate.promise);
		const accepted = actions.accept(BUG);

		await tick();

		expect(calls()).toBe(1);
		expect(state.getState().pendingBugs.has(BUG)).toBe(true);

		gate.resolve();
		await accepted;

		expect(calls()).toBe(2);
		expect(state.getState().pendingBugs.has(BUG)).toBe(false);
	});
});
