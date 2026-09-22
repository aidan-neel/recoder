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
		branch?: string | null;
	}
	export type { ReviewAssignment };
</script>

<script lang="ts">
	import { page } from '$app/state';
	import { ORCHESTRATOR_ID } from '@recoder/shared';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Check from '@lucide/svelte/icons/check';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Badge, type BadgeVariant } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import { TaskSteps } from '@sivir-ui/svelte/components/task-steps';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewMetricsModal from './review-metrics-modal.svelte';
	import ReviewConversation from './review-conversation.svelte';
	import FindingSeverity from './finding-severity.svelte';

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
		awaitingPrompt?: boolean;
		completedAt?: string;
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
		onSend, onStop, restarting = false, now = Date.now(), fullscreen = false, stage = 0, tasks = [],
		planSummary = null, pipelineLogs = [], stageLabel = 'Preparing review', coverage = null,
		awaitingPrompt = false, completedAt, findings = []
	}: Props = $props();

	let drafts = $state<Record<string, string>>({});
	let restartOpen = $state(false);
	let metricsOpen = $state(false);
	const specialists = $derived(assignments.filter((assignment) => assignment.id !== ORCHESTRATOR_ID));
	const orchestrator = $derived<ReviewAssignment>({
		id: ORCHESTRATOR_ID, role: 'orchestrator', title: 'Orchestrator', reason: '', scope: [],
		status: awaitingPrompt ? 'waiting' : active ? 'running' : failed ? 'partial' : 'done',
		model: orchestratorModel ?? assignments.find((item) => item.id === ORCHESTRATOR_ID)?.model ??
			messages.findLast((item) => item.assignmentId === ORCHESTRATOR_ID && item.model)?.model ??
			reasoning.findLast((item) => (!item.assignmentId || item.assignmentId === ORCHESTRATOR_ID) && item.model)?.model
	});
	const selected = $derived(specialists.find((assignment) => assignment.id === page.url.searchParams.get('agent')) ?? orchestrator);
	const isOrchestrator = $derived(selected.id === ORCHESTRATOR_ID);

	/** URL-backed chats support browser history, reloads, and opening in a new tab. */
	function conversationHref(assignmentId: string): string {
		const url = new URL(page.url);
		if (assignmentId === ORCHESTRATOR_ID) url.searchParams.delete('agent');
		else url.searchParams.set('agent', assignmentId);
		return `${url.pathname}${url.search}${url.hash}`;
	}
	const specialistsAt = $derived(specialists.map((item) => item.queuedAt ?? item.startedAt).filter((at): at is string => !!at).sort()[0]);
	const pending = $derived(specialists.filter((item) => ['running', 'waiting', 'queued'].includes(item.status)).length);
	const finalization = $derived(tasks.find((task) => task.id === 'consolidation'));
	const finalizationSeconds = $derived(finalization?.elapsedMs !== undefined ? Math.max(0, Math.round(finalization.elapsedMs / 1000)) : null);
	const progressLabel = $derived(!active ? failed ? 'Review incomplete' : `Finalized review${finalizationSeconds ? ` for ${finalizationSeconds}s` : ''}` : pending ? 'Waiting for specialists…' : stageLabel);
	const finalReasoning = $derived(reasoning.filter((entry) => (entry.assignmentId ?? ORCHESTRATOR_ID) === ORCHESTRATOR_ID && finalization?.startedAt && Date.parse(entry.at) >= Date.parse(finalization.startedAt)));
	const chatReasoning = $derived(reasoning.filter((entry) => !finalReasoning.some((item) => item.id === entry.id)));
	const findingCounts = $derived([
		{ severity: 'high' as const, count: findings.filter((finding) => finding.severity === 'high').length },
		{ severity: 'medium' as const, count: findings.filter((finding) => finding.severity === 'medium').length },
		{ severity: 'low' as const, count: findings.filter((finding) => finding.severity === 'low' || finding.severity === 'info').length }
	]);
	const reviewSteps = [
		{ id: 'checkout', label: 'Prepare repository' },
		{ id: 'plan', label: 'Plan review' },
		{ id: 'specialists', label: 'Specialist reviews' },
		{ id: 'consolidate', label: 'Consolidate findings' }
	];
	const currentStep = $derived(!active && !failed ? reviewSteps.length : Math.min(stage, reviewSteps.length - 1));

	function statusFor(assignment: ReviewAssignment): { label: string; variant: BadgeVariant } {
		switch (assignment.status) {
			case 'running': return { label: active ? 'Reviewing' : 'Interrupted', variant: active ? 'warning' : 'error' };
			case 'waiting': return { label: 'Waiting', variant: 'secondary' };
			case 'queued': return { label: 'Queued', variant: 'outline' };
			case 'done': return { label: 'Finished', variant: 'success' };
			case 'partial': return { label: 'Incomplete', variant: 'warning' };
			case 'error': return { label: 'Failed', variant: 'error' };
			case 'skipped': return { label: 'Skipped', variant: 'secondary' };
		}
	}
