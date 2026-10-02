import { describe, expect, test } from 'bun:test';
import { buildInventory } from './inventory';
import { fallbackPlan, sanitizePlannerOutput, plannerValidationError } from './planner';
import { REVIEW_ROLES } from './roles';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+new
`;

function decisions(selected: string[]) {
	return REVIEW_ROLES.map((role) => ({
		role,
		decision: selected.includes(role) ? 'selected' : 'not_needed',
		reason: selected.includes(role) ? 'needed' : 'not this PR'
	}));
}

describe('planner validation', () => {
	const inventory = buildInventory(DIFF);

	test('repair identifies invalid fields', () => {
		expect(plannerValidationError({ summary: 'Review', assignments: 'incorrect', roleDecisions: [] }))
			.toContain('assignments:');
	});

	test('rejects assignment ids that equal the role id and fills mandatory roles', () => {
		const raw = {
			summary: 'looks executable',
			assignments: [
				{
					id: 'correctness',
					role: 'correctness',
					title: 'bad id',
					reason: 'overlap',
					scope: [{ path: 'src/a.ts', hunkIds: inventory.files[0].hunks.map((hunk) => hunk.id) }],
					questions: ['q'],
					contextEvidenceIds: [],
					priority: 1
				}
			],
			roleDecisions: decisions(['correctness'])
		};
		const sanitized = sanitizePlannerOutput(raw, inventory);
		expect(sanitized).not.toBeNull();
		expect(sanitized!.assignments.some((assignment) => assignment.id === 'correctness')).toBe(false);
		expect(sanitized!.assignments.some((assignment) => assignment.role === 'correctness')).toBe(true);
		expect(sanitized!.assignments.some((assignment) => assignment.role === 'patterns')).toBe(true);
	});

	test('drops unknown paths and keeps known hunks', () => {
		const hunkId = inventory.files[0].hunks[0].id;
		const sanitized = sanitizePlannerOutput(
			{
				summary: 'ok',
				assignments: [
					{
						id: 'correctness-core',
						role: 'correctness',
						title: 'core',
						reason: 'behavior',
						scope: [
							{ path: 'missing.ts', hunkIds: ['x'] },
							{ path: 'src/a.ts', hunkIds: [hunkId] }
						],
						questions: ['q'],
						contextEvidenceIds: [],
						priority: 1
					},
					{
						id: 'patterns-core',
						role: 'patterns',
						title: 'patterns',
						reason: 'conventions',
						scope: [{ path: 'src/a.ts', hunkIds: [hunkId] }],
						questions: ['q'],
						contextEvidenceIds: [],
						priority: 2
					}
				],
				roleDecisions: decisions(['correctness', 'patterns'])
			},
			inventory
		);
		expect(sanitized!.assignments[0].scope.map((entry) => entry.path)).toEqual(['src/a.ts']);
	});

	test('docs-only fallback does not invent a token correctness assignment', () => {
		const docs = buildInventory(`diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+new
`);
		const plan = fallbackPlan(docs);
		expect(docs.docsOnly).toBe(true);
		expect(plan.assignments.every((assignment) => assignment.role === 'docs')).toBe(true);
	});
});

describe('planner coverage', () => {
	const bigDiff = Array.from({ length: 30 }, (_, index) => `diff --git a/src/f${index}.ts b/src/f${index}.ts
--- a/src/f${index}.ts
+++ b/src/f${index}.ts
@@ -1 +1 @@
-old
+${'x'.repeat(3000)}
`).join('');
	const inventory = buildInventory(bigDiff);
	const assignment = (id: string, role: string, paths: string[]) => ({
		id, role, title: id, reason: 'r', questions: [`q-${id}`], contextEvidenceIds: [], priority: 1,
		scope: paths.map((path) => ({ path, hunkIds: [] }))
	});

	test('every code hunk the plan left out is swept by a correctness assignment', () => {
		const plan = sanitizePlannerOutput({
			summary: 's',
			assignments: [assignment('correctness-top', 'correctness', ['src/f0.ts']), assignment('patterns-top', 'patterns', ['src/f0.ts'])],
			roleDecisions: decisions(['correctness', 'patterns'])
		}, inventory)!;
		const read = new Set(plan.assignments.filter((a) => a.role === 'correctness').flatMap((a) => a.scope.flatMap((entry) => entry.hunkIds)));
		for (const hunkId of inventory.hunksById.keys()) expect(read.has(hunkId)).toBe(true);
		expect(plan.assignments.filter((a) => a.id.startsWith('sweep-')).length).toBeGreaterThan(1);
	});

	test('every hunk of a huge PR is covered by wide sweeps', () => {
		const huge = buildInventory(Array.from({ length: 300 }, (_, index) => `diff --git a/src/g${index}.ts b/src/g${index}.ts
--- a/src/g${index}.ts
+++ b/src/g${index}.ts
@@ -1 +1 @@
-old
+${'y'.repeat(3000)}
`).join(''));
		const plan = sanitizePlannerOutput({
			summary: 's',
			assignments: [assignment('correctness-top', 'correctness', ['src/g0.ts']), assignment('patterns-top', 'patterns', ['src/g0.ts'])],
			roleDecisions: decisions(['correctness', 'patterns'])
		}, huge)!;
		const read = new Set(plan.assignments.filter((a) => a.role === 'correctness').flatMap((a) => a.scope.flatMap((entry) => entry.hunkIds)));
		expect(read.size).toBe(huge.hunksById.size);
		// ~900k patch characters in 48k-character sweeps, not 24k-character ones.
		expect(plan.assignments.filter((a) => a.id.startsWith('sweep-')).length).toBeLessThanOrEqual(20);
	});

	test('a same-role assignment over hunks already assigned is folded into the first', () => {
		const plan = sanitizePlannerOutput({
			summary: 's',
			assignments: [
				assignment('security-a', 'security', ['src/f1.ts', 'src/f2.ts']),
				assignment('security-b', 'security', ['src/f2.ts']),
				assignment('security-c', 'security', ['src/f2.ts', 'src/f3.ts'])
			],
			roleDecisions: decisions(['security'])
		}, inventory)!;
		const security = plan.assignments.filter((a) => a.role === 'security');
		expect(security.map((a) => a.id)).toEqual(['security-a', 'security-c']);
		expect(security[0].questions).toContain('q-security-b');
		expect(security[1].scope.map((entry) => entry.path)).toEqual(['src/f3.ts']);
	});
});
