import { expect, test } from 'bun:test';
import { failureExcerpt } from './checks';

test('a CI log excerpt drops colors and timestamps and keeps the failure with its context', () => {
	const noise = Array.from({ length: 200 }, (_, i) => `2026-09-25T10:00:00.1234567Z installing package ${i}`);
	const log = [
		...noise,
		'2026-09-25T10:01:00.0000000Z \x1b[31mFAIL\x1b[0m src/status.test.ts > prints a line',
		'2026-09-25T10:01:00.0000000Z Expected: "No pending jobs"',
		...noise
	].join('\n');
	const excerpt = failureExcerpt(log);
	expect(excerpt).toContain('FAIL src/status.test.ts > prints a line\nExpected: "No pending jobs"');
	expect(excerpt).not.toContain('\x1b[');
	expect(excerpt).not.toMatch(/^2026-/m);
	expect(excerpt).not.toContain('installing package 50\n');
});

test('an oversized CI log keeps its end, where runners report the failure', () => {
	const excerpt = failureExcerpt(Array.from({ length: 5000 }, (_, i) => `error ${i}`).join('\n'), 2000);
	expect(excerpt.length).toBeLessThanOrEqual(2001);
	expect(excerpt.endsWith('error 4999')).toBe(true);
});
