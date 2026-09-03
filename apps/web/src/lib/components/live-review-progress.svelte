<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { TaskSteps } from '@sivir-ui/svelte/components/task-steps';
	import { apiBase } from '$lib/server-api';
	import { MODEL_ROLES } from '$lib/model-settings.svelte';
	import type { Review } from '@recoder/shared';

	interface Props {
		review: Review;
		fileCount: number;
	}

	let { review, fileCount }: Props = $props();

	type AgentStatus = 'queued' | 'running' | 'done';
	interface AgentState {
		status: AgentStatus;
		findings: number;
		lastLog: string | null;
	}

	let agents = $state<Record<string, AgentState>>(Object.fromEntries(
		MODEL_ROLES.map((r) => [r, { status: 'queued', findings: 0, lastLog: null }])
	));
	let elapsed = $state(0);
	let clock: ReturnType<typeof setInterval> | undefined;
	let source: EventSource | undefined;

	const failed = $derived(review.status === 'failed');
	const doneCount = $derived(Object.values(agents).filter((a) => a.status === 'done').length);
	const findingsTotal = $derived(Object.values(agents).reduce((sum, a) => sum + a.findings, 0));

	const stages = [
		{ id: 'fetch', label: 'Fetch diff' },
		{ id: 'review', label: 'Agents reviewing' },
		{ id: 'ready', label: 'Ready' }
	];
	const stageCurrent = $derived(failed ? 1 : fileCount > 0 ? 1 : 0);

	$effect(() => {
		const id = review.id;
		clock = setInterval(() => (elapsed += 1), 1000);
		source = new EventSource(`${apiBase}/api/reviews/${id}/events`);
		source.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data) as {
					type?: string;
					step?: string;
					message?: string;
					data?: { agent?: string; status?: AgentStatus; findings?: number };
				};
				const agent = data.data?.agent;
				if (!agent || !(agent in agents)) return;
				if (data.data?.status === 'done') {
					agents[agent] = {
						status: 'done',
						findings: Number(data.data.findings ?? 0),
						lastLog: agents[agent].lastLog
					};
				} else {
					agents[agent] = {
						status: 'running',
						findings: agents[agent].findings,
						lastLog: data.message ?? agents[agent].lastLog
					};
				}
			} catch {
				// Ignore malformed events.
			}
		};
		return () => {
			source?.close();
			if (clock) clearInterval(clock);
		};
	});

	onDestroy(() => {
		source?.close();
		if (clock) clearInterval(clock);
	});

	function formatElapsed(total: number): string {
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}
</script>

<div
	class="session-enter mx-auto flex min-h-[calc(100vh-52px-6rem)] w-full max-w-2xl flex-col justify-center px-4 py-10"
	style="justify-content: safe center"
>
	<div class="flex items-center gap-3">
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2.5">
				{#if !failed}
					<Spinner size={18} aria-hidden="true" />
				{/if}
				<h1 class="truncate text-2xl font-semibold tracking-tight">
					{#if review.prTitle}{review.prTitle}{:else}PR #{review.prNumber}{/if}
				</h1>
			</div>
		</div>
	</div>

	<div class="mt-4">
		<TaskSteps steps={stages} current={stageCurrent} failed={failed} label="Review stages" />
	</div>

	<p class="mt-3 font-mono text-[13px] text-foreground-muted">
		PR #{review.prNumber} · {doneCount} of {MODEL_ROLES.length} agents done · {findingsTotal} findings
		{fileCount > 0 ? ` · ${fileCount} files` : ''} · {formatElapsed(elapsed)} elapsed
	</p>

	<div class="mt-4 divide-y divide-border border-y border-border">
		{#each MODEL_ROLES as role (role)}
			{@const agent = agents[role]}
			<div class="py-3">
				<div class="flex items-center gap-2.5">
					{#if agent.status === 'running'}
						<Spinner size={14} aria-hidden="true" />
					{:else if agent.status === 'done'}
						<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
					{:else}
						<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground-muted/40"></span>
					{/if}
					<span class="text-[15px] font-medium">{role}</span>
					<span class="ml-auto shrink-0 font-mono text-[13px] text-foreground-muted">
						{agent.status === 'done'
							? `${agent.findings} finding${agent.findings === 1 ? '' : 's'}`
							: agent.status}
					</span>
				</div>
				{#if agent.status === 'running'}
					<div class="mt-2 pl-[22px]">
						<Progress indeterminate />
					</div>
				{/if}
				<p class="mt-1.5 truncate pl-[22px] font-mono text-[13px] text-foreground-muted">
					{#if agent.lastLog}
						› {agent.lastLog}
					{:else}
						<span class="opacity-60">Waiting…</span>
					{/if}
				</p>
			</div>
		{/each}
	</div>

	{#if failed}
		<p class="mt-4 text-[14px] font-medium text-error" role="alert">
			{review.summary ?? 'Review failed.'}
		</p>
	{/if}
</div>
