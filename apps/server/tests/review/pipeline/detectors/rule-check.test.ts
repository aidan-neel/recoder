import { describe, expect, test } from 'bun:test';
import type { RuleLedger } from '../../../../src/review/guidelines/ledger/types';
import { addedLines } from '../../../../src/review/pipeline/detectors/changed-lines';
import { ruleCheckResults } from '../../../../src/review/pipeline/detectors/rule-check';
import { buildInventory } from '../../../../src/review/pipeline/inventory';

/** `src/a.ts` gains a `//` comment on line 2 next to an unchanged one on line 1; `src/new.test.ts` is added. */
const DIFF = [
	'diff --git a/src/a.ts b/src/a.ts',
	'--- a/src/a.ts',
	'+++ b/src/a.ts',
	'@@ -1,2 +1,4 @@',
	' // existing comment',
	'+// new comment',
	'+const url = "http://example.com";',
	'+export const a = 1;',
	' export const b = 2;',
	'diff --git a/src/new.test.ts b/src/new.test.ts',
	'new file mode 100644',
	'--- /dev/null',
	'+++ b/src/new.test.ts',
	'@@ -0,0 +1,2 @@',
	'+test();',
	'+// trailing',
	''
].join('\n');

const inventory = buildInventory(DIFF, []);
const added = addedLines(inventory);

function ledger(rules: RuleLedger['rules']): RuleLedger {
	return { rules, sourcesHash: 'x' };
}

describe('ruleCheckResults', () => {
	test('runs a forbid-pattern only on added lines of files its globs cover', () => {
		const results = ruleCheckResults(
			ledger([
				{
					id: 'R1',
					text: 'Write no line comments.',
					source: { path: 'AGENTS.md', line: 4 },
					appliesTo: 'src/a.ts',
					check: { kind: 'forbid-pattern', pattern: '^\\s*//', glob: '**/*.ts' }
				}
			]),
			{ inventory, added, heads: new Map() }
		);

		expect(results.map(({ file, line, ruleId, category }) => ({ file, line, ruleId, category }))).toEqual([
			{ file: 'src/a.ts', line: 2, ruleId: 'R1', category: 'repo-rule' }
		]);
	});

	test('flags a changed file over the line limit and leaves files under it', () => {
		const results = ruleCheckResults(
			ledger([
				{
					id: 'R2',
					text: 'Keep files under 3 lines.',
					source: { path: 'AGENTS.md' },
					check: { kind: 'max-file-lines', max: 3 }
				}
			]),
			{
				inventory,
				added,
				heads: new Map([
					[
						'src/a.ts',
						'// existing comment\n// new comment\nconst url = 1;\nexport const a = 1;\nexport const b = 2;\n'
					],
					['src/new.test.ts', 'test();\n// trailing\n']
				])
			}
		);

		expect(results.map(({ file, line }) => ({ file, line }))).toEqual([{ file: 'src/a.ts', line: 2 }]);
		expect(results[0].evidence).toContain('5 lines');
	});

	test('flags an added file outside the folder a path rule requires', () => {
		const results = ruleCheckResults(
			ledger([
				{
					id: 'R3',
					text: 'Put tests under tests/.',
					source: { path: 'AGENTS.md' },
					check: { kind: 'path-pattern', files: '**/*.test.ts', mustMatch: 'tests/**' }
				}
			]),
			{ inventory, added, heads: new Map() }
		);

		expect(results.map(({ file, line }) => ({ file, line }))).toEqual([{ file: 'src/new.test.ts', line: 1 }]);
	});
});
