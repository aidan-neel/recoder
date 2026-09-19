<script lang="ts">
	import { ORCHESTRATOR_ID, type ReviewAssignment, type ReviewChatMessage, type ReviewReasoningEntry, type ReviewTask, type ReviewToolCall } from '@recoder/shared';
	import * as Modal from '@sivir-ui/svelte/components/modal';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import ReviewingView, { type ReviewingFinding } from '$lib/components/reviewing-view.svelte';
	import CodeDiff from '$lib/components/code-diff.svelte';
	import { getFileDiff } from '$lib/diff';
	import { DEFAULT_FILE } from '$lib/session-file.svelte';

	// Interactive design fixture. Real sessions use the same view with API/SSE data.
	const now = Date.now();
	const iso = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();
	const model = 'GPT 5.6 Sol';
	let awaitingPrompt = $state(false);
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
	let messages = $state<ReviewChatMessage[]>([...initialMessages]);
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
	const toolCalls: ReviewToolCall[] = specs.map((spec) => ({
		id: `${spec.id}-tool`, assignmentId: spec.id, role: spec.id, command: 'rg -n "status" packages/cli',
		status: 'done', exitCode: 0, startedAt: iso(70), elapsedMs: 220, summary: '3 matches'
	}));
	async function send(assignmentId: string, text: string) {
		const at = new Date().toISOString();
		messages = [...messages,
			{ id: crypto.randomUUID(), assignmentId, from: 'user', text, at, status: 'done', discussion: true },
			{ id: crypto.randomUUID(), assignmentId, from: 'assistant', text: 'This is an interactive design preview. Open a session from the sidebar to discuss a real pull request with the review agents.', at, status: 'done', discussion: true }
		];
	}
</script>

<svelte:head><title>Session design preview — Recoder</title></svelte:head>

{#key previewKey}
	<ReviewingView fullscreen
		title="refactor(cli): extract `sivir list` formatting, add `sivir status`"
		meta={{ prLabel: '#160', repo: 'aidan-neel/sivir-ui', branch: 'claude/branch', files: 5, additions: 205, deletions: 22, elapsed: '1:24' }}
		assignments={awaitingPrompt ? [] : assignments}
		tasks={awaitingPrompt ? [] : [...tasks, { id: 'consolidation', label: 'Finalize review', message: 'Complete', status: 'done', elapsedMs: 20000, updatedAt: iso(0) }]}
		reasoning={awaitingPrompt ? [] : reasoning} {messages} toolCalls={awaitingPrompt ? [] : toolCalls} orchestratorModel={model}
		findings={awaitingPrompt ? [] : findings} stage={4} stageLabel="Review complete" active={false} {awaitingPrompt} completedAt={awaitingPrompt ? undefined : iso(0)}
		planSummary={'I created 3 specialists for this review:\n\n- Test coverage\n- Complexity\n- Documentation'}
		onSend={send} onOpenDiff={() => diffOpen = true}
		onRestart={() => { messages = []; awaitingPrompt = true; previewKey++; }} />
{/key}

<Modal.Root bind:open={diffOpen}>
	<Modal.Content size="xl">
		<Modal.Header><Modal.Title>Example diff</Modal.Title></Modal.Header>
		<Modal.Body><ScrollArea showCues={false} class="max-h-[65dvh]" aria-label="Example code diff"><CodeDiff diff={getFileDiff(DEFAULT_FILE)} findings={[]} /></ScrollArea></Modal.Body>
	</Modal.Content>
</Modal.Root>
