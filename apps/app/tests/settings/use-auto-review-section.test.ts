import { describe, expect, test } from 'bun:test';

import { reposStateOf } from '../../src/lib/settings/use-auto-review-section';

describe('the tracked repositories load state', () => {
	test('reads idle and loading as still loading', () => {
		expect(reposStateOf('idle')).toBe('loading');
		expect(reposStateOf('loading')).toBe('loading');
	});

	test('reads error and offline as failed', () => {
		expect(reposStateOf('error')).toBe('failed');
		expect(reposStateOf('offline')).toBe('failed');
	});

	test('reads ready as ready', () => {
		expect(reposStateOf('ready')).toBe('ready');
	});
});
