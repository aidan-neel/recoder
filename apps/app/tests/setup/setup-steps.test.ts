import type { SetupChecklist } from '@recoder/shared';
import { describe, expect, test } from 'bun:test';

import { currentStep, gateOf } from '../../src/lib/setup/setup-steps';

const OPEN: SetupChecklist = { complete: false, steps: [{ id: 'claim', done: true }] };

const FINISHED: SetupChecklist = { complete: true, steps: [] };

describe('gateOf', () => {
	test('a server that does not answer lets the pull request list through to show its own notice', () => {
		expect(gateOf({ checklist: 'offline', settings: 'idle', steps: null, holding: false, recovering: false })).toBe(
			'done'
		);
	});

	test('a server that comes back holds the gate until the checklist and settings load again', () => {
		expect(gateOf({ checklist: 'offline', settings: 'offline', steps: null, holding: false, recovering: true })).toBe(
			'checking'
		);
	});

	test('the checklist waits for the settings before it shows', () => {
		expect(gateOf({ checklist: 'ready', settings: 'loading', steps: OPEN, holding: false, recovering: false })).toBe(
			'checking'
		);
	});

	test('the checklist keeps the gate while it holds it after setup finishes', () => {
		expect(gateOf({ checklist: 'ready', settings: 'ready', steps: FINISHED, holding: true, recovering: false })).toBe(
			'needed'
		);

		expect(gateOf({ checklist: 'ready', settings: 'ready', steps: FINISHED, holding: false, recovering: false })).toBe(
			'done'
		);
	});
});

describe('currentStep', () => {
	test('a step the server left out counts as not done', () => {
		expect(currentStep(OPEN)).toBe('address');
	});
});
