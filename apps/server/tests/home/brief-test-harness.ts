import { clearHomeBriefCache } from '../../src/home/home-brief';
import { setReviewOverrides } from '../../src/review/session/review-settings';

const realFetch = globalThis.fetch;

export function resetBriefTestState(): void {
	globalThis.fetch = realFetch;
	setReviewOverrides({});
	clearHomeBriefCache();
}

export function configureTestOrchestrator(): void {
	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'k',
		models: [{ id: 'o', label: 'Orchestrator', model: 'orch-model', provider: 'openai-compatible' }],
		orchestratorModelId: 'o'
	});
}

export function stubOrchestratorReplies(replies: string[]): {
	bodies: { model: string; messages: { role: string; content: string }[] }[];
} {
	const bodies: { model: string; messages: { role: string; content: string }[] }[] = [];
	let call = 0;

	globalThis.fetch = Object.assign(
		async (_url: RequestInfo | URL, init?: RequestInit) => {
			const parsed: { model: string; messages: { role: string; content: string }[] } = JSON.parse(String(init?.body));

			bodies.push(parsed);

			const content = replies[Math.min(call++, replies.length - 1)] ?? '';

			return Response.json({ choices: [{ message: { content } }] });
		},
		{ preconnect: realFetch.preconnect }
	);

	return { bodies };
}
