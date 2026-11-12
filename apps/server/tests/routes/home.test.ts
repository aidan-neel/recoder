import { afterEach, beforeEach, expect, test } from 'bun:test';
import { app } from '../../src/app';
import { clearHomeBriefCache } from '../../src/home/home-brief';
import { db } from '../../src/store';
import { configureTestOrchestrator, resetBriefTestState, stubOrchestratorReplies } from '../home/brief-test-harness';

beforeEach(() => {
	clearHomeBriefCache();
});

afterEach(async () => {
	await db.repos.delete('repo-gh');
	await db.repos.delete('repo-gl');
	resetBriefTestState();
});

test('POST /api/home/brief joins stored repositories to disambiguate same-named repos and return structured refs', async () => {
	configureTestOrchestrator();

	const now = '2026-09-22T19:30:00Z';

	await db.repos.set({
		id: 'repo-gh',
		name: 'acme/service',
		url: 'https://github.com/acme/service',
		provider: 'github',
		defaultBranch: 'main',
		createdAt: now,
		updatedAt: now
	});

	await db.repos.set({
		id: 'repo-gl',
		name: 'acme/service',
		url: 'https://gitlab.com/acme/service',
		provider: 'gitlab',
		defaultBranch: 'main',
		createdAt: now,
		updatedAt: now
	});

	const { bodies } = stubOrchestratorReplies(['[repo-gl#7] has **unreviewed changes**.']);

	const res = await app.request('/api/home/brief', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			dayPart: 'afternoon',
			prs: [
				{
					repoId: 'repo-gh',
					repo: 'acme/service',
					number: 7,
					headSha: 'sha-gh',
					title: 'GitHub change',
					additions: 10,
					deletions: 2,
					changedFiles: 1,
					createdAt: now
				},
				{
					repoId: 'repo-gl',
					repo: 'acme/service',
					number: 7,
					headSha: 'sha-gl',
					title: 'GitLab change',
					additions: 220,
					deletions: 40,
					changedFiles: 6,
					createdAt: now
				}
			]
		})
	});

	expect(res.status).toBe(200);

	const payload = await res.json();
	const capturedFacts = bodies[0]?.messages.find((m) => m.role === 'user')?.content ?? '';

	expect(capturedFacts).toContain('acme/service (GitHub) #7');
	expect(capturedFacts).toContain('acme/service (GitLab) #7');
	expect(payload.refs).toEqual([{ repoId: 'repo-gl', number: 7 }]);
	expect(payload.text).toBe('acme/service (GitLab) #7 has **unreviewed changes**.');
});

test('POST /api/home/brief rejects malformed head identifiers', async () => {
	configureTestOrchestrator();

	const res = await app.request('/api/home/brief', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			dayPart: 'morning',
			prs: [
				{
					repoId: 'r1',
					repo: 'acme/service',
					number: 1,
					headSha: 'sha1\nr2#2@sha2',
					title: 'Injected head identifier',
					additions: 5,
					deletions: 1,
					changedFiles: 1,
					createdAt: '2026-09-22T19:30:00Z'
				}
			]
		})
	});

	expect(res.status).toBe(400);
});
