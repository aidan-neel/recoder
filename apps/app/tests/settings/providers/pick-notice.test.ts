import { describe, expect, test } from 'bun:test';

import { CHECK_FAILED } from '../../../src/lib/settings/providers/use-check-again';
import { OFFLINE_TEXT } from '../../../src/lib/api/http';
import { pickNotice } from '../../../src/lib/settings/providers/pick-notice';
import { openCodeStatus } from '../../fixtures';

const manager = openCodeStatus();

describe('why the provider list is empty', () => {
	test('the server down leads with the offline line and a retry', () => {
		const notice = pickNotice({ state: 'offline' });

		expect(notice.lead).toBe(OFFLINE_TEXT);
		expect(notice.retryLabel).toBe('Try again');
	});

	test('a failed check leads with its reason and the server’s message', () => {
		const notice = pickNotice({ state: 'error', message: 'agent exploded' });

		expect(notice.lead).toBe(`${CHECK_FAILED}.`);
		expect(notice.rest).toBe('agent exploded');
	});

	test('a missing agent names it and offers its install command', () => {
		const notice = pickNotice({ state: 'unready', manager: { ...manager, installed: false } });

		expect(notice.lead).toBe('OpenCode isn’t installed.');
		expect(notice.command).toBe('npm i -g opencode');
	});

	test('no provider agent at all has nothing to retry', () => {
		const notice = pickNotice({ state: 'unready', manager: null });

		expect(notice.lead).toBe('No agent connects providers.');
		expect(notice.retryLabel).toBeNull();
	});
});
