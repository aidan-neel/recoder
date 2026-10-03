import { afterEach, expect, test } from 'bun:test';
import type { HomeBriefRequest } from '@recoder/shared';
import { cleanBrief, clearHomeBriefCache, homeBrief } from '../../src/home/home-brief';
import { setReviewOverrides } from '../../src/review/session/review-settings';

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
	setReviewOverrides({});
	clearHomeBriefCache();
});

const NOW = Date.parse('2026-09-22T19:30:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const input: HomeBriefRequest = {
	name: 'Aidan',
	dayPart: 'evening',
	prs: [
		{
			repoId: 'r2',
			repo: 'aidan-neel/sivir-ui',
			number: 158,
			title: 'Theme Studio',
			additions: 604,
			deletions: 137,
			changedFiles: 12,
			createdAt: hoursAgo(5)
		},
		{
			repoId: 'r1',
			repo: 'aidan-neel/recoder',
			number: 88,
			title: 'Adaptive planning',
			additions: 312,
			deletions: 96,
			changedFiles: 9,
			createdAt: hoursAgo(50)
		}
	],
	emptyRepos: ['aidan-neel/skills']
};

test('model output is trimmed to the brief', () => {
	expect(cleanBrief('Brief: "**Evening.** Two PRs\n are open."')).toBe('**Evening.** Two PRs are open.');
});

test('the brief uses the orchestrator model, drops the greeting the page adds itself, and is kept 12 hours across fact changes', async () => {
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
	const second = await homeBrief({ ...input, prs: [] }, []);

	expect(first.text).toBe('Two PRs are open.');
	expect(first.model).toBe('orch-model');
	expect(second).toEqual(first);
	expect(bodies).toHaveLength(1);
	expect(bodies[0].model).toBe('orch-model');
});
