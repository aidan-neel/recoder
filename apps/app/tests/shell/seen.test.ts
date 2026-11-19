import { describe, expect, test } from 'bun:test';

import { isUnread, readSeen, type SeenMarks } from '../../src/lib/shell/seen';
import { useMemoryStorage } from '../fixtures';

const START = Date.parse('2026-11-19T12:00:00Z');
const at = (minutes: number) => new Date(START + minutes * 60_000).toISOString();

useMemoryStorage();

describe('unread rows', () => {
	const marks: SeenMarks = { since: START, at: { seen: Date.parse(at(10)) } };

	test('a row that last changed before this browser kept marks is not unread', () => {
		expect(isUnread('old', at(-5), marks)).toBe(false);
	});

	test('a row that changed after the change it was open for is unread', () => {
		expect(isUnread('seen', at(10), marks)).toBe(false);
		expect(isUnread('seen', at(11), marks)).toBe(true);
	});

	test('a review that is still running is not unread until its result lands', () => {
		expect(isUnread('new', at(20), marks, true)).toBe(false);
		expect(isUnread('new', at(20), marks)).toBe(true);
	});
});

describe('the saved marks', () => {
	test('the first visit starts keeping marks from now and saves that start', () => {
		expect(readSeen(START)).toEqual({ since: START, at: {} });
		expect(readSeen(START + 60_000).since).toBe(START);
	});

	test('a mark older than a month is dropped and a malformed one is ignored', () => {
		const old = START - 31 * 24 * 60 * 60 * 1000;

		localStorage.setItem('recoder.sidebar-seen.v1', JSON.stringify({ since: old, at: { a: old, b: START, c: 'x' } }));

		expect(readSeen(START)).toEqual({ since: old, at: { b: START } });
	});
});
