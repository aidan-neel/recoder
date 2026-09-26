import { expect, test } from 'bun:test';
import type { Finding } from '@recoder/shared';
import { carryFixes } from './finding-fixes';

const fix = { sha: 'abc123', branch: 'feature', summary: 'Guard the empty queue.', at: '2026-09-25T00:00:00.000Z' };
const finding = (id: string, fingerprint?: string): Finding => ({ id, file: 'a.ts', line: 1, severity: 'warning', message: 'm', fingerprint });

test('a re-run keeps a pushed fix on the same finding, matched by fingerprint when its id changed', () => {
	const next = carryFixes([{ ...finding('old-1', 'fp1'), fix }, finding('old-2', 'fp2')], [finding('new-1', 'fp1'), finding('new-2', 'fp2')]);
	expect(next.map((f) => f.fix ?? null)).toEqual([fix, null]);
});
