import { expect, test } from 'bun:test';
import { githubHook, gitlabHook } from '../../../src/forge/watch/webhook-payloads';

const repo = { html_url: 'https://github.com/acme/app' };
const project = { web_url: 'https://gitlab.acme.test/group/app' };

/** A GitHub `pull_request` payload; `merged` is only meaningful on `closed`. */
function githubPullRequest(overrides: Record<string, unknown> = {}) {
	return {
		number: 5,
		head: { sha: 'abc' },
		draft: false,
		state: 'open',
		merged: null,
		...overrides
	};
}

/** A GitLab `merge_request` webhook: `object_attributes` carries the merge request and its state. */
function gitlabMergeRequest(attributes: Record<string, unknown>) {
	return { object_kind: 'merge_request', project, object_attributes: { iid: 4, sha: 'abc', ...attributes } };
}

test('a GitHub pull request closed by merging reports merged with no review event', () => {
	const hook = githubHook('pull_request', {
		action: 'closed',
		repository: repo,
		pull_request: githubPullRequest({ state: 'closed', merged: true })
	});

	expect(hook).toMatchObject({ pull: { number: 5 }, state: 'merged' });
	expect(hook?.event).toBeUndefined();
});

test('a GitHub pull request closed without merging reports closed with no review event', () => {
	const hook = githubHook('pull_request', {
		action: 'closed',
		repository: repo,
		pull_request: githubPullRequest({ state: 'closed', merged: false })
	});

	expect(hook).toMatchObject({ pull: { number: 5 }, state: 'closed' });
	expect(hook?.event).toBeUndefined();
});

test('a GitHub reopened pull request is an opened event reporting open', () => {
	const hook = githubHook('pull_request', { action: 'reopened', repository: repo, pull_request: githubPullRequest() });

	expect(hook).toMatchObject({ pull: { number: 5 }, state: 'open', event: { kind: 'opened' } });
});

test('a GitHub pull request event on an open pull request reports open whatever the action', () => {
	const hook = githubHook('pull_request', { action: 'labeled', repository: repo, pull_request: githubPullRequest() });

	expect(hook).toMatchObject({ pull: { number: 5 }, state: 'open' });
	expect(hook?.event).toBeUndefined();
});

test('a GitLab merge_request merged on the forge reports merged with no review event', () => {
	const hook = gitlabHook(gitlabMergeRequest({ state: 'merged', action: 'merge' }));

	expect(hook).toMatchObject({ pull: { number: 4 }, state: 'merged' });
	expect(hook?.event).toBeUndefined();
});

test('a GitLab merge_request closed on the forge reports closed with no review event', () => {
	const hook = gitlabHook(gitlabMergeRequest({ state: 'closed', action: 'close' }));

	expect(hook).toMatchObject({ pull: { number: 4 }, state: 'closed' });
	expect(hook?.event).toBeUndefined();
});

test('a GitLab merge_request reopened on the forge is an opened event reporting open', () => {
	const hook = gitlabHook(gitlabMergeRequest({ state: 'opened', action: 'reopen' }));

	expect(hook).toMatchObject({ pull: { number: 4 }, state: 'open', event: { kind: 'opened' } });
});

test('a GitLab merge_request update with new commits is a push event reporting open', () => {
	const hook = gitlabHook(gitlabMergeRequest({ state: 'opened', action: 'update', oldrev: 'def' }));

	expect(hook).toMatchObject({ pull: { number: 4 }, state: 'open', event: { kind: 'pushed' } });
});
