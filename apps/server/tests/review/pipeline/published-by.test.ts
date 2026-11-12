import { describe, expect, test } from 'bun:test';
import { toFindingRule, type RepoRule, type RuleLedger } from '../../../src/review/guidelines/ledger/types';
import { consolidateFindings } from '../../../src/review/pipeline/consolidate-merge';
import type { CandidateFinding } from '../../../src/review/pipeline/consolidate';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import { isHeldBack, publishHeldBack } from '../../../src/review/pipeline/published-by';

const BAR_DIFF = [
	'diff --git a/src/service.ts b/src/service.ts',
	'--- a/src/service.ts',
	'+++ b/src/service.ts',
	'@@ -1,1 +1,2 @@',
	' export const ok = true;',
	'+export const extra = 1;',
	''
].join('\n');

const BAR_INVENTORY = buildInventory(BAR_DIFF);

const MANDATORY_RULE: RepoRule = {
	id: 'R1',
	text: 'Export at most one symbol per service module.',
	restatement: 'Export one symbol per service module.',
	level: 'mandatory',
	source: { path: 'AGENTS.md', line: 5, endLine: 6, revision: 'rev9' }
};

const ADVISORY_RULE: RepoRule = {
	id: 'R2',
	text: 'Prefer grouping constants at the top of the module.',
	restatement: 'Group constants at the top.',
	level: 'advisory',
	source: { path: 'AGENTS.md', line: 10, endLine: 10, revision: 'rev9' }
};

const LEDGER: RuleLedger = { rules: [MANDATORY_RULE, ADVISORY_RULE], sourcesHash: 'bar-hash' };

function belowBarRuleCandidate(rule: RepoRule): CandidateFinding {
	return {
		id: `id-${rule.id}`,
		candidateId: `c-${rule.id}`,
		valid: true,
		belowBar: true,
		file: 'src/service.ts',
		line: 2,
		endLine: 2,
		severity: 'info',
		category: 'repo-rule',
		kind: 'quality',
		ruleId: rule.id,
		rule: toFindingRule(rule),
		message: `[repo-rule] Breaks ${rule.id}.`,
		evidenceIds: ['ev_1'],
		verification: {
			status: 'verified',
			method: 'rule',
			reason: 'Checked against the rule and changed line.',
			ruleCheck: {
				applicability: { outcome: 'applies', reason: 'Applies to src/service.ts.', evidenceIds: ['ev_1'] },
				violation: { outcome: 'violated', reason: 'Adds a second export.', evidenceIds: ['ev_1'] }
			}
		}
	};
}

describe('publishHeldBack for repository rules', () => {
	test('keeps a verified low-severity mandatory rule violation visible with its FindingRule attached', () => {
		const candidate = belowBarRuleCandidate(MANDATORY_RULE);

		publishHeldBack(candidate, LEDGER);

		expect(candidate.publishedBy).toBe('rule');
		expect(isHeldBack(candidate)).toBe(false);

		const published = consolidateFindings([candidate], BAR_INVENTORY);

		expect(published).toHaveLength(1);

		expect(published[0]).toMatchObject({
			severity: 'info',
			category: 'repo-rule',
			ruleId: 'R1',
			rule: {
				id: 'R1',
				text: 'Export at most one symbol per service module.',
				restatement: 'Export one symbol per service module.',
				level: 'mandatory',
				source: { path: 'AGENTS.md', line: 5, endLine: 6, revision: 'rev9' }
			}
		});
	});

	test('holds back a low-severity advisory rule finding below the medium reporting bar', () => {
		const candidate = belowBarRuleCandidate(ADVISORY_RULE);

		publishHeldBack(candidate, LEDGER);

		expect(candidate.publishedBy).toBeUndefined();
		expect(isHeldBack(candidate)).toBe(true);
		expect(consolidateFindings([candidate], BAR_INVENTORY)).toEqual([]);
	});

	test('holds back a low-severity rule candidate whose ruleCheck did not establish both applicability and violation', () => {
		const candidate = belowBarRuleCandidate(MANDATORY_RULE);

		candidate.verification = {
			status: 'verified',
			method: 'rule',
			reason: 'Exception covered it.',
			ruleCheck: {
				applicability: { outcome: 'applies', reason: 'Applies.', evidenceIds: ['ev_1'] },
				violation: { outcome: 'exception', reason: 'Allowed here.', evidenceIds: ['ev_1'] }
			}
		};

		publishHeldBack(candidate, LEDGER);

		expect(candidate.publishedBy).toBeUndefined();
	});
});
