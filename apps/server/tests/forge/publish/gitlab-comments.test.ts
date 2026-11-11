import { afterEach, expect, test } from 'bun:test';
import { GhError } from '../../../src/forge/cli';
import { gitlabComments } from '../../../src/forge/publish/gitlab-comments';
import { restoreFetch, stubForge } from '../../helpers/forge-fetch';

const ENV = { GITLAB_TOKEN: 'glpat', GITLAB_HOST: 'git.acme.dev' };
const MR = 'https://git.acme.dev/api/v4/projects/team%2Fapp/merge_requests/9';
const DIFF_REFS = { base_sha: 'base', start_sha: 'start', head_sha: 'head' };

afterEach(restoreFetch);

test('pins an inline note to the merge request’s diff refs on a self-managed host', async () => {
	const calls = stubForge((call) =>
		call.method === 'GET'
			? [200, { web_url: 'https://git.acme.dev/team/app/-/merge_requests/9', diff_refs: DIFF_REFS }]
			: [201, { id: 'd1', notes: [{ id: 77 }] }]
	);

	const forge = gitlabComments('team/app', 9, null, ENV);

	const posted = await forge.createInline('body', {
		path: 'src/a.ts',
		oldPath: 'src/a.ts',
		side: 'new',
		oldLine: 10,
		newLine: 12
	});

	const post = calls.find((call) => call.method === 'POST')!;

	expect(post.url).toBe(`${MR}/discussions`);

	expect(post.body?.position).toEqual({
		position_type: 'text',
		base_sha: 'base',
		start_sha: 'start',
		head_sha: 'head',
		old_path: 'src/a.ts',
		new_path: 'src/a.ts',
		old_line: 10,
		new_line: 12
	});

	expect(posted).toEqual({ id: '77', url: 'https://git.acme.dev/team/app/-/merge_requests/9#note_77' });
});

test('replies in the mention’s discussion when one is given', async () => {
	const calls = stubForge(() => [201, { id: 5 }]);

	await gitlabComments('team/app', 9, 'https://git.acme.dev/team/app/-/merge_requests/9', ENV).create('hi', 'abc');

	expect(calls[0].url).toBe(`${MR}/discussions/abc/notes`);
});

test('a refused write says the token needs the api scope', async () => {
	stubForge(() => [403, { message: '403 Forbidden' }]);

	const error = await gitlabComments('team/app', 9, 'https://x', ENV)
		.edit('5', 'body')
		.catch((err: unknown) => err);

	expect(error).toBeInstanceOf(GhError);
	expect((error as GhError).kind).toBe('auth');
	expect((error as GhError).message).toContain('api scope');
});
