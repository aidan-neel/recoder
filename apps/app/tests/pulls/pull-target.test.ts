import { describe, expect, test } from 'bun:test';
import type { PullListItem, Repo } from '@recoder/shared';

import { readTarget, type TargetContext } from '../../src/lib/pulls/pull-target';

function repo(id: string, name: string): Repo {
	return {
		id,
		name,
		url: `https://github.com/${name}`,
		provider: 'github',
		defaultBranch: 'main',
		createdAt: '',
		updatedAt: ''
	};
}

const API = repo('r1', 'acme/api');

const WEB = repo('r2', 'acme/web');

const OPEN: PullListItem = {
	repoId: 'r1',
	pull: {
		number: 158,
		title: 'Lease',
		url: 'https://github.com/acme/api/pull/158',
		author: 'ana',
		base: 'main',
		headRef: 'fix/lease',
		headSha: 'abc',
		additions: 1,
		deletions: 1,
		changedFiles: 1,
		createdAt: ''
	},
	status: { state: 'open', draft: false, mergeability: 'clean', updatedAt: '', checks: null, commits: 1 },
	review: null
};

function context(change: Partial<TargetContext> = {}): TargetContext {
	return { repos: [API, WEB], pulls: [OPEN], base: '/sample', repoId: null, ...change };
}

describe('readTarget', () => {
	test('a link to a tracked repository opens its pull request, with the brief after it', () => {
		expect(readTarget('https://github.com/acme/web/pull/12 — check retries', context())).toEqual({
			target: { kind: 'pull', repoId: 'r2', repoName: 'web', number: 12, href: '/sample/pulls/r2/12' },
			brief: 'check retries',
			reference: 'https://github.com/acme/web/pull/12'
		});
	});

	test('a link to an untracked repository names the repository to track', () => {
		expect(readTarget('github.com/other/thing/pull/3', context()).target).toEqual({
			kind: 'untracked',
			repoUrl: 'https://github.com/other/thing',
			repoName: 'other/thing',
			number: 3
		});
	});

	test('a bare number is looked up in the chosen repository, words after it included', () => {
		expect(readTarget('158 look at the lease handling', context({ repoId: 'r1' }))).toMatchObject({
			target: { kind: 'pull', repoId: 'r1', number: 158 },
			brief: 'look at the lease handling'
		});
	});

	test('a bare number with several tracked repositories and none chosen asks for the repository', () => {
		expect(readTarget('#158', context()).target.kind).toBe('invalid');
	});

	test('a short name picks its repository', () => {
		expect(readTarget('web#4', context()).target).toMatchObject({ kind: 'pull', repoId: 'r2', number: 4 });
		expect(readTarget('docs#4', context()).target.kind).toBe('invalid');
	});

	test('a branch name finds the open pull request from it', () => {
		expect(readTarget('fix/lease: only the timeout', context({ repoId: 'r1' }))).toMatchObject({
			target: { kind: 'pull', number: 158 },
			brief: 'only the timeout'
		});

		expect(readTarget('fix/other', context({ repoId: 'r1' })).target.kind).toBe('invalid');
	});

	test('a sentence that links one pull request reviews it, and the whole sentence is the brief', () => {
		const sentence =
			'Review https://github.com/acme/web/pull/12 first, then (https://github.com/acme/web/pull/12/files).';

		expect(readTarget(sentence, context())).toEqual({
			target: { kind: 'pull', repoId: 'r2', repoName: 'web', number: 12, href: '/sample/pulls/r2/12' },
			brief: sentence,
			reference: 'https://github.com/acme/web/pull/12'
		});
	});

	test('a sentence that links two pull requests names no target, and says to put one first', () => {
		const sentence = 'Compare https://github.com/acme/web/pull/12 with https://github.com/acme/api/pull/158';

		expect(readTarget(sentence, context())).toEqual({
			target: { kind: 'invalid', reason: 'More than one pull request is linked. Put the one to review first.' },
			brief: null,
			reference: null
		});
	});

	test('a number or a branch at the start wins over a link later in the text', () => {
		const later = 'like https://github.com/acme/web/pull/12';

		expect(readTarget(`158 ${later}`, context({ repoId: 'r1' }))).toMatchObject({
			target: { kind: 'pull', repoId: 'r1', number: 158 },
			brief: later
		});

		expect(readTarget(`fix/lease ${later}`, context({ repoId: 'r1' }))).toMatchObject({
			target: { kind: 'pull', repoId: 'r1', number: 158 },
			brief: later
		});
	});

	test('a link that is no pull request stays no target, wherever it is', () => {
		expect(readTarget('See https://github.com/acme/api/issues/9', context()).target.kind).toBe('invalid');
	});

	test('empty text points at nothing yet', () => {
		expect(readTarget('   ', context())).toEqual({ target: { kind: 'empty' }, brief: null, reference: null });
	});
});
