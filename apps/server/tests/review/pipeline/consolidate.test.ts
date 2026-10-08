import { expect, test } from 'bun:test';
import type { FindingVerification } from '@recoder/shared';
import { EvidenceStore } from '../../../src/evidence/evidence';
import {
	candidateFromDetector,
	publishHeldBack,
	toFinding,
	validateCandidate,
	type CandidateContext,
	type CandidateFinding
} from '../../../src/review/pipeline/consolidate';
import { consolidateFindings } from '../../../src/review/pipeline/consolidate-merge';
import type { DetectorResult } from '../../../src/review/pipeline/detectors/types';
import type { ReviewerFinding } from '../../../src/review/pipeline/finding-schema';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import type { LensId } from '../../../src/review/pipeline/lenses/types';

const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,6 @@
 keep
-old
+n2
+n3
+const outdated = installed < latest;
+n5
+n6
@@ -40,1 +44,2 @@
-x
+y
+z
`;

const INVENTORY = buildInventory(DIFF);

function context(): CandidateContext {
	const inventory = INVENTORY;

	return {
		inventory,
		evidence: new EvidenceStore(null, inventory, 1000),
		changeModel: null,
		ledger: { rules: [{ id: 'R1', text: 'Keep files short.', source: { path: 'AGENTS.md' } }], sourcesHash: 'h' }
	};
}

function raw(over: Partial<ReviewerFinding> = {}): ReviewerFinding {
	return {
		file: 'a.ts',
		line: 2,
		severity: 'high',
		category: 'correctness',
		claim: { trigger: 'a call', executionPath: [], consequence: 'it breaks', violatedContract: 'the caller' },
		examples: [],
		fix: [],
		body: 'bad',
		evidenceIds: [],
		...over
	};
}

let next = 0;

function candidate(over: Partial<ReviewerFinding> = {}, lens: LensId | null = null, ctx = context()): CandidateFinding {
	next++;

	return validateCandidate(
		raw(over),
		{ candidateId: `c${next}`, assignmentId: 'unit-1/correctness', role: 'reviewer', model: 'test', lens },
		ctx
	);
}

function verified(found: CandidateFinding, method: FindingVerification['method'] = 'trace'): CandidateFinding {
	return { ...found, verification: { status: 'verified', method, reason: 'checked' } };
}

function detector(over: Partial<DetectorResult> = {}): DetectorResult {
	return {
		detector: 'lint',
		category: 'readability',
		title: 'Lint',
		body: 'lint says no',
		file: 'a.ts',
		line: 3,
		evidence: 'a.ts:3 no-unused-vars',
		...over
	};
}

test('validateCandidate drops paths outside the change and invented new-side lines', () => {
	expect(candidate().valid).toBe(true);
	expect(candidate({ file: 'missing.ts' }).dropReason).toBe('path is not in the change inventory');
	expect(candidate({ line: 99 }).dropReason).toBe('new-side line is not associated with this change');
});

test('a repair link lets an unchanged line of a modified file pass, never a line outside an added file', () => {
	const added = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,3 @@
+one
+two
+three
`;

	const inventory = buildInventory(DIFF + added);
	const ctx = { ...context(), inventory, evidence: new EvidenceStore(null, inventory, 1000) };
	const meta = { candidateId: 'c1', assignmentId: 'unit-1/correctness', role: 'reviewer', model: 'm', lens: null };

	expect(inventory.files.find((file) => file.path === 'new.ts')?.status).toBe('added');
	expect(validateCandidate(raw({ line: 30 }), meta, ctx, { file: 'a.ts', line: 2 })).toMatchObject({ valid: true });

	expect(validateCandidate(raw({ file: 'new.ts', line: 400 }), meta, ctx, { file: 'new.ts', line: 2 })).toMatchObject({
		valid: false,
		dropStage: 'location',
		dropReason: 'new-side line is not associated with this change'
	});
});

test('each dropped candidate names the stage that dropped it', () => {
	expect(candidate().dropStage).toBeUndefined();
	expect(candidate({ file: 'missing.ts' }).dropStage).toBe('location');
	expect(candidate({ evidenceIds: ['ev_missing'] }).dropStage).toBe('evidence');
	expect(candidate({ category: 'performance' }, 'correctness').dropStage).toBe('category');
});

