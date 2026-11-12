import { describe, expect, test } from 'bun:test';
import { evaluateRuleApplicability } from '../../../../src/review/guidelines/ledger/applicability';
import type { RepoRule, RuleLedger } from '../../../../src/review/guidelines/ledger/types';
import { buildInventory } from '../../../../src/review/pipeline/inventory';

const DIFF = [
	'diff --git a/apps/server/a.ts b/apps/server/a.ts',
	'--- a/apps/server/a.ts',
	'+++ b/apps/server/a.ts',
	'@@ -1,2 +1,3 @@',
	' export const untouched = 1;',
	'+export const added = 2;',
	' export const trailing = 3;',
	''
].join('\n');

const INVENTORY = buildInventory(DIFF);

function ledgerOf(rules: RepoRule[]): RuleLedger {
	return { rules, sourcesHash: 'h' };
}

describe('evaluateRuleApplicability', () => {
	test('marks a rule applicable when its scope covers the file, nothing overrides it, and the span modifies lines', () => {
		const rule: RepoRule = {
			id: 'R1',
			text: 'Write JSDoc comments only.',
			level: 'mandatory',
			source: { path: 'AGENTS.md', line: 3, endLine: 3, revision: 'sha1' }
		};

		const decision = evaluateRuleApplicability(
			rule,
			{ file: 'apps/server/a.ts', line: 2, ruleId: 'R1' },
			ledgerOf([rule]),
			INVENTORY,
			['ev_1']
		);

		expect(decision).toEqual({
			outcome: 'applies',
			reason: 'Rule R1 (AGENTS.md:3) covers all files and applies to the changed lines in apps/server/a.ts.',
			evidenceIds: ['ev_1']
		});
	});

	test('marks a rule not-applicable when its appliesTo glob or nested instruction folder misses the file', () => {
		const globRule: RepoRule = {
			id: 'R1',
			text: 'Use Sivir components.',
			appliesTo: 'apps/web/**',
			source: { path: 'AGENTS.md', line: 8, endLine: 8 }
		};

		const nestedRule: RepoRule = {
			id: 'R2',
			text: 'Colocate route loaders.',
			source: { path: 'apps/web/AGENTS.md', line: 2, endLine: 2 }
		};

		const ledger = ledgerOf([globRule, nestedRule]);

		expect(
			evaluateRuleApplicability(globRule, { file: 'apps/server/a.ts', line: 2, ruleId: 'R1' }, ledger, INVENTORY)
		).toMatchObject({
			outcome: 'not-applicable',
			reason: 'Rule R1 (AGENTS.md:8) applies to apps/web/**, not apps/server/a.ts.'
		});

		expect(
			evaluateRuleApplicability(nestedRule, { file: 'apps/server/a.ts', line: 2, ruleId: 'R2' }, ledger, INVENTORY)
		).toMatchObject({
			outcome: 'not-applicable',
			reason: 'Rule R2 (apps/web/AGENTS.md:2) applies only to apps/web/**, not apps/server/a.ts.'
		});
	});

	test('marks a rule not-applicable and names the winner when overridden by a higher-precedence guideline file', () => {
		const overridden: RepoRule = {
			id: 'R1',
			text: 'Keep files under 500 lines.',
			excludedScopes: ['apps/server/**'],
			overriddenBy: 'R2',
			source: { path: 'AGENTS.md', line: 4, endLine: 4 }
		};

		const winner: RepoRule = {
			id: 'R2',
			text: 'Keep files under 800 lines.',
			source: { path: 'RECODER.md', line: 2, endLine: 2 }
		};

		expect(
			evaluateRuleApplicability(
				overridden,
				{ file: 'apps/server/a.ts', line: 2, ruleId: 'R1' },
				ledgerOf([overridden, winner]),
				INVENTORY
			)
		).toEqual({
			outcome: 'not-applicable',
			reason: 'Rule R1 (AGENTS.md:4) is overridden for apps/server/a.ts by R2 (RECODER.md:2).',
			evidenceIds: []
		});
	});

	test('marks a rule not-applicable when the flagged span hits only unchanged context lines', () => {
		const rule: RepoRule = {
			id: 'R1',
			text: 'Avoid magic numbers.',
			source: { path: 'AGENTS.md', line: 1, endLine: 1 }
		};

		expect(
			evaluateRuleApplicability(rule, { file: 'apps/server/a.ts', line: 1, ruleId: 'R1' }, ledgerOf([rule]), INVENTORY)
		).toEqual({
			outcome: 'not-applicable',
			reason: 'Line 1 of apps/server/a.ts was not modified by this change.',
			evidenceIds: []
		});
	});
});
