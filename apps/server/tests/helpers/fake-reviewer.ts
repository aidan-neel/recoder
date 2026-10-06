import { afterEach } from 'bun:test';
import { resetLlmLimiter } from '../../src/models/llm';
import { subscribeReview } from '../../src/review/session/events';
import { getStoredSettings, setReviewOverrides } from '../../src/review/session/review-settings';
import type { PipelineRun, RunTokenCall, StoredMetrics } from '../../src/models/metrics';
import { db, reviewMetrics } from '../../src/store';

/** The models a review starts on, and the models the developer switches to. */
export const FIRST = ['lead-a', 'worker-a'];
export const SECOND = ['lead-b', 'worker-b'];

/**
 * Restores fetch, the model settings, the concurrency limit and the limiter after each test of the calling file,
 * then runs and clears the cleanups pushed onto the returned list.
 */
export function resetAfterEach(): (() => void)[] {
	const originalFetch = globalThis.fetch;
	const originalSettings = getStoredSettings();
	const originalConcurrency = process.env.RECODER_LLM_CONCURRENCY;
	const cleanups: (() => void)[] = [];

	afterEach(() => {
		globalThis.fetch = originalFetch;
		setReviewOverrides(originalSettings);

		if (originalConcurrency === undefined) delete process.env.RECODER_LLM_CONCURRENCY;
		else process.env.RECODER_LLM_CONCURRENCY = originalConcurrency;

		resetLlmLimiter();
		for (const cleanup of cleanups.splice(0)) cleanup();
	});

	return cleanups;
}

/** The PR #7 hunk of the local forge, which the reviewers examine. */
const HUNK = 'a.ts:1,3:1,4';

const NOTHING = { message: 'ok', findings: [], examinedHunks: [HUNK], subagents: [] };

const FINDING = {
	title: 'TWO is shouted',
	file: 'a.ts',
	line: 2,
	severity: 'medium',
	category: 'correctness',
	symbol: null,
	claim: {
		trigger: 'Reading line two',
		executionPath: [{ file: 'a.ts', line: 2, note: 'the changed line' }],
		consequence: 'The value is upper case',
		violatedContract: 'Line two stays lower case'
	},
	body: 'Line two changed case.'
};

const SUBAGENT = {
	concern: 'Line four',
	question: 'Does anything read line four?',
	scope: [{ path: 'a.ts', hunkIds: [HUNK] }],
	why: 'The line is new.'
};

/** One request the fake reviewer answered: the pipeline call it was, read from its prompts, and the model it named. */
export interface FakeRequest {
	kind: string;
	model: string;
}

/** Saves an endpoint with the models `ids`, the first two picked as the Review and second model. */
export function pickModels(ids: string[]): void {
	setReviewOverrides({
		baseUrl: 'http://locked-models.test/v1',
		apiKey: 'test',
		models: ids.map((id) => ({ id, label: id, model: id })),
		orchestratorModelId: ids[0],
		specialistModelId: ids[1],
		subagentCap: 2
	});
}

/** The kind of pipeline call a stubbed request is, read from its prompts. */
function kindOf(system: string, user: string): string {
	if (system.includes('You write the brief a code change is reviewed against')) return 'brief';
	if (system.includes('You verify one code review finding')) return 'verifier';
	if (system.includes('Role: subagent.')) return 'subagent';
	if (/^Unit \S+\/correctness:/m.test(user)) return 'correctness';
	if (/^Unit \S+:/m.test(user)) return 'lens';

	return 'other';
}

/** A chat completion whose message content is `body` as JSON. */
function reply(body: unknown): Response {
	return Response.json({
		choices: [{ message: { content: JSON.stringify(body) } }],
		usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 }
	});
}

/** The fake model's answer: the correctness reviewer reports one finding and asks one subagent; verifiers confirm it. */
function answer(kind: string, messages: { content: string }[]): Response {
	if (kind === 'brief') return reply({ summary: 'Changes a.ts.' });
	if (kind === 'correctness') return reply({ ...NOTHING, findings: [FINDING], subagents: [SUBAGENT] });
	if (kind !== 'verifier') return reply(NOTHING);

	const cited = /evidenceId=(ev_\d+)/.exec(messages.map((message) => message.content).join('\n'))?.[1];

	return reply(
		cited
			? { message: 'Traced it.', verdict: 'confirmed', reason: 'Line two is upper case.', evidenceIds: [cited] }
			: { message: 'Reading the diff.', actions: [{ action: 'readDiff', path: 'a.ts' }] }
	);
}

/**
 * A fetch that answers every model request of a review as a reviewer that finds one defect, and logs each request
 * into `requests`. `onRequest` runs before each answer, with the number of requests already answered.
 */
export function fakeReviewer(requests: FakeRequest[], onRequest: (answered: number) => void = () => {}): typeof fetch {
	return (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body)) as { model: string; messages: { content: string }[] };
		const kind = kindOf(String(body.messages[0]?.content ?? ''), String(body.messages[1]?.content ?? ''));

		onRequest(requests.length);
		requests.push({ kind, model: body.model });

		return answer(kind, body.messages);
	}) as typeof fetch;
}

/** Resolves once the review ends, passed or failed. */
export function reviewEnded(reviewId: string): Promise<void> {
	return new Promise((resolve) => {
		const off = subscribeReview(
			reviewId,
			() => {
				const status = db.reviews.get(reviewId)?.status;

				if (status === 'passed' || status === 'failed') {
					off();
					resolve();
				}
			},
			false
		);
	});
}

/** The review's stored pipeline runs and pipeline calls. */
export function storedRuns(reviewId: string): { runs: PipelineRun[] | undefined; calls: RunTokenCall[] } {
	const stored = reviewMetrics.get(reviewId) as StoredMetrics | undefined;

	return { runs: stored?.runs, calls: stored?.calls.filter((call) => call.scope === 'pipeline') ?? [] };
}
