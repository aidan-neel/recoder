<script lang="ts">
	import type { CoverageGap, CoverageSummary, ReviewAssignment } from '@recoder/shared';
	import type { Snippet } from 'svelte';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import FindingSeverity from './finding-severity.svelte';
	import type { ReviewingFinding } from './reviewing-view.svelte';
	import { formatAgentName } from '$lib/threads.svelte';

	interface Props {
		findings: ReviewingFinding[];
		specialists: ReviewAssignment[];
		coverage?: CoverageSummary | null;
		coverageGaps?: CoverageGap[];
		onOpenFinding?: ((finding: ReviewingFinding) => void) | null;
		specialistHref: (assignmentId: string) => string;
		/** Show the Findings / Specialists / Coverage cards (off while the review runs). */
		results?: boolean;
		/** Cards above the results, e.g. live progress. */
		children?: Snippet;
	}
	let { findings, specialists, coverage = null, coverageGaps = [], onOpenFinding = null, specialistHref, results = true, children }: Props = $props();

	const RANK = { high: 0, medium: 1, low: 2, info: 3 } as const;
	const ranked = $derived([...findings].sort((a, b) => RANK[a.severity] - RANK[b.severity]));
	const finished = $derived(specialists.filter((item) => item.status === 'done').length);
	const partialPaths = $derived([...new Set(coverageGaps.filter((gap) => gap.state === 'partial').map((gap) => gap.path))]);
	const partialReason = $derived(coverageGaps.find((gap) => gap.state === 'partial')?.reason);

	function duration(ms?: number): string {
		if (ms === undefined) return '';
		const seconds = Math.max(0, Math.round(ms / 1000));
		return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	}
	const countFor = (role: string) => findings.filter((finding) => finding.agent === role).length;
</script>

<aside class="results-rail" aria-label={results ? 'Review results' : 'Review progress'}>
	<ScrollArea class="h-full" showCues={false} aria-label={results ? 'Review results' : 'Review progress'}>
		<div class="results-rail-body">
			{@render children?.()}
			{#if results}
			<Card.Root class="rail-card">
				<div class="rail-card-head">
					<Typography.Title level={2} class="rail-card-title">Findings</Typography.Title>
					<span class="rail-card-meta">{findings.length}</span>
				</div>
				{#each ranked as finding (finding.id)}
					<Button variant="ghost" class="rail-finding" disabled={!onOpenFinding} onclick={() => onOpenFinding?.(finding)}>
						<FindingSeverity severity={finding.severity} />
						<span class="rail-finding-text">
							<span class="rail-finding-title">{finding.title}</span>
							{#if finding.location}<span class="rail-finding-loc">{finding.location}</span>{/if}
						</span>
					</Button>
				{:else}
					<p class="rail-empty">No findings. Nothing in this pull request needs a change.</p>
				{/each}
			</Card.Root>

			{#if specialists.length}
				<Card.Root class="rail-card">
					<div class="rail-card-head">
						<Typography.Title level={2} class="rail-card-title">Specialists</Typography.Title>
						<span class="rail-card-meta">{finished} finished</span>
					</div>
					{#each specialists as specialist (specialist.id)}
						<Button href={specialistHref(specialist.id)} variant="ghost" class="rail-specialist" title={specialist.title}>
							<span class="rail-dot" data-status={specialist.status} aria-hidden="true"></span>
							<span class="rail-specialist-name">{formatAgentName(specialist.role)}</span>
							<span class="rail-specialist-meta">{[specialist.model, duration(specialist.elapsedMs)].filter(Boolean).join(' · ')}</span>
							<span class="rail-specialist-count" aria-label="{countFor(specialist.role)} findings">{countFor(specialist.role)}</span>
						</Button>
					{/each}
				</Card.Root>
			{/if}

			{#if coverage && coverage.total > 0}
				<Card.Root class="rail-card rail-coverage">
					<div class="rail-card-head">
						<Typography.Title level={2} class="rail-card-title">Coverage</Typography.Title>
						<span class="rail-card-meta">{coverage.reviewed} / {coverage.total} hunks</span>
					</div>
					<div class="coverage-bar" role="img" aria-label="{coverage.reviewed} reviewed, {coverage.partial} partial, {coverage.total - coverage.reviewed - coverage.partial} not reviewed">
						{#if coverage.reviewed}<span data-part="reviewed" style="flex: {coverage.reviewed}"></span>{/if}
						{#if coverage.partial}<span data-part="partial" style="flex: {coverage.partial}"></span>{/if}
						{#if coverage.total - coverage.reviewed - coverage.partial > 0}<span data-part="rest" style="flex: {coverage.total - coverage.reviewed - coverage.partial}"></span>{/if}
					</div>
					<p class="rail-note">
						{#if partialPaths.length}
							{coverage.partial} partial in <code>{partialPaths[0]}</code>{partialPaths.length > 1 ? ` and ${partialPaths.length - 1} more` : ''}.{#if partialReason}{' '}{partialReason}{/if}
						{:else if coverage.reviewed === coverage.total}
							Every changed hunk was reviewed.
						{:else}
							{coverage.total - coverage.reviewed} hunks were not reviewed.
						{/if}
					</p>
				</Card.Root>
			{/if}
			{/if}
		</div>
	</ScrollArea>
</aside>
