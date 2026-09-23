import { afterEach, expect, test } from 'bun:test';
import type { HomeBriefRequest, Review } from '@recoder/shared';
import { briefFacts, cleanBrief, clearHomeBriefCache, homeBrief, latestReviews } from './home-brief';
import { setReviewOverrides } from './review-settings';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	setReviewOverrides({});
	clearHomeBriefCache();
});

const NOW = Date.parse('2026-09-22T19:30:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function review(partial: Partial<Review>): Review {
	return {
		id: crypto.randomUUID(),
		repoId: 'r1',
		prNumber: 88,
		headSha: 'x',
		status: 'passed',
		summary: null,
		findings: [],
		runs: [],
		source: 'github',
		prTitle: null,
		prUrl: null,
		createdAt: hoursAgo(20),
		updatedAt: hoursAgo(20),
		...partial
	};
}

const input: HomeBriefRequest = {
	name: 'Aidan',
	dayPart: 'evening',
	prs: [
		{ repoId: 'r2', repo: 'aidan-neel/sivir-ui', number: 158, title: 'Theme Studio', additions: 604, deletions: 137, changedFiles: 12, createdAt: hoursAgo(5) },
		{ repoId: 'r1', repo: 'aidan-neel/recoder', number: 88, title: 'Adaptive planning', additions: 312, deletions: 96, changedFiles: 9, createdAt: hoursAgo(50) }
	],
	emptyRepos: ['aidan-neel/skills']
};

test('facts join each PR with its latest review', () => {
	const high = { id: 'f', file: 'a.ts', severity: 'error' as const, message: 'x' };
	const facts = briefFacts(input, [review({ findings: [high] })], NOW);
	expect(facts).toContain('Greeting: Evening, Aidan.');
	expect(facts).toContain('Open PRs: 2 across 2 repos.');
	expect(facts).toContain('#158 "Theme Studio": +604 −137 in 12 files, opened 5h ago; never reviewed.');
	expect(facts).toContain('#88 "Adaptive planning"');
	expect(facts).toContain('reviewed 20h ago, 1 high finding.');
	expect(facts).toContain('Repos with no open PRs: aidan-neel/skills.');
});

test('a real review outranks a newer empty draft', () => {
	const done = review({ status: 'passed', updatedAt: hoursAgo(10) });
	const draft = review({ status: 'draft', updatedAt: hoursAgo(1) });
	expect(latestReviews([done, draft]).get('r1#88')?.id).toBe(done.id);
});

test('model output is trimmed to the brief', () => {
	expect(cleanBrief('Brief: "**Evening.** Two PRs\n are open."')).toBe('**Evening.** Two PRs are open.');
});

test('the brief uses the orchestrator model and is cached for identical facts', async () => {
	setReviewOverrides({
		baseUrl: 'http://model.test/v1',
		apiKey: 'k',
		models: [{ id: 'o', label: 'Orchestrator', model: 'orch-model', provider: 'openai-compatible' }],
		orchestratorModelId: 'o'
	});
	const bodies: { model: string }[] = [];
	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		bodies.push(JSON.parse(String(init?.body)));
		return Response.json({ choices: [{ message: { content: '**Evening, Aidan.** Two PRs are open.' } }] });
	}) as unknown as typeof fetch;

	const first = await homeBrief(input, []);
	const second = await homeBrief(input, []);
	expect(first.text).toBe('**Evening, Aidan.** Two PRs are open.');
	expect(first.model).toBe('orch-model');
	expect(second).toEqual(first);
	expect(bodies).toHaveLength(1);
	expect(bodies[0].model).toBe('orch-model');
});
