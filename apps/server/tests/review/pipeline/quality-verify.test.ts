import { describe, expect, test } from 'bun:test';
import { EvidenceStore } from '../../../src/evidence/evidence';
import { toFindingRule, type RepoRule, type RuleLedger } from '../../../src/review/guidelines/ledger/types';
import { toFinding, type CandidateFinding } from '../../../src/review/pipeline/consolidate';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import {
	precheckRuleCandidate,
	qualityVerifierPushBack,
	refuteByRuleScope,
	settleQualityVerdict
} from '../../../src/review/pipeline/quality-verify';
import { parseVerdict } from '../../../src/review/pipeline/verify';

const RULE_DIFF = [
	'diff --git a/apps/server/handler.ts b/apps/server/handler.ts',
	'--- a/apps/server/handler.ts',
	'+++ b/apps/server/handler.ts',
	'@@ -1,2 +1,3 @@',
	' export function handle() {',
	'+	console.log("debug");',
	' }',
	''
].join('\n');

const RULE_INVENTORY = buildInventory(RULE_DIFF);

function makeRuleStore(): EvidenceStore {
	const store = new EvidenceStore(null, RULE_INVENTORY, 2000);

	store.records.set('ev_span', {
		id: 'ev_span',
		revision: 'head',
		path: 'apps/server/handler.ts',
		startLine: 1,
		endLine: 3,
		content: '1| export function handle() {\n2| \tconsole.log("debug");\n3| }',
		truncated: false
	});

	store.records.set('ev_guide', {
		id: 'ev_guide',
		revision: 'target',
		path: 'AGENTS.md',
		startLine: 1,
		endLine: 4,
		content: '1| - Never call console.log in server handlers, except in seed scripts.',
		truncated: false
	});

	return store;
}

function makeRuleCandidate(rule: RepoRule, file = 'apps/server/handler.ts', line = 2): CandidateFinding {
	return {
		id: 'f-rule-1',
		candidateId: 'c1',
		valid: true,
		file,
		line,
		endLine: line,
		severity: 'warning',
		category: 'repo-rule',
		kind: 'quality',
		ruleId: rule.id,
		rule: toFindingRule(rule),
		message: '[repo-rule] Calls console.log.',
		evidenceIds: ['ev_span']
	};
}

const STRICT_RULE: RepoRule = {
	id: 'R1',
	text: 'Never call console.log in server handlers.',
	restatement: 'Avoid console.log in server handlers.',
	level: 'mandatory',
	source: { path: 'AGENTS.md', line: 1, endLine: 1, revision: 'base1' }
};

const EXCEPTION_RULE: RepoRule = {
	id: 'R3',
	text: 'Never call console.log in server handlers, except in seed scripts.',
	level: 'mandatory',
	exceptions: ['in seed scripts'],
	source: { path: 'AGENTS.md', line: 1, endLine: 1, revision: 'base1' }
};

function ruleFixture(rule: RepoRule): { ledger: RuleLedger; candidate: CandidateFinding; store: EvidenceStore } {
	return {
		ledger: { rules: [rule], sourcesHash: `hash-${rule.id}` },
		candidate: makeRuleCandidate(rule),
		store: makeRuleStore()
	};
}

