<script lang="ts" module>
	import type { CoverageGap, CoverageSummary, ReviewAssignment, ReviewGuidelinesUsed, ReviewChatMessage, ReviewReasoningEntry, ReviewTask, ReviewToolCall, RoleDecision } from '@recoder/shared';
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
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewMetricsModal from './review-metrics-modal.svelte';
	import ReviewConversation from './review-conversation.svelte';
	import ReviewResultsRail from './review-results-rail.svelte';
	import ReviewSteps from './review-steps.svelte';
	import Disclosure from './ui/disclosure.svelte';
	import ReasoningSteps from './reasoning-steps.svelte';
	import PrChecks from './pr-checks.svelte';
	import SessionHeader from './session-header.svelte';
	import FindingSeverity from './finding-severity.svelte';
	import { closeSessionTab } from '$lib/session-tabs';
	import { requestDeleteSession } from '$lib/delete-session.svelte';
	import { formatAgentName } from '$lib/threads.svelte';
	import { guidelinesStore } from '$lib/guidelines.svelte';
	import { errorToast } from '$lib/notify';
	import { serverApi } from '$lib/server-api';
	import { modelLabel } from '$lib/model-settings.svelte';

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
		onStartReview?: (() => Promise<void>) | null;
		paused?: boolean;
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
		/** Pipeline events (oldest first), shown while the review runs. */
		activity?: { message: string; agent?: string }[];
		/** Show the pull request's CI checks in the session bar. */
		showChecks?: boolean;
		/** The tracked repo, for its review guidelines. */
		repoId?: string | null;
		/** Owner guidelines this review ran with. */
		guidelines?: ReviewGuidelinesUsed | null;
		doneHref?: string | null;
	}
	let {
		reviewId, title, meta, assignments = [], messages = [], orchestratorModel,
		reasoning = [], toolCalls = [], active = true, failed = false,
		errorMessage = null, onStartReview = null, paused = false, connectionLost = false, onOpenDiff, onShowView = null, onOpenFinding = null, onRestart,
		onSend, onStop, restarting = false, now = Date.now(), fullscreen = false, stage = 0, tasks = [],
		planSummary = null, activity = [], showChecks = false, repoId = null, guidelines = null, stageLabel = 'Preparing review', coverage = null, coverageGaps = [],
		awaitingPrompt = false, completedAt, findings = []
	}: Props = $props();

	let drafts = $state<Record<string, string>>({});
	let restartOpen = $state(false);
	let metricsOpen = $state(false);

	async function togglePause(): Promise<void> {
		if (!reviewId) return;
		try {
			if (paused) await serverApi.resumeReview(reviewId);
			else await serverApi.pauseReview(reviewId);
		} catch (e) {
			errorToast(paused ? 'Could not resume the review' : 'Could not pause the review', e instanceof Error ? e.message : undefined);
		}
	}

	async function cancelReview(): Promise<void> {
		if (!reviewId) return;
		try {
			await serverApi.cancelReview(reviewId);
		} catch (e) {
			errorToast('Could not cancel the review', e instanceof Error ? e.message : undefined);
		}
	}
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
	/** Finalization at a glance, in the tool-row grid (label · value · meta). */
	const finalFacts = $derived.by(() => {
		const facts: { label: string; value: string; meta?: string; mono?: boolean; open?: () => void }[] = [];
		const candidateCount = specialists.reduce((sum, item) => sum + (item.candidateCount ?? 0), 0);
		if (candidateCount) facts.push({ label: 'Candidates', value: `${candidateCount} from ${specialists.length} ${specialists.length === 1 ? 'specialist' : 'specialists'}` });
		if (finished) facts.push({ label: 'Confirmed', value: `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}` });
		if (coverage) facts.push({ label: 'Coverage', value: `${coverage.reviewed} of ${coverage.total} changes${coverage.partial ? ` · ${coverage.partial} partial` : ''}` });
		if (guidelines?.layers.length) {
			const hasRepoLayer = guidelines.layers.some((layer) => layer.source === 'repo');
			const value = guidelines.layers.map((layer) => layer.source === 'global'
				? 'Global'
				: `${layer.path}${layer.ref ? ` @ ${layer.ref}` : ''}${layer.sha ? ` ${layer.sha.slice(0, 7)}` : ''}`).join(' + ');
			const target = hasRepoLayer && repoId ? { kind: 'repo' as const, repoId } : { kind: 'global' as const };
			facts.push({ label: 'Guidelines', value, open: () => guidelinesStore.open(target) });
		}
		if (finalization?.model) facts.push({ label: 'Model', value: modelLabel(finalization.model), mono: false, meta: finalization.elapsedMs !== undefined ? `${(finalization.elapsedMs / 1000).toFixed(1)}s` : undefined });
		return facts;
	});
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
	{#if repoId}{@const id = repoId}<DropdownMenu.Item callback={() => guidelinesStore.open({ kind: 'repo', repoId: id })}>Review guidelines</DropdownMenu.Item>{/if}
	{#if reviewId && active && !awaitingPrompt}
		<DropdownMenu.Item callback={() => void togglePause()}>{paused ? 'Resume review' : 'Pause review'}</DropdownMenu.Item>
		<DropdownMenu.Item callback={() => void cancelReview()}>Cancel review</DropdownMenu.Item>
	{/if}
	{#if onRestart}<DropdownMenu.Item disabled={restarting} callback={() => restartOpen = true}>{restarting ? 'Restarting…' : 'Restart review'}</DropdownMenu.Item>{/if}
	{#if reviewId}{@const id = reviewId}<DropdownMenu.Separator /><DropdownMenu.Item callback={() => void closeSessionTab(id)}>Close tab</DropdownMenu.Item><DropdownMenu.Item class="menu-danger" callback={() => requestDeleteSession(id)}>Delete session</DropdownMenu.Item>{/if}
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
							{#if assignment.model}<span class="specialist-model" title={assignment.model}>{modelLabel(assignment.model)}</span>{/if}
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
		<Disclosure>
			{#snippet label()}Created {specialists.length} {specialists.length === 1 ? 'specialist' : 'specialists'}{/snippet}
			{#if planSummary}<Markdown content={planSummary} />{/if}
			{#each specialists as assignment (assignment.id)}
				<Typography.Text><span class="text-fg-secondary">{formatAgentName(assignment.role)}:</span> {assignment.reason || assignment.title}</Typography.Text>
			{/each}
			{#if finished}{@render specialistRows()}{/if}
		</Disclosure>
		{#if !finished}{@render specialistRows()}{/if}
	</section>
{/snippet}

{#snippet progressContent()}
	<Disclosure status={active ? 'running' : failed ? 'error' : 'done'} bodyClass="finalize-body">
		{#snippet label()}{active ? footerLabel : failed ? 'Review incomplete' : `Finalized review${finalizationSeconds ? ` for ${finalizationSeconds}s` : ''}`}{/snippet}
		<ReasoningSteps entries={finalReasoning} live={active} />
		{#if finalFacts.length}
			<div class="fact-rows" aria-label="Finalization summary">
				{#each finalFacts as fact (fact.label)}
					<Typography.Text class="fact-row"><span class="fact-label">{fact.label}</span>{#if fact.open}<Button unstyled class="fact-value fact-link" title="Edit these guidelines" onclick={fact.open}>{fact.value}</Button>{:else}<span class="fact-value" class:font-mono={fact.mono}>{fact.value}</span>{/if}{#if fact.meta}<span class="fact-meta">{fact.meta}</span>{/if}</Typography.Text>
				{/each}
			</div>
		{/if}
	</Disclosure>
{/snippet}

{#snippet headerChecks()}
	{#if reviewId}<div class="findings-toolbar-end"><PrChecks {reviewId} /></div>{/if}
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
		menu={reviewId || onRestart || onOpenDiff || repoId ? sessionMenu : undefined}
		toolbar={showChecks && reviewId ? headerChecks : undefined}
	/>
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
	{#if errorMessage}
		<div class="mx-auto w-full max-w-[740px] px-6 pt-3">
			<Card.Root class="review-notice" {...{ role: 'alert' }}>
				<CircleAlert size={15} class="review-notice-icon" aria-hidden="true" />
				<div class="min-w-0 flex-1">
					<p class="review-notice-title">{failed ? stageLabel : 'Something went wrong'}</p>
					<p class="review-notice-body">{errorMessage}</p>
				</div>
				{#if failed && onRestart}
					<Button variant="outline" class="shrink-0" loading={restarting} onclick={() => (restartOpen = true)}>
						<RotateCcw size={13} aria-hidden="true" /> Retry
					</Button>
				{/if}
			</Card.Root>
		</div>
	{/if}
	<div class="flex min-h-0 flex-1">
		<div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
			{#each [selected] as target (target.id)}
				<ReviewConversation {onStartReview} assignment={target} {messages} reasoning={isOrchestrator ? chatReasoning : reasoning} {toolCalls} {active} {now}
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
		{#if showRail || (isOrchestrator && showSteps)}
			<ReviewResultsRail {findings} {specialists} {coverage} {coverageGaps} {onOpenFinding} specialistHref={conversationHref} results={showRail}>
				{#if showSteps}
					<ReviewSteps current={currentStep} {failed} {active} elapsed={meta.elapsed} {paused}
						onPauseToggle={reviewId && !awaitingPrompt ? togglePause : null} onCancel={reviewId && !awaitingPrompt ? cancelReview : null}
						specialists={{ done: specialists.filter((item) => ['done', 'skipped', 'error', 'partial'].includes(item.status)).length, total: specialists.length }} />
				{/if}
			</ReviewResultsRail>
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