test('a low-severity finding stays valid but below the bar unless Settings asks for low severity', () => {
	const low = candidate({ severity: 'low' });

	expect([low.valid, low.belowBar, low.dropStage]).toEqual([true, true, undefined]);
	expect(candidate({ severity: 'medium' }).belowBar).toBeUndefined();
	expect(candidate({ severity: 'low' }, null, { ...context(), reportLowSeverity: true }).belowBar).toBeUndefined();
});

test('a low-severity finding that fails validation is dropped at that stage, not held back', () => {
	const low = candidate({ severity: 'low', file: 'missing.ts' });

	expect([low.valid, low.dropStage, low.belowBar]).toEqual([false, 'location', undefined]);
});

test('a verified candidate below the bar is not published', () => {
	const held = verified(candidate({ severity: 'low' }));

	expect(consolidateFindings([held], INVENTORY)).toEqual([]);
	expect(toFinding(held)).not.toHaveProperty('belowBar');
});

test('a candidate below the bar that merges with one above it is published as the one above', () => {
	const ctx = context();
	const above = verified(candidate({ severity: 'medium', line: 2 }, null, ctx));
	const below = verified(candidate({ severity: 'low', line: 2 }, null, ctx), 'run');
	const [finding, ...rest] = consolidateFindings([below, above], INVENTORY);

	expect(rest).toHaveLength(0);
	expect(finding.severity).toBe('warning');
	expect(finding.verification?.method).toBe('trace');
});

test('validateCandidate drops findings that break their category or lens requirements', () => {
	const example = { file: 'b.ts', line: 1 };

	expect(candidate({ category: 'performance' }, 'correctness').dropReason).toContain('outside the correctness lens');
	expect(candidate({ category: 'repo-rule', ruleId: 'R9' }, 'rules').valid).toBe(false);
	expect(candidate({ category: 'repo-rule', ruleId: 'R1' }, 'rules').valid).toBe(true);
	expect(candidate({ category: 'readability' }, 'readability').valid).toBe(false);
	expect(candidate({ category: 'readability', smell: 'unclear-name' }, 'readability').valid).toBe(true);
	expect(candidate({ category: 'convention', examples: [example] }, 'conventions').valid).toBe(false);
	expect(candidate({ category: 'convention', examples: [example, example] }, 'conventions').valid).toBe(true);
	expect(candidate({ category: 'intent-mismatch' }, 'correctness').valid).toBe(false);

	const cited = raw().claim;

	expect(
		candidate({ category: 'intent-mismatch', claim: { ...cited, violatedContract: 'breaks A2' } }, 'correctness').valid
	).toBe(true);
});

test('a held-back candidate a run reproduced is published and keeps the severity the reviewer gave it', () => {
	const held = verified(candidate({ severity: 'low' }), 'run');

	publishHeldBack(held, null);

	expect(held).toMatchObject({ valid: true, severity: 'info', belowBar: true, publishedBy: 'reproduced' });
	expect(consolidateFindings([held], INVENTORY)).toMatchObject([{ severity: 'info' }]);
});

test('a held-back candidate stays held when it was only traced or its run ends the same way before the change', () => {
	const traced = verified(candidate({ severity: 'low' }));
	const ran = verified(candidate({ severity: 'low' }), 'run');
	const evidence = { command: 'bun t.ts', exitCode: 1, observed: 'x', evidenceId: 'E1' };

	const sameOnBase = {
		...ran,
		verification: { ...ran.verification!, evidence: { ...evidence, baseline: { exitCode: 1, differs: false } } }
	};

	publishHeldBack(traced, null);
	publishHeldBack(sameOnBase, null);

	expect([traced.publishedBy, sameOnBase.publishedBy]).toEqual([undefined, undefined]);
	expect(consolidateFindings([traced, sameOnBase], INVENTORY)).toEqual([]);
});

const RULES: CandidateContext['ledger'] = {
	rules: [
		{ id: 'R1', text: 'Prefer undefined for absent values.', source: { path: 'AGENTS.md', line: 4 } },
		{ id: 'R2', text: 'Keep the web app tidy.', source: { path: 'AGENTS.md' }, appliesTo: 'apps/web/**' }
	],
	sourcesHash: 'h'
};

function lowRule(ruleId = 'R1', over: Partial<ReviewerFinding> = {}): CandidateFinding {
	return candidate({ severity: 'low', category: 'repo-rule', ruleId, ...over }, 'rules', {
		...context(),
		ledger: RULES
	});
}

