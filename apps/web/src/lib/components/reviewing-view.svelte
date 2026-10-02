<script lang="ts" module>
	import type { CoverageGap, CoverageSummary, ModelFailure, ReviewAssignment, ReviewGuidelinesUsed, ReviewPlanApproval, ReviewChatMessage, ReviewCodeContext, ReviewReasoningEntry, ReviewTask, ReviewToolCall, RoleDecision } from '@recoder/shared';
	export interface ReviewingFinding {
		id: string;
		agent: string | null;
		severity: 'high' | 'medium' | 'low';
		title: string;
		location: string | null;
		file?: string;
		line?: number | null;
		confirmed?: boolean;
	}
	export interface ReviewingMeta {
		prLabel: string;
		/** The pull request on its host; the PR number links to it. */
		prUrl?: string | null;
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
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Play from '@lucide/svelte/icons/play';
	import ScanSearch from '@lucide/svelte/icons/scan-search';
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import * as DropdownMenu from '@sivir-ui/svelte/components/dropdown-menu';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import ModelMarkdown from './model-markdown.svelte';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewMetricsModal from './review-metrics-modal.svelte';
	import ReviewConversation from './review-conversation.svelte';
	import ReviewResultsRail from './review-results-rail.svelte';
	import ReviewSteps from './review-steps.svelte';
	import Disclosure from './ui/disclosure.svelte';
	import ReasoningSteps from './reasoning-steps.svelte';
	import PrChecks from './pr-checks.svelte';
	import ChangesButton from './changes-button.svelte';
	import SessionHeader from './session-header.svelte';
	import FindingSeverity from './finding-severity.svelte';
	import FailureNotice from './failure-notice.svelte';
	import { closeSessionTab } from '$lib/session-tabs';
	import { requestDeleteSession } from '$lib/delete-session.svelte';
	import { formatAgentName } from '$lib/threads.svelte';
	import { groupProgress, groupSpecialists } from '$lib/specialist-groups';
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
		/** Why a failed review stopped, when a model call caused it. */
		failure?: ModelFailure | null;
		onStartReview?: (() => Promise<void>) | null;
		paused?: boolean;
		/** A plan waiting for the developer to approve more specialists. */
		approval?: ReviewPlanApproval | null;
		connectionLost?: boolean;
		onOpenDiff: (() => void) | null;
		/** Switch to the Findings or Diff workspace. Falls back to `onOpenDiff`. */
		onShowView?: ((view: 'findings' | 'diff') => void | Promise<void>) | null;
		onOpenFinding?: ((finding: ReviewingFinding) => void) | null;
		onRestart: (() => void) | null;
		/** Continue a failed review from where it stopped. */
		onContinue?: (() => Promise<void>) | null;
		onSend?: (assignmentId: string, text: string, codeContext?: ReviewCodeContext) => Promise<void>;
		onStop?: (assignmentId: string) => Promise<void>;
		restarting?: boolean;
		now?: number;
		fullscreen?: boolean;
		/**
		 * The same conversation inside the diff page's Ask reviewer drawer: no
		 * session header or results rail, specialists open in place.
		 */
		embedded?: boolean;
		/** Orchestrator composer text and attached code (the drawer shares them with the diff). */
		draft?: string;
		codeContext?: ReviewCodeContext | null;
		/** Bumped to focus the composer. */
		focusKey?: number;
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
		errorMessage = null, failure = null, onStartReview = null, paused = false, approval = null, connectionLost = false, onOpenDiff, onShowView = null, onOpenFinding = null, onRestart, onContinue = null,
		onSend, onStop, restarting = false, now = Date.now(), fullscreen = false,
		embedded = false, draft = $bindable(''), codeContext = $bindable(null), focusKey, stage = 0, tasks = [],
		planSummary = null, activity = [], showChecks = false, repoId = null, guidelines = null, stageLabel = 'Preparing review', stageDetail, coverage = null, coverageGaps = [],
		awaitingPrompt = false, completedAt, findings = []
	}: Props = $props();

	let drafts = $state<Record<string, string>>({});
	/** A new session opens on a card with Run full review until the developer says something. */
	const showIntro = $derived(awaitingPrompt && !messages.some((message) => (message.assignmentId ?? ORCHESTRATOR_ID) === ORCHESTRATOR_ID && message.from === 'user'));
	let introStarting = $state(false);
	async function startFromIntro(): Promise<void> {
		if (!onStartReview || introStarting) return;
		introStarting = true;
		try { await onStartReview(); } finally { introStarting = false; }
	}
	let continuing = $state(false);
	async function continueRun(): Promise<void> {
		if (!onContinue || continuing) return;
		continuing = true;
		try { await onContinue(); } finally { continuing = false; }
	}
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
	const specialistGroups = $derived(groupSpecialists(specialists));
	/** Specialists that ended without a result, a retried one counted by its retry (the server's summary counts the same way). */
	const failedSpecialists = $derived(specialists.filter((item) => item.status === 'error' && !specialists.some((other) => other.id !== item.id && other.id.startsWith(`retry-${item.id}`))).length);
	let approving = $state<'all' | 'limited' | null>(null);
	async function approvePlan(choice: 'all' | 'limited'): Promise<void> {
		if (!reviewId || approving) return;
		approving = choice;
		try {
			await serverApi.approvePlan(reviewId, choice);
		} catch (e) {
			errorToast('Could not start the specialists', e instanceof Error ? e.message : undefined);
		} finally {
			approving = null;
		}
	}
	const orchestrator = $derived<ReviewAssignment>({
		id: ORCHESTRATOR_ID, role: 'orchestrator', title: 'Orchestrator', reason: '', scope: [],
		status: awaitingPrompt ? 'waiting' : active ? 'running' : failed ? 'error' : 'done',
		model: orchestratorModel ?? assignments.find((item) => item.id === ORCHESTRATOR_ID)?.model ??
			messages.findLast((item) => item.assignmentId === ORCHESTRATOR_ID && item.model)?.model ??
			reasoning.findLast((item) => (!item.assignmentId || item.assignmentId === ORCHESTRATOR_ID) && item.model)?.model
	});
	/** The drawer keeps its own place; the conversation page keeps it in the URL. */
	let embeddedAgent = $state<string | null>(null);
	const selected = $derived(specialists.find((assignment) => assignment.id === (embedded ? embeddedAgent : page.url.searchParams.get('agent'))) ?? orchestrator);
	const isOrchestrator = $derived(selected.id === ORCHESTRATOR_ID);
	const finished = $derived(!active && !failed && !awaitingPrompt);
	const showSteps = $derived(!awaitingPrompt && (active || failed));
	const showRail = $derived(isOrchestrator && !active && !awaitingPrompt && (findings.length > 0 || specialists.length > 0));

	/** URL-backed chats support browser history, reloads, and opening in a new tab. */
	/** Link props that open a conversation: a URL on the page, in place in the drawer. */
	function openProps(assignmentId: string): { href?: string; onclick?: () => void } {
		return embedded ? { onclick: () => { embeddedAgent = assignmentId === ORCHESTRATOR_ID ? null : assignmentId; } } : { href: conversationHref(assignmentId) };
	}
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
	const findingCounts = $derived((['high', 'medium', 'low'] as const)
		.map((severity) => ({ severity, count: findings.filter((finding) => finding.severity === severity).length }))
		.filter((item) => item.count > 0));
	const currentStep = $derived(!active && !failed ? 6 : Math.min(stage, 5));

	/** "correctness and performance", "security, docs and 2 more". */
	function nameList(items: ReviewAssignment[]): string {
		const names = groupSpecialists(items).map((group) => `${formatAgentName(group.role).toLowerCase()}${group.items.length > 1 ? ` ×${group.items.length}` : ''}`);
		if (names.length <= 1) return names[0] ?? '';
		if (names.length <= 3) return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
		return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
	}
	/** Early stages (checkout, inventory, planning) have nothing to open, and the live thinking and tool rows already show the work. */
	/** Nothing runs until the developer answers the approval card, so no "Waiting on …" loader yet. */
	const awaitingApproval = $derived(active && approval?.status === 'pending');
	const showProgress = $derived(!awaitingApproval && (!active || running.length > 0 || !!finalization));
	/** Checkout and dependency install have no transcript of their own; until the orchestrator speaks, a loading card stands in. */
	const setupTask = $derived(tasks.find((task) => task.id === 'setup' && task.status === 'running'));
	const orchestratorSpoke = $derived(messages.some((message) => (message.assignmentId ?? ORCHESTRATOR_ID) === ORCHESTRATOR_ID && message.from === 'assistant')
		|| reasoning.some((entry) => entry.assignmentId === ORCHESTRATOR_ID));
	const preparing = $derived(isOrchestrator && active && !awaitingPrompt && !failed && (stage === 0 || (!!setupTask && !orchestratorSpoke)));
	const progressHasBody = $derived(finalReasoning.length > 0 || finalFacts.length > 0);
	/** Specialists a model is actually working for; queued ones are waiting on the stage before them. */
	const working = $derived(specialists.filter((item) => item.status === 'running' || item.status === 'waiting'));
	/** Before the specialist stage, name the stage (installing, running checks), not the specialists waiting for it. */
	const footerLabel = $derived(paused ? 'Paused'
		: stage < 3 ? [stageLabel, stageDetail].filter(Boolean).join(' · ')
		: working.length ? `Waiting on ${nameList(working)}`
		: running.length ? `${running.length} ${running.length === 1 ? 'specialist' : 'specialists'} queued`
		: stageLabel);

	function statusFor(assignment: ReviewAssignment): { label: string; tone: string } {
		switch (assignment.status) {
			case 'running': return active ? { label: 'Reviewing', tone: 'running' } : { label: 'Failed', tone: 'danger' };
			case 'waiting': return { label: 'Waiting', tone: 'idle' };
			case 'queued': return { label: 'Queued', tone: 'idle' };
			case 'done': return { label: 'Finished', tone: 'success' };
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
	<!-- One row per role; a role with several parts (a large PR's correctness sweep) opens to them. -->
	<ul class="specialist-list" aria-label="Specialists">
		{#each specialistGroups as group (group.role)}
			{#if group.items.length === 1}
				{@render specialistRow(group.items[0], formatAgentName(group.role))}
			{:else}
				{@const status = statusFor({ ...group.items[0], status: group.status })}
				<li>
					<Collapsible.Root>
						<Collapsible.Trigger class="specialist-row specialist-group-row" aria-label={`${formatAgentName(group.role)}: ${group.items.length} specialists`}>
							<span class="specialist-main">
								<span class="specialist-name-line">
									<span class="specialist-name">{formatAgentName(group.role)}</span>
									<span class="specialist-count">×{group.items.length}</span>
									{#if group.items[0].model}<span class="specialist-model" title={group.items[0].model}>{modelLabel(group.items[0].model)}</span>{/if}
								</span>
								<span class="specialist-op">{groupProgress(group)}</span>
							</span>
							<Badge variant="secondary" class="status-chip" data-tone={status.tone}>
								{#if group.status === 'running' && active}<Spinner size={12} aria-hidden="true" />{/if}
								{status.label}
							</Badge>
							<ChevronRight size={16} class="specialist-chevron" aria-hidden="true" />
						</Collapsible.Trigger>
						<Collapsible.Content>
							<ul class="specialist-list specialist-parts" aria-label={`${formatAgentName(group.role)} parts`}>
								{#each group.items as assignment (assignment.id)}
									{@render specialistRow(assignment, assignment.title)}
								{/each}
							</ul>
						</Collapsible.Content>
					</Collapsible.Root>
				</li>
			{/if}
		{/each}
	</ul>
{/snippet}

{#snippet specialistRow(assignment: ReviewAssignment, name: string)}
	{@const status = statusFor(assignment)}
	<li>
		<Button {...openProps(assignment.id)} variant="ghost" class="specialist-row" aria-label={`Open ${formatAgentName(assignment.role)} conversation`}>
			<span class="specialist-main">
				<span class="specialist-name-line">
					<span class="specialist-name">{name}</span>
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
{/snippet}

{#snippet approvalCard()}
	{#if approval}
		<Card.Root class="review-approval">
			<div class="review-approval-text">
				<Typography.Text class="review-approval-title">Run {approval.requested} specialists?</Typography.Text>
				<Typography.Metadata class="review-approval-meta">Reading every changed hunk takes {approval.requested}. Up to {approval.limit} run without asking; the rest of the changes would be marked not reviewed.</Typography.Metadata>
			</div>
			<div class="review-approval-actions">
				<Button variant="outline" loading={approving === 'limited'} disabled={approving !== null} onclick={() => void approvePlan('limited')}>Run {approval.limit}</Button>
				<Button loading={approving === 'all'} disabled={approving !== null} onclick={() => void approvePlan('all')}>Run all {approval.requested}</Button>
			</div>
		</Card.Root>
	{/if}
{/snippet}

{#snippet specialistsContent()}
	<section class="specialists" aria-label="Specialists">
		<Disclosure>
			{#snippet label()}Created {specialists.length} {specialists.length === 1 ? 'specialist' : 'specialists'}{/snippet}
			{#if planSummary}<ModelMarkdown content={planSummary} />{/if}
			{#each specialistGroups as group (group.role)}
				<Typography.Text><span class="text-fg-secondary">{formatAgentName(group.role)}{group.items.length > 1 ? ` ×${group.items.length}` : ''}:</span> {group.items[0].reason || group.items[0].title}</Typography.Text>
			{/each}
			{#if finished}{@render specialistRows()}{/if}
		</Disclosure>
		{#if !finished}{@render specialistRows()}{/if}
	</section>
{/snippet}

{#snippet progressContent()}
	<Disclosure status={active ? 'running' : failed ? 'error' : 'done'} bodyClass="finalize-body" children={progressHasBody ? progressBody : undefined}>
		{#snippet label()}{active ? footerLabel : failed ? 'Review failed' : `Finalized review${finalizationSeconds ? ` for ${finalizationSeconds}s` : ''}`}{/snippet}
	</Disclosure>
	{#if failed && !active && onContinue}
		<div class="review-start-cta">
			<Button class="brief-action" loading={continuing} onclick={() => void continueRun()}>
				<Play size={12} fill="currentColor" aria-hidden="true" /> Continue review
			</Button>
		</div>
	{/if}
{/snippet}

{#snippet progressBody()}
		<ReasoningSteps entries={finalReasoning} live={active} />
		{#if finalFacts.length}
			<div class="fact-rows" aria-label="Finalization summary">
				{#each finalFacts as fact (fact.label)}
					<Typography.Text class="fact-row"><span class="fact-label">{fact.label}</span>{#if fact.open}<Button unstyled class="fact-value fact-link" title="Edit these guidelines" onclick={fact.open}>{fact.value}</Button>{:else}<span class="fact-value" class:font-mono={fact.mono}>{fact.value}</span>{/if}{#if fact.meta}<span class="fact-meta">{fact.meta}</span>{/if}</Typography.Text>
				{/each}
			</div>
		{/if}
{/snippet}

{#snippet reviewIntro()}
	<div class="focus-empty review-intro">
		<div class="focus-empty-card">
			<span class="focus-empty-icon" aria-hidden="true"><ScanSearch size={20} /></span>
			<Typography.Title level={2} class="focus-empty-title">Nothing reviewed yet</Typography.Title>
			<p class="focus-empty-text">Ask about any change, or run the full review and specialists will check every file.</p>
			<div class="focus-empty-facts">
				{#if meta.files !== null}<span><b>{meta.files}</b> {meta.files === 1 ? 'file' : 'files'}</span>{/if}
				{#if meta.additions !== null && meta.deletions !== null}<span><b class="text-success">+{meta.additions}</b> <b class="text-danger">−{meta.deletions}</b></span>{/if}
			</div>
			<div class="focus-empty-actions">
				{#if onStartReview}<Button variant="primary" loading={introStarting} disabled={introStarting} onclick={() => void startFromIntro()}>Run full review</Button>{/if}
				{#if onOpenDiff}<Button variant="ghost" onclick={onOpenDiff}>Open diff</Button>{/if}
			</div>
		</div>
	</div>
{/snippet}

{#snippet preparingCard()}
	<div class="focus-empty review-preparing" data-kind="running" role="status">
		<div class="focus-empty-card">
			<span class="focus-empty-icon" aria-hidden="true"><Spinner size={18} /></span>
			<Typography.Title level={2} class="focus-empty-title">{stage === 0 ? 'Checking out the pull request' : 'Setting up the environment'}</Typography.Title>
			<p class="focus-empty-text">{(stage === 0 ? stageDetail : setupTask?.message) || (stage === 0 ? 'Fetching the branch and preparing an isolated checkout.' : 'Installing dependencies so reviewers can run code.')}</p>
			<div class="focus-empty-facts">
				{#if meta.files !== null}<span><b>{meta.files}</b> {meta.files === 1 ? 'file' : 'files'}</span>{/if}
				{#if meta.additions !== null && meta.deletions !== null}<span><b class="text-success">+{meta.additions}</b> <b class="text-danger">−{meta.deletions}</b></span>{/if}
			</div>
		</div>
		<div class="focus-empty-ghosts" data-shimmer aria-hidden="true">
			{#each [0, 1, 2] as i (i)}
				<div class="focus-empty-ghost" style="--i: {i}">
					<span class="focus-empty-ghost-line" style="width: {[34, 28, 40][i]}%"></span>
					<span class="focus-empty-ghost-line is-faint" style="width: {[86, 64, 78][i]}%"></span>
				</div>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet headerChecks()}
	{#if reviewId}<div class="findings-toolbar-end"><PrChecks {reviewId} /><ChangesButton /></div>{/if}
{/snippet}

{#snippet resultCard()}
	<Card.Root class="review-result">
		<span class="review-result-mark" data-warn={failedSpecialists > 0 || undefined} aria-hidden="true">{#if failedSpecialists}<CircleAlert size={14} strokeWidth={2.25} />{:else}<Check size={14} strokeWidth={2.25} />{/if}</span>
		<div class="review-result-text">
			<Typography.Text class="review-result-title">Review finished</Typography.Text>
			<Typography.Metadata class="review-result-meta">{findings.length ? `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}` : 'No findings'}{meta.elapsed ? ` · ${meta.elapsed}` : ''}{meta.files !== null ? ` · ${meta.files} ${meta.files === 1 ? 'file' : 'files'}` : ''}{#if failedSpecialists}{' · '}<span class="review-result-failed">{failedSpecialists} {failedSpecialists === 1 ? 'specialist' : 'specialists'} failed</span>{/if}</Typography.Metadata>
			{#if findingCounts.length}
				<div class="review-result-pills" aria-label="Findings by severity">
					{#each findingCounts as item (item.severity)}<FindingSeverity severity={item.severity} count={item.count} />{/each}
				</div>
			{/if}
		</div>
		<!-- Findings is the review's main page; the diff is one click from there. -->
		<Button onclick={onShowView ? () => void onShowView('findings') : onOpenDiff ?? undefined} disabled={!onShowView && !onOpenDiff} class="shrink-0 gap-2">Open findings <ArrowUpRight size={14} aria-hidden="true" /></Button>
	</Card.Root>
{/snippet}

<div class="review-workspace flex min-h-0 flex-col {fullscreen || embedded ? 'h-full' : 'h-[min(56rem,85dvh)]'}" data-embedded={embedded || undefined}>
	{#if !embedded}
	<SessionHeader
		{title}
		branch={meta.branch}
		repo={meta.repo}
		prLabel={meta.prLabel}
		prUrl={meta.prUrl}
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
	{/if}
	{#if !isOrchestrator}
		{@const status = statusFor(selected)}
		<nav aria-label="Specialist conversation" class="agent-nav mx-auto flex w-full max-w-[740px] shrink-0 items-center {embedded ? 'px-3' : 'px-6'} pt-3">
			<Button {...openProps(ORCHESTRATOR_ID)} variant="ghost" size="icon" class="shrink-0" aria-label="Back to Orchestrator" title="Back to Orchestrator">
				<ArrowLeft size={15} aria-hidden="true" />
			</Button>
			<Typography.Title level={2} class="agent-name min-w-0 truncate">{formatAgentName(selected.role)}</Typography.Title>
			<Typography.Metadata class="agent-status ms-auto shrink-0" data-tone={status.tone}>
				{#if selected.status === 'running' && active}<Spinner size={12} aria-hidden="true" />{/if}
				{status.label}
			</Typography.Metadata>
		</nav>
	{/if}
	{#if connectionLost}<Typography.Text role="status" class="mx-auto w-full max-w-[740px] {embedded ? 'px-4' : 'px-6'} py-2 text-sm text-sev-medium">Reconnecting… Your conversation is saved.</Typography.Text>{/if}
	{#if errorMessage || (failed && failure)}
		<div class="mx-auto w-full max-w-[740px] {embedded ? 'px-4' : 'px-6'} pt-3">
			<FailureNotice title={failed ? stageLabel : 'Something went wrong'} reason={errorMessage ?? failure?.reason ?? ''}
				signIn={!errorMessage && failure?.signIn} usageLimit={errorMessage ? null : failure?.usageLimit} onRetry={failed && onContinue ? () => void continueRun() : failed && onRestart ? () => (restartOpen = true) : null} retrying={continuing || restarting} />
		</div>
	{/if}
	<div class="flex min-h-0 flex-1">
		<div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
			{#each [selected] as target (target.id)}
				<ReviewConversation compact={embedded} {focusKey} {onStartReview} intro={isOrchestrator && showIntro ? reviewIntro : undefined} signInShown={failed && !errorMessage && !!failure?.signIn} assignment={target} {messages} reasoning={isOrchestrator ? chatReasoning : reasoning} {toolCalls} {active} {now}
					awaitingPrompt={isOrchestrator && awaitingPrompt}
					tasks={tasks.filter((task) => (task.assignmentId ?? ORCHESTRATOR_ID) === target.id)}
					bind:draft={() => target.id === ORCHESTRATOR_ID ? draft : drafts[target.id] ?? '', (value) => { if (target.id === ORCHESTRATOR_ID) draft = value; else drafts[target.id] = value; }}
					bind:codeContext {onSend} {onStop}
					onStopReview={isOrchestrator && active && reviewId && !awaitingPrompt && !paused ? cancelReview : null}
					placeholder={!isOrchestrator ? undefined : awaitingPrompt ? undefined : active ? 'Ask Orchestrator anything…' : 'Ask a follow-up about this review…'}
					inserts={isOrchestrator ? [
						...(specialists.length ? [{ key: 'specialists', at: specialistsAt, snippet: specialistsContent }] : []),
						...(approval?.status === 'pending' && active ? [{ key: 'approval', at: undefined, snippet: approvalCard }] : []),
						...(!awaitingPrompt && showProgress ? [{ key: 'progress', at: active ? undefined : finalization?.startedAt ?? completedAt, snippet: progressContent }] : []),
						...(finished ? [{ key: 'result', at: completedAt, snippet: resultCard }] : []),
						...(preparing ? [{ key: 'preparing', at: undefined, snippet: preparingCard }] : [])
					] : []} />
			{/each}
		</div>
		{#if !embedded && (showRail || (isOrchestrator && showSteps))}
			<ReviewResultsRail {findings} {specialists} {coverage} {coverageGaps} {onOpenFinding} specialistHref={conversationHref} results={showRail}>
				{#if showSteps}
					<ReviewSteps current={currentStep} {failed} {active} elapsed={meta.elapsed} {paused}
						onPauseToggle={reviewId && !awaitingPrompt ? togglePause : null} onCancel={reviewId && !awaitingPrompt ? cancelReview : null}
						approval={awaitingApproval ? approval : null} onApprove={reviewId ? approvePlan : null} {approving}
						specialists={{ done: specialists.filter((item) => item.status === 'done').length, failed: failedSpecialists, total: specialists.length }} />
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
