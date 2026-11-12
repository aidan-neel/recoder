import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { LearnedRuleProposal } from '@recoder/shared';

import { useLearnedRulesStore } from '../../src/lib/guidelines/learned-rules-store';

const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function proposal(overrides: Partial<LearnedRuleProposal> = {}): LearnedRuleProposal {
	return {
		repoId: 'r1',
		topic: { id: 't1', label: 'Missing tests' },
		state: 'proposed',
		votes: { dismissed: 4, useful: 1 },
		proposedAt: '2026-10-13T10:00:00.000Z',
		...overrides
	};
}

/** A fetch that lists one proposed rule and answers a decision write with `decide`. */
function rulesFetch(decide: () => Response): typeof fetch {
	return mock((input: string | URL, init?: RequestInit) => {
		if (init?.method === 'PUT') return Promise.resolve(decide());

		return Promise.resolve(json([proposal()]));
	}) as unknown as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = realFetch;
	useLearnedRulesStore.setState({ repoId: null, status: 'loading', error: null, rules: [] });
});

describe('deciding a learned rule', () => {
	test('a decision replaces the row with the server’s answer', async () => {
		const saved = proposal({ state: 'approved', decidedAt: '2026-10-14T09:00:00.000Z' });

		globalThis.fetch = rulesFetch(() => json(saved));

		await useLearnedRulesStore.getState().load('r1');
		await useLearnedRulesStore.getState().decide('r1', 't1', 'approved');

		expect(useLearnedRulesStore.getState().rules[0]).toMatchObject({
			proposal: { state: 'approved', decidedAt: '2026-10-14T09:00:00.000Z' },
			pending: null,
			error: null
		});
	});

	test('a failed decision leaves the row and sets its error', async () => {
		globalThis.fetch = rulesFetch(() => json({ error: 'The rule is gone.' }, 500));

		await useLearnedRulesStore.getState().load('r1');
		await useLearnedRulesStore.getState().decide('r1', 't1', 'rejected');

		expect(useLearnedRulesStore.getState().rules[0]).toMatchObject({
			proposal: { state: 'proposed' },
			pending: null
		});

		expect(useLearnedRulesStore.getState().rules[0]?.error).not.toBeNull();
	});
});

describe('loading a repository’s learned rules', () => {
	test('an answer for an earlier repository is dropped', async () => {
		let releaseFirst: (response: Response) => void = () => {};

		globalThis.fetch = mock((input: string | URL) => {
			const path = new URL(String(input)).pathname;

			if (path === '/api/repos/a/learned-rules') {
				return new Promise<Response>((resolve) => (releaseFirst = resolve));
			}

			return Promise.resolve(json([proposal({ repoId: 'b', topic: { id: 't9', label: 'B rule' } })]));
		}) as unknown as typeof fetch;

		const first = useLearnedRulesStore.getState().load('a');

		await useLearnedRulesStore.getState().load('b');
		releaseFirst(json([proposal({ repoId: 'a' })]));
		await first;

		expect(useLearnedRulesStore.getState().repoId).toBe('b');
		expect(useLearnedRulesStore.getState().rules[0]?.proposal.repoId).toBe('b');
	});
});
