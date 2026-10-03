import { expect, test } from 'bun:test';
import { dispatchPolicy } from '../../../src/review/pipeline/dispatch';
import { runAdaptiveReview } from '../../../src/review/pipeline/harness';
import type { ReviewRole } from '../../../src/review/pipeline/roles';
import { ReviewControl, runWithReviewControl } from '../../../src/review/session/review-control';
import {
	DIFF,
	KEEP_NONE,
	NOTHING,
	PLAN,
	assignment,
	decisions,
	modelReply,
	restoreAfterEach,
	systemOf,
	useTestModel
} from './harness-fixtures';

restoreAfterEach();

const NINE_ROLES: ReviewRole[] = [
	'correctness',
	'patterns',
	'security',
	'perf',
	'errors',
	'api',
	'testing',
	'concurrency',
	'data'
];

/** Runs a nine-specialist plan, past the high dispatch approval threshold, under `control`. */
async function runNineSpecialists(control: ReviewControl, onPending?: () => void) {
	useTestModel();

	const plan = {
		...PLAN,
		assignments: NINE_ROLES.map((role, index) => assignment(`${role}-core`, role, index + 1)),
		roleDecisions: decisions(NINE_ROLES)
	};

	const ran = new Set<string>();
	const approvals: string[] = [];

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const system = systemOf(init);
		const role = /Role: .*\((\w+)\)/.exec(system)?.[1];

		if (role) ran.add(role);

		const reply = system.includes('review orchestrator') ? plan : role ? NOTHING : KEEP_NONE;

		return modelReply({ message: 'ok', ...reply });
	}) as unknown as typeof fetch;

	const result = await runWithReviewControl(control, () =>
		runAdaptiveReview(
			{ diff: DIFF, sandboxPath: null, dispatch: dispatchPolicy('high') },
			{
				onApproval: (approval) => {
					approvals.push(approval.status);
					if (approval.status === 'pending') onPending?.();
				}
			}
		)
	);

	return { ran: [...ran].sort(), approvals, skipped: result.assignments.filter((r) => r.status === 'skipped') };
}

test('a plan past the approval threshold waits for the developer, then runs every specialist', async () => {
	const control = new ReviewControl();

	/** The developer answers a moment later; the review must be holding until then. */
	const approveLater = () => setTimeout(() => expect(control.approve()).toBe(true), 20);

	const { ran, approvals, skipped } = await runNineSpecialists(control, approveLater);

	expect(approvals).toEqual(['pending', 'approved']);
	expect(ran).toEqual([...NINE_ROLES].sort());
	expect(skipped).toEqual([]);
});

test('an unattended review runs a plan past the approval threshold without waiting', async () => {
	const { ran, approvals, skipped } = await runNineSpecialists(new ReviewControl(true));

	expect(approvals).toEqual([]);
	expect(ran).toEqual([...NINE_ROLES].sort());
	expect(skipped).toEqual([]);
});

test('a review told to look only at Python files keeps every specialist, sweep and prompt to those files', async () => {
	useTestModel();

	const diff = `${DIFF}diff --git a/src/b.py b/src/b.py
--- a/src/b.py
+++ b/src/b.py
@@ -1 +1 @@
-old
+new
`;

	const pyHunk = 'src/b.py:1,1:1,1';
	const systems: string[] = [];

	const plan = {
		...PLAN,
		assignments: [
			{
				...assignment('correctness-all', 'correctness', 1),
				scope: [
					{ path: 'src/a.ts', hunkIds: [] },
					{ path: 'src/b.py', hunkIds: [] }
				]
			}
		]
	};

	globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
		const system = systemOf(init);

		systems.push(system);

		const reply = system.includes('file filter')
			? { includeGlobs: ['**/*.py'], excludeGlobs: [], roles: [] }
			: system.includes('review orchestrator')
				? plan
				: system.includes('Role:')
					? { ...NOTHING, examinedHunks: [pyHunk] }
					: KEEP_NONE;

		return modelReply({ message: 'ok', ...reply });
	}) as unknown as typeof fetch;

	const result = await runAdaptiveReview({ diff, sandboxPath: null, instructions: 'review only python files' });

	expect(result.outcome).toBe('complete');
	expect(result.assignments.length).toBeGreaterThan(0);

	expect(result.assignments.flatMap((record) => record.scope.map((entry) => entry.path))).toEqual(
		result.assignments.map(() => 'src/b.py')
	);

	expect(result.coverageGaps.find((gap) => gap.path === 'src/a.ts')?.reason).toContain('outside your instructions');

	/** The words reach the planner and every specialist, not just the file filter. */
	const reached = (marker: string) =>
		systems.filter((system) => system.includes(marker)).every((system) => system.includes('review only python files'));

	expect(reached('review orchestrator')).toBe(true);
	expect(reached('Role:')).toBe(true);
	expect(systems.filter((system) => system.includes('Role:')).length).toBeGreaterThan(0);
});
