<script lang="ts">
	// Temporary preview route for the redesigned reviewing page. Safe to delete.
	import ReviewingView, { type ReviewingFinding } from '$lib/components/reviewing-view.svelte';
	import type {
		CoverageSummary,
		ReviewAssignment,
		ReviewReasoningEntry,
		ReviewTask,
		ReviewToolCall,
		RoleDecision
	} from '@recoder/shared';

	const now = Date.now();
	const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

	const MODEL = 'qwen2.5-coder-32b-instruct';

	interface Spec {
		id: string;
		role: string;
		title: string;
		status: ReviewAssignment['status'];
		reason: string;
		operation: string;
		total: number;
		done: number;
		failed?: number;
		startedAgoMs: number;
	}

	const specs: Spec[] = [
		{ id: 'correctness-focus', role: 'correctness', title: 'Correctness', status: 'running', reason: 'Focus handling changed in the select primitive', operation: 'Reading the focus-restore path in select.svelte', total: 3, done: 1, startedAgoMs: 240_000 },
		{ id: 'perf-format', role: 'perf', title: 'Performance', status: 'running', reason: 'Sorting helper touched on the CLI list path', operation: 'Checking formatRow for repeated full-table sorts', total: 3, done: 2, startedAgoMs: 180_000 },
		{ id: 'patterns-cli', role: 'patterns', title: 'Repository consistency', status: 'running', reason: 'New command added beside existing scaffolding', operation: 'Comparing command scaffolding across cli commands', total: 5, done: 2, startedAgoMs: 120_000 },
		{ id: 'security-cli', role: 'security', title: 'Security', status: 'done', reason: 'New CLI output path', operation: 'Finished · 0 candidates', total: 3, done: 3, startedAgoMs: 260_000 },
		{ id: 'dedup-cli', role: 'dedup', title: 'Dedup', status: 'done', reason: 'Duplicated helpers across commands', operation: 'Finished · 0 candidates', total: 2, done: 2, startedAgoMs: 250_000 },
		{ id: 'errors-cli', role: 'errors', title: 'Errors', status: 'done', reason: 'Error propagation in the new command', operation: 'Finished · 1 candidate', total: 2, done: 2, startedAgoMs: 230_000 },
		{ id: 'docs-cli', role: 'docs', title: 'Docs', status: 'done', reason: 'Help text updated', operation: 'Finished · 0 candidates', total: 1, done: 1, startedAgoMs: 220_000 },
		{ id: 'api-status', role: 'api', title: 'API surface', status: 'error', reason: 'Public command surface changed', operation: 'Model returned invalid JSON on batch 2 · will retry', total: 3, done: 1, failed: 1, startedAgoMs: 210_000 }
	];

	function buildTasks(): ReviewTask[] {
		const out: ReviewTask[] = [];
		let seq = 0;
		for (const spec of specs) {
			const failed = spec.failed ?? 0;
			for (let i = 0; i < spec.total; i += 1) {
				seq += 1;
				let status: ReviewTask['status'] = 'queued';
				let message = 'Queued for specialist review';
				if (i < spec.done) {
					status = 'done';
					message = 'Complete';
				} else if (i < spec.done + failed) {
					status = 'error';
					message = 'Model returned invalid JSON on batch 2';
				} else if (spec.status === 'running' && i === spec.done + failed) {
					status = 'running';
					message = spec.operation;
				}
				out.push({
					id: `${spec.id}-task-${seq}`,
					label: spec.title,
					status,
					message,
					assignmentId: spec.id,
					agent: spec.role,
					model: MODEL,
					...(status === 'running' ? { batch: 2, batches: 3, elapsedMs: 31_000 } : {}),
					...(status === 'done' ? { elapsedMs: 18_000 } : {}),
					updatedAt: iso(0),
					startedAt: iso(spec.startedAgoMs)
				});
			}
		}
		return out;
	}

	const assignments: ReviewAssignment[] = specs.map((spec) => ({
		id: spec.id,
		role: spec.role,
		title: spec.title,
		reason: spec.reason,
		status: spec.status,
		scope: [
			{ path: 'packages/cli/src/list.ts', hunkIds: ['h1', 'h2'] },
			{ path: 'packages/cli/src/format.ts', hunkIds: ['h3'] }
		],
		model: MODEL,
		currentOperation: spec.operation,
		startedAt: iso(spec.startedAgoMs),
		elapsedMs: spec.status === 'done' ? 42_000 : Date.now() - (now - spec.startedAgoMs),
		...(spec.status === 'done' ? { completedAt: iso(20_000) } : {})
	}));

	const tasks = buildTasks();

	const reasoning: ReviewReasoningEntry[] = [
		{
			id: 'r1',
			assignmentId: 'correctness-focus',
			role: 'correctness',
			model: MODEL,
			at: iso(200_000),
			text: 'The close handler reads document.activeElement after teardown has already run, so the element it restores focus to is whatever survived the unmount — usually the body.'
		},
		{
			id: 'r2',
			assignmentId: 'correctness-focus',
			role: 'correctness',
			model: MODEL,
			at: iso(120_000),
			text: 'Checking whether the trigger reference is still live at that point. If it is, capturing it before teardown is the smaller fix.'
		},
		{
			id: 'r3',
			assignmentId: 'correctness-focus',
			role: 'correctness',
			model: MODEL,
			at: iso(41_000),
			text: 'Two call sites in status.ts rely on the sorted order that formatRow leaves behind, so the mutation is load-bearing today.'
		},
		{
			id: 'r4',
			assignmentId: 'perf-format',
			role: 'perf',
			model: MODEL,
			at: iso(90_000),
			text: 'formatRow sorts the full table on every call; the list command calls it once per row, so this is O(n² log n) on large repositories.'
		}
	];

	const toolCalls: ReviewToolCall[] = [
		{ id: 'tc1', assignmentId: 'correctness-focus', role: 'correctness', command: 'gh pr view 160 --json title,files,additions', status: 'done', exitCode: 0, startedAt: iso(200_000), elapsedMs: 220, summary: 'ok' },
		{ id: 'tc2', assignmentId: 'correctness-focus', role: 'correctness', command: 'git diff --merge-base main -- packages/cli', status: 'done', exitCode: 0, startedAt: iso(190_000), elapsedMs: 84, summary: '5 files' },
		{ id: 'tc3', assignmentId: 'correctness-focus', role: 'correctness', command: 'rg -n "formatRow" packages/cli/src', status: 'done', exitCode: 0, startedAt: iso(160_000), elapsedMs: 31, summary: '3 matches' },
		{ id: 'tc4', assignmentId: 'correctness-focus', role: 'correctness', command: 'bun test packages/cli/test/list.test.ts', status: 'error', exitCode: 1, startedAt: iso(120_000), elapsedMs: 4200, summary: '1 failing test' },
		{ id: 'tc5', assignmentId: 'correctness-focus', role: 'correctness', command: 'git show HEAD:src/lib/sivir/components/select/select.svelte', status: 'running', exitCode: null, startedAt: iso(1100), elapsedMs: 1100 },
		{ id: 'tc6', assignmentId: 'correctness-focus', role: 'correctness', command: 'read packages/cli/src/format.ts:40-96', status: 'done', exitCode: 0, startedAt: iso(80_000), elapsedMs: 12, summary: 'format.ts:40-96' },
		{ id: 'tc7', assignmentId: 'correctness-focus', role: 'correctness', command: 'rg -n "activeElement" src/lib/sivir/components', status: 'done', exitCode: 0, startedAt: iso(60_000), elapsedMs: 24, summary: '2 matches' },
		{ id: 'tc8', assignmentId: 'perf-format', role: 'perf', command: 'read packages/cli/src/format.ts:1-64', status: 'done', exitCode: 0, startedAt: iso(150_000), elapsedMs: 14, summary: 'format.ts:1-64' }
	];

	const findings: ReviewingFinding[] = [
		{ id: 'F-01', agent: 'correctness', severity: 'medium', title: 'Focus restored after teardown', location: 'select.svelte:214' },
		{ id: 'F-02', agent: 'correctness', severity: 'low', title: 'formatRow mutates the shared array', location: 'format.ts:58' },
		{ id: 'F-03', agent: 'correctness', severity: 'info', title: 'activeElement read before teardown', location: 'select.svelte:212' },
		{ id: 'F-04', agent: 'perf', severity: 'medium', title: 'Repeated full-table sort in list command', location: 'list.ts:88' },
		{ id: 'F-05', agent: 'errors', severity: 'low', title: 'Swallowed exit code on parse failure', location: 'list.ts:141' },
		{ id: 'F-06', agent: 'patterns', severity: 'info', title: 'Command scaffolding differs from siblings', location: 'list.ts:1' }
	];

	const coverage: CoverageSummary = { reviewed: 14, pending: 7, partial: 1, excluded: 0, total: 22 };

	const roleDecisions: RoleDecision[] = [
		{ role: 'correctness', decision: 'selected', reason: 'Focus behavior changed' },
		{ role: 'perf', decision: 'selected', reason: 'Sorting helper on the hot path' },
		{ role: 'patterns', decision: 'selected', reason: 'New command scaffolding' },
		{ role: 'testing', decision: 'deferred', reason: 'No test changes in scope' },
		{ role: 'concurrency', decision: 'deferred', reason: 'No async paths touched' }
	];

	const pipelineLogs: string[] = Array.from({ length: 48 }, (_, i) => {
		const labels = ['fetch', 'sandbox', 'review', 'assignment:correctness-focus', 'assignment:perf-format', 'assignment:patterns-cli'];
		return `${String(i + 1).padStart(2, '0')} · ${labels[i % labels.length]} · update ${i + 1}`;
	});

	const noop = () => {};
</script>

<svelte:head><title>Reviewing example — Recoder</title></svelte:head>

<ReviewingView
	fullscreen
	title="refactor(cli): extract sivir list formatting, add sivir status"
	meta={{ prLabel: '#160', repo: 'aidan-neel/sivir-ui', files: 5, additions: 205, deletions: 22, elapsed: '1:24' }}
	{assignments}
	{roleDecisions}
	{findings}
	{tasks}
	{reasoning}
	{toolCalls}
	stage={2}
	stageLabel="Reviewing changes"
	active
	connectionLabel="Live updates connected"
	{coverage}
	recommendedChecks={['Run the CLI integration suite on the merge commit', 'Verify focus restoration in a real browser']}
	{pipelineLogs}
	onOpenDiff={noop}
	onRestart={noop}
/>
