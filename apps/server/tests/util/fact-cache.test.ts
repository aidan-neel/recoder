import { afterEach, expect, setSystemTime, test } from 'bun:test';
import { closeFacts, readFact, writeFact } from '../../src/util/fact-cache';

const DAY_MS = 24 * 60 * 60 * 1000;

afterEach(() => {
	setSystemTime();
	closeFacts();
});

test('a fact written before a restart is read back after it', () => {
	writeFact('test-restart', 'blob-1', [{ name: 'parse' }]);
	closeFacts();

	expect(readFact<{ name: string }[]>('test-restart', 'blob-1')).toEqual([{ name: 'parse' }]);
});

test('a fact nobody read for over two weeks is gone after the store reopens', () => {
	const start = new Date('2026-01-01T00:00:00Z');

	setSystemTime(start);
	writeFact('test-age', 'stale', 1);
	writeFact('test-age', 'used', 2);
	closeFacts();

	setSystemTime(new Date(start.getTime() + 10 * DAY_MS));
	readFact('test-age', 'used');
	closeFacts();

	setSystemTime(new Date(start.getTime() + 20 * DAY_MS));

	expect(readFact<number>('test-age', 'stale')).toBeNull();
	expect(readFact<number>('test-age', 'used')).toBe(2);
});
