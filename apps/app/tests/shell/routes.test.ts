import { describe, expect, test } from 'bun:test';

import { messageHref, personHref } from '../../src/lib/people/refs';
import { pullHref, pullTabOf, repoHref, routeOf } from '../../src/lib/shell/routes';

describe('pullTabOf', () => {
	test('opens the Review tab from an old link that names the Bugs tab', () => {
		expect(pullTabOf('bugs')).toBe('review');
	});

	test('names no tab for an address without one or with one the page does not have', () => {
		expect(pullTabOf(null)).toBeNull();
		expect(pullTabOf('constructor')).toBeNull();
	});

	test('names Changes in a link to it, since an address without a tab may land elsewhere', () => {
		const tab = new URL(pullHref('', 'r1', 12, 'changes'), 'http://app').searchParams.get('tab');

		expect(pullTabOf(tab)).toBe('changes');
	});

	test('reads back the tab a pull request link names', () => {
		const tab = new URL(pullHref('', 'r1', 12, 'review'), 'http://app').searchParams.get('tab');

		expect(pullTabOf(tab)).toBe('review');
	});
});

describe('routeOf', () => {
	test('reads back the repository id a link encoded', () => {
		expect(routeOf(repoHref('', 'acme/web app'), '')).toEqual({ screen: 'repo', repoId: 'acme/web app' });
	});

	test('opens a pull request by its number, under the sample as under the live app', () => {
		expect(routeOf('/pulls/r1/12', '')).toEqual({ screen: 'pull', repoId: 'r1', number: 12 });
		expect(routeOf('/sample/pulls/r1/12', '/sample')).toEqual({ screen: 'pull', repoId: 'r1', number: 12 });
	});

	test('treats a pull request number that is not a positive whole number as a missing page', () => {
		expect(routeOf('/pulls/r1/0', '')).toEqual({ screen: 'missing' });
		expect(routeOf('/pulls/r1/1e3', '')).toEqual({ screen: 'missing' });
		expect(routeOf('/pulls/r1/12/files', '')).toEqual({ screen: 'missing' });
	});

	test('opens Settings on the section its address names, its first section for none, live only', () => {
		expect(routeOf('/settings/limits', '')).toEqual({ screen: 'settings', section: 'limits', view: null });
		expect(routeOf('/settings', '')).toEqual({ screen: 'settings', section: 'models', view: null });
		expect(routeOf('/settings/nope', '')).toEqual({ screen: 'missing' });
		expect(routeOf('/sample/settings/models', '/sample')).toEqual({ screen: 'missing' });
	});

	test('opens Settings → Server on the view its address names, Overview for none, and no view elsewhere', () => {
		expect(routeOf('/settings/server', '')).toEqual({ screen: 'settings', section: 'server', view: 'overview' });
		expect(routeOf('/settings/server/logs', '')).toEqual({ screen: 'settings', section: 'server', view: 'logs' });
		expect(routeOf('/settings/server/nope', '')).toEqual({ screen: 'missing' });
		expect(routeOf('/settings/limits/logs', '')).toEqual({ screen: 'missing' });
	});

	test('keeps the live-only pages out of the sample', () => {
		expect(routeOf('/automations', '')).toEqual({ screen: 'automations' });
		expect(routeOf('/sample/automations', '/sample')).toEqual({ screen: 'missing' });
	});

	test('shows the missing page for a path that does not decode instead of throwing', () => {
		expect(routeOf('/repos/%E0%A4%A', '')).toEqual({ screen: 'missing' });
	});

	test('ignores a trailing slash', () => {
		expect(routeOf('/sample/repos/', '/sample')).toEqual({ screen: 'repos' });
	});

	test('does not read a path outside its base as one of its own', () => {
		expect(routeOf('/samples', '/sample')).toEqual({ screen: 'missing' });
	});

	test('reads back the person a profile link names, a bot and a self-managed GitLab among them', () => {
		const people = [
			{ provider: 'github' as const, host: null, login: 'renovate[bot]' },
			{ provider: 'gitlab' as const, host: 'git.acme.dev:8443', login: 'tomas' }
		];

		for (const person of people)
			expect(routeOf(personHref('/sample', person), '/sample')).toEqual({ screen: 'person', person });
	});

	test('shows the missing page for a profile on a forge people do not come from', () => {
		expect(routeOf('/people/local/mira', '')).toEqual({ screen: 'missing' });
		expect(routeOf('/people/github/acme.dev/mira', '')).toEqual({ screen: 'missing' });
	});

	test('reads back the conversation a message link names', () => {
		expect(routeOf(messageHref('', 'dm 1/2'), '')).toEqual({ screen: 'messages', conversationId: 'dm 1/2' });
	});
});
