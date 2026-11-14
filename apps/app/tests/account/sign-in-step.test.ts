import { describe, expect, test } from 'bun:test';

import { signInStep } from '../../src/lib/account/sign-in-step';

describe('signInStep', () => {
	test('a locked setup asks for the code first', () => {
		expect(signInStep({ setup: true, setupLocked: true })).toBe('code');
	});

	test('an unlocked setup and a sign-in go straight to the forges', () => {
		expect(signInStep({ setup: true, setupLocked: false })).toBe('choose');
		expect(signInStep({ setup: false, setupLocked: false })).toBe('choose');
	});
});
