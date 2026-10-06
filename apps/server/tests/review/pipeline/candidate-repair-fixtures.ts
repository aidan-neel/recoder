import { EvidenceStore } from '../../../src/evidence/evidence';
import {
	validateCandidate,
	type CandidateContext,
	type CandidateFinding
} from '../../../src/review/pipeline/consolidate';
import type { ReviewerFinding } from '../../../src/review/pipeline/finding-schema';
import type { ChangeIntent } from '../../../src/review/pipeline/intent/types';
import { buildInventory } from '../../../src/review/pipeline/inventory';
import type { LensId } from '../../../src/review/pipeline/lenses/types';

/**
 * One changed file: new-side lines 11, 12, 14 and 44 are added code, 13 is an
 * added comment, 10, 15, 16, 43 and 45 are context. Line 30 is outside the change.
 */
export const REPAIR_DIFF = `diff --git a/src/q.ts b/src/q.ts
--- a/src/q.ts
+++ b/src/q.ts
@@ -10,4 +10,7 @@ export function drain() {
 const queue = load();
-queue.pop();
+const next = queue.shift();
+if (!next) return;
+// persist before saving
+persistNext(next);
 save(queue);
 return queue;
@@ -40,2 +43,3 @@
 function other() {
+	cleanupOld();
 }
`;

/** An intent holding goal G1 and prior decision D1, which is not citable. */
const INTENT = {
	summary: 'Drain the queue in order.',
	goals: [{ id: 'G1', text: 'Items leave the queue in the order they arrived.', source: 'pr' }],
	acceptanceCriteria: [],
	statedConstraints: [],
	nonGoals: [],
	priorDecisions: [{ id: 'D1', text: 'The queue is persisted after each item.', source: 'pr' }],
	observedChanges: [],
	openQuestions: []
} as unknown as ChangeIntent;

/** Validation context over `REPAIR_DIFF`, with or without the intent. */
export function repairContext(intent: ChangeIntent | null = INTENT): CandidateContext {
	const inventory = buildInventory(REPAIR_DIFF, []);

	return {
		inventory,
		evidence: new EvidenceStore(null, inventory, 1000),
		changeModel: null,
		ledger: null,
		intent
	};
}

/** A reviewer's correctness finding on `src/q.ts` line 30, whose execution path cites line 14. */
export function reported(over: Partial<ReviewerFinding> = {}): ReviewerFinding {
	return {
		title: 'Item persisted before the queue is saved',
		file: 'src/q.ts',
		line: 30,
		severity: 'high',
		category: 'correctness',
		claim: {
			trigger: 'A drain that fails after persisting',
			executionPath: [{ file: 'src/q.ts', line: 14, note: 'persists the shifted item' }],
			consequence: 'The item is persisted but stays in the saved queue',
			violatedContract: 'Each item is handled once'
		},
		examples: [],
		fix: [],
		body: 'The item is persisted before the queue is saved.',
		evidenceIds: [],
		...over
	};
}

/** The finding as validation leaves it, held to `lens`. */
export function candidateOf(
	raw: ReviewerFinding,
	lens: LensId | null = 'correctness',
	ctx = repairContext()
): CandidateFinding {
	const meta = { candidateId: 'c1', assignmentId: `unit-1/${lens}`, role: 'reviewer', model: 'test', lens };

	return validateCandidate(raw, meta, ctx);
}