test('a verified low repo-rule violation of a ledger rule is published as a rule violation and stays low', () => {
	const held = verified(lowRule(), 'rule');

	publishHeldBack(held, RULES);

	expect(held.publishedBy).toBe('rule');
	expect(consolidateFindings([held], INVENTORY)).toMatchObject([{ severity: 'info', category: 'repo-rule' }]);
});

test('a low repo-rule finding stays held when its rule id is not in the ledger', () => {
	const held = verified({ ...lowRule(), ruleId: 'R9' }, 'rule');

	publishHeldBack(held, RULES);

	expect(held.publishedBy).toBeUndefined();
	expect(consolidateFindings([held], INVENTORY)).toEqual([]);
});

test('a low finding of another category stays held even when it names a ledger rule', () => {
	const held = verified(
		{ ...candidate({ severity: 'low', category: 'readability', smell: 'unclear-name' }), ruleId: 'R1' },
		'rule'
	);

	publishHeldBack(held, RULES);

	expect(held.publishedBy).toBeUndefined();
});

test('a low repo-rule finding stays held when its rule does not apply to the file or no verifier proved it', () => {
	const elsewhere = verified(lowRule('R2'), 'rule');
	const unproven = { ...lowRule(), verification: { status: 'unverified' as const, reason: 'could not settle it' } };
	const traced = verified(lowRule(), 'trace');

	for (const held of [elsewhere, unproven, traced]) publishHeldBack(held, RULES);

	expect([elsewhere, unproven, traced].map((held) => held.publishedBy)).toEqual([undefined, undefined, undefined]);
});

test('a group of a held candidate and one published by a rule is published as the published one', () => {
	const held = verified(lowRule('R1', { line: 2 }), 'trace');
	const eligible = verified(lowRule('R1', { line: 2 }), 'rule');

	publishHeldBack(eligible, RULES);

	const [finding, ...rest] = consolidateFindings([held, eligible], INVENTORY);

	expect(rest).toHaveLength(0);
	expect(finding.id).toBe(eligible.id);
});

test('a candidate published by a reason is held again when it is judged again and no longer qualifies', () => {
	const held = { ...verified(candidate({ severity: 'low' }), 'run'), publishedBy: 'reproduced' as const };

	held.verification = { status: 'verified', method: 'trace', reason: 'checked' };
	publishHeldBack(held, null);

	expect(held.publishedBy).toBeUndefined();
});

test('an intent-mismatch may rest on a non-goal the intent holds, but not on an id it does not', () => {
	const claim = (id: string) => ({ id, text: 'Do not split comma-separated values.', source: 'pr' });

	const intent = {
		summary: '',
		goals: [],
		acceptanceCriteria: [],
		statedConstraints: [],
		nonGoals: [claim('N2')],
		priorDecisions: [],
		observedChanges: [],
		openQuestions: [],
		stack: { parent: null, children: [] }
	};

	const citing = (id: string) =>
		validateCandidate(
			raw({ category: 'intent-mismatch', claim: { ...raw().claim, violatedContract: `breaks ${id}` } }),
			{ candidateId: 'c1', assignmentId: 'unit-1/correctness', role: 'reviewer', model: 'm', lens: 'correctness' },
			{ ...context(), intent }
		);

	expect(citing('N2').valid).toBe(true);
	expect(citing('A9')).toMatchObject({ valid: false, dropStage: 'category' });
});

test('the fingerprint follows the line it sits on, and a drifted report that quotes the code snaps back to it', () => {
	const first = candidate({ line: 4, body: 'one wording', title: 'One' });
	const drifted = candidate({ line: 6, body: 'compares `installed < latest`', title: 'Two' });
	const elsewhere = candidate({ line: 2 });

	expect(drifted.line).toBe(4);
	expect(drifted.fingerprint).toBe(first.fingerprint);
	expect(elsewhere.fingerprint).not.toBe(first.fingerprint);
});

test('a detector result becomes a verified candidate, by rule for a rule check', () => {
	const ctx = context();
	const lint = candidateFromDetector(detector(), { candidateId: 'd1' }, ctx);
	const rule = candidateFromDetector(detector({ detector: 'rule-check', ruleId: 'R1' }), { candidateId: 'd2' }, ctx);
	const outside = candidateFromDetector(detector({ line: 30 }), { candidateId: 'd3' }, ctx);

	expect(lint.valid).toBe(true);
	expect(lint.verification).toMatchObject({ status: 'verified', method: 'detector' });
	expect(rule.verification?.method).toBe('rule');
	expect(outside.valid).toBe(false);
});

