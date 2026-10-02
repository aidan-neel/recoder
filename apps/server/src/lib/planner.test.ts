import { describe, expect, test } from 'bun:test';
import { buildInventory } from './inventory';
import { fallbackPlan, normalizePlannerRaw, sanitizePlannerOutput, plannerValidationError } from './planner';
import { dispatchPolicy } from './dispatch';
import type { ReviewDirective } from './directive';
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
		expect(plannerValidationError({ summary: 'Review', assignments: 'incorrect', roleDecisions: [] })).toContain(
			'assignments:'
		);
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

	test("a small model's loosely shaped plan is repaired instead of replaced by the fallback", () => {
		const hunkId = inventory.files[0].hunks[0].id;

		const raw = {
			message: 'One lens on the change.',
			assignments: [
				{
					id: 'correctness',
					role: 'Correctness',
					title: '',
					reason: '',
					files: ['src/a.ts', 'missing.ts'],
					questions: 'Does it still work?',
					priority: '2'
				},
				{ role: 'Security', scope: [{ file: 'src/a.ts', hunkIds: hunkId }] },
				{ role: 'nonsense', scope: ['src/a.ts'] }
			],
			roleDecisions: { correctness: 'yes', security: { decision: 'Selected', reason: 'auth' }, perf: 'skip' },
			checks: 'bun test'
		};

		const normalized = normalizePlannerRaw(raw) as {
			assignments: Array<Record<string, unknown>>;
			summary: string;
			roleDecisions: unknown[];
			checks: string[];
		};

		expect(normalized.summary).toBe('One lens on the change.');

		expect(normalized.assignments.map((a) => [a.id, a.role, a.priority])).toEqual([
			['correctness-main', 'correctness', 2],
			['security-2', 'security', 2]
		]);

		expect(normalized.assignments[0].scope).toEqual([
			{ path: 'src/a.ts', hunkIds: [] },
			{ path: 'missing.ts', hunkIds: [] }
		]);

		expect(normalized.assignments[0].questions).toEqual(['Does it still work?']);
		expect(normalized.assignments[1].scope).toEqual([{ path: 'src/a.ts', hunkIds: [hunkId] }]);

		expect(normalized.roleDecisions).toEqual([
			{ role: 'correctness', decision: 'selected', reason: 'No reason given.' },
			{ role: 'security', decision: 'selected', reason: 'auth' },
			{ role: 'perf', decision: 'not_needed', reason: 'No reason given.' }
		]);

		expect(normalized.checks).toEqual(['bun test']);

		const plan = sanitizePlannerOutput(raw, inventory)!;

		expect(plan.assignments.map((a) => [a.id, a.role]).sort()).toEqual([
			['correctness-main', 'correctness'],
			['patterns-core', 'patterns'],
			['security-2', 'security']
		]);

		expect(plannerValidationError({ message: 'thinking…' })).toContain('assignments');
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
	const bigDiff = Array.from(
		{ length: 30 },
		(_, index) => `diff --git a/src/f${index}.ts b/src/f${index}.ts
--- a/src/f${index}.ts
+++ b/src/f${index}.ts
@@ -1 +1 @@
-old
+${'x'.repeat(3000)}
`
	).join('');

	const inventory = buildInventory(bigDiff);

	const assignment = (id: string, role: string, paths: string[]) => ({
		id,
		role,
		title: id,
		reason: 'r',
		questions: [`q-${id}`],
		contextEvidenceIds: [],
		priority: 1,
		scope: paths.map((path) => ({ path, hunkIds: [] }))
	});

	test('every code hunk the plan left out is swept by a correctness assignment', () => {
		const plan = sanitizePlannerOutput(
			{
				summary: 's',
				assignments: [
					assignment('correctness-top', 'correctness', ['src/f0.ts']),
					assignment('patterns-top', 'patterns', ['src/f0.ts'])
				],
				roleDecisions: decisions(['correctness', 'patterns'])
			},
			inventory
		)!;

		const read = new Set(
			plan.assignments.filter((a) => a.role === 'correctness').flatMap((a) => a.scope.flatMap((entry) => entry.hunkIds))
		);

		for (const hunkId of inventory.hunksById.keys()) expect(read.has(hunkId)).toBe(true);
		expect(plan.assignments.filter((a) => a.id.startsWith('sweep-')).length).toBeGreaterThan(1);
	});

	test('sweeps over a huge PR stop at the dispatch cap and widen to fit, leaving the rest unassigned', () => {
		const huge = buildInventory(
			Array.from(
				{ length: 300 },
				(_, index) => `diff --git a/src/g${index}.ts b/src/g${index}.ts
--- a/src/g${index}.ts
+++ b/src/g${index}.ts
@@ -1 +1 @@
-old
+${'y'.repeat(3000)}
`
			).join('')
		);

		const raw = {
			summary: 's',
			assignments: [
				assignment('correctness-top', 'correctness', ['src/g0.ts']),
				assignment('patterns-top', 'patterns', ['src/g0.ts'])
			],
			roleDecisions: decisions(['correctness', 'patterns'])
		};

		const high = sanitizePlannerOutput(raw, huge, { dispatch: dispatchPolicy('high') })!;
		const sweeps = high.assignments.filter((a) => a.id.startsWith('sweep-'));

		expect(sweeps.length).toBe(dispatchPolicy('high').maxSweepAssignments);
		// Each sweep took the wide group (up to 32 files) rather than the usual 16.
		expect(sweeps[0].scope.length).toBeGreaterThan(16);

		const read = new Set(
			high.assignments.filter((a) => a.role === 'correctness').flatMap((a) => a.scope.flatMap((entry) => entry.hunkIds))
		);

		expect(read.size).toBeLessThan(huge.hunksById.size);

		const low = sanitizePlannerOutput(raw, huge, { dispatch: dispatchPolicy('low') })!;

		expect(low.assignments.length).toBeLessThanOrEqual(dispatchPolicy('low').maxSpecialists);
		expect(low.assignments.filter((a) => a.id.startsWith('sweep-')).length).toBe(1);
	});

	test("the first pass never exceeds the dispatch level's specialist count, mandatory roles included", () => {
		const roles = [
			'security',
			'perf',
			'errors',
			'api',
			'testing',
			'concurrency',
			'data',
			'docs',
			'impact',
			'frontend',
			'dedup'
		] as const;

		const raw = {
			summary: 's',
			assignments: roles.map((role, index) => ({
				...assignment(`${role}-x`, role, [`src/f${index}.ts`]),
				priority: index + 1
			})),
			roleDecisions: decisions([...roles])
		};

		for (const level of ['low', 'medium', 'high'] as const) {
			const plan = sanitizePlannerOutput(raw, inventory, { dispatch: dispatchPolicy(level) })!;

			expect(plan.assignments.length).toBeLessThanOrEqual(dispatchPolicy(level).maxSpecialists);
			expect(plan.assignments.some((a) => a.role === 'correctness')).toBe(true);
		}
	});

	test('developer instructions limit the lenses and keep sweeps off excluded files', () => {
		const directive: ReviewDirective = {
			instructions: 'only security, and only f0',
			includeGlobs: [],
			excludeGlobs: [],
			roles: ['security']
		};

		const plan = sanitizePlannerOutput(
			{
				summary: 's',
				assignments: [
					assignment('security-top', 'security', ['src/f0.ts']),
					assignment('perf-top', 'perf', ['src/f1.ts'])
				],
				roleDecisions: decisions(['security', 'perf'])
			},
			inventory,
			{ directive }
		)!;

		expect(plan.assignments.map((a) => a.role)).toEqual(['security']);

		expect(plan.roleDecisions.find((d) => d.role === 'perf')).toMatchObject({
			decision: 'not_needed',
			reason: 'Left out by your instructions'
		});

		const scoped = buildInventory(bigDiff);

		for (const file of scoped.files) if (file.path !== 'src/f0.ts') file.excludeReason = 'outside your instructions';

		const swept = sanitizePlannerOutput(
			{
				summary: 's',
				assignments: [assignment('correctness-top', 'correctness', ['src/f0.ts', 'src/f1.ts'])],
				roleDecisions: decisions(['correctness'])
			},
			scoped
		)!;

		expect(swept.assignments.flatMap((a) => a.scope.map((entry) => entry.path))).toEqual(['src/f0.ts', 'src/f0.ts']);

		expect(
			fallbackPlan(scoped, 'x', { directive }).assignments.every(
				(a) => a.role === 'security' && a.scope.every((entry) => entry.path === 'src/f0.ts')
			)
		).toBe(true);
	});

	test('a same-role assignment over hunks already assigned is folded into the first', () => {
		const plan = sanitizePlannerOutput(
			{
				summary: 's',
				assignments: [
					assignment('security-a', 'security', ['src/f1.ts', 'src/f2.ts']),
					assignment('security-b', 'security', ['src/f2.ts']),
					assignment('security-c', 'security', ['src/f2.ts', 'src/f3.ts'])
				],
				roleDecisions: decisions(['security'])
			},
			inventory
		)!;

		const security = plan.assignments.filter((a) => a.role === 'security');

		expect(security.map((a) => a.id)).toEqual(['security-a', 'security-c']);
		expect(security[0].questions).toContain('q-security-b');
		expect(security[1].scope.map((entry) => entry.path)).toEqual(['src/f3.ts']);
	});
});
