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

/**
 * The lines a require-braces rule reports in `src/flow.ts`, a file whose head
 * is `lines` and whose diff adds the 1-based lines in `addedRows`.
 */
async function braceLines(lines: string[], addedRows: number[]): Promise<number[]> {
	const unchanged = lines.length - addedRows.length;

	const diff = [
		'diff --git a/src/flow.ts b/src/flow.ts',
		'--- a/src/flow.ts',
		'+++ b/src/flow.ts',
		`@@ -${unchanged ? 1 : 0},${unchanged} +1,${lines.length} @@`,
		...lines.map((text, index) => `${addedRows.includes(index + 1) ? '+' : ' '}${text}`),
		''
	].join('\n');

	const flowInventory = buildInventory(diff, []);

	const results = await ruleCheckResults(
		ledger([
			{
				id: 'R4',
				text: 'Always use braces for control flow.',
				source: { path: 'AGENTS.md' },
				check: { kind: 'require-braces', glob: '**/*.ts' }
			}
		]),
		{
			inventory: flowInventory,
			added: addedLines(flowInventory),
			heads: new Map([['src/flow.ts', `${lines.join('\n')}\n`]])
		}
	);

	return results.flatMap((result) => [result.line, ...(result.relatedLocations ?? []).map((other) => other.line)]);
}

describe('ruleCheckResults', () => {
	test('runs a forbid-pattern only on added lines of files its globs cover', async () => {
		const results = await ruleCheckResults(
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

	test('flags a changed file over the line limit and leaves files under it', async () => {
		const results = await ruleCheckResults(
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

	test('flags an added file outside the folder a path rule requires', async () => {
		const results = await ruleCheckResults(
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

	test('flags an added if whose body has no braces', async () => {
		expect(await braceLines(['if (ready) start();', 'export {};'], [1])).toEqual([1]);
	});

	test('leaves an added if whose body is a braced block', async () => {
		expect(await braceLines(['if (ready) {', '\tstart();', '}'], [1, 2, 3])).toEqual([]);
	});

	test('flags an added else without braces after a braced if', async () => {
		expect(await braceLines(['if (ready) {', '\tstart();', '} else stop();'], [1, 2, 3])).toEqual([3]);
	});

	test('leaves an added arrow function with an expression body', async () => {
		expect(await braceLines(['export const next = (x: number) => x + 1;'], [1])).toEqual([]);
	});

	test('leaves a brace-less if on a line the diff does not add', async () => {
		expect(await braceLines(['if (ready) start();', 'export const x = 1;'], [2])).toEqual([]);
	});
});