test('reports of one fingerprint on one line merge and keep the strongest proof', () => {
	const ctx = context();
	const traced = verified({ ...candidate({ line: 2 }, null, ctx), evidenceIds: ['E1'] });
	const ran = verified({ ...candidate({ line: 2, endLine: 3 }, null, ctx), evidenceIds: ['E2'] }, 'run');
	const unproven = candidate({ line: 2 }, null, ctx);
	const [finding, ...rest] = consolidateFindings([traced, ran, unproven], INVENTORY);

	expect(rest).toHaveLength(0);
	expect(finding.endLine).toBe(3);
	expect(finding.fingerprint).toBe(traced.fingerprint);
	expect(finding.verification?.method).toBe('run');
	expect(finding.evidenceIds).toEqual(['E2', 'E1']);
	expect(finding.relatedLocations).toEqual([{ file: 'a.ts', line: 2, endLine: 2, side: 'new' }]);
});

test('different bugs on overlapping lines of one hunk stay separate findings', () => {
	const ctx = context();
	const wide = verified(candidate({ line: 2, endLine: 5, title: 'Variants are unbounded' }, null, ctx), 'run');
	const inside = verified(candidate({ line: 3, endLine: 5, title: 'Metadata is dropped' }, null, ctx), 'run');
	const last = verified(candidate({ line: 5, title: 'Recency is not refreshed' }, null, ctx), 'run');
	const findings = consolidateFindings([wide, inside, last], INVENTORY);

	expect(findings.map((finding) => finding.title).sort()).toEqual([
		'Metadata is dropped',
		'Recency is not refreshed',
		'Variants are unbounded'
	]);
});

test("a finding's fingerprint does not depend on what else the run found in the same place", () => {
	const ctx = context();
	const alone = verified(candidate({ line: 6 }, null, ctx));
	const earlier = verified(candidate({ line: 2, category: 'performance' }, null, ctx));
	const [solo] = consolidateFindings([alone], INVENTORY);
	const together = consolidateFindings([earlier, alone], INVENTORY);

	expect(together.map((finding) => finding.fingerprint)).toContain(solo.fingerprint);
});

test('two lenses quoting one expression from nearby lines, under different bug categories, merge into one finding', () => {
	const ctx = context();
	const claim = { ...raw().claim, trigger: 'comparing `installed < latest` as strings' };
	const correctness = verified(candidate({ line: 2, endLine: 3, claim }, null, ctx), 'run');
	const contract = verified(candidate({ line: 6, category: 'api-contract', claim }, null, ctx));
	const findings = consolidateFindings([correctness, contract], INVENTORY);

	expect([correctness.line, correctness.endLine, contract.line]).toEqual([4, 5, 4]);
	expect(findings).toHaveLength(1);
	expect(findings[0].category).toBe('correctness');
});

test('two lenses reporting one bug under the same title from different lines of a file merge', () => {
	const ctx = context();
	const title = 'Locks do not span middleware instances';
	const correctness = verified(candidate({ line: 2, title }, null, ctx), 'run');
	const concurrency = verified(candidate({ line: 6, category: 'concurrency', title: `${title}.` }, null, ctx));
	const other = verified(candidate({ line: 6, category: 'concurrency', title: 'Expired entries stay' }, null, ctx));
	const findings = consolidateFindings([correctness, concurrency, other], INVENTORY);

	expect(findings.map((finding) => finding.title).sort()).toEqual(['Expired entries stay', title]);
	expect(findings.find((finding) => finding.title === title)?.relatedLocations).toHaveLength(1);
});

test('consolidation lists bugs first and caps quality findings at medium', () => {
	const ctx = context();
	const quality = verified(candidate({ category: 'readability', smell: 'unclear-name', line: 2 }, null, ctx), 'rule');
	const bug = verified(candidate({ severity: 'medium', line: 44 }, null, ctx));
	const findings = consolidateFindings([quality, bug], INVENTORY);

	expect(findings.map((finding) => finding.category)).toEqual(['correctness', 'readability']);
	expect(findings[1].severity).toBe('warning');
});
