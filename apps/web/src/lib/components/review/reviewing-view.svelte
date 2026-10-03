<script lang="ts" module>
	export type { ReviewingFinding, ReviewingMeta } from '$lib/review/reviewing-view';
</script>

<script lang="ts">
	import { page } from '$app/state';
	import { ORCHESTRATOR_ID } from '@recoder/shared';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewMetricsModal from './review-metrics-modal.svelte';
	import ReviewConversation from './review-conversation.svelte';
	import ReviewResultsRail from './review-results-rail.svelte';
	import ReviewSteps from './review-steps.svelte';
	import ReviewSpecialists from './review-specialists.svelte';
	import ReviewFinalize from './review-finalize.svelte';
	import ReviewResultCard from './review-result-card.svelte';
	import ReviewIntroCard from './review-intro-card.svelte';
	import ReviewPreparingCard from './review-preparing-card.svelte';
	import ReviewSessionMenu from './review-session-menu.svelte';
	import RestartReviewDialog from './restart-review-dialog.svelte';
	import PlanApprovalCard from './plan-approval-card.svelte';
	import SpecialistNav from './specialist-nav.svelte';
	import PrChecks from '../home/pr-checks.svelte';
	import SessionHeader from '../session/session-header.svelte';
	import FailureNotice from './failure-notice.svelte';
	import { errorToast } from '$lib/shell/notify';
	import { PendingAction } from '$lib/shell/pending-action.svelte';
	import { serverApi } from '$lib/api/server-api';
	import { approvePlan, declinePlan, planApproval } from '$lib/review/plan-approval.svelte';
	import { conversationHref, type ReviewingViewProps } from '$lib/review/reviewing-view';
	import { ReviewingState } from '$lib/review/reviewing-state.svelte';

	let {
		reviewId,
		title,
		meta,
		assignments = [],
		messages = [],
		orchestratorModel,
		reasoning = [],
		toolCalls = [],
		active = true,
		failed = false,
		errorMessage = null,
		failure = null,
		onStartReview = null,
		paused = false,
		approval = null,
		connectionLost = false,
		onOpenDiff,
		onShowView = null,
		onOpenFinding = null,
		onRestart,
		onContinue = null,
		onSend,
		onStop,
		restarting = false,
		now = Date.now(),
		fullscreen = false,
		embedded = false,
		draft = $bindable(''),
		codeContext = $bindable(null),
		focusKey,
		stage = 0,
		tasks = [],
		planSummary = null,
		showChecks = false,
		repoId = null,
		guidelines = null,
		stageLabel = 'Preparing review',
		stageDetail,
		coverage = null,
		coverageGaps = [],
		awaitingPrompt = false,
		completedAt,
		findings = []
	}: ReviewingViewProps = $props();

	let drafts = $state<Record<string, string>>({});
	const continueRun = new PendingAction(() => onContinue);
	let restartOpen = $state(false);
	let metricsOpen = $state(false);

	/** The drawer keeps its own place; the conversation page keeps it in the URL. */
	let embeddedAgent = $state<string | null>(null);

	const view = new ReviewingState({
		get assignments() {
			return assignments;
		},
		get messages() {
			return messages;
		},
		get reasoning() {
			return reasoning;
		},
		get tasks() {
			return tasks;
		},
		get orchestratorModel() {
			return orchestratorModel;
		},
		get active() {
			return active;
		},
		get failed() {
			return failed;
		},
		get awaitingPrompt() {
			return awaitingPrompt;
		},
		get paused() {
			return paused;
		},
		get approval() {
			return approval;
		},
		get stage() {
			return stage;
		},
		get stageLabel() {
			return stageLabel;
		},
		get stageDetail() {
			return stageDetail;
		}
	});

	const approving = $derived(reviewId !== null && planApproval.approving === reviewId);

	const selected = $derived(
		view.specialists.find(
			(assignment) => assignment.id === (embedded ? embeddedAgent : page.url.searchParams.get('agent'))
		) ?? view.orchestrator
	);

	const isOrchestrator = $derived(selected.id === ORCHESTRATOR_ID);

	const showRail = $derived(
		isOrchestrator && !active && !awaitingPrompt && (findings.length > 0 || view.specialists.length > 0)
	);

	const inserts = $derived(
		isOrchestrator
			? [
					...(view.specialists.length
						? [{ key: 'specialists', at: view.specialistsAt, snippet: specialistsContent }]
						: []),
					...(approval?.status === 'pending' && active
						? [{ key: 'approval', at: undefined, snippet: approvalCard }]
						: []),
					...(!awaitingPrompt && view.showProgress
						? [
								{
									key: 'progress',
									at: active ? undefined : (view.finalization?.startedAt ?? completedAt),
									snippet: progressContent
								}
							]
						: []),
					...(view.finished ? [{ key: 'result', at: completedAt, snippet: resultCard }] : []),
					...(view.preparing ? [{ key: 'preparing', at: undefined, snippet: preparingCard }] : [])
				]
			: []
	);

	async function togglePause(): Promise<void> {
		if (!reviewId) return;

		try {
			if (paused) await serverApi.resumeReview(reviewId);
			else await serverApi.pauseReview(reviewId);
		} catch (e) {
			errorToast(
				paused ? 'Could not resume the review' : 'Could not pause the review',
				e instanceof Error ? e.message : undefined
			);
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

	/** Link props that open a conversation: a URL on the page, in place in the drawer. */
	function openProps(assignmentId: string): { href?: string; onclick?: () => void } {
		return embedded
			? {
					onclick: () => {
						embeddedAgent = assignmentId === ORCHESTRATOR_ID ? null : assignmentId;
					}
				}
			: { href: conversationHref(page.url, assignmentId) };
	}
</script>

{#snippet sessionMenu()}
	<ReviewSessionMenu
		{reviewId}
		{repoId}
		{active}
		{awaitingPrompt}
		{paused}
		{restarting}
		{onOpenDiff}
		onRestart={onRestart ? () => (restartOpen = true) : null}
		onMetrics={() => (metricsOpen = true)}
		onTogglePause={() => void togglePause()}
		onCancel={() => void cancelReview()}
	/>
{/snippet}

{#snippet approvalCard()}
	{#if approval}<PlanApprovalCard {reviewId} {approving} />{/if}
{/snippet}

{#snippet specialistsContent()}
	<ReviewSpecialists specialists={view.specialists} {planSummary} finished={view.finished} {active} {openProps} />
{/snippet}

{#snippet progressContent()}
	<ReviewFinalize
		{active}
		{failed}
		footerLabel={view.progressLabel}
		verifying={view.verifying}
		verifications={view.verifications}
		{reasoning}
		finalReasoning={view.finalReasoning}
		finalization={view.finalization}
		specialists={view.specialists}
		finished={view.finished}
		findingCount={findings.length}
		{coverage}
		{guidelines}
		{repoId}
		{now}
		continuing={continueRun.running}
		onContinue={onContinue ? () => void continueRun.run() : null}
	/>
{/snippet}

{#snippet reviewIntro()}
	<ReviewIntroCard {meta} {onStartReview} {onOpenDiff} />
{/snippet}

{#snippet preparingCard()}
	<ReviewPreparingCard {meta} {stage} {stageDetail} setupMessage={view.setupTask?.message} />
{/snippet}

{#snippet headerChecks()}
	{#if reviewId}<div class="findings-toolbar-end"><PrChecks {reviewId} /></div>{/if}
{/snippet}

{#snippet resultCard()}
	<ReviewResultCard {findings} {meta} failedSpecialists={view.failedSpecialists} {onShowView} {onOpenDiff} />
{/snippet}

<div
	class="review-workspace flex min-h-0 flex-col {fullscreen || embedded ? 'h-full' : 'h-[min(56rem,85dvh)]'}"
	data-embedded={embedded || undefined}
>
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
			onView={active
				? null
				: (view) => {
						if (view !== 'conversation') return onShowView ? onShowView(view) : onOpenDiff?.();
					}}
			diffDisabled={!onOpenDiff}
			menu={reviewId || onRestart || onOpenDiff || repoId ? sessionMenu : undefined}
			toolbar={showChecks && reviewId ? headerChecks : undefined}
		/>
	{/if}
	{#if !isOrchestrator}<SpecialistNav assignment={selected} {active} {embedded} {openProps} />{/if}
	{#if connectionLost}<Typography.Text
			role="status"
			class="mx-auto w-full max-w-[740px] {embedded ? 'px-4' : 'px-6'} py-2 text-sm text-sev-medium"
			>Reconnecting… Your conversation is saved.</Typography.Text
		>{/if}
	{#if errorMessage || (failed && failure)}
		<div class="mx-auto w-full max-w-[740px] {embedded ? 'px-4' : 'px-6'} pt-3">
			<FailureNotice
				title={failed ? stageLabel : 'Something went wrong'}
				reason={errorMessage ?? failure?.reason ?? ''}
				signIn={!errorMessage && failure?.signIn}
				usageLimit={errorMessage ? null : failure?.usageLimit}
				onRetry={failed && onContinue
					? () => void continueRun.run()
					: failed && onRestart
						? () => (restartOpen = true)
						: null}
				retrying={continueRun.running || restarting}
			/>
		</div>
	{/if}
	<div class="flex min-h-0 flex-1">
		<div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
			{#each [selected] as target (target.id)}
				<ReviewConversation
					compact={embedded}
					{focusKey}
					{onStartReview}
					intro={isOrchestrator && view.showIntro ? reviewIntro : undefined}
					signInShown={failed && !errorMessage && !!failure?.signIn}
					assignment={target}
					{messages}
					reasoning={isOrchestrator ? view.chatReasoning : reasoning}
					{toolCalls}
					{active}
					{now}
					awaitingPrompt={isOrchestrator && awaitingPrompt}
					tasks={tasks.filter((task) => (task.assignmentId ?? ORCHESTRATOR_ID) === target.id)}
					bind:draft={
						() => (target.id === ORCHESTRATOR_ID ? draft : (drafts[target.id] ?? '')),
						(value) => {
							if (target.id === ORCHESTRATOR_ID) draft = value;
							else drafts[target.id] = value;
						}
					}
					bind:codeContext
					{onSend}
					{onStop}
					onStopReview={isOrchestrator && active && reviewId && !awaitingPrompt && !paused ? cancelReview : null}
					placeholder={!isOrchestrator
						? undefined
						: awaitingPrompt
							? undefined
							: active
								? 'Ask Orchestrator anything…'
								: 'Ask a follow-up about this review…'}
					{inserts}
				/>
			{/each}
		</div>
		{#if !embedded && (showRail || (isOrchestrator && view.showSteps))}
			<ReviewResultsRail
				{findings}
				specialists={view.specialists}
				{coverage}
				{coverageGaps}
				{onOpenFinding}
				specialistHref={(assignmentId) => conversationHref(page.url, assignmentId)}
				results={showRail}
			>
				{#if view.showSteps}
					<ReviewSteps
						current={view.currentStep}
						{failed}
						{active}
						elapsed={meta.elapsed}
						{paused}
						onPauseToggle={reviewId && !awaitingPrompt ? togglePause : null}
						onCancel={reviewId && !awaitingPrompt ? cancelReview : null}
						approval={view.awaitingApproval ? approval : null}
						onApprove={reviewId ? () => approvePlan(reviewId) : null}
						onDecline={reviewId ? () => declinePlan(reviewId) : null}
						{approving}
						specialists={{
							done: view.specialists.filter((item) => item.status === 'done').length,
							failed: view.failedSpecialists,
							total: view.specialists.length
						}}
					/>
				{/if}
			</ReviewResultsRail>
		{/if}
	</div>
</div>

{#if reviewId}<ReviewMetricsModal {reviewId} bind:open={metricsOpen} showTrigger={false} />{/if}
<RestartReviewDialog bind:open={restartOpen} {onRestart} />
