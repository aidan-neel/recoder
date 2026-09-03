<script lang="ts">
	import { apiBase } from '$lib/server-api';
	import { MODEL_ROLES } from '$lib/model-settings.svelte';
	import type { Review } from '@recoder/shared';
	import ReviewingView, {
		type ReviewingAgent,
		type ReviewingFinding
	} from '$lib/components/reviewing-view.svelte';

	interface Props {
		review: Review;
		/** Tracked repo display name (the review only carries an id). */
		repo: string;
		files?: number | null;
		additions?: number | null;
		deletions?: number | null;
		onOpenDiff?: (() => void) | null;
		onRestart?: (() => void) | null;
	}

	let {
		review,
		repo,
		files = null,
		additions = null,
		deletions = null,
		onOpenDiff = null,
		onRestart = null
	}: Props = $props();

	type AgentStatus = 'queued' | 'running' | 'done';
	interface AgentState {
		status: AgentStatus;
		model: string | null;
		line: string | null;
		findings: number;
	}

	interface AgentEvent {
		type?: string;
		step?: string;
		message?: string;
		data?: {
			agent?: string;
			status?: AgentStatus;
			findings?: number;
			model?: string;
			files?: string[];
			command?: string;
		};
	}

	let agents = $state<Record<string, AgentState>>(Object.fromEntries(
		MODEL_ROLES.map((r) => [r, { status: 'queued', model: null, line: null, findings: 0 }])
	));

	$effect(() => {
		const id = review.id;
		const source = new EventSource(`${apiBase}/api/reviews/${id}/events`);
		source.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as AgentEvent;
				const agent = data.data?.agent;
				if (!agent || !(agent in agents)) return;
				const current = agents[agent];
				if (data.data?.status === 'done') {
					const findings = Number(data.data.findings ?? 0);
					agents[agent] = {
						...current,
						status: 'done',
						findings,
						line: `done · ${findings} finding${findings === 1 ? '' : 's'}`
					};
				} else if (data.message) {
					agents[agent] = {
						status: 'running',
						model: data.data?.model ?? current.model,
						line: data.message,
						findings: current.findings
					};
				} else if (data.data?.model) {
					agents[agent] = { ...current, status: 'running', model: data.data.model };
				}
			} catch {
				// Ignore malformed events.
			}
		};
		return () => source.close();
	});

	// Ticking elapsed clock, anchored at the review's creation when known.
	const startedAt = Date.now();
	let now = $state(startedAt);
	let clock: ReturnType<typeof setInterval> | undefined;

	$effect(() => {
		clock = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(clock);
	});

	function formatElapsed(totalSeconds: number): string {
		const m = Math.floor(totalSeconds / 60);
		const s = totalSeconds % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	const elapsed = $derived.by(() => {
		const anchor = Date.parse(review.createdAt);
		const base = Number.isNaN(anchor) ? startedAt : anchor;
		return formatElapsed(Math.max(0, Math.floor((now - base) / 1000)));
	});

	const viewAgents = $derived<ReviewingAgent[]>(
		MODEL_ROLES.map((role) => {
			const agent = agents[role];
			const lines = agent.line ? [agent.line] : [];
			return {
				id: role,
				name: role,
				model: agent.model,
				status: agent.status,
				progress: agent.status === 'done' ? 100 : agent.status === 'running' ? 50 : 0,
				findings: agent.findings,
				logs: lines,
				doneMeta:
					agent.status === 'done'
						? `done · ${agent.findings} finding${agent.findings === 1 ? '' : 's'}`
						: null
			};
		})
	);

	const viewFindings = $derived<ReviewingFinding[]>(
		review.findings.map((finding, i) => {
			const firstLine = finding.message.split('\n')[0].replace(/^\[[^\]]+\]\s*/, '');
			return {
				id: `F-${String(i + 1).padStart(2, '0')}`,
				agent: null,
				severity: finding.severity === 'error' ? 'high' : finding.severity === 'warning' ? 'medium' : 'info',
				title: firstLine === '' ? finding.file : firstLine,
				location: finding.line ? `${finding.file}:${finding.line}` : finding.file
			};
		})
	);

	const pendingCount = $derived(
		MODEL_ROLES.filter((role) => agents[role].status !== 'done').length
	);
</script>

<ReviewingView
	title={review.prTitle && review.prTitle !== '' ? review.prTitle : `PR #${review.prNumber}`}
	meta={{
		prLabel: `#${review.prNumber}`,
		repo,
		files,
		additions,
		deletions,
		elapsed
	}}
	agents={viewAgents}
	findings={viewFindings}
	{pendingCount}
	{onOpenDiff}
	{onRestart}
/>
