import { describe, expect, test } from 'bun:test';
import type { ChangeModel, ChangedSymbol } from '../../../../src/review/pipeline/change-model/types';
import { addedLines } from '../../../../src/review/pipeline/detectors/changed-lines';
import { complexityResults, deadCodeResults } from '../../../../src/review/pipeline/detectors/symbols';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { addedFile } from '../harness-fixtures';

const INVENTORY = buildInventory(addedFile('src/a.ts', 120) + addedFile('tests/a.test.ts', 5), []);

function symbol(overrides: Partial<ChangedSymbol>): ChangedSymbol {
	const name = overrides.name ?? 'helper';

	return {
		id: `src/a.ts#${name}`,
		name,
		qualifiedName: name,
		kind: 'function',
		file: 'src/a.ts',
		startLine: 1,
		endLine: 10,
		change: 'added',
		hunkIds: [],
		language: 'typescript',
		signature: `export function ${name}()`,
		exported: true,
		calls: [],
		references: [],
		tests: [],
		examples: [],
		metrics: { lines: 10, maxDepth: 1, params: 1 },
		...overrides
	};
}

function model(symbols: ChangedSymbol[], p95 = { lines: 40, maxDepth: 3, params: 3 }): ChangeModel {
	return { symbols, byHunk: {}, baselines: [{ language: 'typescript', sampled: 200, p95 }], unparsed: [] };
}

describe('deadCodeResults', () => {
	test('flags an added export that only its own file names, even with a test file beside the module', () => {
		const results = deadCodeResults(
			model([
				symbol({ name: 'orphan', references: [{ file: 'src/a.ts', line: 50, text: 'orphan()' }] }),
				symbol({
					name: 'imported',
					references: [{ file: 'src/b.ts', line: 2, text: "import { imported } from './a'" }]
				}),
				symbol({ name: 'besideTest', tests: ['tests/a.test.ts'] }),
				symbol({
					name: 'tested',
					tests: ['tests/a.test.ts'],
					references: [{ file: 'tests/a.test.ts', line: 3, text: 'tested()' }]
				}),
				symbol({ name: 'local', exported: false }),
				symbol({ name: 'older', change: 'modified' }),
				symbol({ name: 'inTest', file: 'tests/a.test.ts' })
			]),
			INVENTORY
		);

		expect(results.map((result) => result.symbol)).toEqual(['orphan', 'besideTest']);
	});
});

describe('complexityResults', () => {
	const added = addedLines(INVENTORY);

	test('flags a symbol only past both the repo p95 and the absolute floor', () => {
		const results = complexityResults(
			model([
				symbol({ name: 'long', metrics: { lines: 90, maxDepth: 2, params: 1 } }),
				symbol({ name: 'pastP95Only', metrics: { lines: 55, maxDepth: 2, params: 1 } }),
				symbol({ name: 'deep', metrics: { lines: 20, maxDepth: 5, params: 1 } })
			]),
			added
		);

		expect(results.map((result) => result.symbol)).toEqual(['long', 'deep']);
		expect(results[0].evidence).toContain('lines 90');
	});

	test('uses the repo p95 when it is above the floor', () => {
		const results = complexityResults(
			model([symbol({ metrics: { lines: 90, maxDepth: 2, params: 1 } })], { lines: 120, maxDepth: 3, params: 3 }),
			added
		);

		expect(results).toEqual([]);
	});

	test('skips a language with no baseline', () => {
		const results = complexityResults(
			model([symbol({ language: 'python', metrics: { lines: 300, maxDepth: 9, params: 9 } })]),
			added
		);

		expect(results).toEqual([]);
	});

	test('skips a modified symbol the change barely touched', () => {
		const inventory = buildInventory(
			'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -5 +5 @@\n-old\n+new\n',
			[]
		);

		const results = complexityResults(
			model([symbol({ change: 'modified', endLine: 100, metrics: { lines: 100, maxDepth: 2, params: 1 } })]),
			addedLines(inventory)
		);

		expect(results).toEqual([]);
	});
});
