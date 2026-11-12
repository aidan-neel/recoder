import { afterEach, beforeEach, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HomeBriefRequest, Repo } from '@recoder/shared';
import { cleanBrief, clearHomeBriefCache, homeBrief } from '../../src/home/home-brief';
import { serverDataDir } from '../../src/util/data-dir';
import { configureTestOrchestrator, resetBriefTestState, stubOrchestratorReplies } from './brief-test-harness';

beforeEach(() => {
	clearHomeBriefCache();
});

afterEach(() => {
	resetBriefTestState();
});

const NOW = Date.parse('2026-09-22T19:30:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const baseInput: HomeBriefRequest = {
	name: 'Aidan',
	dayPart: 'evening',
	prs: [
		{
			repoId: 'r2',
			repo: 'aidan-neel/sivir-ui',
			number: 158,
			headSha: 'sha-158',
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
			headSha: 'sha-88',
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

test('the brief reuses the cache for an unchanged pull request snapshot and returns structured repository references', async () => {
	configureTestOrchestrator();

	const { bodies } = stubOrchestratorReplies(['**Evening, Aidan.** [r2#158] is 741 lines and **never reviewed**.']);
	const first = await homeBrief(baseInput, []);
	const reordered = await homeBrief({ ...baseInput, dayPart: 'night', prs: [...baseInput.prs].reverse() }, []);

	expect(first.text).toBe('#158 is 741 lines and **never reviewed**.');
	expect(first.refs).toEqual([{ repoId: 'r2', number: 158 }]);
	expect(first.model).toBe('orch-model');
	expect(reordered).toEqual(first);
	expect(bodies).toHaveLength(1);
});

test('the cache does not serve a brief when a pull request opens, closes, or advances its head commit', async () => {
	configureTestOrchestrator();

	const { bodies } = stubOrchestratorReplies([
		'[r2#158] is **unreviewed**.',
		'[r1#88] is the only open PR.',
		'[r1#88] has a **new commit**.'
	]);

	const initial = await homeBrief(baseInput, []);
	const afterClose = await homeBrief({ ...baseInput, prs: [baseInput.prs[1]] }, []);
	const afterNewHead = await homeBrief({ ...baseInput, prs: [{ ...baseInput.prs[1], headSha: 'sha-88-next' }] }, []);

	expect(bodies).toHaveLength(3);
	expect(initial.refs).toEqual([{ repoId: 'r2', number: 158 }]);
	expect(afterClose.refs).toEqual([{ repoId: 'r1', number: 88 }]);
	expect(afterNewHead.text).toBe('#88 has a **new commit**.');
	expect(afterNewHead.snapshot).not.toBe(afterClose.snapshot);
});

test('repositories sharing a name and pull request number are disambiguated from stored repository URLs and providers', async () => {
	configureTestOrchestrator();

	const repos: Repo[] = [
		{
			id: 'r-acme',
			name: 'api',
			url: 'https://github.com/acme/api',
			provider: 'github',
			defaultBranch: 'main',
			createdAt: hoursAgo(100),
			updatedAt: hoursAgo(100)
		},
		{
			id: 'r-beta',
			name: 'api',
			url: 'https://github.com/beta/api',
			provider: 'github',
			defaultBranch: 'main',
			createdAt: hoursAgo(100),
			updatedAt: hoursAgo(100)
		}
	];

	const colliding: HomeBriefRequest = {
		dayPart: 'morning',
		prs: [
			{
				repoId: 'r-acme',
				repo: 'api',
				number: 42,
				headSha: 'sha-a',
				title: 'Rate limiter',
				additions: 40,
				deletions: 10,
				changedFiles: 2,
				createdAt: hoursAgo(3)
			},
			{
				repoId: 'r-beta',
				repo: 'api',
				number: 42,
				headSha: 'sha-b',
				title: 'Auth token rotation',
				additions: 380,
				deletions: 90,
				changedFiles: 8,
				createdAt: hoursAgo(4)
			}
		]
	};

	const { bodies } = stubOrchestratorReplies(['[r-beta#42] is 470 lines and **never reviewed**.']);
	const result = await homeBrief(colliding, [], repos);
	const userMessage = bodies[0]?.messages.find((m) => m.role === 'user')?.content ?? '';

	expect(userMessage).toContain('2 repos');
	expect(userMessage).toContain('[r-acme#42] acme/api #42');
	expect(userMessage).toContain('[r-beta#42] beta/api #42');
	expect(result.text).toBe('beta/api #42 is 470 lines and **never reviewed**.');
	expect(result.refs).toEqual([{ repoId: 'r-beta', number: 42 }]);
});

test('a persisted brief written with an older cache version is ignored', async () => {
	configureTestOrchestrator();

	writeFileSync(
		join(serverDataDir(), 'home-brief.json'),
		JSON.stringify({
			version: 3,
			text: 'Stale cached brief.',
			refs: [{ repoId: 'r2', number: 158 }],
			snapshot: 'r1#88@sha-88\nr2#158@sha-158',
			generatedAt: new Date().toISOString(),
			model: 'orch-model'
		})
	);

	const { bodies } = stubOrchestratorReplies(['[r2#158] needs **fresh attention**.']);
	const fresh = await homeBrief(baseInput, []);

	expect(bodies).toHaveLength(1);
	expect(fresh.text).toBe('#158 needs **fresh attention**.');
});
