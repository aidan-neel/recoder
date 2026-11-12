import { describe, expect, test } from 'bun:test';

import { settingsHref } from '../../src/lib/settings/settings-url';

describe('the settings pages’ addresses', () => {
	test('a section is /settings/<id>', () => {
		expect(settingsHref('agent')).toBe('/settings/agent');
		expect(settingsHref('connections')).toBe('/settings/connections');
	});

	test('extra params ride along, like the provider dialog’s add', () => {
		expect(settingsHref('agent', { add: 'provider' })).toBe('/settings/agent?add=provider');
	});
});
