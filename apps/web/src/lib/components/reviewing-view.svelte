<script lang="ts" module>
	export interface ReviewingAgent {
		id: string;
		name: string;
		model: string | null;
		status: 'queued' | 'running' | 'done';
		progress: number;
		findings: number;
		logs: string[];
		/** Right-hand meta for finished agents, e.g. `done · 2 findings · 0:31`. */
		doneMeta: string | null;
	}

	export interface ReviewingFinding {
		id: string;
		agent: string | null;
		severity: 'high' | 'medium' | 'low' | 'info';
		title: string;
		location: string | null;
	}

	export interface ReviewingMeta {
		prLabel: string;
		repo: string;
		files: number | null;
		additions: number | null;
		deletions: number | null;
		elapsed: string;
	}
</script>

<script lang="ts">
	import Circle from '@lucide/svelte/icons/circle';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import SeverityPill from './severity-pill.svelte';

	interface Props {
		title: string;
		meta: ReviewingMeta;
		agents: ReviewingAgent[];
		findings: ReviewingFinding[];
		pendingCount: number;
		onOpenDiff: (() => void) | null;
		onRestart: (() => void) | null;
		/** Shown once every agent is done (sandbox use). */
		doneHref?: string | null;
	}

	let {
		title,
		meta,
		agents,
		findings,
		pendingCount,
		onOpenDiff,
		onRestart,
		doneHref = null
	}: Props = $props();

	const doneCount = $derived(agents.filter((a) => a.status === 'done').length);
	const allDone = $derived(agents.length > 0 && doneCount === agents.length);
</script>

<div class="mx-auto w-full max-w-5xl px-4 py-8">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<h1 class="truncate text-2xl font-semibold tracking-tight">{title}</h1>
			<p class="mt-1 truncate font-mono text-[13px] text-foreground-muted">
				{#if meta.prLabel !== ''}<span>PR {meta.prLabel} · </span>{/if}<span>{meta.repo}</span>
				{#if meta.files !== null}
					<span> · {meta.files} files</span>
				{/if}
				{#if meta.additions !== null}
					<span> · </span><span class="text-success">+{meta.additions}</span>
				{/if}
				{#if meta.deletions !== null}
					<span> </span><span class="text-error">−{meta.deletions}</span>
				{/if}
				<span> · {meta.elapsed} elapsed</span>
			</p>
		</div>
		<div class="flex shrink-0 items-center gap-2 pt-1">
			{#if onOpenDiff}
				<Button variant="outline" size="sm" class="font-sans" onclick={onOpenDiff}>
					Open partial diff
				</Button>
			{/if}
			{#if onRestart}
				<Button
					variant="ghost"
					size="icon"
					aria-label="Restart review"
					title="Restart review"
					onclick={onRestart}
				>
					<RotateCw size={15} />
				</Button>
			{/if}
		</div>
	</div>

	<div class="mt-6 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
		<div class="grid min-w-0 gap-3">
			{#each agents as agent (agent.id)}
				{#if agent.status === 'running'}
					{@const shown = agent.logs.slice(-4)}
					<div class="relative rounded-xl border border-border bg-card">
						<div class="py-3 pr-6 pl-4">
							<div class="flex items-center gap-2.5">
								<Spinner size={14} aria-hidden="true" />
								<span class="text-[15px] font-semibold">{agent.name}</span>
								{#if agent.model}
									<span class="truncate font-mono text-[12px] text-foreground-muted">
										{agent.model}
									</span>
								{/if}
								<span class="ml-auto shrink-0 font-mono text-[13px] text-foreground-muted">
									{agent.findings} finding{agent.findings === 1 ? '' : 's'} · {Math.round(
										agent.progress
									)}%
								</span>
							</div>
							<div class="mt-2.5 font-mono text-[13px] leading-relaxed">
								{#if shown.length === 0}
									<p class="m-0 truncate text-foreground-muted">
										<span class="opacity-60">Starting…</span>
									</p>
								{:else}
									{#each shown as line, i (i)}
										<p
											class="m-0 truncate {i === shown.length - 1
												? 'text-foreground'
												: 'text-foreground-muted opacity-70'}"
										>
											{line}{#if i === shown.length - 1}<span
													aria-hidden="true"
													class="motion-safe:animate-pulse">█</span
												>{/if}
										</p>
									{/each}
								{/if}
							</div>
						</div>
						<div
							aria-hidden="true"
							class="absolute top-3 right-3 bottom-3 w-[3px]"
						>
							<div
								class="w-full rounded-full bg-primary transition-[height]"
								style:height={`${Math.round(agent.progress)}%`}
							></div>
						</div>
					</div>
				{:else}
					<div class="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3">
						{#if agent.status === 'done'}
							<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
						{:else}
							<span class="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground-muted/40"></span>
						{/if}
						<span class="text-[15px] font-semibold">{agent.name}</span>
						{#if agent.model}
							<span class="truncate font-mono text-[12px] text-foreground-muted">
								{agent.model}
							</span>
						{/if}
						<span class="ml-auto shrink-0 font-mono text-[13px] text-foreground-muted">
							{agent.status === 'done' ? (agent.doneMeta ?? 'done') : 'queued'}
						</span>
					</div>
				{/if}
			{/each}
		</div>

		<aside class="min-w-0 rounded-xl border border-border bg-card" aria-label="Findings so far">
			<div class="flex items-center justify-between px-4 py-3">
				<h2 class="text-[15px] font-medium">Findings so far</h2>
				<span class="font-mono text-[13px] text-foreground-muted">{findings.length}</span>
			</div>
			{#if findings.length > 0}
				<div class="divide-y divide-border border-t border-border">
					{#each findings as finding (finding.id)}
						<div class="px-4 py-3">
							<p class="m-0 flex items-center gap-2">
								<SeverityPill severity={finding.severity} />
								<span class="truncate font-mono text-[12px] text-foreground-muted">
									{#if finding.agent}{finding.agent} · {/if}{finding.id}
								</span>
							</p>
							<p class="m-0 mt-1.5 text-[15px] font-semibold tracking-tight">{finding.title}</p>
							{#if finding.location}
								<p class="m-0 mt-0.5 truncate font-mono text-[13px] text-foreground-muted">
									{finding.location}
								</p>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<p class="m-0 border-t border-border px-4 py-3 text-[14px] text-foreground-muted">
					No findings yet.
				</p>
			{/if}
			{#if pendingCount > 0}
				<div
					class="flex items-center gap-2 border-t border-border px-4 py-3 text-[13px] text-foreground-muted"
				>
					<Circle size={13} aria-hidden="true" />
					<span>{pendingCount} agent{pendingCount === 1 ? '' : 's'} still writing…</span>
				</div>
			{/if}
		</aside>
	</div>

	{#if allDone && doneHref}
		<div class="mt-6 flex justify-center">
			<Button href={doneHref} class="font-sans">Open session</Button>
		</div>
	{/if}
</div>