</script>

{#snippet specialistsContent()}
	<section class="flex min-w-0 flex-col gap-3" aria-label="Specialists">
		<Collapsible.Root>
			<Collapsible.Trigger class="review-disclosure">
				Created {specialists.length} {specialists.length === 1 ? 'specialist' : 'specialists'}
				<ChevronRight size={14} aria-hidden="true" />
			</Collapsible.Trigger>
			<Collapsible.Content class="pb-2">
				{#each specialists as assignment (assignment.id)}
					<Typography.Text class="mb-2 text-sm"><span class="font-medium">{assignment.title}:</span> {assignment.reason}</Typography.Text>
				{/each}
			</Collapsible.Content>
		</Collapsible.Root>
		{#if planSummary}<Markdown content={planSummary} class="text-sm" />{/if}
		<Card.Root class="!gap-0 overflow-hidden rounded-xl border border-border bg-transparent !p-0 shadow-none">
			{#each specialists as assignment (assignment.id)}
				{@const status = statusFor(assignment)}
					<Button href={conversationHref(assignment.id)} variant="ghost" class="specialist-row h-auto min-h-[68px] w-full justify-start rounded-none !px-3 !py-3 text-left" aria-label={`Open ${assignment.title} conversation`}>
						<span class="flex min-w-0 flex-1 flex-col gap-1">
							<span class="flex min-w-0 items-center justify-between gap-3">
								<span class="truncate text-sm font-normal">{assignment.title}</span>
								<Badge variant={status.variant} dot={assignment.status === 'done'} class="min-h-[23px] shrink-0 gap-1 rounded-md px-1.5 py-1 text-xs font-normal">
									{#if assignment.status === 'running' && active}<Spinner size={11} aria-hidden="true" />
									{:else if status.variant === 'error'}<CircleAlert size={11} aria-hidden="true" />{/if}
									{status.label}
								</Badge>
							</span>
							<Typography.Metadata class="truncate font-mono text-xs font-normal" title={assignment.currentOperation || assignment.reason}>{assignment.currentOperation || assignment.reason || status.label}</Typography.Metadata>
						</span>
					</Button>
			{/each}
		</Card.Root>
	</section>
{/snippet}

{#snippet progressContent()}
	<Collapsible.Root>
		<Collapsible.Trigger class="review-disclosure" >
			<span class={failed ? 'text-error' : ''}>{progressLabel}</span><ChevronRight size={14} aria-hidden="true" />
		</Collapsible.Trigger>
		<Collapsible.Content class="space-y-4 py-3">
			{#each finalReasoning as entry (entry.id)}<Markdown content={entry.text} streaming={active && entry.status === 'streaming'} />{/each}
			<TaskSteps steps={reviewSteps} current={currentStep} {failed} label="Review progress" />
			<Typography.Metadata class="block font-mono">{meta.repo} {meta.prLabel} · {meta.elapsed}</Typography.Metadata>
			{#if coverage}<Typography.Text class="text-sm text-foreground-muted">{coverage.reviewed} of {coverage.total} changes reviewed{coverage.partial ? ` · ${coverage.partial} partial` : ''}</Typography.Text>{/if}
			<ScrollArea showCues={false} class="max-h-64" aria-label="Review activity">
				{#each tasks as task (task.id)}<Typography.Text class="mb-2 text-xs text-foreground-muted"><span class="font-medium">{task.label}</span> · {task.message || task.status}</Typography.Text>{/each}
				{#each pipelineLogs as log, i (i)}<Typography.Text class="mb-1 break-words font-mono text-xs text-foreground-muted">{log}</Typography.Text>{/each}
			</ScrollArea>
		</Collapsible.Content>
	</Collapsible.Root>
	{#if !active && !failed}
		<Card.Root class="review-completion mt-2 !flex-row flex-wrap items-center justify-between !gap-4 rounded-xl border border-border-subtle bg-transparent !p-4 shadow-none">
			<Card.Content class="min-w-0 !space-y-2">
				<Typography.Text class="flex items-center gap-2 text-sm font-normal text-foreground"><Check size={15} class="shrink-0 text-success" aria-hidden="true" />Review finished with {findings.length} {findings.length === 1 ? 'finding' : 'findings'}</Typography.Text>
				{#if findings.length}
					<div class="flex flex-wrap items-center gap-2 ps-[23px]" aria-label="Findings by severity">
						{#each findingCounts.filter((item) => item.count > 0) as item (item.severity)}
							<FindingSeverity severity={item.severity} count={item.count} />
						{/each}
					</div>
				{/if}
			</Card.Content>
			<Button variant="outline" onclick={onOpenDiff ?? undefined} disabled={!onOpenDiff} class="shrink-0 gap-2 bg-transparent font-normal">Open Review <ArrowUpRight size={14} aria-hidden="true" /></Button>
		</Card.Root>
	{/if}
{/snippet}

<div class="review-workspace flex min-h-0 flex-col {fullscreen ? 'h-full' : 'h-[min(56rem,85dvh)]'}">
	<header class="flex min-h-14 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
		<Typography.Title level={1} class="min-w-0 flex-1 basis-64 truncate text-sm font-normal tracking-normal" title={title}>{title}</Typography.Title>
		<div class="ms-auto flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-foreground-muted">
			{#if meta.branch}<Typography.Metadata class="max-w-40 truncate font-mono text-xs font-normal" title={meta.branch}>{meta.branch}</Typography.Metadata>{/if}
			{#if selected.model}<Typography.Metadata class="max-w-48 truncate font-mono text-xs font-normal" title={selected.model}>{selected.model}</Typography.Metadata>{/if}
			{#if meta.files !== null}
				<Button variant="quiet" class="h-7 gap-2 px-1 font-mono text-xs font-normal text-foreground-muted hover:text-foreground" disabled={!onOpenDiff} onclick={onOpenDiff ?? undefined} aria-label={`Open diff, ${meta.files} changed files`}>
					{meta.files} {meta.files === 1 ? 'file' : 'files'}
					{#if meta.additions !== null}<span class="text-success">+{meta.additions}</span>{/if}
					{#if meta.deletions !== null}<span class="text-error">−{meta.deletions}</span>{/if}
				</Button>
			{/if}
			{#if reviewId || onRestart || onOpenDiff}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger variant="ghost" size="icon" aria-label="Session actions" class="size-9"><Ellipsis size={16} aria-hidden="true" /></DropdownMenu.Trigger>
					<DropdownMenu.Content>
						{#if onOpenDiff}<DropdownMenu.Item callback={onOpenDiff}>Open diff</DropdownMenu.Item>{/if}
						{#if reviewId}<DropdownMenu.Item callback={() => metricsOpen = true}>View token usage</DropdownMenu.Item>{/if}
						{#if onRestart}<DropdownMenu.Item disabled={restarting} callback={() => restartOpen = true}>{restarting ? 'Restarting…' : 'Restart review'}</DropdownMenu.Item>{/if}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>
	</header>
	{#if !isOrchestrator}
		{@const status = statusFor(selected)}
		<nav aria-label="Review conversations" class="mx-auto flex w-full max-w-[776px] shrink-0 items-center gap-2 px-4 pb-3 pt-1 sm:px-6">
			<Button href={conversationHref(ORCHESTRATOR_ID)} variant="ghost" size="icon" aria-label="Back to Orchestrator" title="Back to Orchestrator" class="size-9 shrink-0"><ArrowLeft size={16} aria-hidden="true" /></Button>
			<Typography.Title level={2} class="sr-only">{selected.title} conversation</Typography.Title>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger variant="ghost" class="min-w-0 gap-2 !px-2 text-sm" aria-label="Switch conversation"><span class="truncate">{selected.title}</span><ChevronDown size={14} class="shrink-0" aria-hidden="true" /></DropdownMenu.Trigger>
				<DropdownMenu.Content>
					{#each [orchestrator, ...specialists] as assignment (assignment.id)}
						<DropdownMenu.Item href={conversationHref(assignment.id)} aria-current={assignment.id === selected.id ? 'page' : undefined}>{assignment.title}</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<Badge variant={status.variant} dot={selected.status === 'done'} class="ms-auto shrink-0 rounded-md font-normal">{status.label}</Badge>
		</nav>
	{/if}
	{#if connectionLost}<Typography.Text role="status" class="mx-auto w-full max-w-[776px] px-6 py-2 text-sm text-warning">Reconnecting… Your conversation is saved.</Typography.Text>{/if}
	{#if errorMessage}<Typography.Text role="alert" class="mx-auto w-full max-w-[776px] px-6 py-2 text-sm text-error">{errorMessage}</Typography.Text>{/if}
	{#each [selected] as target (target.id)}
		<ReviewConversation assignment={target} {messages} reasoning={isOrchestrator ? chatReasoning : reasoning} {toolCalls} {active} {now}
			awaitingPrompt={isOrchestrator && awaitingPrompt}
			tasks={tasks.filter((task) => (task.assignmentId ?? ORCHESTRATOR_ID) === target.id)}
			bind:draft={() => drafts[target.id] ?? '', (value) => drafts[target.id] = value} {onSend} {onStop}
			workspace={isOrchestrator && specialists.length ? specialistsContent : undefined} workspaceAt={specialistsAt}
			afterTranscript={isOrchestrator && !awaitingPrompt ? progressContent : undefined} afterTranscriptAt={completedAt} />
	{/each}
</div>

{#if reviewId}<ReviewMetricsModal {reviewId} bind:open={metricsOpen} showTrigger={false} />{/if}
<AlertDialog.Root bind:open={restartOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Restart review?</AlertDialog.Title>
			<AlertDialog.Description>Open a fresh session for this pull request. Tell the orchestrator what to review when you’re ready.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Exit>Cancel</AlertDialog.Exit>
			<AlertDialog.Confirm variant="primary" onclick={onRestart ?? undefined}>Restart review</AlertDialog.Confirm>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
