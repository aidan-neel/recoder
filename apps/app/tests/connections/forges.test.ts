import { describe, expect, test } from 'bun:test';
import type { ProviderAuth } from '@recoder/shared';

import { forgeLine } from '../../src/lib/connections/forges';

function auth(patch: Partial<ProviderAuth>): ProviderAuth {
	return { provider: 'github', available: true, authenticated: false, user: null, ...patch };
}

describe('the line under a forge’s name', () => {
	test('a signed-in forge names who and where', () => {
		expect(forgeLine(auth({ authenticated: true, user: 'aidan', host: 'gitlab.acme.dev' }))).toBe(
			'Signed in as aidan on gitlab.acme.dev'
		);

		expect(forgeLine(auth({ authenticated: true }))).toBe('Signed in');
	});

	test('an available forge that is not signed in reads Not connected', () => {
		expect(forgeLine(auth({}))).toBe('Not connected');
	});

	test('a missing CLI points at the token instead', () => {
		expect(forgeLine(auth({ available: false }))).toBe('CLI not installed. Connect with a token instead.');
	});
});
