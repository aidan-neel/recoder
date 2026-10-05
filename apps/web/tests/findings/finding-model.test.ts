import { expect, test } from 'bun:test';
import type { Finding } from '@recoder/shared';
import { mapBackendFinding } from '../../src/lib/findings/finding-model';

const base: Finding = { id: 'f1', file: 'src/a.ts', line: 3, severity: 'info', message: 'Unused export.' };

test('older findings without a kind count as bugs and take the category from the message prefix', () => {
	const mapped = mapBackendFinding({ ...base, message: '[perf] The map never shrinks.' }, 0);

	expect(mapped).toMatchObject({ category: 'perf', kind: 'bug', body: 'The map never shrinks.' });
});

test('a quality category without a kind lists the finding under code quality', () => {
	const mapped = mapBackendFinding({ ...base, category: 'dead-code', message: '[dead-code] Unused export.' }, 0);

	expect(mapped).toMatchObject({ category: 'dead-code', kind: 'quality', body: 'Unused export.' });
});
