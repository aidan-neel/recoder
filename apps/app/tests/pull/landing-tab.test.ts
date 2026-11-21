import { describe, expect, test } from 'bun:test';

import { landingTab } from '../../src/lib/pull/landing-tab';

const HEAD = 'a41c9e2';

describe('landingTab', () => {
	test('waits on Description until the description has been read', () => {
		expect(landingTab({ phase: 'idle' })).toBeNull();
		expect(landingTab({ phase: 'loading' })).toBeNull();
	});

	test('lands on Description when there is one or one is being written', () => {
		const pending = { status: 'pending', headSha: HEAD, startedAt: '2026-11-20T00:00:00.000Z' } as const;

		expect(landingTab({ phase: 'ready', value: pending, refreshing: false })).toBe('description');
	});

	test('lands on Changes when there is no description: it failed, is off, or did not load', () => {
		const failed = { status: 'failed', headSha: HEAD, error: 'timed out' } as const;
		const off = { status: 'unavailable', reason: 'No model' } as const;

		expect(landingTab({ phase: 'ready', value: failed, refreshing: false })).toBe('changes');
		expect(landingTab({ phase: 'ready', value: off, refreshing: false })).toBe('changes');
		expect(landingTab({ phase: 'failed', error: 'Not found' })).toBe('changes');
	});
});
