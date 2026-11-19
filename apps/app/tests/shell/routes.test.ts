import { describe, expect, test } from 'bun:test';

import { pullHref, pullTabOf, repoHref, routeOf } from '../../src/lib/shell/routes';

describe('pullTabOf', () => {
	test('opens the Review tab from an old link that names the Bugs tab', () => {
		expect(pullTabOf('bugs')).toBe('review');
	});

	test('falls back to Changes for no tab or one the page does not have', () => {
		expect(pullTabOf(null)).toBe('changes');
		expect(pullTabOf('constructor')).toBe('changes');
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
});
