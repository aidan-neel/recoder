<script lang="ts" module>
	import type {
		CoverageGap,
		CoverageSummary,
		ReviewAssignment,
		ReviewReasoningEntry,
		ReviewTask,
		ReviewToolCall,
		RoleDecision
	} from '@recoder/shared';
	export interface ReviewingFinding {
		id: string;
		agent: string | null;
		severity: 'high' | 'medium' | 'low' | 'info';
		title: string;
		location: string | null;
		confirmed?: boolean;
	}
	export interface ReviewingMeta {
		prLabel: string;
		repo: string;
		files: number | null;
		additions: number | null;
		deletions: number | null;
		elapsed: string;
	}
	export type { ReviewAssignment };
</script>

<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { Progress } from '@sivir-ui/svelte/components/progress';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import * as Tabs from '@sivir-ui/svelte/components/tabs';
	import * as Select from '@sivir-ui/svelte/components/select';
	import { formatAgentName } from '$lib/threads.svelte';
	import ReviewMetricsModal from './review-metrics-modal.svelte';

	interface Props {
		reviewId?: string;
		title: string;
		meta: ReviewingMeta;
		assignments?: ReviewAssignment[];
		roleDecisions?: RoleDecision[];
		findings: ReviewingFinding[];
		tasks?: ReviewTask[];
		reasoning?: ReviewReasoningEntry[];
		toolCalls?: ReviewToolCall[];
		/** Coarse stage 0..4 (checkout → complete). */
		stage?: number;
		stageLabel?: string;
		stageDetail?: string;
		active?: boolean;
		failed?: boolean;
		errorMessage?: string | null;
		connectionLabel?: string;
		connectionLost?: boolean;
		planSummary?: string | null;
		pendingCount?: number;
		coverage?: CoverageSummary | null;
		coverageGaps?: CoverageGap[];
		recommendedChecks?: string[];
		pipelineLogs?: string[];
		onOpenDiff: (() => void) | null;
		onRestart: (() => void) | null;
		restarting?: boolean;
		doneHref?: string | null;
		now?: number;
		/** Fill the viewport with independently scrolling panes (see /example). */
		fullscreen?: boolean;
	}

	let {
		reviewId,
		title,
		meta,
		assignments = [],
		roleDecisions = [],
		findings,
		tasks = [],
		reasoning = [],
		toolCalls = [],
		stage = 0,
		stageLabel = 'Reviewing changes',
		stageDetail,
		active = true,
		failed = false,
		errorMessage = null,
		connectionLabel = '',
		connectionLost = false,
		planSummary = null,
		coverage = null,
		coverageGaps = [],
		recommendedChecks = [],
		pipelineLogs = [],
		onOpenDiff,
		onRestart,
		restarting = false,
		doneHref = null,
		now = Date.now(),
		fullscreen = false
	}: Props = $props();

	const stages = [
		{ key: 'fetch', label: 'PR metadata' },
		{ key: 'sandbox', label: 'Local checkout' },
		{ key: 'diff', label: 'Local diff' },
		{ key: 'specialists', label: 'Specialist review' },
		{ key: 'finalize', label: 'Save results' }
	];

	function taskDone(id: string): boolean {
		const task = tasks.find((item) => item.id === id);
		return task?.status === 'done' || task?.status === 'skipped';
	}

	const stageStates = $derived.by(() => {
		const done = [
			taskDone('fetch') || stage >= 1,
			taskDone('sandbox') || stage >= 1,
			taskDone('diff') || stage >= 2,
			stage >= 3,
			taskDone('finalize') || stage >= 4
		];
		const activeIndex = done.findIndex((value) => !value);
		return stages.map((_, index) => {
			if (tasks.find((task) => task.id === stages[index].key)?.status === 'error') return 'error' as const;
			if (done[index]) return 'done' as const;
			if (index === activeIndex) return failed ? ('error' as const) : ('active' as const);
			return 'pending' as const;
		});
	});

	const completeTasks = $derived(
		tasks.filter((task) => task.status === 'done' || task.status === 'skipped').length
	);
	const failedTasks = $derived(tasks.filter((task) => task.status === 'error').length);
	const activeSpecialists = $derived(
		assignments.filter((assignment) => assignment.id !== '__pipeline' && assignment.status === 'running').length
	);
	const completeSpecialists = $derived(
		assignments.filter((assignment) => assignment.id !== '__pipeline' && assignment.status === 'done').length
	);

	let selectedId = $state<string | null>(null);
	let pickedAssignment = $state(false);
	function selectAssignment(id: string): void {
		pickedAssignment = true;
		selectedId = id;
	}
	const selected = $derived(
		assignments.find((assignment) => assignment.id === selectedId) ??
			assignments.find((assignment) => assignment.status === 'running') ??
			assignments[0] ??
			null
	);

	let tab = $state('reasoning');
	$effect(() => {
		if (!assignments.some((assignment) => assignment.id === selectedId) ||
			(!pickedAssignment && selectedId === '__pipeline' && assignments.some((assignment) => assignment.id !== '__pipeline'))) {
			selectedId = assignments.find((assignment) => assignment.id !== '__pipeline' && assignment.status === 'running')?.id ?? assignments[0]?.id ?? null;
		}
	});

	function tasksFor(id: string): ReviewTask[] {
		return tasks.filter((task) => task.assignmentId === id);
	}
	function taskCounts(id: string) {
		const list = tasksFor(id);
		const done = list.filter((task) => task.status === 'done' || task.status === 'skipped').length;
		return { done, total: list.length };
	}
	function assignmentStatus(assignment: ReviewAssignment): { label: string; tone: string } {
		const counts = taskCounts(assignment.id);
		const suffix = counts.total > 0 ? ` · ${counts.done}/${counts.total} tasks` : '';
		switch (assignment.status) {
			case 'running':
				return { label: `Working${suffix}`, tone: 'text-[var(--color-info-vivid)]' };
			case 'waiting':
				return { label: 'Waiting for a model', tone: 'text-foreground-muted' };
			case 'queued':
				return { label: 'Queued', tone: 'text-foreground-muted' };
			case 'done':
				return { label: `Complete${suffix}`, tone: 'text-success' };
			case 'partial':
				return { label: `Incomplete${suffix}`, tone: 'text-warning' };
			case 'error':
				return { label: `Failed${suffix}`, tone: 'text-error' };
			case 'skipped':
				return { label: 'Skipped', tone: 'text-foreground-muted' };
		}
	}
	function assignmentDetail(assignment: ReviewAssignment): string {
		const running = tasksFor(assignment.id).find((task) => task.status === 'running');
		const parts: string[] = [];
		if (running?.batch && running?.batches) parts.push(`batch ${running.batch} of ${running.batches}`);
		const elapsed = assignmentElapsed(assignment);
		if (elapsed !== '') parts.push(elapsed);
		return parts.join(' · ');
	}
	function assignmentElapsed(assignment: ReviewAssignment): string {
		const start = Date.parse(assignment.startedAt ?? assignment.queuedAt ?? '');
		if (!Number.isFinite(start)) return '';
		const end = assignment.completedAt ? Date.parse(assignment.completedAt) : now;
		return formatMs(Math.max(0, end - start));
	}
	function formatMs(ms: number): string {
		if (!Number.isFinite(ms)) return '—';
		const seconds = Math.max(0, Math.floor(ms / 1000));
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}
	function toolDuration(tool: ReviewToolCall): string {
		const elapsed = tool.status === 'running' && active
			? Math.max(0, now - Date.parse(tool.startedAt)) : tool.elapsedMs;
		if (elapsed === undefined || !Number.isFinite(elapsed)) return '—';
		return elapsed < 1000 ? `${Math.round(elapsed)}ms` : elapsed < 60000 ? `${(elapsed / 1000).toFixed(1)}s` : formatMs(elapsed);
	}
	function timeAgo(iso: string): string {
		const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.floor(hours / 24)}d ago`;
	}
	function plural(count: number, word: string): string {
		return `${count} ${word}${count === 1 ? '' : 's'}`;
	}
	const selectedReasoning = $derived(
		selected ? reasoning.filter((entry) => entry.assignmentId === selected.id) : []
	);
	const selectedTools = $derived(
		selected ? toolCalls.filter((tool) => tool.assignmentId === selected.id) : []
	);
	const selectedTasks = $derived(selected ? tasksFor(selected.id) : []);
	const waitingRoles = $derived(roleDecisions.filter((decision) => decision.decision === 'deferred'));
	const selectedMeta = $derived.by(() => {
		if (!selected) return '';
		const running = tasksFor(selected.id).find((task) => task.status === 'running');
		const elapsed =
			running?.elapsedMs !== undefined ? formatMs(running.elapsedMs) : assignmentElapsed(selected);
		const parts: string[] = [];
		if (elapsed !== '') parts.push(elapsed);
		if (running?.batch && running?.batches) parts.push(`batch ${running.batch} of ${running.batches}`);
		const files = selected.scope.length;
		if (files > 0) parts.push(plural(files, 'file'));
		return parts.join(' · ');
	});

	let activityOpen = $state(false);
	const tabTriggerClass =
		'transition-colors data-[state=inactive]:hover:bg-foreground/[0.06]';
</script>

{#snippet headerContent()}
	<header class="flex flex-wrap items-start justify-between gap-4">
		<div class="min-w-0 flex-1 basis-64">
			<h1 class="text-xl font-semibold tracking-tight break-words sm:text-2xl">{title}</h1>
			<p class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-foreground-muted">
				<span class="break-all">{meta.repo} {meta.prLabel}</span>
				{#if meta.files !== null}<span>{plural(meta.files, 'file')}</span>{/if}
				{#if meta.additions !== null}<span class="text-success">+{meta.additions}</span>{/if}
				{#if meta.deletions !== null}<span class="text-error">−{meta.deletions}</span>{/if}
				<span class="font-mono tabular-nums">{meta.elapsed} elapsed</span>
			</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			{#if reviewId}<ReviewMetricsModal {reviewId} />{/if}
			{#if onOpenDiff && !active}<Button variant="outline" onclick={onOpenDiff}>Open diff</Button>{/if}
			{#if onRestart}<Button variant="ghost" loading={restarting} loadingLabel="Restarting…" onclick={onRestart}>Restart review</Button>{/if}
		</div>
	</header>
{/snippet}

{#snippet statusContent()}
	<section aria-label="Review status" class="mt-4 border-y border-border py-4">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-2.5">
				{#if failed}<CircleAlert size={18} class="text-error" />
				{:else if active}<Spinner size={18} aria-hidden="true" />
				{:else}<Check size={18} class="text-success" />{/if}
				<h2 class="text-base font-semibold">{stageLabel}</h2>
			</div>
			{#if connectionLabel}
				<p role="status" class="text-sm {connectionLost ? 'text-warning' : 'text-foreground-muted'}">
					{connectionLabel}
				</p>
			{/if}
		</div>
		{#if errorMessage}
			<p role="alert" class="mt-3 break-words text-sm text-error">{errorMessage}</p>
		{/if}
		{#if stageDetail}<p class="mt-3 text-sm text-foreground-muted">{stageDetail}</p>{/if}
		{#if planSummary}<p class="mt-3 text-sm text-foreground-muted">{planSummary}</p>{/if}

		<div class="mt-4 flex flex-wrap items-center gap-1.5" aria-label="Review stages">
			<span class="mr-1 text-[13px] text-foreground-muted">Stages</span>
			{#each stages as stage_, index (stage_.key)}
				{@const state = stageStates[index]}
				<span
					class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] transition-colors {state ===
					'active'
						? 'border-primary/50 bg-primary/[0.08] text-foreground'
						: state === 'done'
							? 'border-border bg-secondary/60 text-foreground'
							: state === 'error'
								? 'border-error/40 bg-error/10 text-error'
								: 'border-border text-foreground-muted'}"
				>
					{#if state === 'done'}
						<Check size={13} class="text-success" aria-hidden="true" />
					{:else if state === 'active'}
						<Spinner size={12} aria-hidden="true" />
					{:else if state === 'error'}
						<CircleAlert size={13} aria-hidden="true" />
					{:else}
						<span class="size-1.5 rounded-full bg-foreground-muted/40" aria-hidden="true"></span>
					{/if}
					{stage_.label}
				</span>
			{/each}
		</div>

		{#if tasks.length > 0}
			<div class="mt-4 flex flex-wrap items-baseline justify-between gap-2 text-sm">
				<span class="text-foreground-muted">
					{completeTasks} of {tasks.length} review tasks complete{#if failedTasks > 0}<span class="text-error">
							· {failedTasks} failed</span
						>{/if}
				</span>
				<span class="text-foreground-muted">
					{activeSpecialists} specialists working · {completeSpecialists} complete
				</span>
			</div>
			<Progress
				class="mt-2"
				value={completeTasks}
				max={Math.max(tasks.length, 1)}
				{...{ 'aria-label': 'Completed review tasks' }}
			/>
		{/if}
	</section>
{/snippet}

{#snippet activityContent()}
	<section class="min-w-0" aria-label="Specialist activity">
		<div class="mb-3 flex items-baseline justify-between gap-2">
			<h2 class="text-base font-semibold">Specialist activity</h2>
			<span class="text-sm text-foreground-muted"
				>{plural(assignments.filter((assignment) => assignment.id !== '__pipeline').length, 'specialist')}</span
			>
		</div>
		<div class="flex min-w-0 flex-col gap-1">
			{#each assignments as assignment (assignment.id)}
				{@const status = assignmentStatus(assignment)}
				{@const detail = assignmentDetail(assignment)}
				{@const isSelected = selected?.id === assignment.id}
				<Button
					unstyled
					type="button"
					aria-current={isSelected ? 'true' : undefined}
					onclick={() => selectAssignment(assignment.id)}
					class="flex w-full flex-col gap-1 rounded-[var(--radius-lg)] border px-3 py-2.5 text-left transition-colors {isSelected
						? 'border-primary/40 bg-primary/[0.06]'
						: 'border-transparent hover:bg-secondary/50'}"
				>
					<span class="flex w-full items-center gap-2">
						<span class="flex size-4 shrink-0 items-center justify-center">
							{#if assignment.status === 'running' || assignment.status === 'waiting'}
								<Spinner size={14} aria-hidden="true" />
							{:else if assignment.status === 'done'}
								<Check size={15} class="text-success" aria-hidden="true" />
							{:else if assignment.status === 'error' || assignment.status === 'partial'}
								<CircleAlert
									size={15}
									class={assignment.status === 'error' ? 'text-error' : 'text-warning'}
									aria-hidden="true"
								/>
							{:else}
								<span class="size-1.5 rounded-full bg-foreground-muted"></span>
							{/if}
						</span>
						<span class="min-w-0 flex-1 truncate text-sm font-medium">{assignment.title}</span>
						<span class="shrink-0 text-[12px] font-medium {status.tone}">{status.label}</span>
					</span>
					<span class="block break-words pl-6 text-[13px] text-foreground-muted">
						{assignment.currentOperation ?? assignment.reason}
					</span>
					{#if detail !== ''}
						<span class="block pl-6 font-mono text-[12px] text-foreground-muted">{detail}</span>
					{/if}
				</Button>
			{:else}
				<p class="py-4 text-sm text-foreground-muted">Specialists appear after the review is planned.</p>
			{/each}
			{#if waitingRoles.length > 0}
				<div class="flex items-center gap-2 px-3 py-2 text-[13px] text-foreground-muted">
					<span class="size-1.5 shrink-0 rounded-full bg-foreground-muted/40"></span>
					<span class="min-w-0 flex-1 truncate">
						{waitingRoles.map((decision) => formatAgentName(decision.role)).join(', ')}
					</span>
					<span class="shrink-0">{waitingRoles.length} waiting</span>
				</div>
			{/if}
		</div>
	</section>
{/snippet}

{#snippet detailContent()}
	<section class="min-w-0" aria-label="Specialist detail">
		{#if selected}
			<Tabs.Root bind:value={tab} variant="segmented">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="flex min-w-0 items-baseline gap-2.5">
						<h2 class="truncate text-base font-semibold">{selected.title}</h2>
						{#if selected.model}
							<span class="truncate font-mono text-[13px] text-foreground-muted">{selected.model}</span>
						{/if}
					</div>
					<Tabs.List>
						<Tabs.Trigger value="reasoning" class={tabTriggerClass}>Reasoning</Tabs.Trigger>
						<Tabs.Trigger value="tools" class={tabTriggerClass}>Tool calls</Tabs.Trigger>
						<Tabs.Trigger value="tasks" class={tabTriggerClass}>Tasks</Tabs.Trigger>
					</Tabs.List>
				</div>

				{#if selectedMeta !== ''}
					<p class="mt-3 font-mono text-[13px] text-foreground-muted">{selectedMeta}</p>
				{/if}

				<Tabs.Content value="reasoning" class="mt-4">
					{#if selectedReasoning.length > 0}
						<div class="flex flex-col gap-4">
							{#each selectedReasoning as entry (entry.id)}
								<p class="whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.text}</p>
							{/each}
						</div>
					{:else}
						<p class="py-3 text-sm text-foreground-muted">
							{active
								? 'Reasoning appears here as the specialist thinks through the change.'
								: 'No reasoning was captured for this specialist.'}
						</p>
					{/if}
				</Tabs.Content>

				<Tabs.Content value="tools" class="mt-4">
					{#if selectedTools.length > 0}
						<div class="mb-2 flex items-baseline justify-between gap-2">
							<h3 class="text-sm font-medium">Tool calls · {selectedTools.length}</h3>
							<span class="text-[12px] text-foreground-muted">Read-only evidence retrieval</span>
						</div>
						<div class="overflow-hidden rounded-[var(--radius-lg)] border border-border">
							<ul class="m-0 flex list-none flex-col divide-y divide-border p-0">
								{#each selectedTools as tool (tool.id)}
									<li class="flex items-center gap-3 px-3 py-2 font-mono text-[13px]">
										{#if tool.status === 'running'}
											<Spinner size={13} class="shrink-0 text-foreground-muted" aria-hidden="true" />
										{:else}
											<span class="shrink-0 text-foreground-muted" aria-hidden="true">$</span>
										{/if}
										<span class="min-w-0 flex-1 break-words" title={tool.summary}>{tool.command}</span>
										{#if tool.status === 'running'}
											<span class="shrink-0 text-[var(--color-info-vivid)]">running</span>
										{:else if tool.status === 'error'}
											<span class="shrink-0 text-error">{tool.exitCode === null ? 'failed' : `exit ${tool.exitCode}`}</span>
										{:else}
											<span class="shrink-0 text-success">{tool.exitCode === null ? 'complete' : `exit ${tool.exitCode}`}</span>
										{/if}
										<span class="w-14 shrink-0 text-right tabular-nums text-foreground-muted">
											{toolDuration(tool)}
										</span>
									</li>
								{/each}
							</ul>
						</div>
					{:else}
						<p class="py-3 text-sm text-foreground-muted">
							{active
								? 'Tool calls appear here as the specialist retrieves evidence.'
								: 'No tool calls were recorded for this specialist.'}
						</p>
					{/if}
				</Tabs.Content>

				<Tabs.Content value="tasks" class="mt-4">
					{#if selectedTasks.length > 0}
						<ul class="m-0 flex list-none flex-col divide-y divide-border p-0">
							{#each selectedTasks as task (task.id)}
								<li class="flex flex-col gap-1 py-2.5">
									<div class="flex flex-wrap items-baseline justify-between gap-2 text-sm">
										<span class="font-medium">{task.label}</span>
										<span class="font-mono text-[12px] text-foreground-muted">
											{task.status}
											{#if task.elapsedMs !== undefined}· {formatMs(task.elapsedMs)}{/if}
										</span>
									</div>
									<p class="break-words text-[13px] {task.status === 'error' ? 'text-error' : 'text-foreground-muted'}">
										{task.message}
									</p>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="py-3 text-sm text-foreground-muted">No tasks recorded for this specialist.</p>
					{/if}
				</Tabs.Content>
			</Tabs.Root>
		{:else}
			<p class="py-4 text-sm text-foreground-muted">
				Select a specialist to see its reasoning, tool calls, and tasks.
			</p>
		{/if}
	</section>
{/snippet}

{#snippet footerContent()}
	{#if coverage || recommendedChecks.length > 0 || pipelineLogs.length > 0}
		<div class="mt-8 flex flex-col gap-4 border-t border-border pt-6">
			{#if coverage}
				<div class="flex flex-col gap-1">
					<p class="text-sm text-foreground-muted">
						{coverage.reviewed} reviewed · {coverage.partial} partial · {coverage.excluded} excluded ·
						{coverage.pending} pending
					</p>
					{#each coverageGaps as gap (gap.hunkId ?? gap.path + gap.reason)}
						<p class="break-all font-mono text-[12px] text-foreground-muted">
							{gap.path}{gap.hunkId ? ` · ${gap.hunkId}` : ''} · {gap.state} · {gap.reason}
						</p>
					{/each}
				</div>
			{/if}
			{#if recommendedChecks.length > 0}
				<section aria-label="Recommended checks">
					<h2 class="mb-2 text-sm font-semibold">Checks recommended but not executed</h2>
					<ul class="list-disc space-y-1 pl-4 text-sm text-foreground-muted">
						{#each recommendedChecks as check (check)}<li>{check}</li>{/each}
					</ul>
				</section>
			{/if}
			<Collapsible.Root bind:open={activityOpen}>
				<div class="flex items-center justify-between gap-2 rounded-[var(--radius-lg)] border border-border px-3 py-2.5">
					<span class="text-sm font-medium">Activity history</span>
					<span class="flex items-center gap-2 text-[13px] text-foreground-muted">
						{plural(pipelineLogs.length, 'event')}
						<Collapsible.Trigger class="flex items-center gap-1 text-[var(--color-info-vivid)] hover:underline hover:underline-offset-4">
							{activityOpen ? 'Collapse' : 'Expand'}
							<ChevronDown size={13} class="transition-transform {activityOpen ? 'rotate-180' : ''}" />
						</Collapsible.Trigger>
					</span>
				</div>
				<Collapsible.Content>
					<ScrollArea class="mt-2 max-h-64" aria-label="Pipeline activity" showCues={false}>
						<div class="space-y-2 pr-2 text-[13px] text-foreground-muted">
							{#each pipelineLogs as line, index (index)}
								<p class="break-words">{line}</p>
							{:else}
								<p>Waiting for the first update.</p>
							{/each}
						</div>
					</ScrollArea>
				</Collapsible.Content>
			</Collapsible.Root>
		</div>
	{/if}

	{#if !active && doneHref}<div class="mt-6"><Button href={doneHref}>Open session</Button></div>{/if}
{/snippet}

{#if fullscreen}
	<div class="flex h-full flex-col overflow-hidden">
		<div class="shrink-0 px-5 pt-5 sm:px-6">
			{@render headerContent()}
			{@render statusContent()}
		</div>
		<div class="flex min-h-0 flex-1">
			<aside class="hidden w-[340px] shrink-0 border-r border-border lg:flex lg:flex-col">
				<ScrollArea class="min-h-0 flex-1" aria-label="Specialist activity" showCues={false}>
					<div class="p-4">{@render activityContent()}</div>
				</ScrollArea>
			</aside>
			<section class="min-w-0 flex-1">
				<ScrollArea class="h-full" aria-label="Specialist detail" showCues={false}>
					<div class="mx-auto w-full max-w-[900px] p-5 sm:p-6">
						<div class="mb-4 lg:hidden">
							<Select.Root value={selected?.id ?? ''} onValueChange={selectAssignment}>
								<Select.Trigger variant="outline" class="w-full justify-between" aria-label="Select specialist">{selected?.title ?? 'Select specialist'}</Select.Trigger>
								<Select.Content>
									{#each assignments as assignment (assignment.id)}<Select.Item value={assignment.id}>{assignment.title}</Select.Item>{/each}
								</Select.Content>
							</Select.Root>
						</div>
						{@render detailContent()}
						{@render footerContent()}
					</div>
				</ScrollArea>
			</section>
		</div>
	</div>
{:else}
	<div class="mx-auto w-full max-w-[1140px] px-4 py-6 sm:px-6 sm:py-8">
		{@render headerContent()}
		{@render statusContent()}
		<div class="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
			{@render activityContent()}
			{@render detailContent()}
		</div>
		{@render footerContent()}
	</div>
{/if}
