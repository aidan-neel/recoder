import { describe, expect, test } from 'bun:test';

import { parseRepoInput, repoKey } from '../../src/lib/connections/repo-input';

describe('parseRepoInput', () => {
	test('owner/name reads as a GitHub repository', () => {
		expect(parseRepoInput(' acme/api.git ')).toEqual({
			ok: true,
			repo: { name: 'acme/api', url: 'https://github.com/acme/api', provider: 'github' }
		});
	});

	test('a GitHub link to a page inside the repository names the repository', () => {
		expect(parseRepoInput('https://www.github.com/acme/api/pull/12/files')).toMatchObject({
			ok: true,
			repo: { name: 'acme/api', url: 'https://github.com/acme/api' }
		});
	});

	test('a host followed by a path is read as a link, not as owner/name', () => {
		expect(parseRepoInput('gitlab.com/group/project')).toMatchObject({
			ok: true,
			repo: { name: 'group/project', provider: 'gitlab' }
		});
	});

	test('an SSH address keeps GitLab subgroups and becomes an https URL', () => {
		expect(parseRepoInput('git@gitlab.com:group/sub/project.git')).toEqual({
			ok: true,
			repo: { name: 'group/sub/project', url: 'https://gitlab.com/group/sub/project', provider: 'gitlab' }
		});
	});

	test('a GitLab link drops the page after /-/', () => {
		expect(parseRepoInput('https://gitlab.com/group/project/-/merge_requests/3')).toMatchObject({
			ok: true,
			repo: { name: 'group/project', url: 'https://gitlab.com/group/project' }
		});
	});

	test('a self-managed GitLab host is accepted only once Settings holds it', () => {
		expect(parseRepoInput('https://code.acme.dev/team/app', 'code.acme.dev')).toMatchObject({
			ok: true,
			repo: { name: 'team/app', url: 'https://code.acme.dev/team/app', provider: 'gitlab' }
		});

		expect(parseRepoInput('https://code.acme.dev/team/app')).toEqual({
			ok: false,
			error: 'Recoder tracks GitHub and GitLab repositories.'
		});
	});

	test('a GitLab link with only a group asks for the project', () => {
		expect(parseRepoInput('https://gitlab.com/group')).toEqual({
			ok: false,
			error: 'Enter the group and project, like group/project.'
		});
	});

	test('a file:// URL tracks a local repository named after its folder', () => {
		expect(parseRepoInput('file:///home/me/code/api/')).toEqual({
			ok: true,
			repo: { name: 'api', url: 'file:///home/me/code/api', provider: 'local' }
		});
	});

	test('text that is neither owner/name nor a link asks for one', () => {
		expect(parseRepoInput('just some words')).toEqual({
			ok: false,
			error: 'Enter owner/name or a link to the repository.'
		});
	});
});

describe('repoKey', () => {
	test('the same repository written two ways gets one key', () => {
		expect(repoKey('https://www.GitHub.com/Acme/API.git/')).toBe(repoKey('github.com/acme/api'));
	});
});