describe('repo-rule verification decisions', () => {
	test('confirms an applicable rule violation and records both applicability and violation decisions with evidence', () => {
		const { ledger, candidate, store } = ruleFixture(STRICT_RULE);

		const settled = settleQualityVerdict(
			candidate,
			{
				verdict: 'confirmed',
				reason: 'Line 2 of `apps/server/handler.ts:2` calls `console.log`.',
				evidenceIds: ['ev_span']
			},
			store,
			{ ledger, inventory: RULE_INVENTORY, retrievals: 1 }
		);

		expect(settled).toEqual({
			status: 'verified',
			method: 'rule',
			reason: 'Line 2 of `apps/server/handler.ts:2` calls `console.log`.',
			ruleCheck: {
				applicability: {
					outcome: 'applies',
					reason: 'Rule R1 (AGENTS.md:1) covers all files and applies to the changed lines in apps/server/handler.ts.',
					evidenceIds: ['ev_span']
				},
				violation: {
					outcome: 'violated',
					reason: 'Line 2 of `apps/server/handler.ts:2` calls `console.log`.',
					evidenceIds: ['ev_span']
				}
			}
		});
	});

	test('refutes a scope mismatch at applicability and marks violation as not-checked without needing a verifier', () => {
		const webOnly: RepoRule = {
			id: 'R2',
			text: 'Never call console.log in browser components.',
			level: 'mandatory',
			appliesTo: 'apps/web/**',
			source: { path: 'apps/web/AGENTS.md', line: 2, endLine: 2, revision: 'base1' }
		};

		const { ledger, candidate } = ruleFixture(webOnly);
		const precheck = precheckRuleCandidate(candidate, ledger, RULE_INVENTORY);

		expect(precheck).not.toBeNull();
		if (precheck) refuteByRuleScope(candidate, precheck);

		expect(candidate.valid).toBe(false);
		expect(candidate.refuted).toBe(true);
		expect(candidate.dropStage).toBe('refuted');

		expect(toFinding(candidate).verification?.ruleCheck).toEqual({
			applicability: {
				outcome: 'not-applicable',
				reason: 'Rule R2 (apps/web/AGENTS.md:2) applies only to apps/web/**, not apps/server/handler.ts.',
				evidenceIds: ['ev_span']
			},
			violation: {
				outcome: 'not-checked',
				reason: 'Rule does not apply to this change, so violation was not checked.',
				evidenceIds: []
			}
		});
	});

	test('refutes an applicable rule when a stated exception covers the changed lines and records exception evidence', () => {
		const { ledger, candidate, store } = ruleFixture(EXCEPTION_RULE);

		const parsed = parseVerdict({
			verdict: 'refuted',
			reason: 'This file is invoked as a seed helper covered by the stated exception.',
			evidenceIds: ['ev_span', 'ev_guide'],
			ruleCheck: {
				applicability: { outcome: 'applies', evidenceIds: ['ev_guide'] },
				violation: {
					outcome: 'exception',
					reason: 'Covered by the seed-script exception.',
					exceptionsChecked: ['in seed scripts'],
					evidenceIds: ['ev_span', 'ev_guide']
				}
			}
		});

		expect(parsed).not.toBeNull();
		if (!parsed) return;

		const settled = settleQualityVerdict(candidate, parsed, store, {
			ledger,
			inventory: RULE_INVENTORY,
			retrievals: 1
		});

		expect(settled).toBe('refuted');

		expect(candidate.ruleCheck).toEqual({
			applicability: {
				outcome: 'applies',
				reason: 'Rule R3 (AGENTS.md:1) covers all files and applies to the changed lines in apps/server/handler.ts.',
				evidenceIds: ['ev_guide']
			},
			violation: {
				outcome: 'exception',
				reason: 'Covered by the seed-script exception.',
				exceptionsChecked: ['in seed scripts'],
				evidenceIds: ['ev_span', 'ev_guide']
			}
		});
	});

	test('leaves a rule finding unverified when the rule states exceptions that the verifier did not check', () => {
		const { ledger, candidate, store } = ruleFixture(EXCEPTION_RULE);

		const verdict = {
			verdict: 'confirmed' as const,
			reason: 'Calls console.log at apps/server/handler.ts:2.',
			evidenceIds: ['ev_span']
		};

		expect(qualityVerifierPushBack(candidate, verdict, { retrievals: 1 }, store, ledger)).not.toBeNull();

		const settled = settleQualityVerdict(candidate, verdict, store, {
			ledger,
			inventory: RULE_INVENTORY,
			retrievals: 1
		});

		expect(settled).toMatchObject({
			status: 'unverified',
			ruleCheck: {
				applicability: { outcome: 'applies' },
				violation: { outcome: 'unknown' }
			}
		});
	});

	test('rejects a confirmation resting on the reviewer assertion alone when the verifier performed no retrieval', () => {
		const { ledger, candidate, store } = ruleFixture(STRICT_RULE);

		const verdict = {
			verdict: 'confirmed' as const,
			reason: 'The reviewer reported console.log at apps/server/handler.ts:2.',
			evidenceIds: ['ev_span']
		};

		expect(qualityVerifierPushBack(candidate, verdict, { retrievals: 0 }, store, ledger)).not.toBeNull();

		const settled = settleQualityVerdict(candidate, verdict, store, {
			ledger,
			inventory: RULE_INVENTORY,
			retrievals: 0
		});

		expect(settled).toMatchObject({
			status: 'unverified',
			ruleCheck: {
				applicability: { outcome: 'applies' },
				violation: { outcome: 'unknown', evidenceIds: [] }
			}
		});
	});
});
