<script lang="ts">
	import ListFilter from '@lucide/svelte/icons/list-filter';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Search from '@lucide/svelte/icons/search';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Input } from '@sivir-ui/svelte/components/input';
	import * as Popover from '@sivir-ui/svelte/components/popover';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import { Spinner } from '@sivir-ui/svelte/components/spinner';
	import { Switch } from '@sivir-ui/svelte/components/switch';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { dismissFinding, discussFinding, restoreFinding } from '$lib/findings/finding-actions';
	import { SEVERITIES, findingsStore, type Finding } from '$lib/findings/findings.svelte';
	import { formatAgentName } from '$lib/findings/threads.svelte';
	import { collapse } from '$lib/shell/collapse';
	import SeverityPill from '../ui/severity-pill.svelte';
	import FindingSeverity from './finding-severity.svelte';
	import VerificationBadge from './verification-badge.svelte';

	interface Props {
		/** Findings to list, already filtered and ordered. */
		ranked: Finding[];
		/** The card that shows open. */
		activeId: string | undefined;
		needsYou: number;
		dismissedCount: number;
		/** Search text; the parent filters `ranked` by it. */
		query: string;
	}

	let { ranked, activeId, needsYou, dismissedCount, query = $bindable() }: Props = $props();
</script>

<section class="focus-list" aria-label="Findings that need you">
	<header class="focus-list-head">
		<Typography.Title level={2} class="focus-list-title">Needs you</Typography.Title>
		<span class="focus-list-meta"><span class="font-mono">{needsYou}</span> by severity</span>
		<span class="ms-auto"></span>
		<Popover.Root placement="bottom-end">
			<Popover.Trigger variant="ghost" size="icon" aria-label="Filter by severity"
				><ListFilter size={15} aria-hidden="true" /></Popover.Trigger
			>
			<Popover.Content class="w-auto" surfaceClass="!p-2">
				<Popover.Title class="sr-only">Severities</Popover.Title>
				<div class="flex gap-1.5">
					{#each SEVERITIES as severity (severity)}
						<FindingSeverity
							{severity}
							count={findingsStore.items.filter((item) => item.status !== 'dismissed' && item.severity === severity)
								.length}
							interactive
							pressed={findingsStore.isSeverityShown(severity)}
							onToggle={() => findingsStore.toggleSeverity(severity)}
						/>
					{/each}
				</div>
				<div class="focus-filter-row">
					<Switch
						switched={findingsStore.showDismissed}
						disabled={dismissedCount === 0}
						onclick={() => (findingsStore.showDismissed = !findingsStore.showDismissed)}
						label="Show dismissed"
					/>
					<span class="focus-filter-count">{dismissedCount}</span>
				</div>
			</Popover.Content>
		</Popover.Root>
		<Popover.Root placement="bottom-end">
			<Popover.Trigger variant="ghost" size="icon" aria-label="Search findings"
				><Search size={15} aria-hidden="true" /></Popover.Trigger
			>
			<Popover.Content class="w-72" surfaceClass="!p-2">
				<Popover.Title class="sr-only">Search findings</Popover.Title>
				<Input bind:value={query} placeholder="Search text or file…" aria-label="Search findings" />
			</Popover.Content>
		</Popover.Root>
	</header>
	<ScrollArea class="min-h-0 flex-1" showCues={false} aria-label="Findings">
		<div class="focus-cards">
			{#each ranked as finding, i (finding.id)}
				{@const isActive = finding.id === activeId}
				{@const dismissed = finding.status === 'dismissed'}
				<div class="focus-card-slot" in:collapse out:collapse>
					<Card.Root
						class="focus-card"
						data-active={isActive || undefined}
						data-dismissed={dismissed || undefined}
						{...{ style: `--i: ${i}` }}
					>
						<Button
							unstyled
							class="focus-card-select"
							aria-current={isActive || undefined}
							onclick={() => findingsStore.discuss(finding.id)}
						>
							<span class="focus-card-head">
								{#if dismissed}<SeverityPill tone="info">Dismissed</SeverityPill>{:else}<FindingSeverity
										severity={finding.severity}
									/>{#if finding.verification && finding.status !== 'accepted'}<VerificationBadge
											verification={finding.verification}
										/>{/if}{/if}
								<span class="min-w-0 truncate">{finding.category}</span>
								<span class="focus-card-loc" title="{finding.file}:{finding.startLine}"
									>{finding.file}:{finding.startLine}</span
								>
								{#if findingsStore.suggestions[finding.id]}
									{@const fix = findingsStore.suggestions[finding.id]}
									{@const fixState =
										fix.apply === 'applied' || finding.status === 'accepted'
											? 'fixed'
											: fix.status === 'loading'
												? 'fixing'
												: fix.status === 'ready'
													? 'ready'
													: 'failed'}
									<span class="focus-card-fix" data-state={fixState}
										>{#if fixState === 'fixing'}<Spinner size={10} aria-hidden="true" />{/if}{fixState === 'fixing'
											? 'Fixing'
											: fixState === 'ready'
												? 'Fix ready'
												: fixState === 'fixed'
													? 'Fixed'
													: 'Fix failed'}</span
									>
								{/if}
							</span>
							<span class="focus-card-body ai-voice">{finding.title}</span>
						</Button>
						<div class="focus-card-reveal" inert={!isActive}>
							<div class="focus-card-reveal-clip">
								<div class="focus-card-foot">
									<span class="min-w-0 flex-1 truncate">{formatAgentName(finding.agent)}</span>
									{#if dismissed}
										<Button variant="outline" class="gap-1.5" onclick={() => restoreFinding(finding)}
											><RotateCcw size={14} aria-hidden="true" />Restore</Button
										>
									{:else}
										<Button variant="ghost" onclick={() => dismissFinding(finding)}>Dismiss</Button>
										<Button variant="outline" class="gap-1.5" onclick={() => discussFinding(finding)}
											><MessageSquare size={14} aria-hidden="true" />Discuss</Button
										>
									{/if}
								</div>
							</div>
						</div>
					</Card.Root>
				</div>
			{:else}
				<Typography.Text class="px-1 py-3 text-sm text-fg-muted"
					>{query
						? 'No findings match your search.'
						: 'Nothing needs you. Every finding is fixed, dismissed or filtered out.'}</Typography.Text
				>
			{/each}
		</div>
	</ScrollArea>
</section>
