import { describe, expect, test } from 'bun:test';

import { oauthStartUrl } from '../../src/lib/account/oauth-redirect';

const API = 'http://localhost:3001';

describe('the redirect sign-in address', () => {
	test('names the forge and carries the page to come back to, encoded', () => {
		expect(oauthStartUrl({ provider: 'github' }, '/pulls?tab=bugs&x=1', API)).toBe(
			'http://localhost:3001/api/auth/oauth/github/start?return=%2Fpulls%3Ftab%3Dbugs%26x%3D1'
		);
	});

	test('carries a self-managed GitLab host', () => {
		const url = new URL(oauthStartUrl({ provider: 'gitlab', host: 'gitlab.example.com' }, '/', API));

		expect(url.pathname).toBe('/api/auth/oauth/gitlab/start');
		expect(url.searchParams.get('host')).toBe('gitlab.example.com');
	});
});
