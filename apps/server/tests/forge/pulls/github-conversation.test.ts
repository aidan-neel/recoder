import { afterEach, expect, test } from 'bun:test';
import { githubCommits, githubConversation } from '../../../src/forge/pulls/github-conversation';
import { restoreFetch, stubForge } from '../../helpers/forge-fetch';

afterEach(restoreFetch);

const user = (login: string) => ({ login, avatar_url: `https://avatars.example/${login}` });

test('the conversation is oldest first across comments, review summaries and inline comments', async () => {
	stubForge(({ url }) => {
		if (url.includes('/issues/7/comments')) {
			return [200, [{ id: 1, user: user('al'), body: 'Looks good', created_at: '2026-11-02T00:00:00Z' }]];
		}

		if (url.includes('/pulls/7/reviews')) {
			return [
				200,
				[
					{ id: 2, user: user('bo'), body: '', state: 'APPROVED', submitted_at: '2026-11-03T00:00:00Z' },
					{ id: 3, user: user('bo'), body: '', state: 'COMMENTED', submitted_at: '2026-11-01T12:00:00Z' },
					{ id: 4, user: user('bo'), body: 'draft', state: 'PENDING' }
				]
			];
		}

		return [
			200,
			[{ id: 5, user: user('cy'), body: 'Why?', path: 'a.ts', line: 3, created_at: '2026-11-01T00:00:00Z' }]
		];
	});

	const conversation = await githubConversation('o/r', 7);

	expect(conversation.map((entry) => [entry.kind, entry.id])).toEqual([
		['inline', 'inline:5'],
		['comment', 'comment:1'],
		['review', 'review:2']
	]);

	expect(conversation[0]).toMatchObject({ path: 'a.ts', line: 3 });
	expect(conversation[2]).toMatchObject({ verdict: 'approved', author: { login: 'bo' } });
});

test('a comment Recoder wrote is marked byRecoder', async () => {
	stubForge(({ url }) => [
		200,
		url.includes('/issues/7/comments')
			? [
					{ id: 1, user: user('al'), body: 'Thanks', created_at: '2026-11-01T00:00:00Z' },
					{ id: 2, user: user('al'), body: '<!-- recoder:summary -->\nSummary', created_at: '2026-11-02T00:00:00Z' },
					{ id: 3, user: user('recoder-bot'), body: 'Done', created_at: '2026-11-03T00:00:00Z' }
				]
			: []
	]);

	const conversation = await githubConversation('o/r', 7);

	expect(conversation.map((entry) => entry.byRecoder)).toEqual([false, true, true]);
});

test('a commit splits its message into a title and a body', async () => {
	stubForge(() => [
		200,
		[
			{
				sha: 'abc',
				html_url: 'https://github.com/o/r/commit/abc',
				author: null,
				commit: { message: 'Fix it\n\nBecause it broke.', author: { name: 'Al Ice', date: '2026-11-01T00:00:00Z' } }
			}
		]
	]);

	const [commit] = await githubCommits('o/r', 7);

	expect(commit).toEqual({
		sha: 'abc',
		title: 'Fix it',
		body: 'Because it broke.',
		author: { login: 'Al Ice', name: 'Al Ice', avatarUrl: null },
		authoredAt: '2026-11-01T00:00:00Z',
		url: 'https://github.com/o/r/commit/abc'
	});
});
