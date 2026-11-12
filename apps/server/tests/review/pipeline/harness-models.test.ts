import { expect, test } from 'bun:test';
import type { ReviewChatMessage } from '@recoder/shared';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import { getStoredSettings, setReviewOverrides } from '../../../src/review/session/review-settings';
import { execUnavailableReason } from '../../../src/sandbox/exec-sandbox';
import {
	NOTHING,
	TWO_REVIEWERS,
	TWO_UNIT_DIFF,
	confirmingVerifier,
	finding,
	isVerifier,
	messagesOf,
	modelReply,
	restoreAfterEach,
	runnableCheckout,
	unitOf,
	useTwoModels
} from './harness-fixtures';

restoreAfterEach();

/** Configures `lead` for reviewers, `worker` for subagents and `judge` at `high` effort for verifiers. */
function useSeparateVerifier(): void {
	useTwoModels();

	setReviewOverrides({
		...getStoredSettings(),
		models: [
			{ id: 'lead', label: 'Lead', model: 'lead', efforts: ['low', 'medium', 'high'] },
			{ id: 'worker', label: 'Worker', model: 'worker', efforts: ['low', 'medium', 'high'] },
			{ id: 'judge', label: 'Judge', model: 'judge', efforts: ['low', 'medium', 'high'] }
		],
		orchestratorModelId: 'lead',
		orchestratorEffort: 'medium',
		specialistModelId: 'worker',
		specialistEffort: 'low',
		verifierModelId: 'judge',
		verifierEffort: 'high'
	});
}

/** Stubbed reviewer answer: `reviewer-1` raises one finding titled `title`, every other reviewer reports nothing. */
function reviewerReply(unit: string | null, title = 'possible miss'): Response {
	const reply = unit === 'reviewer-1' ? { ...NOTHING, findings: [finding(title)] } : NOTHING;

	return modelReply({ message: 'Checking the changed behavior.', ...reply });
}

test.skipIf((await execUnavailableReason()) !== null)(
	'verifiers follow the Review model by default even when a separate specialist model is set',
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

			return kind === 'verifier' ? modelReply(confirmingVerifier(init)) : reviewerReply(unit);
		}) as unknown as typeof fetch;

		const messages: Array<Omit<ReviewChatMessage, 'at' | 'from'>> = [];

		const checkout = await runnableCheckout();

		try {
			const result = await runAdaptiveReview(
				{ diff: TWO_UNIT_DIFF, ...checkout.input },
				{
					onMessage: (message) => messages.push(message),
					getDiscussion: async (assignmentId) => (assignmentId ? `Question for ${assignmentId}` : 'Shared conversation')
				}
			);

			expect(result.assignments.map((record) => [record.id, record.role, record.status])).toEqual(
				TWO_REVIEWERS.map((id) => [id, 'reviewer', 'done'])
			);

			expect([...models.reviewer]).toEqual(['lead']);
			expect([...models.verifier]).toEqual(['lead']);
			expect([...models.other].filter((model) => model !== 'lead')).toEqual([]);
			expect(result.findings[0]?.model).toBe('lead');
			expect(result.findings[0]?.verification?.model).toBe('lead');
			expect(contexts.some((context) => context.includes('Question for reviewer-1'))).toBe(true);

			expect(messages.some((message) => message.assignmentId === 'reviewer-1' && message.status === 'streaming')).toBe(
				true
			);
		} finally {
			await checkout.remove();
		}
	}
);

test.skipIf((await execUnavailableReason()) !== null)(
	'setting verifierModelId and verifierEffort routes only verifiers to that model and records both on the finding',
	async () => {
		useSeparateVerifier();

		const calls: Record<string, Array<{ model: string; effort?: string }>> = {
			reviewer: [],
			verifier: [],
			other: []
		};

		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { model: string; reasoning_effort?: string };
			const unit = unitOf(init);
			const kind = unit ? 'reviewer' : isVerifier(init) ? 'verifier' : 'other';

			calls[kind].push({ model: body.model, effort: body.reasoning_effort });

			return kind === 'verifier' ? modelReply(confirmingVerifier(init)) : reviewerReply(unit);
		}) as unknown as typeof fetch;

		const checkout = await runnableCheckout();

		try {
			const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, ...checkout.input });

			expect(new Set(calls.reviewer.map((call) => call.model))).toEqual(new Set(['lead']));
			expect(new Set(calls.verifier.map((call) => call.model))).toEqual(new Set(['judge']));
			expect(new Set(calls.verifier.map((call) => call.effort))).toEqual(new Set(['high']));
			expect(calls.other.every((call) => call.model === 'lead')).toBe(true);
			expect(result.findings[0]?.model).toBe('lead');

			expect(result.findings[0]?.verification).toMatchObject({
				status: 'verified',
				model: 'judge',
				effort: 'high'
			});
		} finally {
			await checkout.remove();
		}
	}
);

test.skipIf((await execUnavailableReason()) !== null)(
	'a refuted candidate keeps the verifier model and effort on its unconfirmed verification record',
	async () => {
		useSeparateVerifier();

		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			if (isVerifier(init)) {
				const last = String(messagesOf(init).at(-1)?.content ?? '');
				const cited = /evidenceId=(ev_\d+)/.exec(last)?.[1];

				return modelReply(
					cited
						? { message: 'Checked.', verdict: 'refuted', reason: 'The value is kept.', evidenceIds: [cited] }
						: { message: 'Running check.', actions: [{ action: 'run', command: 'true' }] }
				);
			}

			return reviewerReply(unitOf(init), 'false alarm');
		}) as unknown as typeof fetch;

		const checkout = await runnableCheckout();

		try {
			const result = await runAdaptiveReview({ diff: TWO_UNIT_DIFF, ...checkout.input });

			expect(result.findings).toHaveLength(0);

			expect(result.unconfirmed[0]?.verification).toMatchObject({
				status: 'unverified',
				outcome: 'refuted',
				model: 'judge',
				effort: 'high'
			});
		} finally {
			await checkout.remove();
		}
	}
);
