<script lang="ts">
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import { Markdown } from '@sivir-ui/svelte/components/markdown';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import FindingSeverity from './finding-severity.svelte';
	import FixButton from './fix-button.svelte';
	import SuggestedFix from './suggested-fix.svelte';
	import SeverityPill from './ui/severity-pill.svelte';
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
	const suggestion = $derived(findingsStore.suggestions[finding.id]);

	function discuss(): void {
		findingsStore.discuss(finding.id);
		threadsStore.open(finding.id);
	}
</script>

<div
	onmouseenter={() => {
		if (!findingsStore.suppressHover) findingsStore.hoveredId = finding.id;
	}}
	onmouseleave={() => (findingsStore.hoveredId = null)}
	role="article"
	aria-label={finding.title}
>
	<Card.Root class="inline-finding" data-focused={focused || undefined} data-state={finding.status}>
		<Collapsible.Root open={!dismissed}>
			{#if dismissed}
				<div class="inline-finding-dismissed">
					<span class="size-1.5 shrink-0 rounded-full" style:background-color={SEVERITY_DOT[finding.severity]}></span>
					<Typography.Metadata class="min-w-0 flex-1 truncate" title={finding.title}>{finding.title}</Typography.Metadata>
					<span class="shrink-0">Dismissed</span>
					<Button variant="ghost" onclick={() => findingsStore.reopen(finding.id)}>Undo</Button>
				</div>
			{:else}
				<div class="inline-finding-head">
					{#if accepted}<SeverityPill tone="success">Fixed</SeverityPill>{:else}<FindingSeverity severity={finding.severity} />{/if}
					<span class="min-w-0 truncate">{finding.category}</span>
					{#if finding.code}<span class="inline-finding-id">{finding.code}</span>{/if}
				</div>
			{/if}
			<Collapsible.Content>
				<Typography.Title level={3} class="sr-only">{finding.title}</Typography.Title>
				<div class="inline-finding-body ai-voice"><Markdown content={finding.body} /></div>
				{#if suggestion?.status === 'ready' && suggestion.patch}<SuggestedFix {suggestion} />{/if}
				<div class="inline-finding-foot">
					<Typography.Metadata class="min-w-0 flex-1 truncate" title={`${finding.category} · ${formatAgentName(finding.agent)}${finding.model ? ` · ${finding.model}` : ''}`}>
						{formatAgentName(finding.agent)}{#if finding.model}<span class="font-mono"> · {finding.model}</span>{/if}
					</Typography.Metadata>
					{#if accepted}
						{#if suggestion?.sha}<span class="font-mono text-[11.5px] text-fg-faint" title="Pushed to {suggestion.branch}">{suggestion.sha.slice(0, 7)}</span>{/if}
						<FixButton {finding} />
					{:else if finding.status === 'open'}
						<Button variant="ghost" class="gap-1.5" aria-expanded={threadsStore.openId === finding.id} aria-controls={threadsStore.openId === finding.id ? 'finding-thread' : undefined} onclick={discuss}>
							<MessageSquare size={14} aria-hidden="true" />Discuss
						</Button>
						<Button variant="ghost" class="text-fg-muted" onclick={() => {
							findingsStore.dismiss(finding.id);
							if (threadsStore.openId === finding.id) threadsStore.close();
						}}>Dismiss</Button>
						<FixButton {finding} />
					{/if}
				</div>
			</Collapsible.Content>
		</Collapsible.Root>
	</Card.Root>
</div>
