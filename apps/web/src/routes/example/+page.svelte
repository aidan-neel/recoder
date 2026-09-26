<script lang="ts">
	import { page } from '$app/state';
	import { ORCHESTRATOR_ID, type ReviewAssignment, type ReviewChatMessage, type ReviewReasoningEntry, type ReviewTask, type ReviewToolCall } from '@recoder/shared';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import ReviewingView, { type ReviewingFinding } from '$lib/components/reviewing-view.svelte';
	import CodeDiff from '$lib/components/code-diff.svelte';
	import { findingsStore } from '$lib/findings.svelte';
	import { getFileDiff } from '$lib/diff';
	import { DEFAULT_FILE } from '$lib/session-file.svelte';

	// Interactive design fixture. Real sessions use the same view with API/SSE data.
	const now = Date.now();
	const iso = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();
	const model = 'GPT 5.6 Sol';
	// `?state=draft` previews a new session: the opening card, then the orchestrator's first pass.
	const draft = page.url.searchParams.get('state') === 'draft';
	// `?state=failed` previews an incomplete review with Continue review.
	let failed = $state(page.url.searchParams.get('state') === 'failed');
	let continuing = $state(false);
	let awaitingPrompt = $state(draft);
	const specs = [
		{ id: 'testing', title: 'Test Coverage', operation: 'Searching across `/study` for missing tests…' },
		{ id: 'complexity', title: 'Complexity', operation: 'Searching across `/study` for complexity…' },
		{ id: 'docs', title: 'Documentation', operation: 'Searching across `/study` for missing documentation…' }
	];
	const assignments: ReviewAssignment[] = specs.map((spec) => ({
		id: spec.id, role: spec.id, title: spec.title, reason: spec.operation,
		status: 'done', scope: [{ path: 'packages/cli/src/status.ts', hunkIds: ['h1'] }],
		model, currentOperation: spec.operation, startedAt: iso(80)
	}));
	const initialMessages: ReviewChatMessage[] = [
		{ id: 'request', assignmentId: ORCHESTRATOR_ID, from: 'user', text: 'No questions yet, just start your review first.', at: iso(130), status: 'done' },
		{ id: 'plan', assignmentId: ORCHESTRATOR_ID, from: 'assistant', model, text: 'Okay, beginning a review on Sivir UI. First, I’ll create 3 specialists for a broad review.', at: iso(100), status: 'done' }
	];
	const openerMessage: ReviewChatMessage = {
		id: 'opener', assignmentId: ORCHESTRATOR_ID, from: 'assistant', model, discussion: true, at: iso(20), status: 'done',
		text: 'This pull request moves `sivir list` formatting into its own module and adds a `sivir status` command.\n\nRisk areas:\n- `status.ts`: an empty queue prints nothing instead of a message.\n- `list.ts`: column widths changed, so scripts that parse the output may break.\n\nYou can comment on the diff, ask about anything, or press Run full review.'
	};
	// `?state=fixes` previews fixes a reply asked for: one being written, one ready to apply.
	const fixesPreview = page.url.searchParams.get('state') === 'fixes';
	const fixReply: ReviewChatMessage = {
		id: 'fix-reply', assignmentId: ORCHESTRATOR_ID, from: 'assistant', model, discussion: true, at: iso(5), status: 'done',
		text: 'I’ll fix the tenant leak and the eviction issue.\n\n```recoder-fix\n{"findings":["F-01","F-02"]}\n```'
	};
	if (fixesPreview) {
		findingsStore.fixBatches['fix-reply'] = ['f-security-tenant', 'f-perf-eviction'];
		findingsStore.suggestions['f-security-tenant'] = {
			status: 'ready', summary: 'Key buckets by tenant as well as route.', applies: true,
			patch: 'diff --git a/src/rate-limit/limiter.ts b/src/rate-limit/limiter.ts\n--- a/src/rate-limit/limiter.ts\n+++ b/src/rate-limit/limiter.ts\n@@ -20,3 +20,3 @@\n export function bucketKey(req: Request): string {\n-\treturn req.route;\n+\treturn `${req.tenantId}:${req.route}:${req.headers.get(\'x-forwarded-for\') ?? req.ip}`;\n }\n'
		};
		findingsStore.suggestions['f-perf-eviction'] = { status: 'loading' };
	}
	let messages = $state<ReviewChatMessage[]>(draft ? [openerMessage] : fixesPreview ? [...initialMessages, fixReply] : [...initialMessages]);
	let previewKey = $state(0);
	let diffOpen = $state(false);
	const reasoning: ReviewReasoningEntry[] = [{
		id: 'plan-reasoning', assignmentId: ORCHESTRATOR_ID, model, at: iso(120), status: 'done',
		text: 'I’ll compare the new status command with the existing list behavior, then delegate focused checks for test coverage, complexity, and documentation.'
	}];
	const tasks: ReviewTask[] = specs.map((spec) => ({
		id: `${spec.id}-task`, assignmentId: spec.id, label: spec.title, status: 'done',
		message: spec.operation, updatedAt: iso(0), startedAt: iso(80)
	}));
	const findings: ReviewingFinding[] = ['high', 'medium', 'medium', 'low'].map((severity, i) => ({ id: `example-${i}`, agent: 'testing', severity: severity as ReviewingFinding['severity'], title: 'Example finding', location: null }));
	const repro = 'packages/cli/src/recoder-repro.test.ts';
	const toolCalls: ReviewToolCall[] = [
		...specs.map((spec) => ({
			id: `${spec.id}-tool`, assignmentId: spec.id, role: spec.id, command: 'rg -n "status" packages/cli',
			status: 'done' as const, exitCode: 0, startedAt: iso(70), elapsedMs: 220, summary: '3 matches'
		})),
		{
			id: 'testing-write', assignmentId: 'testing', role: 'testing', command: `write ${repro}`, input: { action: 'writeFile', path: repro },
			status: 'done', exitCode: null, startedAt: iso(66), elapsedMs: 90, summary: repro,
			result: { content: `Wrote ${repro} (6 lines).\nimport { expect, test } from 'bun:test';\nimport { status } from './status';\n\ntest('status prints a line for an empty queue', () => {\n\texpect(status([])).toBe('No pending jobs');\n});`, truncated: false }
		},
		{
			id: 'testing-run', assignmentId: 'testing', role: 'testing', command: `$ bun test ${repro}`, input: { action: 'run', command: `bun test ${repro}` },
			status: 'done', exitCode: 1, startedAt: iso(64), elapsedMs: 1840, summary: 'exit 1',
			result: { content: `$ bun test ${repro}\n(fail) status prints a line for an empty queue\n  Expected: "No pending jobs"\n  Received: ""\n\n 0 pass\n 1 fail\n[exit 1 · 1.8s]`, truncated: false, evidenceId: 'ev_9' }
		}
	];
	// `?state=running` previews artboard 3b: a review mid-flight.
	const running = page.url.searchParams.get('state') === 'running';
	const liveSpecs = [
		{ id: 'correctness', model: 'gpt-5-codex', status: 'running', op: 'Reading src/rate-limit/limiter.ts:20-46' },
		{ id: 'patterns', model: 'gpt-5-codex', status: 'done', op: 'Compared exports against 14 call sites · 1 finding' },
		{ id: 'perf', model: 'qwen3-coder', status: 'running', op: 'Searching src/ for Map eviction patterns' },
		{ id: 'docs', model: 'qwen3-coder', status: 'done', op: 'Checked doc comments in src/rate-limit' },
		{ id: 'security', model: 'gpt-5-codex', status: 'queued', op: 'Waiting for a free slot' }
	] as const;
	const liveAssignments: ReviewAssignment[] = liveSpecs.map((spec) => ({
		id: spec.id, role: spec.id, title: spec.id, reason: spec.op, status: spec.status, scope: [],
		model: spec.model, currentOperation: spec.op, startedAt: iso(60)
	}));
	const liveMessages: ReviewChatMessage[] = [
		{ id: 'ask', assignmentId: ORCHESTRATOR_ID, from: 'user', text: 'Review this. Focus on the clock injection and anything that breaks existing callers.', at: iso(140), status: 'done' },
		{ id: 'plan', assignmentId: ORCHESTRATOR_ID, from: 'assistant', model, at: iso(120), status: 'done',
			text: 'This turns the module-level limiter into a `RateLimiter` class with an injectable `Clock`. The risk sits in two places: callers of the old free `allow()`, and whether refill timing actually uses the new clock.\n\nI’m sending five specialists. Correctness and repository consistency always run; performance, docs and security were picked for this diff.' }
	];
	const liveTools: ReviewToolCall[] = [
		['readDiff', 'src/rate-limit/limiter.ts', 400], ['search', 'allow\\( in src/', 1100],
		['readFile', 'src/rate-limit/index.ts', 200], ['readFile', 'src/time/clock.ts', 200]
	].map(([action, target, ms], i) => ({
		id: `live-tool-${i}`, assignmentId: ORCHESTRATOR_ID, command: `${action} ${target}`, input: { action: action as string, path: target as string },
		// The last reads are still going, so the preview shows the live labels.
		...(i >= 2 ? { status: 'running' as const, exitCode: null } : { status: 'done' as const, exitCode: 0, elapsedMs: ms as number }),
		startedAt: iso(118 - i)
	}));
	const liveReasoning: ReviewReasoningEntry[] = [{ id: 'live-reasoning', assignmentId: ORCHESTRATOR_ID, model, at: iso(132), status: 'done', text: 'Reading the diff to scope specialists.' }];

	/** Streams the canned reply in network-sized chunks, like a live provider. */
	async function send(assignmentId: string, text: string) {
		const at = new Date().toISOString();
		const reply = 'This is an interactive design preview. Open a session from the top bar to discuss a real pull request with the review agents. Replies stream in as the model writes them, so you can start reading before it finishes.';
		const id = crypto.randomUUID();
		messages = [...messages,
			{ id: crypto.randomUUID(), assignmentId, from: 'user', text, at, status: 'done', discussion: true },
			{ id, assignmentId, from: 'assistant', text: '', at, status: 'streaming', discussion: true }
		];
		const update = (patch: Partial<ReviewChatMessage>) => (messages = messages.map((message) => message.id === id ? { ...message, ...patch } : message));
		// Like the real API: sending resolves at once, the reply streams after.
		void (async () => {
			await new Promise((resolve) => setTimeout(resolve, 700));
			for (let end = 0; end < reply.length;) {
				end = Math.min(reply.length, end + 18 + Math.floor(Math.random() * 30));
				update({ text: reply.slice(0, end) });
				await new Promise((resolve) => setTimeout(resolve, 90 + Math.random() * 160));
			}
			update({ status: 'done' });
		})();
	}
