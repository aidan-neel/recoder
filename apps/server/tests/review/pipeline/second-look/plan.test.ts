import { expect, test } from 'bun:test';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { contractCheckUnits } from '../../../../src/review/pipeline/second-look/plan';
import { addedFile } from '../harness-fixtures';

const inventory = buildInventory(addedFile('src/a.ts', 20), []);

function candidate(id: string, patch: Partial<CandidateFinding>): CandidateFinding {
	return {
		id,
		candidateId: id,
		valid: true,
		file: 'src/a.ts',
		line: 3,
		severity: 'info',
		category: 'readability',
		smell: 'stale-comment',
		title: `Report ${id}`,
		message: 'The comment says one thing, the code does another.',
		...patch
	};
}

test('contract checks go to valid readability reports of a comment that disagrees with the code, once per place, up to the cap', () => {
	const units = contractCheckUnits(
		[
			candidate('c1', {}),
			candidate('c2', {}),
			candidate('c3', { line: 5, smell: 'magic-value' }),
			candidate('c4', { line: 6, valid: false }),
			candidate('c5', { line: 7, category: 'correctness' }),
			candidate('c6', { line: 8, smell: 'hidden-side-effect' }),
			candidate('c7', { line: 9, smell: 'misleading-name' })
		],
		inventory,
		2
	);

	expect(units.map((unit) => [unit.id, unit.title, unit.purpose, unit.scope[0].path])).toEqual([
		['contract-1', 'Check the contract: Report c1', 'contract-check', 'src/a.ts'],
		['contract-2', 'Check the contract: Report c6', 'contract-check', 'src/a.ts']
	]);
});
