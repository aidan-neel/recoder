import { expect, test } from 'bun:test';
import { renderReport } from '../../../src/cli/output/render';
import { paintFor } from '../../../src/cli/terminal/paint';
import { PLAIN_SURFACE, type Surface } from '../../../src/cli/terminal/surface';
import { visibleWidth } from '../../../src/cli/terminal/text';
import { finding, report } from './fixtures';

const COLOR_SURFACE: Surface = { ...PLAIN_SURFACE, paint: paintFor(true) };

const text = (value: Parameters<typeof report>[0], surface = PLAIN_SURFACE) =>
	renderReport(report(value), 'text', surface);

test('a finding with no line, no title and no verification renders without undefined or null', () => {
	const bare = finding({ line: undefined, title: undefined, category: undefined, suggestion: undefined });
	const rendered = text({ findings: [bare] });

	expect(rendered).not.toContain('undefined');
	expect(rendered).not.toContain('null');
	expect(rendered).toContain('src/a.ts');
	expect(rendered).toContain('It breaks.');
});

test('a report for a surface with no color holds no escape codes, so a file or a pipe gets plain text', () => {
	const detailed = finding({
		severity: 'error',
		message: 'Calls `fetchBatch` again at once.',
		patch: { diff: '--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new', checks: [] }
	});

	expect(text({ findings: [detailed] })).not.toContain('\u001b[');
	expect(text({ findings: [detailed] }, COLOR_SURFACE)).toContain('\u001b[');
});

test('an inline code span loses its backticks and is never broken across lines', () => {
	const message = `${'word '.repeat(14)}then \`maxAttempts <= 1\` yields nothing.`;
	const lines = text({ findings: [finding({ message })] }).split('\n');

	expect(lines.some((line) => line.includes('maxAttempts <= 1'))).toBe(true);
	expect(lines.join('\n')).not.toContain('`');
});

test('no line is wider than the surface, whatever the length of a path or a sentence', () => {
	const long = finding({ message: 'x '.repeat(200), suggestion: 'y '.repeat(200) });
	const rendered = text({ summary: 'z '.repeat(200), findings: [long], recommendedChecks: ['w '.repeat(200)] });

	expect(Math.max(...rendered.split('\n').map(visibleWidth))).toBeLessThanOrEqual(PLAIN_SURFACE.columns);
});

test('the error of a review that stopped is shown under its outcome', () => {
	const rendered = text({ outcome: 'failed', error: 'the model stopped answering' });

	expect(rendered).toContain('Review failed');
	expect(rendered).toContain('the model stopped answering');
});