</script>

<svelte:head><title>Session design preview — Recoder</title></svelte:head>

{#if running}
	<ReviewingView fullscreen
		title="Move rate limiter into a class with injectable clock"
		meta={{ prLabel: '#4127', repo: 'ledger-api', branch: 'rate-limit/clock', files: 6, additions: 73, deletions: 34, elapsed: '2:14' }}
		assignments={liveAssignments} messages={liveMessages} toolCalls={liveTools} reasoning={liveReasoning} orchestratorModel={model}
		findings={[]} stage={3} stageLabel="Specialist review" active completedAt={undefined}
		onSend={send} onOpenDiff={() => diffOpen = true} onRestart={null} />
{:else}
{#key previewKey}
	<ReviewingView fullscreen
		title="refactor(cli): extract `sivir list` formatting, add `sivir status`"
		meta={{ prLabel: '#160', repo: 'aidan-neel/sivir-ui', branch: 'claude/branch', files: 5, additions: 205, deletions: 22, elapsed: '1:24' }}
		assignments={awaitingPrompt ? [] : assignments}
		tasks={awaitingPrompt ? [] : [...tasks, { id: 'consolidation', label: 'Finalize review', message: 'Complete', status: 'done', elapsedMs: 20000, updatedAt: iso(0) }]}
		reasoning={awaitingPrompt ? [] : reasoning} {messages} toolCalls={awaitingPrompt ? [] : toolCalls} orchestratorModel={model}
		findings={awaitingPrompt ? [] : findings} stage={6} stageLabel={failed ? 'Specialist review' : 'Review complete'} active={continuing} {failed} {awaitingPrompt} completedAt={awaitingPrompt ? undefined : iso(0)}
		failure={failed ? { reason: 'The model endpoint timed out.' } : null}
		onContinue={failed ? async () => { continuing = true; await new Promise((resolve) => setTimeout(resolve, 900)); failed = false; continuing = false; } : null}
		planSummary={'I created 3 specialists for this review:\n\n- Test coverage\n- Complexity\n- Documentation'}
		onSend={send} onOpenDiff={() => diffOpen = true}
		onStartReview={awaitingPrompt ? async () => { await new Promise((resolve) => setTimeout(resolve, 600)); awaitingPrompt = false; } : null}
		onRestart={() => { messages = []; awaitingPrompt = true; previewKey++; }} />
{/key}
{/if}

<Modal.Root bind:open={diffOpen}>
	<Modal.Content size="xl">
		<Modal.Header><Modal.Title>Example diff</Modal.Title></Modal.Header>
		<Modal.Body><ScrollArea showCues={false} class="max-h-[65dvh]" aria-label="Example code diff"><CodeDiff diff={getFileDiff(DEFAULT_FILE)} findings={[]} /></ScrollArea></Modal.Body>
	</Modal.Content>
</Modal.Root>
