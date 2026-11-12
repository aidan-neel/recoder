import { describe, expect, test } from 'bun:test';
import { ruleAppliesTo } from '../../../../src/review/guidelines/ledger/glob';
import { ledgerBlock } from '../../../../src/review/guidelines/ledger/ledger';
import { compareSourcePrecedence } from '../../../../src/review/guidelines/ledger/precedence';
import { GLOBAL_SOURCE } from '../../../../src/review/guidelines/ledger/sources';
import { toFindingRule } from '../../../../src/review/guidelines/ledger/types';
import { toLedger } from '../../../../src/review/guidelines/ledger/validate';
import type { CandidateFinding } from '../../../../src/review/pipeline/consolidate';
import { addedLines } from '../../../../src/review/pipeline/detectors/changed-lines';
import { ruleCheckResults } from '../../../../src/review/pipeline/detectors/rule-check';
import { buildInventory } from '../../../../src/review/pipeline/inventory';
import { precheckRuleCandidate } from '../../../../src/review/pipeline/quality-verify';

describe('compareSourcePrecedence', () => {
	test('ranks repo Recoder guidelines above global settings, nested folders, and root instruction files', () => {
		const ordered = [
			'RECODER.md',
			'.recoder/REVIEW.md',
			GLOBAL_SOURCE,
			'apps/web/AGENTS.md',
			'apps/web/CLAUDE.md',
			'AGENTS.md',
			'CLAUDE.md',
			'CONTRIBUTING.md',
			'GEMINI.md'
		];

		for (let i = 0; i < ordered.length - 1; i++) {
			expect(compareSourcePrecedence(ordered[i], ordered[i + 1])).toBeLessThan(0);
			expect(compareSourcePrecedence(ordered[i + 1], ordered[i])).toBeGreaterThan(0);
		}
	});

	test('ranks a deeper nested AGENTS.md above its parent folder while leaving sibling folders independent', () => {
		expect(compareSourcePrecedence('apps/web/ui/AGENTS.md', 'apps/web/AGENTS.md')).toBeLessThan(0);
		expect(compareSourcePrecedence('apps/web/AGENTS.md', 'apps/api/AGENTS.md')).toBe(0);
	});
});

