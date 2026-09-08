<script lang="ts" module>
	import type { ReviewTask } from '@recoder/shared';
	export interface ReviewingAgent {
		id: string;
		name: string;
		model: string | null;
		status: 'queued' | 'running' | 'done' | 'error';
		progress: number;
		findings: number;
		logs: string[];
		doneMeta: string | null;
		tasks?: ReviewTask[];
		completed?: number;
		total?: number;
		failed?: number;
		current?: string;
		batch?: number;
		batches?: number;
	}
	export interface ReviewingFinding {
		id: string;
		agent: string | null;
		severity: 'high' | 'medium' | 'low' | 'info';
		title: string;
		location: string | null;
	}
	export interface ReviewingMeta {
		prLabel: string; repo: string; files: number | null;
		additions: number | null; deletions: number | null; elapsed: string;
	}
</script>

<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import { TaskSteps } from '@sivir-ui/svelte/components/task-steps';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { formatAgentName } from '$lib/threads.svelte';
	import SeverityPill from './severity-pill.svelte';

	interface Props {
		title: string; meta: ReviewingMeta; agents: ReviewingAgent[];
		findings: ReviewingFinding[]; pendingCount: number;
		onOpenDiff: (() => void) | null; onRestart: (() => void) | null;
		doneHref?: string | null; pipelineLogs?: string[]; spinQueued?: boolean;
		stage?: number; stageLabel?: string; stageDetail?: string; failed?: boolean; errorMessage?: string | null;
		connectionLabel?: string; connectionLost?: boolean;
		completedTasks?: number; totalTasks?: number; failedTasks?: number;
		now?: number; active?: boolean;
	}
	let {
		title, meta, agents, findings, pendingCount, onOpenDiff, onRestart,
		doneHref = null, pipelineLogs = [], stage = 3, stageLabel = 'Reviewing changes', stageDetail,
		failed = false, errorMessage = null, connectionLabel = '', connectionLost = false,
		completedTasks = 0, totalTasks = 0, failedTasks = 0, now = Date.now(), active = true
	}: Props = $props();
	const steps = [
		{ id: 'fetch', label: 'PR metadata' }, { id: 'sandbox', label: 'Local checkout' },
		{ id: 'diff', label: 'Local diff' }, { id: 'agents', label: 'Specialist review' },
		{ id: 'finalize', label: 'Save results' }
	];
	const running = $derived(agents.filter((agent) => agent.status === 'running').length);
	const done = $derived(agents.filter((agent) => agent.status === 'done').length);
	function taskTime(task: ReviewTask): string {
		const elapsed = (task.elapsedMs ?? 0) + ((task.status === 'running' || task.status === 'queued') && active
			? Math.max(0, now - Date.parse(task.updatedAt)) : 0);
		return Math.floor(elapsed / 60000) + ':' + String(Math.floor(elapsed / 1000) % 60).padStart(2, '0');
	}
	function statusLabel(status: ReviewingAgent['status']): string {
		return { queued: 'Waiting', running: 'Working', done: 'Complete', error: 'Incomplete' }[status];
	}
</script>

