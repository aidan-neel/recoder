import { describe, expect, test } from 'bun:test';

import { gateOf, parseSteps } from '../../src/lib/setup/setup-steps';

const NONE = { provider: false, model: false, repo: false };

const ALL = { provider: true, model: true, repo: true };

/** The gate's input before anything is known: no steps, nothing saved, the check running. */
const WAITING = {
	steps: null,
	saved: null,
	check: 'loading',
	waited: false,
	holding: false,
	recovering: false
} as const;

describe('gateOf', () => {
	test('a returning person gets the queue or first run, as the last visit saw it, before the check answers', () => {
		expect(gateOf({ ...WAITING, saved: ALL })).toBe('done');
		expect(gateOf({ ...WAITING, saved: NONE })).toBe('needed');
	});

	test('a check that has not answered by the end of the wait lets the queue through instead of hanging', () => {
		expect(gateOf(WAITING)).toBe('checking');
		expect(gateOf({ ...WAITING, waited: true })).toBe('done');
	});

	test('a check that fails lets the queue through to show its own notice', () => {
		expect(gateOf({ ...WAITING, check: 'failed' })).toBe('done');
		expect(gateOf({ ...WAITING, check: 'offline' })).toBe('done');
	});

	test('a server that comes back holds the gate while the check runs again', () => {
		expect(gateOf({ ...WAITING, check: 'offline', saved: ALL, recovering: true })).toBe('checking');
	});

	test('known steps decide over the saved ones, and first run keeps the page while it holds it', () => {
		expect(gateOf({ ...WAITING, steps: NONE, saved: ALL })).toBe('needed');
		expect(gateOf({ ...WAITING, steps: ALL, holding: true })).toBe('needed');
		expect(gateOf({ ...WAITING, steps: ALL })).toBe('done');
	});
});

describe('parseSteps', () => {
	test('only a whole set of saved steps is trusted', () => {
		expect(parseSteps(JSON.stringify(ALL))).toEqual(ALL);
		expect(parseSteps(JSON.stringify({ provider: true, model: 'yes', repo: true }))).toBeNull();
		expect(parseSteps('{not json')).toBeNull();
		expect(parseSteps(null)).toBeNull();
	});
});
