import { expect, test } from 'bun:test';
import { EvidenceStore } from '../../../src/evidence/evidence';
import { buildInventory, type ReviewInventory } from '../../../src/review/pipeline/inventory';
import { validateCandidate, type CandidateContext } from '../../../src/review/pipeline/consolidate';
import { parseReviewerOutput } from '../../../src/review/pipeline/reviewer';
import { addedLines } from '../../../src/review/pipeline/detectors/changed-lines';
import { CoverageLedger } from '../../../src/review/pipeline/coverage';
import { applyDiffLimits } from '../../../src/review/pipeline/harness/diff-limits';
import { applyRepair, isRepairable } from '../../../src/review/pipeline/candidate-repair';

const diff = `diff --git a/a.ts b/a.ts
--- a/a.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-const value = 1;
-const next = value + 1;
-consume(next);
diff --git a/b.ts b/b.ts
--- /dev/null
+++ b/b.ts
@@ -0,0 +1,3 @@
+const value = 1;
+const next = value + 1;
+consume(next);`;

const META = { candidateId: 'c1', assignmentId: 'r1', role: 'reviewer', model: 'fake', lenses: null };

function context(inventory: ReviewInventory = buildInventory(diff)): CandidateContext {
	return { inventory, evidence: new EvidenceStore(null, inventory, 1000), changeModel: null, ledger: null };
}

function reportedMove(over: Record<string, unknown> = {}) {
	return parseReviewerOutput({
		findings: [
			{
				file: 'b.ts',
				line: 1,
				tier: 'bug',
				category: 'correctness',
				body: 'The new scope binds consume differently.',
				claim: {
					trigger: 'call moved code',
					executionPath: [],
					consequence: 'wrong consumer',
					violatedContract: 'preserve binding'
				},
				...over
			}
		],
		examinedHunks: []
	})!.findings[0];
}

test('moved lines are inventory context, not new code for line-local detectors', () => {
	const inventory = buildInventory(diff);

	expect(addedLines(inventory).size).toBe(0);
	expect(inventory.moves).toMatchObject([{ fromPath: 'a.ts', toPath: 'b.ts', exact: true }]);
});

test('new lines alongside a moved block still reach deterministic detectors', () => {
	const inventory = buildInventory(diff.replace('@@ -0,0 +1,3 @@', '@@ -0,0 +1,4 @@') + '\n+newCode();');

	expect([...addedLines(inventory).get('b.ts')!.keys()]).toEqual([4]);
});

test('an inherited defect is skipped unless the reviewer identifies a behavior change caused by the move', () => {
	const ctx = context();
	const raw = reportedMove();
	const inherited = validateCandidate(raw, META, ctx);

	expect(inherited).toMatchObject({ valid: false, dropStage: 'covered' });
	expect(isRepairable(inherited)).toBe(false);
	expect(validateCandidate({ ...raw, tier: 'bug', severity: 'low' }, META, ctx).valid).toBe(false);
	expect(validateCandidate({ ...raw, tier: 'fyi' }, META, ctx).valid).toBe(true);

	expect(
		validateCandidate({ ...raw, moveReason: 'The destination has a different lexical consume binding.' }, META, ctx)
	).toMatchObject({ valid: true, move: { relation: { exact: true } } });
});

test('a move explanation cannot admit findings on lines omitted by diff limits', () => {
	const lines = Array.from({ length: 10 }, (_, index) => `line${index}();`);

	const inventory = buildInventory(
		[
			'diff --git a/z.ts b/z.ts',
			'--- a/z.ts',
			'+++ /dev/null',
			'@@ -1,10 +0,0 @@',
			...lines.map((line) => `-${line}`),
			'diff --git a/a.ts b/a.ts',
			'--- /dev/null',
			'+++ b/a.ts',
			'@@ -0,0 +1,10 @@',
			...lines.map((line) => `+${line}`)
		].join('\n')
	);

	const ctx = context(inventory);

	const raw = reportedMove({
		file: 'a.ts',
		line: 10,
		moveReason: 'A new lexical scope supplies a different implementation.'
	});

	expect(validateCandidate(raw, META, ctx).valid).toBe(true);
	applyDiffLimits(inventory, new CoverageLedger(), { maxFiles: 10, maxDiffChars: 15 });
	expect(validateCandidate(raw, META, ctx)).toMatchObject({ valid: false, dropStage: 'location' });
});

test('repairing a category preserves the explanation that makes a moved-code defect new', () => {
	const ctx = context();

	const raw = reportedMove({
		category: 'intent-mismatch',
		moveReason: 'The destination supplies a different lexical binding.'
	});

	const candidate = validateCandidate(raw, META, ctx);

	expect(candidate).toMatchObject({ valid: false, dropStage: 'category' });

	const repair = applyRepair(
		candidate,
		[{ kind: 'category', category: 'correctness', basis: 'This is a binding regression, not a PR intent claim.' }],
		'deterministic',
		ctx
	);

	expect(repair.result).toBe('revalidated');
	expect(candidate).toMatchObject({ valid: true, move: { reason: raw.moveReason } });
});
