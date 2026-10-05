import { afterEach, expect, test } from 'bun:test';
import type { Repo } from '@recoder/shared';
import { gatherChangeContext, prsForCommit } from '../../../src/forge/pr-context';

const realFetch = globalThis.fetch;
const signal = new AbortController().signal;

afterEach(() => {
	globalThis.fetch = realFetch;
});

function repo(url: string, provider: Repo['provider']): Repo {
	return { id: `repo-${provider}`, name: 'app', url, provider, defaultBranch: 'main', createdAt: '', updatedAt: '' };
}

/** Answers each request with the first route whose key the URL contains; anything else is a 404. */
function routes(table: [string, unknown][]): string[] {
	const seen: string[] = [];

	globalThis.fetch = (async (input: RequestInfo | URL) => {
		const url = String(input);
		const hit = table.find(([key]) => url.includes(key));

		seen.push(url);

		return hit ? Response.json(hit[1]) : new Response('{"message":"Not Found"}', { status: 404 });
	}) as typeof fetch;

	return seen;
}

const user = (login: string) => ({ login });

test('a GitHub PR becomes sorted, clipped sources without Recoder comments, with its stack', async () => {
	routes([
		['graphql', { data: { repository: { pullRequest: { closingIssuesReferences: { nodes: [{ number: 9 }] } } } } }],
		[
			'/pulls/5/comments',
			[
				{ id: 2, in_reply_to_id: 1, body: 'agreed', user: user('bo'), created_at: '2026-01-02T00:00:00Z' },
				{ id: 1, path: 'a.ts', line: 3, body: 'why?', user: user('al'), created_at: '2026-01-01T00:00:00Z' }
			]
		],
		['/pulls/5/reviews', [{ id: 7, body: '', user: user('al'), submitted_at: '2026-01-03T00:00:00Z' }]],
		['/pulls/5/commits', [{ sha: 'abcdef1234', commit: { message: 'Add cache\n\nSee #4', author: { name: 'Al' } } }]],
		[
			'/pulls/5',
			{
				number: 5,
				title: 'Cache intents',
				body: `Closes #9. ${'z'.repeat(5000)}`,
				user: user('al'),
				head: { ref: 'feat', sha: 'head1' },
				base: { ref: 'base-branch' },
				requested_reviewers: [user('bo')],
				labels: [{ name: 'perf' }]
			}
		],
		[
			'/issues/5/comments',
			[
				{ id: 11, body: 'ship it', user: user('bo'), created_at: '2026-01-02T00:00:00Z' },
				{ id: 10, body: 'first', user: user('al'), created_at: '2026-01-01T00:00:00Z' },
				{ id: 12, body: '<!-- recoder --> summary', user: user('ci'), created_at: '2026-01-03T00:00:00Z' }
			]
		],
		['/issues/9/comments', []],
		['/issues/9', { title: 'Slow', body: 'It is slow', user: user('cy') }],
		['/issues/4', { title: 'A PR', body: '', pull_request: {} }],
		['head=octo%3Abase-branch', [{ number: 3, title: 'Base work', body: 'parent', head: { ref: 'base-branch' } }]],
		['base=feat', [{ number: 8, title: 'Next', body: 'child', base: { ref: 'feat' } }]]
	]);

	const context = await gatherChangeContext(repo('https://github.com/octo/app', 'github'), 5, 'github', signal);

	expect(context.sources.map((source) => source.ref)).toEqual([
		'pr',
		'stack:#3',
		'stack:#8',
		'issue:#9',
		'thread:#5/1',
		'comment:pr/1',
		'comment:pr/2',
		'commit:abcdef1'
	]);

	expect(context.sources[0].text.length).toBeLessThanOrEqual(4001);
	expect(context.sources.find((source) => source.ref === 'thread:#5/1')?.text).toBe('al: why?\n\nbo: agreed');
	expect(context.stack.parent?.number).toBe(3);
	expect(context.stack.children.map((child) => child.number)).toEqual([8]);
	expect(context.people).toContain('Reviewers: bo');
});

test('a GitLab MR splits discussions into comments and threads and drops system notes', async () => {
	routes([
		[
			'merge_requests/4/discussions',
			[
				{ notes: [{ id: 1, body: 'looks fine', author: { username: 'al' }, created_at: '2026-01-01T00:00:00Z' }] },
				{ notes: [{ id: 2, body: 'added 1 commit', system: true, author: { username: 'al' } }] },
				{
					notes: [
						{
							id: 3,
							body: 'off by one',
							author: { username: 'bo' },
							created_at: '2026-01-02T00:00:00Z',
							position: { new_path: 'b.ts', new_line: 8 }
						}
					]
				}
			]
		],
		['merge_requests/4/commits', []],
		['merge_requests/4/closes_issues', [{ iid: 2, project_id: 77 }]],
		['merge_requests/4/related_issues', []],
		[
			'merge_requests/4',
			{ iid: 4, project_id: 77, title: 'Fix', description: 'Body', source_branch: 'fix', target_branch: 'main' }
		],
		['issues/2/notes', []],
		['issues/2', { title: 'Bug', description: 'Broken' }],
		['merge_requests?state=opened', []]
	]);

	const context = await gatherChangeContext(repo('https://gitlab.com/g/app', 'gitlab'), 4, 'gitlab', signal);

	expect(context.sources.map((source) => [source.ref, source.title ?? '', source.text])).toEqual([
		['pr', 'Fix', 'Body'],
		['issue:#2', 'Bug', 'Broken'],
		['thread:#4/1', 'b.ts:8', 'bo: off by one'],
		['comment:pr/1', '', 'looks fine']
	]);
});

test('an unreachable host gives an empty context and no commit PRs', async () => {
	routes([]);

	const github = repo('https://github.com/octo/app', 'github');

	expect(await gatherChangeContext(github, 5, 'github', signal)).toEqual({
		sources: [],
		stack: { parent: null, children: [] },
		people: ''
	});

	expect(await prsForCommit(github, 'github', 'abc', signal)).toEqual([]);
});
