<script lang="ts">
	import { apiBase } from '$lib/server-api';
	import { applyProgressMessage, emptyReviewProgress, formatAssignmentHeadline, type ProgressMessage } from '$lib/review-progress-state';
	import type { Finding, Review, ReviewAssignment } from '@recoder/shared';
	import ReviewingView, { type ReviewingFinding } from './reviewing-view.svelte';

	interface Props {
		review: Review;
		repo: string;
		files?: number | null;
		additions?: number | null;
		deletions?: number | null;
		onOpenDiff?: (() => void) | null;
		onRestart?: (() => void) | null;
	}
	let { review, repo, files = null, additions = null, deletions = null, onOpenDiff = null, onRestart = null }: Props = $props();
	let progress = $state(emptyReviewProgress(''));
	let liveFindings = $state<Finding[]>([]);
	let connection = $state<'connecting' | 'live' | 'reconnecting' | 'closed'>('connecting');
	let lastReceived = $state(0);
	let now = $state(Date.now());
	let terminalStatus = $state<string | null>(null);
	let failureReason = $state<string | null>(null);
	const reviewId = $derived(review.id);

	$effect(() => {
		const id = reviewId;
		progress = emptyReviewProgress(id);
		liveFindings = [];
		terminalStatus = null;
		failureReason = null;
		connection = 'connecting';
		lastReceived = Date.now();
		const source = new EventSource(`${apiBase}/api/reviews/${id}/events`);
		source.onopen = () => { connection = 'live'; lastReceived = Date.now(); };
		source.onerror = () => { connection = 'reconnecting'; };
		source.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data) as ProgressMessage;
				lastReceived = Date.now();
				progress = applyProgressMessage(progress, message);
				const items = message.data?.items;
				if (Array.isArray(items)) {
					const byId = new Map(liveFindings.map((finding) => [finding.id, finding]));
					for (const item of items as Finding[]) if (item?.id) byId.set(item.id, item);
					liveFindings = [...byId.values()];
				}
				const status = message.status ?? (message.type === 'done' && !message.step ? 'passed' : message.type === 'error' && !message.step ? 'failed' : null);
				if (status === 'passed' || status === 'failed') {
					if (status === 'failed' && message.message) failureReason = message.message;
					terminalStatus = status;
					connection = 'closed';
					source.close();
				}
			} catch { /* Ignore malformed events; preserve the last valid snapshot. */ }
		};
		return () => source.close();
	});
	$effect(() => {
		const timer = setInterval(() => now = Date.now(), 1000);
		return () => clearInterval(timer);
	});
	const status = $derived(terminalStatus ?? review.status);
	const active = $derived(status === 'queued' || status === 'running');
	const elapsed = $derived(formatDuration((active ? now : Date.parse(review.updatedAt)) - Date.parse(review.createdAt)));
	function formatDuration(ms: number): string {
		const seconds = Math.max(0, Math.floor(ms / 1000));
		return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
	}
	const mergedFindings = $derived.by(() => {
		const byId = new Map(review.findings.map((finding) => [finding.id, finding]));
		for (const finding of liveFindings) byId.set(finding.id, finding);
		return [...byId.values()];
	});
	const assignments = $derived<ReviewAssignment[]>(progress.assignments ?? []);
	const confirmed = $derived(status === 'passed');
	const viewFindings = $derived<ReviewingFinding[]>((confirmed || (!active && mergedFindings.length > 0)) ? mergedFindings.map((finding, i) => ({
		id: 'F-' + String(i + 1).padStart(2, '0'), agent: finding.agent ?? null,
		severity: finding.severity === 'error' ? 'high' : finding.severity === 'warning' ? 'medium' : 'info',
		title: finding.message.split('\n')[0].replace(/^\[[^\]]+\]\s*/, '') || finding.file,
		location: finding.file + (finding.line ? ':' + finding.line : ''),
		confirmed
	})) : []);
	const stageIndex = $derived(
		status === 'passed' ? 4
			: progress.stage === 'consolidation' || progress.tasks.finalize ? 3
			: progress.stage === 'specialists' || (assignments.length > 0) ? 2
			: progress.stage === 'understand' || progress.tasks.inventory || progress.tasks.planning ? 1
			: 0
	);
	const currentStage = $derived(
		status === 'passed' ? 'Review complete'
			: status === 'failed' ? (progress.outcome === 'partial' ? 'Review incomplete' : 'Review interrupted')
			: ['Checkout', 'Understand changes', 'Specialist review', 'Consolidation'][stageIndex]
	);
	const connectionLabel = $derived(connection === 'closed' ? 'Updates complete'
		: connection === 'reconnecting' || now - lastReceived > 15000 ? 'Reconnecting · keeping the latest progress'
		: connection === 'connecting' ? 'Connecting to review' : 'Live updates connected');
	const headline = $derived(formatAssignmentHeadline(assignments));
</script>

<ReviewingView
	{reviewId}
	title={review.prTitle || `PR #${review.prNumber}`}
	meta={{ prLabel: '#' + review.prNumber, repo, files, additions, deletions, elapsed }}
	{assignments}
	findings={viewFindings}
	pendingCount={assignments.filter((assignment) => assignment.status === 'running' || assignment.status === 'queued' || assignment.status === 'waiting').length}
	pipelineLogs={progress.activity.map((entry) => entry.message)}
	{onOpenDiff}
	{onRestart}
	stage={stageIndex}
	stageLabel={currentStage}
	stageDetail={stageIndex === 0 ? progress.tasks[['fetch', 'sandbox', 'diff'].find((id) => progress.tasks[id]?.status === 'running') ?? 'fetch']?.message : undefined}
	failed={status === 'failed'}
	errorMessage={status === 'failed' ? failureReason ?? review.summary : null}
	{connectionLabel}
	connectionLost={connection === 'reconnecting' || (active && now - lastReceived > 15000)}
	{headline}
	planSummary={progress.planSummary ?? null}
	candidateCount={progress.candidateCount ?? 0}
	{confirmed}
	coverage={progress.coverage ?? null}
	coverageGaps={progress.coverageGaps ?? []}
	recommendedChecks={progress.recommendedChecks ?? []}
	{now}
	{active}
	tasks={Object.values(progress.tasks)}
/>
