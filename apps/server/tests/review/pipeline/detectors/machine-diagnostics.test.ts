import { describe, expect, test } from 'bun:test';
import { parseDiagnostics } from '../../../../src/review/pipeline/detectors/parse-diagnostics';

describe('machine-format diagnostics', () => {
	test('reads eslint JSON after a script banner', () => {
		const json = JSON.stringify([
			{
				filePath: '/work/src/a.ts',
				messages: [{ ruleId: 'no-unused-vars', severity: 2, message: "'x' is unused", line: 4 }]
			}
		]);

		expect(parseDiagnostics(`> pkg@1 lint\n> eslint -f json .\n${json}\n`)).toMatchObject([
			{ path: '/work/src/a.ts', line: 4, rule: 'no-unused-vars', tool: 'eslint', severity: 'error' }
		]);
	});

	test('reads oxlint JSON and strips the plugin wrapper from the code', () => {
		const json = JSON.stringify({
			diagnostics: [
				{
					message: 'Unexpected any',
					code: 'typescript-eslint(no-explicit-any)',
					severity: 'warning',
					filename: 'src/b.ts',
					labels: [{ span: { line: 9, column: 3 } }]
				}
			]
		});

		expect(parseDiagnostics(json)).toMatchObject([
			{ path: 'src/b.ts', line: 9, rule: '@typescript-eslint/no-explicit-any', tool: 'oxlint', severity: 'warning' }
		]);
	});

	test('reads SARIF results under the run tool name', () => {
		const sarif = JSON.stringify({
			runs: [
				{
					tool: { driver: { name: 'Semgrep' } },
					results: [
						{
							ruleId: 'eval-use',
							level: 'error',
							message: { text: 'eval is dangerous' },
							locations: [{ physicalLocation: { artifactLocation: { uri: 'src/c.js' }, region: { startLine: 2 } } }]
						}
					]
				}
			]
		});

		expect(parseDiagnostics(sarif)).toMatchObject([
			{ path: 'src/c.js', line: 2, rule: 'eval-use', tool: 'semgrep', severity: 'error' }
		]);
	});

	test('falls back to the line parsers for plain tsc output', () => {
		const out = "src/d.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.\n";

		expect(parseDiagnostics(out)).toMatchObject([{ path: 'src/d.ts', line: 3, rule: 'TS2322' }]);
	});

	test('treats JSON that is no known format as plain text', () => {
		expect(parseDiagnostics('{"ok":true}')).toEqual([]);
	});
});
