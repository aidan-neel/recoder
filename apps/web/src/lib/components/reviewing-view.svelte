<script lang="ts" module>
	import type { CoverageGap, CoverageSummary, ReviewAssignment, ReviewTask } from '@recoder/shared';
	export interface ReviewingFinding {
		id: string;
		agent: string | null;
		severity: 'high' | 'medium' | 'low' | 'info';
		title: string;
		location: string | null;
		confirmed?: boolean;
	}
	export interface ReviewingMeta {
		prLabel: string; repo: string; files: number | null;
		additions: number | null; deletions: number | null; elapsed: string;
	}
	export type { ReviewAssignment };
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
	import { formatAssignmentHeadline } from '@recoder/shared';
	import SeverityPill from './severity-pill.svelte';
	import ReviewMetricsModal from './review-metrics-modal.svelte';

	interface Props {
		reviewId?: string;
		title: string; meta: ReviewingMeta;
		assignments?: ReviewAssignment[];
		findings: ReviewingFinding[]; pendingCount: number;
		onOpenDiff: (() => void) | null; onRestart: (() => void) | null;
		doneHref?: string | null; pipelineLogs?: string[];
		stage?: number; stageLabel?: string; stageDetail?: string; failed?: boolean; errorMessage?: string | null;
		connectionLabel?: string; connectionLost?: boolean;
		headline?: string;
		planSummary?: string | null;
		candidateCount?: number;
		confirmed?: boolean;
		coverage?: CoverageSummary | null;
		coverageGaps?: CoverageGap[];
		recommendedChecks?: string[];
		now?: number; active?: boolean;
		tasks?: ReviewTask[];
	}
	let {
		reviewId,
		title, meta, assignments = [], findings, pendingCount, onOpenDiff, onRestart,
		doneHref = null, pipelineLogs = [], stage = 0, stageLabel = 'Preparing review', stageDetail,
		failed = false, errorMessage = null, connectionLabel = '', connectionLost = false,
		headline = '', planSummary = null, candidateCount = 0, confirmed = false,
		coverage = null, coverageGaps = [], recommendedChecks = [],
		now = Date.now(), active = true, tasks = []
	}: Props = $props();
	const steps = [
		{ id: 'checkout', label: 'Checkout' },
		{ id: 'understand', label: 'Understand changes' },
		{ id: 'specialists', label: 'Specialist review' },
		{ id: 'consolidation', label: 'Consolidation' }
	];
	function statusLabel(status: ReviewAssignment['status']): string {
		return {
			queued: 'Queued',
			waiting: 'Waiting for a model',
			running: 'Active',
			done: 'Complete',
			partial: 'Partial',
			error: 'Failed',
			skipped: 'Skipped'
		}[status];
	}
	function assignmentTime(assignment: ReviewAssignment): string {
		const start = Date.parse(assignment.startedAt ?? assignment.queuedAt ?? '');
		const end = assignment.completedAt ? Date.parse(assignment.completedAt) : now;
		const running = ['running', 'waiting', 'queued'].includes(assignment.status) && active;
		const elapsed = Number.isFinite(start) && (assignment.completedAt || running)
			? Math.max(0, end - start) : (assignment.elapsedMs ?? 0);
		if (!Number.isFinite(elapsed) || elapsed < 0) return '';
		return Math.floor(elapsed / 60000) + ':' + String(Math.floor(elapsed / 1000) % 60).padStart(2, '0');
	}
	function taskTime(task: ReviewTask): string {
		const elapsed = (task.elapsedMs ?? 0) + ((task.status === 'running' || task.status === 'queued' || task.status === 'waiting') && active
			? Math.max(0, now - Date.parse(task.updatedAt)) : 0);
		return Math.floor(elapsed / 60000) + ':' + String(Math.floor(elapsed / 1000) % 60).padStart(2, '0');
	}
	const displayHeadline = $derived(headline || formatAssignmentHeadline(assignments));
	const completeCount = $derived(assignments.filter((assignment) => assignment.status === 'done').length);
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
		<div class="flex flex-wrap items-center gap-2">
			{#if reviewId}<ReviewMetricsModal {reviewId} />{/if}
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
		{#if planSummary}<p class="mt-3 text-sm text-foreground-muted">{planSummary}</p>{/if}
		{#if assignments.length > 0}
			<div class="mt-4 flex flex-wrap justify-between gap-2 text-sm text-foreground-muted">
				<p>{displayHeadline}</p>
			</div>
			<Progress class="mt-2" value={completeCount} max={Math.max(assignments.length, 1)} {...{ 'aria-label': 'Completed specialist assignments' }} />
		{:else}
			<p class="mt-3 text-sm text-foreground-muted">Review starts once the local checkout and inventory are ready.</p>
		{/if}
	</section>

	<div class="grid items-start gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
		<section class="min-w-0 lg:col-start-2 lg:row-start-1" aria-label="Specialist assignments">
			<div class="mb-3 flex items-baseline justify-between gap-3">
				<h2 class="text-base font-semibold">Specialists</h2>
				<span class="text-sm text-foreground-muted">{assignments.length} assignment{assignments.length === 1 ? '' : 's'}</span>
			</div>
			<div class="divide-y divide-border border-y border-border">
				{#each assignments as assignment (assignment.id)}
					{@const childTasks = tasks.filter((task) => task.assignmentId === assignment.id)}
					<Collapsible.Root open={assignment.status === 'running' || assignment.status === 'waiting'}>
						<div class="min-w-0 py-1">
							<Collapsible.Trigger class="group flex w-full items-start gap-3 rounded-md px-2 py-4 text-left hover:bg-secondary/50">
								<span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
									{#if assignment.status === 'running' || assignment.status === 'waiting'}<Spinner size={16} aria-hidden="true" />
									{:else if assignment.status === 'done'}<Check size={16} class="text-success" />
									{:else if assignment.status === 'error' || assignment.status === 'partial'}<CircleAlert size={16} class={assignment.status === 'error' ? 'text-error' : 'text-warning'} />
									{:else}<span class="h-1.5 w-1.5 rounded-full bg-foreground-muted"></span>{/if}
								</span>
								<span class="min-w-0 flex-1">
									<span class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
										<span class="font-medium">{assignment.title}</span>
										<span class="text-xs {assignment.status === 'error' ? 'text-error' : 'text-foreground-muted'}">
											{statusLabel(assignment.status)}{#if assignmentTime(assignment)} · <span class="font-mono tabular-nums">{assignmentTime(assignment)}</span>{/if}
										</span>
									</span>
									<span class="mt-1 block text-sm text-foreground-muted">{formatAgentName(assignment.role)}{#if assignment.followUp} · follow-up{/if}</span>
									<span class="mt-1 block break-words text-sm text-foreground-muted">{assignment.currentOperation ?? assignment.reason}</span>
									<span class="mt-1.5 block text-xs text-foreground-muted">
										{assignment.scope.map((entry) => entry.path).join(', ') || 'No scoped files'}
										{#if assignment.candidateCount} · {assignment.candidateCount} candidate{assignment.candidateCount === 1 ? '' : 's'}{/if}
									</span>
								</span>
								<ChevronDown size={16} class="mt-1 shrink-0 text-foreground-muted group-data-[state=open]:rotate-180" />
							</Collapsible.Trigger>
							<Collapsible.Content class="pb-4 pl-10 pr-2">
								<p class="mb-3 text-sm text-foreground-muted">{assignment.reason}</p>
								{#if assignment.model}<p class="mb-3 break-all font-mono text-xs text-foreground-muted">{assignment.model}</p>{/if}
								{#if assignment.questions?.length}
									<ul class="mb-3 list-disc space-y-1 pl-4 text-sm text-foreground-muted">
										{#each assignment.questions as question (question)}<li>{question}</li>{/each}
									</ul>
								{/if}
								{#if childTasks.length}
									<ul class="space-y-3" aria-label={assignment.title + ' operations'}>
										{#each childTasks as task (task.id)}
											<li class="border-l-2 border-border pl-3">
												<div class="flex flex-wrap justify-between gap-2 text-sm">
													<span class="font-medium">{task.label}</span>
													<span class="text-foreground-muted">
														{task.status === 'queued' || task.status === 'waiting' ? (task.status === 'waiting' ? 'Waiting for a model' : 'Queued') : task.status === 'running' ? 'Working' : task.status === 'done' ? 'Complete' : task.status === 'partial' ? 'Partial' : task.status === 'skipped' ? 'Skipped' : 'Failed'}
														{#if task.elapsedMs !== undefined}<span class="ml-2 font-mono tabular-nums">{taskTime(task)}</span>{/if}
													</span>
												</div>
												<p class="mt-1 break-words text-sm {task.status === 'error' ? 'text-error' : 'text-foreground-muted'}">{task.message}</p>
												{#if task.currentFile}<p class="mt-1 break-all font-mono text-xs text-foreground-muted">{task.currentFile}</p>{/if}
											</li>
										{/each}
									</ul>
								{/if}
							</Collapsible.Content>
						</div>
					</Collapsible.Root>
				{:else}
					<p class="py-4 text-sm text-foreground-muted">{pendingCount ? 'Waiting for specialist assignments.' : 'Specialists appear after the review is planned.'}</p>
				{/each}
			</div>
		</section>
		<aside class="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
			<section aria-label="Review stages">
				<h2 class="mb-3 text-sm font-semibold">Review stages</h2>
				<TaskSteps {steps} current={stage} {failed} label="Review stages" />
			</section>
			<Collapsible.Root>
				<Collapsible.Trigger class="group flex w-full justify-between gap-2 py-2 text-sm font-medium">
					Coverage and exclusions <ChevronDown size={14} class="group-data-[state=open]:rotate-180" />
				</Collapsible.Trigger>
				<Collapsible.Content>
					{#if coverage}
						<p class="py-2 text-sm text-foreground-muted">
							{coverage.reviewed} reviewed · {coverage.partial} partial · {coverage.excluded} excluded · {coverage.pending} pending
						</p>
					{:else}
						<p class="py-2 text-sm text-foreground-muted">Coverage is recorded as specialists finish.</p>
					{/if}
					{#each coverageGaps as gap (gap.hunkId ?? gap.path + gap.reason)}
						<p class="break-all py-1 font-mono text-xs text-foreground-muted">{gap.path}{gap.hunkId ? ` · ${gap.hunkId}` : ''} · {gap.state} · {gap.reason}</p>
					{/each}
				</Collapsible.Content>
			</Collapsible.Root>
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
			<section aria-label="Findings" class="border-t border-border pt-5">
				<h2 class="mb-3 flex justify-between text-sm font-semibold">
					{confirmed ? 'Confirmed findings' : active ? 'Findings so far' : 'Unconfirmed findings'}
					<span class="font-mono">{confirmed || !active ? findings.length : candidateCount}</span>
				</h2>
				{#if !confirmed && active}
					<p class="mb-3 text-sm text-foreground-muted">
						{candidateCount} candidate{candidateCount === 1 ? '' : 's'} (unconfirmed until consolidation).
					</p>
				{:else if !confirmed && !active && findings.length}
					<p class="mb-3 text-sm text-foreground-muted">
						These candidates were not confirmed. This is not evidence the PR is clean.
					</p>
				{/if}
				{#if confirmed || (!active && findings.length)}
					{#each findings as finding (finding.id)}
						<div class="space-y-2 border-b border-border py-3">
							<SeverityPill severity={finding.severity} />
							<p class="break-words text-sm">{finding.title}</p>
							{#if finding.location}<p class="break-all font-mono text-xs text-foreground-muted">{finding.location}</p>{/if}
						</div>
					{:else}
						<p class="text-sm leading-relaxed text-foreground-muted">No confirmed findings. This is not a merge approval or a correctness guarantee.</p>
					{/each}
				{/if}
			</section>
			{#if recommendedChecks.length}
				<section aria-label="Recommended checks" class="border-t border-border pt-5">
					<h2 class="mb-3 text-sm font-semibold">Checks recommended but not executed</h2>
					<ul class="list-disc space-y-1 pl-4 text-sm text-foreground-muted">
						{#each recommendedChecks as check (check)}<li>{check}</li>{/each}
					</ul>
				</section>
			{/if}
		</aside>
	</div>
	{#if !active && doneHref}<div class="mt-6"><Button href={doneHref}>Open session</Button></div>{/if}
</div>
