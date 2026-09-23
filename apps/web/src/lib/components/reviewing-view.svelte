<script lang="ts" module>
	import type { CoverageGap, CoverageSummary, ReviewAssignment, ReviewChatMessage, ReviewReasoningEntry, ReviewTask, ReviewToolCall, RoleDecision } from '@recoder/shared';
	export interface ReviewingFinding {
		id: string;
		agent: string | null;
		severity: 'high' | 'medium' | 'low' | 'info';
		title: string;
		location: string | null;
		file?: string;
		line?: number | null;
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
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewMetricsModal from './review-metrics-modal.svelte';
	import ReviewConversation from './review-conversation.svelte';
	import ReviewResultsRail from './review-results-rail.svelte';
	import ReviewSteps from './review-steps.svelte';
	import SessionHeader from './session-header.svelte';
	import FindingSeverity from './finding-severity.svelte';
	import { closeSessionTab } from '$lib/session-tabs';
	import { formatAgentName } from '$lib/threads.svelte';

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
		/** Switch to the Findings or Diff workspace. Falls back to `onOpenDiff`. */
		onShowView?: ((view: 'findings' | 'diff') => void | Promise<void>) | null;
		onOpenFinding?: ((finding: ReviewingFinding) => void) | null;
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
		errorMessage = null, connectionLost = false, onOpenDiff, onShowView = null, onOpenFinding = null, onRestart,
		onSend, onStop, restarting = false, now = Date.now(), fullscreen = false, stage = 0, tasks = [],
		planSummary = null, pipelineLogs = [], stageLabel = 'Preparing review', coverage = null, coverageGaps = [],
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
	const finished = $derived(!active && !failed && !awaitingPrompt);
	const showSteps = $derived(!awaitingPrompt && (active || failed));
	const showRail = $derived(isOrchestrator && !active && !awaitingPrompt && (findings.length > 0 || specialists.length > 0));

	/** URL-backed chats support browser history, reloads, and opening in a new tab. */
	function conversationHref(assignmentId: string): string {
		const url = new URL(page.url);
		if (assignmentId === ORCHESTRATOR_ID) url.searchParams.delete('agent');
		else url.searchParams.set('agent', assignmentId);
		return `${url.pathname}${url.search}${url.hash}`;
	}
	const specialistsAt = $derived(specialists.map((item) => item.queuedAt ?? item.startedAt).filter((at): at is string => !!at).sort()[0]);
	const running = $derived(specialists.filter((item) => ['running', 'waiting', 'queued'].includes(item.status)));
	const finalization = $derived(tasks.find((task) => task.id === 'consolidation'));
	const finalizationSeconds = $derived(finalization?.elapsedMs !== undefined ? Math.max(0, Math.round(finalization.elapsedMs / 1000)) : null);
	const finalReasoning = $derived(reasoning.filter((entry) => (entry.assignmentId ?? ORCHESTRATOR_ID) === ORCHESTRATOR_ID && finalization?.startedAt && Date.parse(entry.at) >= Date.parse(finalization.startedAt)));
	const chatReasoning = $derived(reasoning.filter((entry) => !finalReasoning.some((item) => item.id === entry.id)));
	const findingCounts = $derived((['high', 'medium', 'low', 'info'] as const)
		.map((severity) => ({ severity, count: findings.filter((finding) => finding.severity === severity).length }))
		.filter((item) => item.count > 0));
	const currentStep = $derived(!active && !failed ? 4 : Math.min(stage, 3));

	/** "correctness and performance", "security, docs and 2 more". */
	function nameList(items: ReviewAssignment[]): string {
		const names = items.map((item) => formatAgentName(item.role).toLowerCase());
		if (names.length <= 1) return names[0] ?? '';
		if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
		return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
	}
	const footerLabel = $derived(running.length ? `Waiting on ${nameList(running)}` : stageLabel);

	function statusFor(assignment: ReviewAssignment): { label: string; tone: string } {
		switch (assignment.status) {
			case 'running': return active ? { label: 'Reviewing', tone: 'running' } : { label: 'Interrupted', tone: 'danger' };
			case 'waiting': return { label: 'Waiting', tone: 'idle' };
			case 'queued': return { label: 'Queued', tone: 'idle' };
			case 'done': return { label: 'Finished', tone: 'success' };
			case 'partial': return { label: 'Incomplete', tone: 'running' };
			case 'error': return { label: 'Failed', tone: 'danger' };
			case 'skipped': return { label: 'Skipped', tone: 'idle' };
		}
	}
</script>

{#snippet sessionMenu()}
	{#if onOpenDiff}<DropdownMenu.Item callback={onOpenDiff}>Open diff</DropdownMenu.Item>{/if}
	{#if reviewId}<DropdownMenu.Item callback={() => metricsOpen = true}>View token usage</DropdownMenu.Item>{/if}
	{#if onRestart}<DropdownMenu.Item disabled={restarting} callback={() => restartOpen = true}>{restarting ? 'Restarting…' : 'Restart review'}</DropdownMenu.Item>{/if}
	{#if reviewId}{@const id = reviewId}<DropdownMenu.Separator /><DropdownMenu.Item callback={() => void closeSessionTab(id)}>Close tab</DropdownMenu.Item>{/if}
{/snippet}

{#snippet specialistRows()}
	<ul class="specialist-list" aria-label="Specialists">
		{#each specialists as assignment (assignment.id)}
			{@const status = statusFor(assignment)}
			<li>
				<Button href={conversationHref(assignment.id)} variant="ghost" class="specialist-row" aria-label={`Open ${formatAgentName(assignment.role)} conversation`}>
					<span class="specialist-main">
						<span class="specialist-name-line">
							<span class="specialist-name">{formatAgentName(assignment.role)}</span>
							{#if assignment.model}<span class="specialist-model">{assignment.model}</span>{/if}
						</span>
						<span class="specialist-op" title={assignment.currentOperation || assignment.title}>{assignment.currentOperation || assignment.title}</span>
					</span>
					<Badge variant="secondary" class="status-chip" data-tone={status.tone}>
						{#if assignment.status === 'running' && active}<Spinner size={12} aria-hidden="true" />{/if}
						{status.label}
					</Badge>
					<ChevronRight size={16} class="specialist-chevron" aria-hidden="true" />
				</Button>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet specialistsContent()}
	<section class="specialists" aria-label="Specialists">
		<Collapsible.Root>
			<Collapsible.Trigger class="review-disclosure">
				Created {specialists.length} {specialists.length === 1 ? 'specialist' : 'specialists'}
				<ChevronRight size={14} aria-hidden="true" />
			</Collapsible.Trigger>
			<Collapsible.Content class="specialist-reasons">
				{#if planSummary}<Markdown content={planSummary} />{/if}
				{#each specialists as assignment (assignment.id)}
					<Typography.Text><span class="text-fg-secondary">{formatAgentName(assignment.role)}:</span> {assignment.reason || assignment.title}</Typography.Text>
				{/each}
				{#if finished}{@render specialistRows()}{/if}
			</Collapsible.Content>
		</Collapsible.Root>
		{#if !finished}{@render specialistRows()}{/if}
	</section>
{/snippet}

{#snippet activityLog()}
	{#if tasks.length || pipelineLogs.length}
		<ScrollArea showCues={false} class="max-h-64" aria-label="Review activity">
			{#each tasks as task (task.id)}<Typography.Text class="review-log"><span class="text-fg-secondary">{task.label}</span> · {task.message || task.status}</Typography.Text>{/each}
			{#each pipelineLogs as log, i (i)}<Typography.Text class="review-log font-mono">{log}</Typography.Text>{/each}
		</ScrollArea>
	{/if}
{/snippet}

{#snippet progressContent()}
	<Collapsible.Root>
		<Collapsible.Trigger class="review-disclosure">
			{#if active}<Spinner size={12} class="text-sev-medium" aria-hidden="true" />{/if}
			<span class={failed ? 'text-danger' : ''}>{active ? footerLabel : failed ? 'Review incomplete' : `Finalized review${finalizationSeconds ? ` for ${finalizationSeconds}s` : ''}`}</span>
			<ChevronRight size={14} aria-hidden="true" />
		</Collapsible.Trigger>
		<Collapsible.Content class="review-progress-detail">
			{#each finalReasoning as entry (entry.id)}<Markdown content={entry.text} streaming={active && entry.status === 'streaming'} />{/each}
			{#if coverage}<Typography.Text class="text-fg-muted">{coverage.reviewed} of {coverage.total} changes reviewed{coverage.partial ? ` · ${coverage.partial} partial` : ''}</Typography.Text>{/if}
			{@render activityLog()}
		</Collapsible.Content>
	</Collapsible.Root>
{/snippet}

{#snippet resultCard()}
	<Card.Root class="review-result">
		<div class="review-result-text">
			<Typography.Text class="review-result-title"><Check size={16} class="shrink-0 text-success" aria-hidden="true" />Review finished with {findings.length} {findings.length === 1 ? 'finding' : 'findings'}</Typography.Text>
			{#if findingCounts.length}
				<div class="review-result-pills" aria-label="Findings by severity">
					{#each findingCounts as item (item.severity)}<FindingSeverity severity={item.severity} count={item.count} />{/each}
				</div>
			{/if}
		</div>
		<Button onclick={onOpenDiff ?? undefined} disabled={!onOpenDiff} class="shrink-0 gap-2">Open review <ArrowUpRight size={14} aria-hidden="true" /></Button>
	</Card.Root>
{/snippet}

<div class="review-workspace flex min-h-0 flex-col {fullscreen ? 'h-full' : 'h-[min(56rem,85dvh)]'}">
	<SessionHeader
		{title}
		branch={meta.branch}
		repo={meta.repo}
		prLabel={meta.prLabel}
		files={meta.files}
		additions={meta.additions}
		deletions={meta.deletions}
		view="conversation"
		onView={(view) => { if (view !== 'conversation') return onShowView ? onShowView(view) : onOpenDiff?.(); }}
		diffDisabled={!onOpenDiff}
		onFiles={onOpenDiff}
		bordered={!showSteps}
		menu={reviewId || onRestart || onOpenDiff ? sessionMenu : undefined}
	/>
	{#if showSteps}
		<ReviewSteps current={currentStep} {failed} {active} elapsed={meta.elapsed}
			specialists={{ done: specialists.filter((item) => ['done', 'skipped', 'error', 'partial'].includes(item.status)).length, total: specialists.length }} />
	{/if}
	{#if !isOrchestrator}
		{@const status = statusFor(selected)}
		<nav aria-label="Review conversations" class="mx-auto flex w-full max-w-[740px] shrink-0 items-center gap-2 px-6 pb-1 pt-3">
			<Button href={conversationHref(ORCHESTRATOR_ID)} variant="ghost" size="icon" aria-label="Back to Orchestrator" title="Back to Orchestrator" class="shrink-0"><ArrowLeft size={16} aria-hidden="true" /></Button>
			<Typography.Title level={2} class="sr-only">{formatAgentName(selected.role)} conversation</Typography.Title>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger variant="quiet" class="min-w-0 gap-2" aria-label="Switch conversation"><span class="truncate">{formatAgentName(selected.role)}</span><ChevronDown size={14} class="shrink-0" aria-hidden="true" /></DropdownMenu.Trigger>
				<DropdownMenu.Content>
					{#each [orchestrator, ...specialists] as assignment (assignment.id)}
						<DropdownMenu.Item href={conversationHref(assignment.id)} aria-current={assignment.id === selected.id ? 'page' : undefined}>{formatAgentName(assignment.role)}</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<Badge variant="secondary" class="status-chip ms-auto shrink-0" data-tone={status.tone}>{status.label}</Badge>
		</nav>
	{/if}
	{#if connectionLost}<Typography.Text role="status" class="mx-auto w-full max-w-[740px] px-6 py-2 text-sm text-sev-medium">Reconnecting… Your conversation is saved.</Typography.Text>{/if}
	{#if errorMessage}<Typography.Text role="alert" class="mx-auto w-full max-w-[740px] px-6 py-2 text-sm text-danger">{errorMessage}</Typography.Text>{/if}
	<div class="flex min-h-0 flex-1">
		<div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
			{#each [selected] as target (target.id)}
				<ReviewConversation assignment={target} {messages} reasoning={isOrchestrator ? chatReasoning : reasoning} {toolCalls} {active} {now}
					awaitingPrompt={isOrchestrator && awaitingPrompt}
					tasks={tasks.filter((task) => (task.assignmentId ?? ORCHESTRATOR_ID) === target.id)}
					bind:draft={() => drafts[target.id] ?? '', (value) => drafts[target.id] = value} {onSend} {onStop}
					placeholder={!isOrchestrator ? undefined : awaitingPrompt ? undefined : active ? 'Ask Orchestrator anything…' : 'Ask a follow-up about this review…'}
					inserts={isOrchestrator ? [
						...(specialists.length ? [{ key: 'specialists', at: specialistsAt, snippet: specialistsContent }] : []),
						...(!awaitingPrompt ? [{ key: 'progress', at: active ? undefined : finalization?.startedAt ?? completedAt, snippet: progressContent }] : []),
						...(finished ? [{ key: 'result', at: completedAt, snippet: resultCard }] : [])
					] : []} />
			{/each}
		</div>
		{#if showRail}
			<ReviewResultsRail {findings} {specialists} {coverage} {coverageGaps} {onOpenFinding} specialistHref={conversationHref} />
		{/if}
	</div>
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
