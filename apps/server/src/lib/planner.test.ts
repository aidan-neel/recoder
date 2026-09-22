import { describe, expect, test } from 'bun:test';
import { buildInventory } from './inventory';
import { fallbackPlan, sanitizePlannerOutput, plannerSystemPrompt, plannerValidationError } from './planner';
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

	test('prompt supplies typed requirements and repair identifies invalid fields', () => {
		expect(plannerSystemPrompt()).toContain('"type":"integer"');
		expect(plannerSystemPrompt()).toContain('contextEvidenceIds');
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
