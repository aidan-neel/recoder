import { expect, test } from 'bun:test';
import type { ReviewChatMessage } from '@recoder/shared';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import { execUnavailableReason } from '../../../src/sandbox/exec-sandbox';
import {
	NOTHING,
	TWO_UNIT_DIFF,
	confirmingVerifier,
	finding,
	isVerifier,
	lensIdsOf,
	messagesOf,
	modelReply,
	restoreAfterEach,
	runnableCheckout,
	unitOf,
	useTwoModels
} from './harness-fixtures';

restoreAfterEach();

test.skipIf((await execUnavailableReason()) !== null)(
	'lens reviewers run on the Review model and verifiers on the second model',
	async () => {
		useTwoModels();

		const models: Record<string, Set<string>> = { reviewer: new Set(), verifier: new Set(), other: new Set() };
		const contexts: string[] = [];

		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			const unit = unitOf(init);
			const kind = unit ? 'reviewer' : isVerifier(init) ? 'verifier' : 'other';

			models[kind].add(body.model);
			if (unit) contexts.push(String(messagesOf(init).at(-1)?.content));
			if (kind === 'verifier') return modelReply(confirmingVerifier(init));

			const reply = unit === 'unit-1/correctness' ? { ...NOTHING, findings: [finding('possible miss')] } : NOTHING;

			return modelReply({ message: 'Checking the changed behavior.', ...reply });
		}) as unknown as typeof fetch;

		const messages: Array<Omit<ReviewChatMessage, 'at' | 'from'>> = [];

		const checkout = await runnableCheckout();

		try {
			const result = await runAdaptiveReview(
				{ diff: TWO_UNIT_DIFF, ...checkout.input },
				{
					onMessage: (message) => messages.push(message),
					getDiscussion: (assignmentId) => (assignmentId ? `Question for ${assignmentId}` : 'Shared conversation')
				}
			);

			expect(result.assignments.map((record) => [record.id, record.role, record.status])).toEqual(
				[...lensIdsOf('unit-1'), ...lensIdsOf('unit-2')].map((id) => [id, 'reviewer', 'done'])
			);

			expect([...models.reviewer]).toEqual(['lead']);
			expect([...models.verifier]).toEqual(['worker']);
			expect([...models.other].filter((model) => model !== 'lead')).toEqual([]);
			expect(contexts.some((context) => context.includes('Question for unit-1/correctness'))).toBe(true);

			expect(
				messages.some((message) => message.assignmentId === 'unit-1/correctness' && message.status === 'streaming')
			).toBe(true);
		} finally {
			await checkout.remove();
		}
	}
);
