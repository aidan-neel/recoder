import { describe, expect, test } from 'bun:test';
import type { AddedLines } from '../../../../src/review/pipeline/detectors/changed-lines';
import { diagnosticResults } from '../../../../src/review/pipeline/detectors/diagnostics';
import { parseDiagnostics } from '../../../../src/review/pipeline/detectors/parse-diagnostics';

/** `apps/server/src/a.ts` adds lines 3 and 4; `src/b.svelte` adds line 7. */
const ADDED: AddedLines = new Map([
	[
		'apps/server/src/a.ts',
		new Map([
			[3, 'const x: string = 1;'],
			[4, 'let unused = 2;']
		])
	],
	['src/b.svelte', new Map([[7, '<div>{count}</div>']])]
]);

const RED = '\u001b[38;2;225;80;80;1m';
const BLUE = '\u001b[38;2;92;157;255;1m';
const DIM = '\u001b[2m';
const OFF = '\u001b[0m';

/** One oxlint graphical diagnostic with its colour codes, as it prints when piped. */
function oxlint(mark: string, heading: string, path: string, at: string, code: string): string {
	return [
		`  ${RED}${mark}${OFF} ${RED}${heading}${OFF}`,
		`   ╭─[${BLUE}${path}${OFF}:${at}]`,
		` ${DIM}${at.split(':')[0]}${OFF} │ ${code}`,
		'   ·          ────',
		'   ╰────',
		'  help: Change the code.',
		''
	].join('\n');
}

function check(command: string, output: string) {
	return { command, evidenceId: 'e1', exitCode: 1, output };
}

describe('parseDiagnostics', () => {
	test('reads tsc errors in both the plain and the pretty format', () => {
		const found = parseDiagnostics(
			[
				"src/a.ts(3,7): error TS2322: Type 'number' is not assignable to type 'string'.",
				"\u001b[96msrc/a.ts\u001b[0m:\u001b[93m4\u001b[0m:\u001b[93m5\u001b[0m - \u001b[91merror\u001b[0m TS6133: 'unused' is declared but its value is never read."
			].join('\n')
		);

		expect(found.map(({ path, line, rule, source }) => ({ path, line, rule, source }))).toEqual([
			{ path: 'src/a.ts', line: 3, rule: 'TS2322', source: 'typecheck' },
			{ path: 'src/a.ts', line: 4, rule: 'TS6133', source: 'typecheck' }
		]);
	});

	test('reads eslint stylish rows under their file header, with the rule name split from the message', () => {
		const found = parseDiagnostics(
			[
				'/work/apps/server/src/a.ts',
				"  4:5  error  'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars",
				'  9:1  warning  Unexpected console statement  no-console',
				'',
				'✖ 2 problems (1 error, 1 warning)'
			].join('\n')
		);

		expect(found.map(({ path, line, message, rule }) => ({ path, line, message, rule }))).toEqual([
			{
				path: '/work/apps/server/src/a.ts',
				line: 4,
				message: "'unused' is assigned a value but never used",
				rule: '@typescript-eslint/no-unused-vars'
			},
			{ path: '/work/apps/server/src/a.ts', line: 9, message: 'Unexpected console statement', rule: 'no-console' }
		]);
	});

	test('reads eslint unix rows and svelte-check human output', () => {
		const found = parseDiagnostics(
			[
				'src/a.ts:4:5: Missing return type [Error/@typescript-eslint/explicit-function-return-type]',
				'/work/src/b.svelte:7:3',
				"Error: Cannot find name 'count'. (ts)"
			].join('\n')
		);

		expect(found.map(({ path, line, rule, source }) => ({ path, line, rule, source }))).toEqual([
			{ path: 'src/a.ts', line: 4, rule: '@typescript-eslint/explicit-function-return-type', source: 'lint' },
			{ path: '/work/src/b.svelte', line: 7, rule: 'ts', source: 'typecheck' }
		]);
	});
});

