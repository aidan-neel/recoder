import { describe, expect, test } from 'bun:test';

import { sectionFromPath } from '../../src/lib/settings/sections';

describe('settings section from the address', () => {
	test('/settings shows the default section in place, with or without a trailing slash', () => {
		expect(sectionFromPath('/settings')).toBe('agent');
		expect(sectionFromPath('/settings/')).toBe('agent');
		expect(sectionFromPath('/settings/connections')).toBe('connections');
	});

	test('an unknown section or a look-alike path is no section', () => {
		expect(sectionFromPath('/settings/nope')).toBeNull();
		expect(sectionFromPath('/settingsx')).toBeNull();
		expect(sectionFromPath('/review/settings')).toBeNull();
	});
});
