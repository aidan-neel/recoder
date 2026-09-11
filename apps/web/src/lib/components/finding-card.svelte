<script lang="ts">
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import SeverityPill from './severity-pill.svelte';
	import { SEVERITY_DOT, findingsStore, type Finding } from '$lib/findings.svelte';
	import { formatAgentName, threadsStore } from '$lib/threads.svelte';

	interface Props {
		finding: Finding;
	}

	let { finding }: Props = $props();

	const dismissed = $derived(finding.status === 'dismissed');
	const accepted = $derived(finding.status === 'accepted');
	/** Ringed while this is the navigator's current finding. */
	const focused = $derived(findingsStore.activeId === finding.id);

	/** Drives the collapse/expand animation. Derived so external resets stay in sync. */
	const expanded = $derived(!dismissed);
</script>

<div
	class="select-none rounded-lg border border-border bg-card p-3 font-sans {focused
		? 'ring-1 ring-[#5698ff]'
		: ''}"
	onmouseenter={() => {
		if (!findingsStore.suppressHover) findingsStore.hoveredId = finding.id;
	}}
	onmouseleave={() => (findingsStore.hoveredId = null)}
	role="article"
>
	<Collapsible.Root open={expanded}>
		{#if dismissed}
			<div class="flex items-center gap-2 font-mono text-[14px] text-foreground-muted">
				<span
					class="h-1.5 w-1.5 shrink-0 rounded-full"
					style:background-color={SEVERITY_DOT[finding.severity]}
				></span>
				<span>{finding.category}</span>
				<span class="opacity-70">· Dismissed</span>
				<Button
					variant="ghost"
					size="sm"
					class="ml-auto font-sans text-[14px]"
					onclick={() => findingsStore.reopen(finding.id)}
				>
					Undo
				</Button>
			</div>
		{:else}
			<div class="flex items-center gap-2 font-mono text-[14px]">
				<SeverityPill severity={finding.severity} />
			<span class="font-medium">{finding.category}</span>
			<span class="truncate text-foreground-muted">
				{formatAgentName(finding.agent)}{finding.model ? ` · ${finding.model}` : ''}
			</span>
				{#if finding.code}
					<span class="ml-auto shrink-0 font-mono text-foreground-muted">{finding.code}</span>
				{/if}
			</div>
		{/if}
		<Collapsible.Content>
			<div class="mt-1.5 min-w-0">
				<Markdown content={finding.body} />
			</div>
			{#if finding.status === 'open'}
				<div class="mt-2.5 flex items-center gap-1">
					<Button
						variant="primary"
						size="sm"
						class="font-sans text-[14px]"
						aria-expanded={threadsStore.openId === finding.id}
						aria-controls={threadsStore.openId === finding.id ? 'finding-thread' : undefined}
						onclick={() => {
							findingsStore.discuss(finding.id);
							threadsStore.open(finding.id);
						}}
					>
						Discuss finding
					</Button>
					<Button
						variant="secondary"
						size="sm"
						class="font-sans text-[14px]"
						onclick={() => {
							findingsStore.dismiss(finding.id);
							if (threadsStore.openId === finding.id) threadsStore.close();
						}}
					>
						Dismiss
					</Button>
				</div>
			{/if}

			{#if accepted}
				<div class="mt-2 flex items-center gap-2">
			<span
				class="rounded bg-success/15 px-1.5 py-0.5 font-sans text-[13px] font-semibold text-success"
			>
				Fixed
			</span>
			{#if finding.fixedBy}
				<span class="font-mono text-[12px] text-foreground-muted">· {finding.fixedBy}</span>
			{/if}
					<Button
						variant="ghost"
						size="sm"
						class="font-sans text-[14px]"
						onclick={() => findingsStore.reopen(finding.id)}
					>
						Undo
					</Button>
				</div>
			{/if}
		</Collapsible.Content>
	</Collapsible.Root>
</div>
