import { expect, test } from 'bun:test';
import type { Repo } from '@recoder/shared';
import { ownsRepo } from '../../../src/forge/watch/scope';

function repo(url: string, provider: Repo['provider']): Repo {
	return { id: url, name: url, url, provider, defaultBranch: 'main', createdAt: '', updatedAt: '' };
}

const LOGINS = { github: 'Aidan', gitlab: 'aidan' };

test('a repository under the connected login is owned, whatever the case', () => {
	expect(ownsRepo(repo('https://github.com/aidan/app', 'github'), LOGINS)).toBe(true);
	expect(ownsRepo(repo('git@gitlab.com:Aidan/tools/cli.git', 'gitlab'), LOGINS)).toBe(true);
});

test("an organization's repository, another forge's login and a local clone are not owned", () => {
	expect(ownsRepo(repo('https://github.com/acme/app', 'github'), LOGINS)).toBe(false);
	expect(ownsRepo(repo('https://github.com/aidan/app', 'github'), { github: null, gitlab: 'aidan' })).toBe(false);
	expect(ownsRepo(repo('/home/aidan/app', 'local'), LOGINS)).toBe(false);
});
