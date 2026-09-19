<script lang="ts">
	import { Button } from '@sivir-ui/svelte/components/button';
	import { Badge } from '@sivir-ui/svelte/components/badge';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import FindingSeverity from './finding-severity.svelte';
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
	onmouseenter={() => {
		if (!findingsStore.suppressHover) findingsStore.hoveredId = finding.id;
	}}
	onmouseleave={() => (findingsStore.hoveredId = null)}
	role="article"
	aria-label={finding.title}
>
	<Card.Root
		class="max-w-4xl rounded-xl border border-border bg-card/50 !p-3 font-sans shadow-none {focused
			? 'ring-1 ring-ring'
			: ''}"
	>
	<Collapsible.Root open={expanded}>
		{#if dismissed}
			<div class="flex min-w-0 items-center gap-2 text-sm text-foreground-muted">
				<span
					class="h-1.5 w-1.5 shrink-0 rounded-full"
					style:background-color={SEVERITY_DOT[finding.severity]}
				></span>
				<Typography.Metadata class="min-w-0 truncate text-sm" title={finding.title}>{finding.title}</Typography.Metadata>
				<span class="shrink-0 text-xs">Dismissed</span>
				<Button
					variant="ghost"
					class="ml-auto font-sans text-[14px]"
					onclick={() => findingsStore.reopen(finding.id)}
				>
					Undo
				</Button>
			</div>
		{:else}
			<div class="flex items-start gap-2 text-sm">
				<FindingSeverity severity={finding.severity} />
				<Typography.Title level={3} class="min-w-0 text-sm !font-medium leading-5 tracking-normal" title={finding.title}>{finding.title}</Typography.Title>
			</div>
		{/if}
		<Collapsible.Content>
			<div class="mt-2 min-w-0 text-sm">
				<Markdown content={finding.body} class="text-sm" />
			</div>
			<div class="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
			<Typography.Metadata class="min-w-0 truncate text-xs" title={`${finding.category} · ${formatAgentName(finding.agent)}${finding.model ? ` · ${finding.model}` : ''}`}>{formatAgentName(finding.agent)}{finding.model ? ` · ${finding.model}` : ''}</Typography.Metadata>
			{#if finding.status === 'open'}
				<div class="flex items-center gap-1">
					<Button
						variant="outline"
						class="bg-transparent !px-2.5 font-sans text-xs !font-normal"
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
						variant="ghost"
						class="!px-2.5 font-sans text-xs !font-normal text-foreground-muted"
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
				<div class="flex items-center gap-2">
			<Badge variant="success">Fixed</Badge>
			{#if finding.fixedBy}
				<span class="font-mono text-[12px] text-foreground-muted">· {finding.fixedBy}</span>
			{/if}
					<Button
						variant="ghost"
						class="font-sans text-[14px]"
						onclick={() => findingsStore.reopen(finding.id)}
					>
						Undo
					</Button>
				</div>
			{/if}
			</div>
		</Collapsible.Content>
	</Collapsible.Root>
	</Card.Root>
</div>
