import { describe, expect, test } from 'bun:test';
import type { Repo } from '@recoder/shared';

import { parsePullRef, repoFromLink, reposFor } from '../../src/lib/shell/pull-ref';

function repo(id: string, name: string, url: string): Repo {
	return { id, name, url, provider: 'github', defaultBranch: 'main', createdAt: '', updatedAt: '' };
}

const API = repo('r1', 'acme/api', 'https://github.com/acme/api');

const WEB = repo('r2', 'acme/web', 'https://github.com/acme/web');

const LAB = repo('r3', 'group/sub/tool', 'https://gitlab.com/group/sub/tool.git');

describe('parsePullRef', () => {
	test('reads a GitHub link with or without its scheme and trailing page', () => {
		expect(parsePullRef('https://github.com/acme/api/pull/12/files')).toEqual({
			number: 12,
			address: 'github.com/acme/api',
			name: null
		});

		expect(parsePullRef('github.com/Acme/API/pull/7')?.address).toBe('github.com/acme/api');
	});

	test('reads a GitLab merge request link in a subgroup', () => {
		expect(parsePullRef('https://gitlab.com/group/sub/tool/-/merge_requests/45')).toEqual({
			number: 45,
			address: 'gitlab.com/group/sub/tool',
			name: null
		});
	});

	test('reads a bare number, #N and a repository before #', () => {
		expect(parsePullRef('12')).toEqual({ number: 12, address: null, name: null });
		expect(parsePullRef(' #12 ')).toEqual({ number: 12, address: null, name: null });
		expect(parsePullRef('Acme/API#3')).toEqual({ number: 3, address: null, name: 'acme/api' });
	});

	test('names no pull request for text, zero, or a repository and number run together', () => {
		expect(parsePullRef('csv export')).toBeNull();
		expect(parsePullRef('#0')).toBeNull();
		expect(parsePullRef('api12')).toBeNull();
	});
});

describe('reposFor', () => {
	test('matches a link to the tracked repository by address, and a short name by its last segment', () => {
		expect(reposFor(parsePullRef('https://github.com/acme/web/pull/2')!, [API, WEB])).toEqual([WEB]);
		expect(reposFor(parsePullRef('https://gitlab.com/group/sub/tool/-/merge_requests/9')!, [API, LAB])).toEqual([LAB]);
		expect(reposFor(parsePullRef('api#4')!, [API, WEB])).toEqual([API]);
	});

	test('offers every tracked repository for a bare number, and none for an untracked link', () => {
		expect(reposFor(parsePullRef('#4')!, [API, WEB])).toEqual([API, WEB]);
		expect(reposFor(parsePullRef('https://github.com/other/thing/pull/1')!, [API, WEB])).toEqual([]);
	});
});

describe('repoFromLink', () => {
	test('reads the owner and name from a pull request or merge request link, keeping their case', () => {
		expect(repoFromLink('https://github.com/Acme/API/pull/12')).toBe('Acme/API');
		expect(repoFromLink('https://gitlab.com/group/sub/tool/-/merge_requests/45')).toBe('group/sub/tool');
		expect(repoFromLink('https://github.com/acme/api')).toBeNull();
	});
});