describe('conflicting rule files', () => {
	test('overrides a root AGENTS.md rule across the repository when RECODER.md states a conflicting rule', () => {
		const ledger = toLedger(
			{
				rules: [
					{
						text: 'Never use default exports.',
						source: 'AGENTS.md',
						line: 1
					},
					{
						text: 'Default exports are allowed.',
						source: 'RECODER.md',
						line: 1
					}
				]
			},
			[
				{ path: 'AGENTS.md', text: '- Never use default exports.\n', revision: 'sha1' },
				{ path: 'RECODER.md', text: '- Default exports are allowed.\n', revision: 'sha1' }
			],
			'hash'
		);

		const [rootRule, repoRule] = ledger.rules;

		expect(rootRule).toMatchObject({
			id: 'R1',
			excludedScopes: ['**'],
			overriddenBy: 'R2'
		});

		expect(ruleAppliesTo(rootRule, 'src/index.ts')).toBe(false);
		expect(ruleAppliesTo(repoRule, 'src/index.ts')).toBe(true);
		expect(ledgerBlock(ledger, ['src/index.ts'])).toBe('R2: Default exports are allowed. (RECODER.md:1)');
	});

	test('carves a nested folder out of a conflicting root rule while keeping the root rule outside that folder', () => {
		const ledger = toLedger(
			{
				rules: [
					{
						text: 'Keep every file under 500 lines.',
						source: 'AGENTS.md',
						line: 1,
						check: { kind: 'max-file-lines', max: 500 }
					},
					{
						text: 'Keep every file under 800 lines.',
						source: 'apps/web/AGENTS.md',
						line: 1,
						check: { kind: 'max-file-lines', max: 800 }
					}
				]
			},
			[
				{ path: 'AGENTS.md', text: '- Keep every file under 500 lines.\n', revision: 'sha1' },
				{ path: 'apps/web/AGENTS.md', text: '- Keep every file under 800 lines.\n', revision: 'sha1' }
			],
			'hash'
		);

		const [rootRule, webRule] = ledger.rules;

		expect(rootRule).toMatchObject({
			id: 'R1',
			excludedScopes: ['apps/web/**'],
			overriddenBy: 'R2'
		});

		expect(ruleAppliesTo(rootRule, 'apps/server/index.ts')).toBe(true);
		expect(ruleAppliesTo(rootRule, 'apps/web/page.tsx')).toBe(false);
		expect(ruleAppliesTo(webRule, 'apps/web/page.tsx')).toBe(true);
		expect(ruleAppliesTo(webRule, 'apps/server/index.ts')).toBe(false);
	});

	test('keeps a mandatory file-line detector active when higher-precedence guidelines set a function-line limit', async () => {
		const ledger = toLedger(
			{
				rules: [
					{
						text: 'Files stay under 500 lines, tests included.',
						source: 'AGENTS.md',
						line: 1,
						check: { kind: 'max-file-lines', max: 500 }
					},
					{
						text: 'Keep functions under 40 lines.',
						source: GLOBAL_SOURCE,
						line: 1
					}
				]
			},
			[
				{ path: 'AGENTS.md', text: '- Files stay under 500 lines, tests included.\n', revision: 'sha1' },
				{ path: GLOBAL_SOURCE, text: '- Keep functions under 40 lines.\n' }
			],
			'hash'
		);

		const [fileRule, functionRule] = ledger.rules;

		expect(fileRule.excludedScopes).toBeUndefined();
		expect(fileRule.overriddenBy).toBeUndefined();
		expect(ruleAppliesTo(fileRule, 'src/a.ts')).toBe(true);
		expect(ruleAppliesTo(functionRule, 'src/a.ts')).toBe(true);

		const diff = [
			'diff --git a/src/a.ts b/src/a.ts',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -1,1 +1,2 @@',
			' export const x = 1;',
			'+export const y = 2;',
			''
		].join('\n');

		const inventory = buildInventory(diff, []);
		const longHead = `${Array.from({ length: 501 }, (_, idx) => `export const v${idx} = ${idx};`).join('\n')}\n`;

		const hits = await ruleCheckResults(ledger, {
			inventory,
			added: addedLines(inventory),
			heads: new Map([['src/a.ts', longHead]])
		});

		expect(hits.map((hit) => hit.ruleId)).toEqual(['R1']);
	});

	test('keeps compatible rules on the same topic active when one requires JSDoc and the other forbids line comments', () => {
		const ledger = toLedger(
			{
				rules: [
					{
						text: 'Never write // comments.',
						source: 'AGENTS.md',
						line: 1
					},
					{
						text: 'Comments are JSDoc docstrings only.',
						source: 'RECODER.md',
						line: 1
					}
				]
			},
			[
				{ path: 'AGENTS.md', text: '- Never write // comments.\n', revision: 'sha1' },
				{ path: 'RECODER.md', text: '- Comments are JSDoc docstrings only.\n', revision: 'sha1' }
			],
			'hash'
		);

		const [forbidLineComments, requireJsdoc] = ledger.rules;

		expect(forbidLineComments.excludedScopes).toBeUndefined();
		expect(forbidLineComments.overriddenBy).toBeUndefined();
		expect(requireJsdoc.excludedScopes).toBeUndefined();
		expect(ruleAppliesTo(forbidLineComments, 'src/a.ts')).toBe(true);
		expect(ruleAppliesTo(requireJsdoc, 'src/a.ts')).toBe(true);

		const diff = [
			'diff --git a/src/a.ts b/src/a.ts',
			'--- a/src/a.ts',
			'+++ b/src/a.ts',
			'@@ -1,1 +1,2 @@',
			' export const x = 1;',
			'+// comment',
			''
		].join('\n');

		const inventory = buildInventory(diff, []);

		const candidate: CandidateFinding = {
			id: 'f1',
			candidateId: 'c1',
			valid: true,
			file: 'src/a.ts',
			line: 2,
			endLine: 2,
			severity: 'warning',
			category: 'repo-rule',
			kind: 'quality',
			ruleId: forbidLineComments.id,
			rule: toFindingRule(forbidLineComments),
			message: '[repo-rule] Uses // comment.'
		};

		expect(precheckRuleCandidate(candidate, ledger, inventory)).toBeNull();
	});
});
