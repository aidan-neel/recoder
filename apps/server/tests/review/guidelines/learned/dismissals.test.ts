import { beforeEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	listDismissals,
	MAX_DISMISSALS_PER_REPO,
	recordDismissal,
	removeDismissal,
	type Dismissal
} from '../../../../src/review/guidelines/learned/dismissals';

beforeEach(() => {
	process.env.RECODER_DATA_DIR = mkdtempSync(join(tmpdir(), 'recoder-dismissals-'));
});

const dismissal = (fingerprint: string, repoId = 'repo-1'): Dismissal => ({
	repoId,
	fingerprint,
	file: 'src/a.ts',
	category: 'correctness',
	title: `Finding ${fingerprint}`,
	dismissedAt: new Date().toISOString()
});

test('a dismissal is still there when the store is read again, and restoring it removes it', () => {
	recordDismissal({ ...dismissal('aaaa'), reason: 'intended' });

	expect(listDismissals('repo-1').map((held) => [held.fingerprint, held.reason])).toEqual([['aaaa', 'intended']]);
	expect(listDismissals('repo-2')).toEqual([]);

	expect(removeDismissal('repo-1', 'aaaa')).toBe(true);
	expect(removeDismissal('repo-1', 'aaaa')).toBe(false);
	expect(listDismissals('repo-1')).toEqual([]);
});

test('dismissing the same finding twice keeps one record, and a repository keeps only its newest', () => {
	recordDismissal(dismissal('same'));
	recordDismissal(dismissal('same'));

	expect(listDismissals('repo-1')).toHaveLength(1);

	for (let index = 0; index < MAX_DISMISSALS_PER_REPO + 5; index++) recordDismissal(dismissal(`f${index}`));

	const held = listDismissals('repo-1');

	expect(held).toHaveLength(MAX_DISMISSALS_PER_REPO);
	expect(held[0].fingerprint).toBe(`f${MAX_DISMISSALS_PER_REPO + 4}`);
	expect(held.some((entry) => entry.fingerprint === 'same')).toBe(false);
});