describe('parseDiagnostics for oxlint', () => {
	test('reads a coloured error with its path, line and plugin rule', () => {
		const found = parseDiagnostics(
			oxlint(
				'×',
				'import(consistent-type-specifier-style): Prefer a top-level type-only import.',
				'src/a.ts',
				'3:10',
				"import { type Foo } from './foo'"
			)
		);

		expect(found.map(({ path, line, rule, source, message }) => ({ path, line, rule, source, message }))).toEqual([
			{
				path: 'src/a.ts',
				line: 3,
				rule: 'import/consistent-type-specifier-style',
				source: 'lint',
				message: 'Prefer a top-level type-only import.'
			}
		]);

		expect(found[0].raw).not.toContain('\u001b');
	});

	test('reads warnings and maps eslint and typescript-eslint rules to their eslint names', () => {
		const found = parseDiagnostics(
			[
				oxlint(
					'⚠',
					"eslint(no-unused-vars): Variable 'unused' is declared but never used.",
					'src/a.ts',
					'4:5',
					'let unused'
				),
				oxlint('⚠', 'typescript-eslint(no-explicit-any): Unexpected any.', 'src/a.ts', '9:12', 'let v: any')
			].join('\n')
		);

		expect(found.map(({ line, rule }) => ({ line, rule }))).toEqual([
			{ line: 4, rule: 'no-unused-vars' },
			{ line: 9, rule: '@typescript-eslint/no-explicit-any' }
		]);
	});

	test('reads the plain ascii form oxlint prints without colour', () => {
		const found = parseDiagnostics(
			[
				"  x eslint(curly): Expected { after 'if' condition.",
				'     ,-[src/a.ts:4:9]',
				'   3 |       if (expired)',
				'   4 |         payload = undefined',
				'     :         ^^^^^^^^^^^^^^^^^^^',
				'     `----',
				"  ! eslint(no-unused-vars): Parameter 'evt' is declared but never used.",
				'    ,-[src/a.ts:9:3]'
			].join('\n')
		);

		expect(found.map(({ path, line, rule }) => ({ path, line, rule }))).toEqual([
			{ path: 'src/a.ts', line: 4, rule: 'curly' },
			{ path: 'src/a.ts', line: 9, rule: 'no-unused-vars' }
		]);
	});

	test('keeps a diagnostic that names no rule', () => {
		const found = parseDiagnostics(oxlint('×', 'Unexpected token', 'src/a.ts', '3:1', 'let = ;'));

		expect(found).toMatchObject([{ path: 'src/a.ts', line: 3, message: 'Unexpected token', rule: undefined }]);
	});
});

/** Diagnostics on added lines from one check command that printed these lines. */
function checkResults(command: string, lines: string[]) {
	return diagnosticResults([check(command, lines.join('\n'))], ADDED);
}

/** Where each result points and what it reports as. */
function places(results: ReturnType<typeof diagnosticResults>) {
	return results.map(({ file, line, detector, category }) => ({ file, line, detector, category }));
}

describe('diagnosticResults', () => {
	test('keeps only diagnostics on added lines, resolving paths against the command dir', () => {
		const results = checkResults('cd apps/server && bun run check', [
			"src/a.ts(3,7): error TS2322: Type 'number' is not assignable to type 'string'.",
			"src/a.ts(10,1): error TS2304: Cannot find name 'y'.",
			"src/other.ts(3,1): error TS2304: Cannot find name 'z'."
		]);

		expect(places(results)).toEqual([
			{ file: 'apps/server/src/a.ts', line: 3, detector: 'typecheck', category: 'correctness' }
		]);
	});

	test('maps absolute paths by their changed-path suffix and unused-variable rules to dead code', () => {
		const results = checkResults('cd apps/server && bun run lint', [
			'/sandbox/repo/apps/server/src/a.ts',
			"  4:5  error  'unused' is assigned a value but never used  @typescript-eslint/no-unused-vars"
		]);

		expect(results).toHaveLength(1);

		expect(results[0]).toMatchObject({
			file: 'apps/server/src/a.ts',
			line: 4,
			detector: 'lint',
			category: 'dead-code'
		});

		expect(results[0].evidence.startsWith('e1: ')).toBe(true);
	});

	test('reports a diagnostic two checks both print once', () => {
		const line = "src/a.ts(3,7): error TS2322: Type 'number' is not assignable to type 'string'.";

		const results = diagnosticResults(
			[check('cd apps/server && bun run check', line), check('cd apps/server && bun run typecheck', line)],
			ADDED
		);

		expect(results).toHaveLength(1);
	});

	test('reports oxlint diagnostics on added lines as lint findings and skips unchanged lines', () => {
		const results = checkResults('cd apps/server && bun run lint', [
			oxlint('×', 'eslint(curly): Expected braces around the body.', 'src/a.ts', '3:1', 'if (x) y();'),
			oxlint('⚠', 'eslint(no-unused-vars): Variable is never used.', 'src/a.ts', '4:5', 'let unused = 2;'),
			oxlint('×', 'eslint(curly): Expected braces around the body.', 'src/a.ts', '20:1', 'if (z) w();')
		]);

		expect(places(results)).toEqual([
			{ file: 'apps/server/src/a.ts', line: 3, detector: 'lint', category: 'convention' },
			{ file: 'apps/server/src/a.ts', line: 4, detector: 'lint', category: 'dead-code' }
		]);
	});

	test('treats oxlint output as lint even when a type check command printed it', () => {
		const results = diagnosticResults(
			[
				check('cd apps/server && bun run check', oxlint('×', 'eslint(curly): Expected braces.', 'src/a.ts', '3:1', 'x'))
			],
			ADDED
		);

		expect(results).toMatchObject([{ detector: 'lint', file: 'apps/server/src/a.ts', line: 3 }]);
	});
});
