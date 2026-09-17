<script lang="ts" module>
	import type { CoverageGap, CoverageSummary, ReviewAssignment, ReviewChatMessage, ReviewReasoningEntry, ReviewTask, ReviewToolCall, RoleDecision } from '@recoder/shared';
	export interface ReviewingFinding {
		id: string;
		agent: string | null;
		severity: 'high' | 'medium' | 'low' | 'info';
		title: string;
		location: string | null;
		confirmed?: boolean;
	}
	export interface ReviewingMeta {
		prLabel: string;
		repo: string;
		files: number | null;
		additions: number | null;
		deletions: number | null;
		elapsed: string;
	}
	export type { ReviewAssignment };
</script>

<script lang="ts">
	import { ORCHESTRATOR_ID } from '@recoder/shared';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Badge, type BadgeVariant } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Select from '@sivir-ui/svelte/components/select';
	import { TaskSteps } from '@sivir-ui/svelte/components/task-steps';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewMetricsModal from './review-metrics-modal.svelte';
	import ReviewConversation from './review-conversation.svelte';

	interface Props {
		reviewId?: string;
		title: string;
		meta: ReviewingMeta;
		assignments?: ReviewAssignment[];
		messages?: ReviewChatMessage[];
		orchestratorModel?: string;
		reasoning?: ReviewReasoningEntry[];
		toolCalls?: ReviewToolCall[];
		active?: boolean;
		failed?: boolean;
		errorMessage?: string | null;
		connectionLost?: boolean;
		onOpenDiff: (() => void) | null;
		onRestart: (() => void) | null;
		onSend?: (assignmentId: string, text: string) => Promise<void>;
		onStop?: (assignmentId: string) => Promise<void>;
		restarting?: boolean;
		now?: number;
		fullscreen?: boolean;
		// Accepted by the demo and older callers; the workspace shows conversations instead.
		findings: ReviewingFinding[];
		roleDecisions?: RoleDecision[];
		tasks?: ReviewTask[];
		stage?: number;
		stageLabel?: string;
		stageDetail?: string;
		connectionLabel?: string;
		planSummary?: string | null;
		pendingCount?: number;
		coverage?: CoverageSummary | null;
		coverageGaps?: CoverageGap[];
		pipelineLogs?: string[];
		doneHref?: string | null;
	}
	let {
		reviewId, title, meta, assignments = [], messages = [], orchestratorModel,
		reasoning = [], toolCalls = [], active = true, failed = false,
		errorMessage = null, connectionLost = false, onOpenDiff, onRestart,
		onSend, onStop, restarting = false, now = Date.now(), fullscreen = false, stage = 0, tasks = []
	}: Props = $props();

	let selectedId = $state(ORCHESTRATOR_ID);
	let drafts = $state<Record<string, string>>({});
	const specialists = $derived(assignments.filter((assignment) => assignment.id !== ORCHESTRATOR_ID));
	const orchestrator = $derived<ReviewAssignment>({
		id: ORCHESTRATOR_ID, role: 'orchestrator', title: 'Orchestrator', reason: '', scope: [],
		status: active ? 'running' : failed ? 'partial' : 'done',
		model: orchestratorModel ?? assignments.find((item) => item.id === ORCHESTRATOR_ID)?.model ??
			messages.findLast((item) => item.assignmentId === ORCHESTRATOR_ID && item.model)?.model ??
			reasoning.findLast((item) => (!item.assignmentId || item.assignmentId === ORCHESTRATOR_ID) && item.model)?.model
	});
	const selected = $derived(specialists.find((assignment) => assignment.id === selectedId) ?? orchestrator);
	const participants = $derived([orchestrator, ...specialists]);
	const reviewStatus = $derived(active ? 'Reviewing' : failed ? 'Incomplete' : 'Complete');
	const reviewVariant = $derived<BadgeVariant>(active ? 'info' : failed ? 'warning' : 'success');
	const reviewSteps = [
		{ id: 'checkout', label: 'Prepare repository' },
		{ id: 'plan', label: 'Plan review' },
		{ id: 'specialists', label: 'Specialist reviews' },
		{ id: 'consolidate', label: 'Consolidate findings' }
	];
	const currentStep = $derived(!active && !failed ? reviewSteps.length : Math.min(stage, reviewSteps.length - 1));

	function statusFor(assignment: ReviewAssignment): { label: string; variant: BadgeVariant } {
		switch (assignment.status) {
			case 'running': return { label: 'Working', variant: 'info' };
			case 'waiting': return { label: 'Waiting', variant: 'secondary' };
			case 'queued': return { label: 'Queued', variant: 'outline' };
			case 'done': return { label: 'Complete', variant: 'success' };
			case 'partial': return { label: 'Incomplete', variant: 'warning' };
			case 'error': return { label: 'Failed', variant: 'error' };
			case 'skipped': return { label: 'Skipped', variant: 'secondary' };
		}
	}
</script>