<div class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div class="min-w-0 flex-1 basis-64">
			<h1 class="text-xl font-semibold tracking-tight break-words sm:text-2xl">{title}</h1>
			<p class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-foreground-muted">
				<span class="break-all">{meta.repo} {meta.prLabel}</span>
				{#if meta.files !== null}<span>{meta.files} files</span>{/if}
				{#if meta.additions !== null}<span class="text-success">+{meta.additions}</span>{/if}
				{#if meta.deletions !== null}<span class="text-error">−{meta.deletions}</span>{/if}
				<span class="font-mono tabular-nums">{meta.elapsed} elapsed</span>
			</p>
		</div>
		<div class="flex items-center gap-2">
			{#if onOpenDiff}<Button variant="outline" size="sm" onclick={onOpenDiff}>Open diff</Button>{/if}
			{#if onRestart}<Button variant="ghost" size="sm" onclick={onRestart}>Restart review</Button>{/if}
		</div>
	</header>

	<section aria-label="Review status" class="my-6 border-y border-border py-5">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-2.5">
				{#if failed}<CircleAlert size={18} class="text-error" />
				{:else if active}<Spinner size={18} aria-hidden="true" />
				{:else}<Check size={18} class="text-success" />{/if}
				<h2 class="text-base font-semibold">{stageLabel}</h2>
			</div>
			{#if connectionLabel}
				<p role="status" class="text-sm {connectionLost ? 'text-warning' : 'text-foreground-muted'}">{connectionLabel}</p>
			{/if}
		</div>
		{#if errorMessage}<p role="alert" class="mt-3 break-words text-sm text-error">{errorMessage}</p>{/if}
		{#if stageDetail}<p class="mt-3 text-sm text-foreground-muted">{stageDetail}</p>{/if}
		{#if totalTasks > 0}
			<div class="mt-4 flex flex-wrap justify-between gap-2 text-sm text-foreground-muted">
				<p>{completedTasks} of {totalTasks} review tasks complete{#if failedTasks} · <span class="text-error">{failedTasks} failed</span>{/if}</p>
				<p>{running} specialists working · {done} complete</p>
			</div>
			<Progress class="mt-2" value={completedTasks} max={totalTasks} {...{ 'aria-label': 'Completed review tasks' }} />
		{:else}
			<p class="mt-3 text-sm text-foreground-muted">Specialists start once the local checkout and diff are ready.</p>
		{/if}
	</section>

	<div class="grid items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
		<aside class="min-w-0 space-y-6">
			<section aria-label="Review stages">
				<h2 class="mb-3 text-sm font-semibold">Review stages</h2>
				<TaskSteps {steps} current={stage} {failed} label="Review stages" />
			</section>
			<Collapsible.Root>
				<Collapsible.Trigger class="group flex w-full justify-between gap-2 py-2 text-sm font-medium">
					Activity history <ChevronDown size={14} class="group-data-[state=open]:rotate-180" />
				</Collapsible.Trigger>
				<Collapsible.Content>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable history needs keyboard access.) -->
					<div class="max-h-64 space-y-3 overflow-y-auto py-2 text-sm text-foreground-muted" tabindex="0" role="region" aria-label="Pipeline activity">
						{#each pipelineLogs as line, index (index)}<p class="break-words">{line}</p>{:else}<p>Waiting for the first update.</p>{/each}
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
			<section aria-label="Findings so far" class="border-t border-border pt-5">
				<h2 class="mb-3 flex justify-between text-sm font-semibold">Findings so far <span class="font-mono">{findings.length}</span></h2>
				{#each findings as finding (finding.id)}
					<div class="space-y-2 border-b border-border py-3">
						<SeverityPill severity={finding.severity} />
						<p class="break-words text-sm">{finding.title}</p>
						{#if finding.location}<p class="break-all font-mono text-xs text-foreground-muted">{finding.location}</p>{/if}
					</div>
				{:else}
					<p class="text-sm leading-relaxed text-foreground-muted">{pendingCount ? 'Verified findings appear as specialists finish each batch.' : 'No findings reported.'}</p>
				{/each}
			</section>
		</aside>

		<section class="min-w-0" aria-label="Specialist activity">
			<div class="mb-3 flex items-baseline justify-between gap-3">
				<h2 class="text-base font-semibold">Specialist activity</h2>
				<span class="text-sm text-foreground-muted">{agents.length} specialists</span>
			</div>
			<div class="divide-y divide-border border-y border-border">
				{#each agents as agent (agent.id)}
					<Collapsible.Root open={agent.id === agents[0]?.id}>
						<div class="min-w-0 py-1">
							<Collapsible.Trigger class="group flex w-full items-start gap-3 rounded-md px-2 py-4 text-left hover:bg-secondary/50">
								<span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
									{#if agent.status === 'running'}<Spinner size={16} aria-hidden="true" />
									{:else if agent.status === 'done'}<Check size={16} class="text-success" />
									{:else if agent.status === 'error'}<CircleAlert size={16} class="text-error" />
									{:else}<span class="h-1.5 w-1.5 rounded-full bg-foreground-muted"></span>{/if}
								</span>
								<span class="min-w-0 flex-1">
									<span class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
										<span class="font-medium">{formatAgentName(agent.name)}</span>
										<span class="text-xs {agent.status === 'error' ? 'text-error' : 'text-foreground-muted'}">
											{statusLabel(agent.status)}{#if agent.total} · {agent.completed}/{agent.total} tasks{/if}
										</span>
									</span>
									<span class="mt-1 block break-words text-sm text-foreground-muted">{agent.current ?? agent.logs.at(-1) ?? 'Waiting for the local diff'}</span>
									{#if agent.batches}
										<span class="mt-1.5 block text-xs text-foreground-muted">Batch {agent.batch} of {agent.batches} · {agent.findings} findings{#if agent.failed} · {agent.failed} failed tasks{/if}</span>
									{/if}
								</span>
								<ChevronDown size={16} class="mt-1 shrink-0 text-foreground-muted group-data-[state=open]:rotate-180" />
							</Collapsible.Trigger>
							<Collapsible.Content class="pb-4 pl-10 pr-2">
								{#if agent.model}<p class="mb-3 break-all font-mono text-xs text-foreground-muted">{agent.model}</p>{/if}
								{#if agent.tasks?.length}
									<ul class="space-y-3" aria-label={formatAgentName(agent.name) + ' tasks'}>
										{#each agent.tasks.filter((task) => task.batch === agent.batch) as task (task.id)}
											<li class="border-l-2 border-border pl-3">
												<div class="flex flex-wrap justify-between gap-2 text-sm">
													<span class="font-medium">{task.label}</span>
													<span class="text-foreground-muted">
														{task.status === 'queued' ? 'Queued' : task.status === 'running' ? 'Working' : task.status === 'done' ? 'Complete' : task.status === 'skipped' ? 'Skipped' : 'Failed'}
														{#if task.elapsedMs !== undefined}<span class="ml-2 font-mono tabular-nums">{taskTime(task)}</span>{/if}
													</span>
												</div>
												<p class="mt-1 break-words text-sm {task.status === 'error' ? 'text-error' : 'text-foreground-muted'}">{task.message}</p>
												{#if task.files?.length}<p class="mt-1 break-all font-mono text-xs leading-relaxed text-foreground-muted">{task.files.join(', ')}</p>{/if}
											</li>
										{/each}
									</ul>
								{:else}<p class="text-sm text-foreground-muted">No tasks assigned yet.</p>{/if}
								{#if agent.logs.length}
									<Collapsible.Root>
										<Collapsible.Trigger class="mt-4 py-2 text-sm text-foreground-muted">Activity history <ChevronDown size={14} /></Collapsible.Trigger>
										<Collapsible.Content>
											<!-- svelte-ignore a11y_no_noninteractive_tabindex (Scrollable history needs keyboard access.) -->
											<div class="max-h-52 space-y-2 overflow-y-auto py-2 text-sm text-foreground-muted" tabindex="0" role="region" aria-label={formatAgentName(agent.name) + ' activity'}>
												{#each agent.logs as line, index (index)}<p class="break-words">{line}</p>{/each}
											</div>
										</Collapsible.Content>
									</Collapsible.Root>
								{/if}
							</Collapsible.Content>
						</div>
					</Collapsible.Root>
				{/each}
			</div>
		</section>
	</div>
	{#if done === agents.length && doneHref}<div class="mt-6"><Button href={doneHref}>Open session</Button></div>{/if}
</div>
