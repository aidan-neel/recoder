import { expect, test } from 'bun:test';
import { buildInventory } from './inventory';
import { EvidenceStore } from './evidence';
import { applyConsolidation, deterministicConsolidate, validateCandidate } from './consolidate';

const DIFF = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-old
+new
`;

test('validateCandidate drops paths outside the change and invented new-side lines', () => {
	const inventory = buildInventory(DIFF);
	const evidence = new EvidenceStore(null, inventory, 1000);
	const meta = {
		candidateId: 'c1',
		assignmentId: 'correctness-core',
		role: 'correctness' as const,
		model: 'test',
		fingerprint: () => 'fp'
	};
	const ok = validateCandidate(
		{ file: 'a.ts', line: 1, severity: 'high', category: 'bug', body: 'bad', evidenceIds: [] },
		meta,
		inventory,
		evidence
	);
	expect(ok.valid).toBe(true);
	const missing = validateCandidate(
		{ file: 'missing.ts', line: 1, severity: 'high', category: 'bug', body: 'bad', evidenceIds: [] },
		{ ...meta, candidateId: 'c2' },
		inventory,
		evidence
	);
	expect(missing.valid).toBe(false);
	const invented = validateCandidate(
		{ file: 'a.ts', line: 99, severity: 'high', category: 'bug', body: 'bad', evidenceIds: [] },
		{ ...meta, candidateId: 'c3' },
		inventory,
		evidence
	);
	expect(invented.valid).toBe(false);
});

test('consolidation cannot invent findings that were not candidates', () => {
	const inventory = buildInventory(DIFF);
	const evidence = new EvidenceStore(null, inventory, 1000);
	const candidate = validateCandidate(
		{ file: 'a.ts', line: 1, severity: 'low', category: 'bug', body: 'real', evidenceIds: [] },
		{
			candidateId: 'c1',
			assignmentId: 'correctness-core',
			role: 'correctness',
			model: 'test',
			fingerprint: () => 'fp'
		},
		inventory,
		evidence
	);
	const applied = applyConsolidation(
		{ keep: ['c1', 'invented'], merge: [], reject: [], recommendedChecks: [] },
		[candidate]
	);
	expect(applied.confirmed).toHaveLength(1);
	expect(applied.confirmed[0].file).toBe('a.ts');
});

test('failed consolidation keeps validated candidates as unconfirmed rather than claiming zero findings', () => {
	const inventory = buildInventory(DIFF);
	const evidence = new EvidenceStore(null, inventory, 1000);
	const candidate = validateCandidate(
		{ file: 'a.ts', line: 1, severity: 'medium', category: 'bug', body: 'real', evidenceIds: [] },
		{
			candidateId: 'c1',
			assignmentId: 'correctness-core',
			role: 'correctness',
			model: 'test',
			fingerprint: () => 'fp'
		},
		inventory,
		evidence
	);
	const { confirmed, rejected } = deterministicConsolidate([candidate]);
	expect(confirmed).toHaveLength(1);
	expect(rejected).toEqual([]);
});
