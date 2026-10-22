import { describe, expect, test } from 'bun:test';

import { gateOf } from '../../src/lib/setup/setup-steps';

const NONE = { provider: false, model: false, repo: false };

const ALL = { provider: true, model: true, repo: true };

describe('gateOf', () => {
	test('a server that does not answer lets the queue through to show its own notice', () => {
		expect(
			gateOf({ settings: 'offline', repos: 'loading', auth: 'idle', steps: null, holding: false, recovering: false })
		).toBe('done');
	});

	test('a server that comes back holds the gate until the settings and repositories load again', () => {
		expect(
			gateOf({ settings: 'offline', repos: 'offline', auth: 'idle', steps: null, holding: false, recovering: true })
		).toBe('checking');
	});

	test('first run waits for the forge check before it shows', () => {
		expect(
			gateOf({ settings: 'ready', repos: 'ready', auth: 'loading', steps: NONE, holding: false, recovering: false })
		).toBe('checking');
	});

	test('first run keeps the gate while it holds it after the last step', () => {
		expect(
			gateOf({ settings: 'ready', repos: 'ready', auth: 'ready', steps: ALL, holding: true, recovering: false })
		).toBe('needed');

		expect(
			gateOf({ settings: 'ready', repos: 'ready', auth: 'ready', steps: ALL, holding: false, recovering: false })
		).toBe('done');
	});
});
