import { expect, test } from 'bun:test';
import { renderReport } from '../../../src/cli/output/render';
import { PLAIN_SURFACE } from '../../../src/cli/terminal/surface';
import { finding, report } from './fixtures';

test('a finding with no line, no title and no verification renders without undefined or null', () => {
	const bare = finding({ line: undefined, title: undefined, category: undefined, suggestion: undefined });
	const text = renderReport(report({ findings: [bare] }), 'markdown', PLAIN_SURFACE);

	expect(text).not.toContain('undefined');
	expect(text).not.toContain('null');
	expect(text).toContain('src/a.ts');
	expect(text).toContain('It breaks.');
});

test('a finding shows its title, location, verification command, suggestion and patch', () => {
	const detailed = finding({
		title: 'Off by one',
		line: 3,
		endLine: 5,
		severity: 'error',
		suggestion: 'Use <=.',
		verification: { status: 'verified', method: 'run', reason: 'The test fails.', command: 'bun test a' },
		patch: { diff: '--- a/src/a.ts\n+++ b/src/a.ts', checks: ['bun run check'] }
	});

	const text = renderReport(report({ findings: [detailed] }), 'markdown', PLAIN_SURFACE);

	expect(text).toContain('### error: Off by one');
	expect(text).toContain('src/a.ts:3-5');
	expect(text).toContain('Verification: verified by run. The test fails.');
	expect(text).toContain('bun test a');
	expect(text).toContain('Use <=.');
	expect(text).toContain('+++ b/src/a.ts');
	expect(text).toContain('bun run check');
});

test('a patch that contains a code fence cannot close its own block early', () => {
	const patch = { diff: '+```ts\n+const a = 1;\n+```', checks: [] };
	const text = renderReport(report({ findings: [finding({ patch })] }), 'markdown', PLAIN_SURFACE);

	expect(text).toContain('````diff');
});

test('unconfirmed findings, checks and gaps get their own headings only when there are any', () => {
	const empty = renderReport(report(), 'markdown', PLAIN_SURFACE);

	const full = renderReport(
		report({
			unconfirmed: [finding({ id: 'u' })],
			recommendedChecks: ['bun test'],
			coverageGaps: [{ path: 'src/b.ts', state: 'partial', reason: 'Too large.' }]
		}),
		'markdown',
		PLAIN_SURFACE
	);

	expect(empty).not.toContain('## ');
	expect(full).toContain('## Unconfirmed findings');
	expect(full).toContain('## Recommended checks');
	expect(full).toContain('src/b.ts (partial): Too large.');
});

test('json is the report with two-space indentation', () => {
	const value = report();

	expect(renderReport(value, 'json', PLAIN_SURFACE)).toBe(JSON.stringify(value, null, 2));
});
