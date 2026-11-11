import { expect, test } from 'bun:test';
import { selectWritten } from '../../../src/cli/output/select';
import { OUTPUT, finding, report } from './fixtures';

const everything = report({
	findings: [
		finding({ id: 'e', severity: 'error' }),
		finding({ id: 'w', severity: 'warning' }),
		finding({ id: 'i', severity: 'info' })
	],
	unconfirmed: [finding({ id: 'u-error', severity: 'error' }), finding({ id: 'u-info', severity: 'info' })]
});

const ids = (findings: { id: string }[]) => findings.map((entry) => entry.id);

test('findings below the minimum severity are left out', () => {
	const written = selectWritten(everything, { ...OUTPUT, minSeverity: 'warning' });

	expect(ids(written.findings)).toEqual(['e', 'w']);
});

test('unconfirmed findings are emptied unless they are asked for', () => {
	expect(selectWritten(everything, OUTPUT).unconfirmed).toEqual([]);
});

test('unconfirmed findings that are asked for are filtered by the minimum severity too', () => {
	const written = selectWritten(everything, { ...OUTPUT, includeUnconfirmed: true, minSeverity: 'error' });

	expect(ids(written.unconfirmed)).toEqual(['u-error']);
});

test('the report it was given is not changed', () => {
	selectWritten(everything, { ...OUTPUT, minSeverity: 'error' });

	expect(everything.findings).toHaveLength(3);
	expect(everything.unconfirmed).toHaveLength(2);
});
