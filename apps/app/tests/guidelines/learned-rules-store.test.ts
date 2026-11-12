import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { LearnedRuleProposal } from '@recoder/shared';

import { useLearnedRulesStore } from '../../src/lib/guidelines/learned-rules-store';

/** The first rule the store holds for a repository. */
function firstRule(repoId: string) {
	return useLearnedRulesStore.getState().repos[repoId]?.rules[0];
}

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

/**
 * Puts `answer` in place of `fetch`. The cast is safe: the store calls fetch
 * with an address and an init only, and those are all `answer` reads.
 */
function stubFetch(answer: (input: string | URL, init?: RequestInit) => Response): void {
	globalThis.fetch = mock((input: string | URL, init?: RequestInit) =>
		Promise.resolve(answer(input, init))
	) as unknown as typeof fetch;
}

/** A fetch that lists one proposed rule and answers a decision write with `decide`. */
function stubRules(decide: () => Response): void {
	stubFetch((_input, init) => (init?.method === 'PUT' ? decide() : json([proposal()])));
}

afterEach(() => {
	globalThis.fetch = realFetch;
	useLearnedRulesStore.setState({ repos: {} });
});

describe('deciding a learned rule', () => {
	test('a decision replaces the row with the server’s answer', async () => {
		const saved = proposal({ state: 'approved', decidedAt: '2026-10-14T09:00:00.000Z' });

		stubRules(() => json(saved));

		await useLearnedRulesStore.getState().load('r1');
		await useLearnedRulesStore.getState().decide('r1', 't1', 'approved');

		expect(firstRule('r1')).toMatchObject({
			proposal: { state: 'approved', decidedAt: '2026-10-14T09:00:00.000Z' },
			pending: null,
			error: null
		});
	});

	test('a failed decision leaves the row and sets its error', async () => {
		stubRules(() => json({ error: 'The rule is gone.' }, 500));

		await useLearnedRulesStore.getState().load('r1');
		await useLearnedRulesStore.getState().decide('r1', 't1', 'rejected');

		expect(firstRule('r1')).toMatchObject({
			proposal: { state: 'proposed' },
			pending: null
		});

		expect(firstRule('r1')?.error).not.toBeNull();
	});
});

describe('loading learned rules', () => {
	test('two repositories asked for at once each keep their own rules', async () => {
		stubFetch((input) => {
			const repoId = new URL(String(input)).pathname.split('/')[3] ?? '';

			return json([proposal({ repoId, topic: { id: `t-${repoId}`, label: `${repoId} rule` } })]);
		});

		await Promise.all([useLearnedRulesStore.getState().load('a'), useLearnedRulesStore.getState().load('b')]);

		expect([firstRule('a')?.proposal.repoId, firstRule('b')?.proposal.repoId]).toEqual(['a', 'b']);
	});

	test('a refresh that fails keeps the rules already on screen', async () => {
		stubRules(() => json({}));
		await useLearnedRulesStore.getState().load('r1');

		stubFetch(() => json({ error: 'down' }, 500));
		await useLearnedRulesStore.getState().load('r1');

		expect(useLearnedRulesStore.getState().repos.r1).toMatchObject({ status: 'ready', rules: [{ pending: null }] });
	});
});
