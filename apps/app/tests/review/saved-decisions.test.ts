import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { readDecisions, writeDecisions } from '../../src/lib/review/saved-decisions';
import { memoryStorage } from '../fixtures';

const record = { state: 'sent' as const, note: '', at: 1 };

describe('saved decisions', () => {
	beforeEach(() => {
		globalThis.localStorage = memoryStorage();
	});

	afterEach(() => {
		Reflect.deleteProperty(globalThis, 'localStorage');
	});

	test('saving for a new commit drops that review’s older commits and keeps every other review', () => {
		writeDecisions('r1', 'old', { f1: record }, ['f1']);
		writeDecisions('r1@x', 'old', { f2: record }, ['f2']);
		writeDecisions('r2', 'old', { f3: record }, ['f3']);
		writeDecisions('r1', 'new', { f4: record }, ['f4']);

		expect(readDecisions('r1', 'old')).toEqual({});
		expect(readDecisions('r1', 'new')).toEqual({ f4: record });
		expect(readDecisions('r1@x', 'old')).toEqual({ f2: record });
		expect(readDecisions('r2', 'old')).toEqual({ f3: record });
	});

	test('a save from a tab with an older copy keeps what another tab saved for other items', () => {
		const accepted = { state: 'accepted' as const, note: '', at: 2 };

		writeDecisions('r1', 'head', { f1: accepted }, ['f1']);

		const merged = writeDecisions('r1', 'head', { f2: record }, ['f2']);

		expect(merged).toEqual({ f1: accepted, f2: record });
		expect(readDecisions('r1', 'head')).toEqual({ f1: accepted, f2: record });

		writeDecisions('r1', 'head', { f2: record }, ['f1']);

		expect(readDecisions('r1', 'head')).toEqual({ f2: record });
	});
});
