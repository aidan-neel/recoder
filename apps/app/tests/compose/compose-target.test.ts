import { describe, expect, test } from 'bun:test';
import type { Repo } from '@recoder/shared';

import { takePull } from '../../src/lib/compose/compose-target';
import type { TargetContext } from '../../src/lib/pulls/pull-target';

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

function context(change: Partial<TargetContext> = {}): TargetContext {
	return {
		repos: [repo('r1', 'acme/api'), repo('r2', 'acme/web')],
		pulls: [],
		base: '/sample',
		repoId: 'r1',
		...change
	};
}

const API_PULL = { kind: 'pull', repoId: 'r1', repoName: 'api', number: 12, href: '/sample/pulls/r1/12' } as const;

describe('takePull', () => {
	test('a pasted link moves into the pick and leaves the brief empty', () => {
		const take = takePull('https://github.com/acme/api/pull/12', context(), true);

		expect(take).toEqual({ kind: 'taken', target: API_PULL, text: '' });
	});

	test('a number followed by a space is taken and the brief stays', () => {
		expect(takePull('#12 look at the lease', context(), false)).toEqual({
			kind: 'taken',
			target: API_PULL,
			text: 'look at the lease'
		});
	});

	test('a number still being typed stays in the field', () => {
		expect(takePull('#1', context(), false)).toBeNull();
	});

	test('a number the person ends with Enter is taken at once', () => {
		expect(takePull('#12', context(), true)).toEqual({ kind: 'taken', target: API_PULL, text: '' });
	});

	test('a bare number or a branch is a brief, not a pull request', () => {
		expect(takePull('3 things to check', context(), true)).toBeNull();
		expect(takePull('fix/lease', context(), true)).toBeNull();
	});

	test('a link inside a sentence is taken out of it', () => {
		const take = takePull('Check the retries in https://github.com/acme/api/pull/12 please', context(), true);

		expect(take).toEqual({ kind: 'taken', target: API_PULL, text: 'Check the retries in please' });
	});

	test('a link to a repository that is not tracked is taken as an untracked pull request', () => {
		const take = takePull('https://github.com/other/lib/pull/5', context(), true);

		expect(take).toMatchObject({ kind: 'taken', target: { kind: 'untracked', number: 5 }, text: '' });
	});

	test('a reference to an unknown repository is refused with its reason', () => {
		expect(takePull('nosuch#12 check retries', context(), false)).toEqual({
			kind: 'refused',
			reason: 'No tracked repository is called nosuch.',
			text: 'check retries'
		});
	});

	test('a question that names no pull request is left alone', () => {
		expect(takePull('Why does the lease renew twice? ', context(), true)).toBeNull();
	});
});
