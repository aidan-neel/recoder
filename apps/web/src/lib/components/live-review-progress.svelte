<script lang="ts">
	import { apiBase } from '$lib/server-api';
	import { MODEL_ROLES } from '$lib/model-settings.svelte';
	import { applyProgressMessage, emptyReviewProgress, taskSummary, type ProgressMessage } from '$lib/review-progress-state';
	import type { Finding, Review } from '@recoder/shared';
	import ReviewingView, { type ReviewingAgent, type ReviewingFinding } from './reviewing-view.svelte';

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
	const tasks = $derived(Object.values(progress.tasks));
	const agentTasks = $derived(tasks.filter((task) => task.agent));
	const summary = $derived(taskSummary(agentTasks));
	const viewAgents = $derived<ReviewingAgent[]>(MODEL_ROLES.map((role) => {
		const work = agentTasks.filter((task) => task.agent === role);
		const counts = taskSummary(work);
		const current = work.find((task) => task.status === 'running') ??
			work.find((task) => task.status === 'queued') ?? work.at(-1);
		const roleStatus = counts.total && counts.settled === counts.total
			? (counts.failed ? 'error' : 'done')
			: counts.running ? 'running' : status === 'failed' ? 'error' : 'queued';
		const findings = mergedFindings.filter((finding) => finding.agent === role).length;
		return {
			id: role, name: role, model: work.find((task) => task.model)?.model ?? null,
			status: roleStatus, progress: 0, findings, doneMeta: null,
			logs: progress.activity.filter((entry) => entry.agent === role).map((entry) => entry.message),
			tasks: work, completed: counts.done, total: counts.total, failed: counts.failed,
			current: roleStatus === 'done' ? 'Review complete' : roleStatus === 'error' ? 'Review incomplete' : current?.message ?? 'Waiting for the local diff',
			batch: current?.batch, batches: current?.batches
		};
	}));
	const viewFindings = $derived<ReviewingFinding[]>(mergedFindings.map((finding, i) => ({
		id: 'F-' + String(i + 1).padStart(2, '0'), agent: finding.agent ?? null,
		severity: finding.severity === 'error' ? 'high' : finding.severity === 'warning' ? 'medium' : 'info',
		title: finding.message.split('\n')[0].replace(/^\[[^\]]+\]\s*/, '') || finding.file,
		location: finding.file + ':' + finding.line
	})));
	const stage = $derived(status === 'passed' ? 5
		: progress.tasks.finalize ? 4 : agentTasks.length ? 3
		: progress.tasks.diff ? 2 : progress.tasks.sandbox ? 1 : 0);
	const currentStage = $derived(['Fetching PR metadata', 'Preparing local checkout', 'Computing local PR diff', 'Reviewing changes', 'Saving results', 'Review complete'][stage]);
	const connectionLabel = $derived(connection === 'closed' ? 'Updates complete'
		: connection === 'reconnecting' || now - lastReceived > 15000 ? 'Reconnecting · keeping the latest progress'
		: connection === 'connecting' ? 'Connecting to review' : 'Live updates connected');
</script>

<ReviewingView
	title={review.prTitle || `PR #${review.prNumber}`}
	meta={{ prLabel: '#' + review.prNumber, repo, files, additions, deletions, elapsed }}
	agents={viewAgents}
	findings={viewFindings}
	pendingCount={viewAgents.filter((agent) => agent.status === 'running' || agent.status === 'queued').length}
	pipelineLogs={progress.activity.filter((entry) => !entry.agent).map((entry) => entry.message)}
	{onOpenDiff}
	{onRestart}
	{stage}
	stageLabel={status === 'failed' ? 'Review interrupted' : currentStage}
	stageDetail={stage < 3 ? progress.tasks[['fetch', 'sandbox', 'diff'][stage]]?.message : undefined}
	failed={status === 'failed'}
	errorMessage={status === 'failed' ? failureReason ?? review.summary : null}
	{connectionLabel}
	connectionLost={connection === 'reconnecting' || (active && now - lastReceived > 15000)}
	completedTasks={summary.done}
	totalTasks={summary.total}
	failedTasks={summary.failed}
	{now}
	active={active}
/>
