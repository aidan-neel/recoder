<script lang="ts">
	import type { ReviewStream } from '$lib/review/review-stream.svelte';
	import type { Review, ReviewAssignment, ReviewCodeContext } from '@recoder/shared';
	import ReviewingView, { type ReviewingFinding } from './reviewing-view.svelte';
	import { serverApi } from '$lib/api/server-api';
	import { recentSessions } from '$lib/session/recent-sessions.svelte';
	import { mapBackendFinding } from '$lib/findings/findings.svelte';
	import { reviewStage } from '$lib/review/review-progress-state';

	interface Props {
		review: Review;
		stream: ReviewStream;
		repo: string;
		files?: number | null;
		additions?: number | null;
		deletions?: number | null;
		onOpenDiff?: (() => void) | null;
		onShowView?: ((view: 'findings' | 'diff') => void | Promise<void>) | null;
		onOpenFinding?: ((finding: ReviewingFinding) => void) | null;
		onRestart?: (() => void) | null;
		onStartReview?: (() => Promise<void>) | null;
		/** Continue a failed review from where it stopped. */
		onContinue?: (() => Promise<void>) | null;
		actionError?: string | null;
		restarting?: boolean;
		/** Render inside the diff page's Ask reviewer drawer. */
		embedded?: boolean;
		draft?: string;
		codeContext?: ReviewCodeContext | null;
		focusKey?: number;
	}
	let {
		review,
		stream,
		repo,
		files = null,
		additions = null,
		deletions = null,
		onOpenDiff = null,
		onShowView = null,
		onOpenFinding = null,
		onRestart = null,
		onStartReview = null,
		onContinue = null,
		actionError = null,
		restarting = false,
		embedded = false,
		draft = $bindable(''),
		codeContext = $bindable(null),
		focusKey
	}: Props = $props();
	const progress = $derived(stream.progress);
	const connection = $derived(stream.connection);
	let now = $state(Date.now());
	const reviewId = $derived(review.id);

	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 1000);

		return () => clearInterval(timer);
	});
	const status = $derived(review.status);
	const awaitingPrompt = $derived(status === 'draft');
	const active = $derived(status === 'queued' || status === 'running');
	const elapsed = $derived(
		awaitingPrompt
			? '0:00'
			: formatDuration((active ? now : Date.parse(review.updatedAt)) - Date.parse(review.startedAt ?? review.createdAt))
	);
	function formatDuration(ms: number): string {
		const seconds = Math.max(0, Math.floor(ms / 1000));

		return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
	}
	/**
	 * One entry per id, latest wins: reviews saved before follow-up ids were made unique can repeat one.
	 * Reviews saved before every reviewer had to finish can carry a `partial` status, which meant finished.
	 */
	const assignments = $derived<ReviewAssignment[]>([
		...new Map(
			(progress.assignments ?? []).map((assignment) => [
				assignment.id,
				(assignment.status as string) === 'partial' ? { ...assignment, status: 'done' as const } : assignment
			])
		).values()
	]);
	/** Planner/consolidation events are review-level, never another correctness assignment. */
	const pipelineId = '__pipeline';
	const confirmed = $derived(status === 'passed');
	const viewFindings = $derived<ReviewingFinding[]>(
		!active
			? review.findings.map((finding, i) => ({
					id: 'F-' + String(i + 1).padStart(2, '0'),
					agent: finding.agent ?? null,
					severity: finding.severity === 'error' ? 'high' : finding.severity === 'warning' ? 'medium' : 'low',
					title: mapBackendFinding(finding, i).title || finding.file,
					location: finding.file + (finding.line ? ':' + finding.line : ''),
					file: finding.file,
					line: finding.line ?? null,
					confirmed
				}))
			: []
	);
	/** Indexes match the steps in review-steps.svelte. */
	const stage = $derived(reviewStage(progress, status));
	const stageIndex = $derived(stage.index);
	const currentStage = $derived(stage.label);
	const displayAssignments = $derived<ReviewAssignment[]>([
		...assignments,
		{
			id: pipelineId,
			role: 'pipeline',
			title: 'Review pipeline',
			reason: 'Planning and saving results',
			status: active ? 'running' : status === 'passed' ? 'done' : 'error',
			scope: [],
			currentOperation: currentStage
		}
	]);
	const connectionLabel = $derived(
		connection === 'closed'
			? 'Updates complete'
			: connection === 'reconnecting'
				? 'Reconnecting · keeping the latest progress'
				: connection === 'connecting'
					? 'Connecting to review'
					: 'Live updates connected'
	);
</script>

<ReviewingView
	fullscreen
	{embedded}
	bind:draft
	bind:codeContext
	{focusKey}
	{reviewId}
	{awaitingPrompt}
	onStartReview={awaitingPrompt ? onStartReview : null}
	paused={progress.paused ?? false}
	completedAt={!active && !awaitingPrompt ? review.updatedAt : undefined}
	title={review.prTitle || `PR #${review.prNumber}`}
	meta={{
		prLabel: '#' + review.prNumber,
		prUrl: review.prUrl,
		repo: recentSessions.repos.find((item) => item.id === review.repoId)?.name ?? repo,
		files,
		additions,
		deletions,
		elapsed,
		branch: recentSessions.branches[`${review.repoId}#${review.prNumber}`]
	}}
	assignments={displayAssignments}
	messages={progress.messages ?? []}
	orchestratorModel={progress.orchestratorModel}
	onSend={async (assignmentId, text, context) => {
		await serverApi.sendReviewMessage(reviewId, assignmentId, text, context);
	}}
	onStop={async (assignmentId) => {
		await serverApi.stopReviewMessage(reviewId, assignmentId);
	}}
	findings={viewFindings}
	pendingCount={assignments.filter(
		(assignment) => assignment.status === 'running' || assignment.status === 'queued' || assignment.status === 'waiting'
	).length}
	activity={progress.activity}
	showChecks={review.source !== 'stub'}
	repoId={review.source !== 'stub' ? review.repoId : null}
	guidelines={progress.guidelines ?? null}
	{onOpenDiff}
	{onShowView}
	{onOpenFinding}
	{onRestart}
	onContinue={status === 'failed' ? onContinue : null}
	{restarting}
	stage={stageIndex}
	stageLabel={currentStage}
	stageDetail={stage.detail}
	failed={status === 'failed'}
	errorMessage={actionError}
	failure={progress.failure ?? (status === 'failed' && review.summary ? { reason: review.summary } : null)}
	{connectionLabel}
	connectionLost={connection === 'reconnecting'}
	coverage={progress.coverage ?? null}
	coverageGaps={progress.coverageGaps ?? []}
	{now}
	{active}
	tasks={Object.values(progress.tasks).map((task) => ({ ...task, assignmentId: task.assignmentId ?? pipelineId }))}
	reasoning={(progress.reasoning ?? []).map((entry) => ({ ...entry, assignmentId: entry.assignmentId ?? pipelineId }))}
	toolCalls={(progress.toolCalls ?? []).map((tool) => ({ ...tool, assignmentId: tool.assignmentId ?? pipelineId }))}
/>
