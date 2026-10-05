<script lang="ts">
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Collapsible from '@sivir-ui/svelte/components/collapsible';
	import ModelMarkdown from '../review/model-markdown.svelte';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import FindingFacets from './finding-facets.svelte';
	import FindingSeverity from './finding-severity.svelte';
	import FixButton from './fix-button.svelte';
	import SuggestedFix from './suggested-fix.svelte';
	import FixStatus from './fix-status.svelte';
	import VerificationBadge from './verification-badge.svelte';
	import { categoryLabel } from '$lib/findings/finding-labels';
	import { SEVERITY_DOT, findingsStore, type Finding } from '$lib/findings/findings.svelte';
	import { formatAgentName, threadsStore } from '$lib/findings/threads.svelte';
	import { modelLabel } from '$lib/settings/model-settings.svelte';

	interface Props {
		finding: Finding;
	}

	let { finding }: Props = $props();

	const dismissed = $derived(finding.status === 'dismissed');
	/** Ringed while this is the navigator's current finding. */
	const focused = $derived(findingsStore.activeId === finding.id);
	const fix = $derived(findingsStore.readyFix(finding));

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
					<Typography.Metadata class="min-w-0 flex-1 truncate" title={finding.title}
						>{finding.title}</Typography.Metadata
					>
					<span class="shrink-0">Dismissed</span>
					<Button variant="ghost" onclick={() => findingsStore.reopen(finding.id)}>Undo</Button>
				</div>
			{:else}
				<div class="inline-finding-head">
					<FindingSeverity severity={finding.severity} />
					{#if finding.verification}<VerificationBadge verification={finding.verification} />{/if}
					<FindingFacets {finding} class="min-w-0" />
					{#if finding.code}<span class="inline-finding-id">{finding.code}</span>{/if}
				</div>
			{/if}
			<Collapsible.Content>
				<Typography.Title level={3} class="sr-only">{finding.title}</Typography.Title>
				<div class="inline-finding-body ai-voice"><ModelMarkdown content={finding.body} /></div>
				<FixStatus {finding} />
				{#if fix}<SuggestedFix suggestion={fix} />{/if}
				<div class="inline-finding-foot">
					<Typography.Metadata
						class="min-w-0 flex-1 truncate"
						title={`${categoryLabel(finding.category)} · ${formatAgentName(finding.agent)}${finding.model ? ` · ${finding.model}` : ''}`}
					>
						{formatAgentName(finding.agent)}{#if finding.model}<span> · {modelLabel(finding.model)}</span>{/if}
					</Typography.Metadata>
					{#if finding.status === 'open'}
						<Button
							variant="ghost"
							class="gap-1.5"
							aria-expanded={threadsStore.openId === finding.id}
							aria-controls={threadsStore.openId === finding.id ? 'finding-thread' : undefined}
							onclick={discuss}
						>
							<MessageSquare size={14} aria-hidden="true" />Discuss
						</Button>
						<Button
							variant="ghost"
							class="text-fg-muted"
							onclick={() => {
								findingsStore.dismiss(finding.id);
								if (threadsStore.openId === finding.id) threadsStore.close();
							}}>Dismiss</Button
						>
						<FixButton {finding} />
					{/if}
				</div>
			</Collapsible.Content>
		</Collapsible.Root>
	</Card.Root>
</div>