{#snippet participant(assignment: ReviewAssignment)}
	{@const status = statusFor(assignment)}
	<Button
		variant={selected.id === assignment.id ? 'secondary' : 'ghost'}
		class="h-auto min-h-11 w-full justify-between gap-3 !px-2 py-2 text-left"
		aria-current={selected.id === assignment.id ? 'page' : undefined}
		onclick={() => selectedId = assignment.id}
	>
		<span class="min-w-0 flex-1 truncate text-sm font-medium" title={assignment.title}>{assignment.title}</span>
		<Badge variant={status.variant} class="shrink-0 self-center">{status.label}</Badge>
	</Button>
{/snippet}

<div class="flex min-h-0 flex-col {fullscreen ? 'h-full' : 'h-[min(56rem,85dvh)]'}">
	<header class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-4 py-3 sm:px-6">
		<div class="flex min-w-0 flex-1 basis-64 items-center gap-3">
			<Typography.Title level={1} class="min-w-0 truncate text-base" title={title}>{title}</Typography.Title>
			<Badge variant={reviewVariant} class="shrink-0 self-center">{reviewStatus}</Badge>
		</div>
		<div class="ms-auto flex items-center gap-1.5">
			{#if reviewId}<ReviewMetricsModal {reviewId} />{/if}
			{#if onRestart}
				<AlertDialog.Root>
					<AlertDialog.Trigger variant="ghost" disabled={restarting}>{restarting ? 'Restarting…' : 'Restart'}</AlertDialog.Trigger>
					<AlertDialog.Content>
						<AlertDialog.Header>
							<AlertDialog.Title>Restart review?</AlertDialog.Title>
							<AlertDialog.Description>Start a fresh review of this pull request with the current model settings.</AlertDialog.Description>
						</AlertDialog.Header>
						<AlertDialog.Footer>
							<AlertDialog.Exit>Cancel</AlertDialog.Exit>
							<AlertDialog.Confirm variant="primary" onclick={onRestart}>Restart</AlertDialog.Confirm>
						</AlertDialog.Footer>
					</AlertDialog.Content>
				</AlertDialog.Root>
			{/if}
			{#if onOpenDiff}<Button variant="primary" onclick={onOpenDiff}>Open diff</Button>{/if}
		</div>
	</header>
	<div class="flex min-h-0 flex-1">
		<aside class="hidden w-80 shrink-0 flex-col border-r border-border lg:flex xl:w-[22rem]" aria-label="Review conversations">
			<div class="px-4 pb-3 pt-5">
				<Typography.Title level={2} class="mb-3 text-sm">Review</Typography.Title>
				<TaskSteps steps={reviewSteps} current={currentStep} failed={failed} label="Review progress" class="mb-5" />
				{@render participant(orchestrator)}
			</div>
			<ScrollArea showCues={false} class="min-h-0 flex-1 px-4 pb-4">
				{#if specialists.length}
					<Typography.Title level={3} class="mb-2 mt-3 text-sm">Specialists</Typography.Title>
					<div class="flex flex-col gap-1">
						{#each specialists as assignment (assignment.id)}{@render participant(assignment)}{/each}
					</div>
				{/if}
			</ScrollArea>
			<div class="flex flex-col gap-1 border-t border-border px-5 py-3">
				<Typography.Metadata class="truncate" title={`${meta.repo} ${meta.prLabel}`}>{meta.repo} {meta.prLabel}</Typography.Metadata>
				<Typography.Metadata class="tabular-nums">{meta.elapsed}{meta.files !== null ? ` · ${meta.files} ${meta.files === 1 ? 'file' : 'files'}` : ''}</Typography.Metadata>
			</div>
		</aside>
		<section class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`${selected.title} conversation`}>
			<div class="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
				<Typography.Title level={2} class="hidden text-sm lg:block">{selected.title}</Typography.Title>
				<div class="min-w-0 max-w-full lg:hidden">
					<Select.Root value={selected.id} onValueChange={(value) => selectedId = value}>
						<Select.Trigger variant="ghost" aria-label="Conversation">{selected.title}</Select.Trigger>
						<Select.Content>
							{#each participants as assignment (assignment.id)}<Select.Item value={assignment.id}>{assignment.title}</Select.Item>{/each}
						</Select.Content>
					</Select.Root>
				</div>
				{#if selected.model}<Badge variant="secondary" class="max-w-full self-center"><span class="truncate">{selected.model}</span></Badge>{/if}
			</div>
			{#if connectionLost}<Typography.Text role="status" class="px-6 py-2 text-sm text-warning">Reconnecting… Your conversation is saved.</Typography.Text>{/if}
			{#if errorMessage}<Typography.Text role="alert" class="px-6 py-2 text-sm text-error">{errorMessage}</Typography.Text>{/if}
			{#each [selected] as target (target.id)}
				<ReviewConversation
					assignment={target} {messages} {reasoning} {toolCalls} {active} {now}
					tasks={tasks.filter((task) => (task.assignmentId ?? ORCHESTRATOR_ID) === target.id)}
					bind:draft={() => drafts[target.id] ?? '', (value) => drafts[target.id] = value} {onSend} {onStop}
				/>
			{/each}
		</section>
	</div>
</div>
