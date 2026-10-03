<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Check from '@lucide/svelte/icons/check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import FindingSeverity from '../findings/finding-severity.svelte';
	import type { ReviewingFinding, ReviewingMeta } from '$lib/review/reviewing-view';

	/** The finished review's summary card. Findings is the review's main page; the diff is one click from there. */
	let {
		findings,
		meta,
		failed,
		onShowView,
		onOpenDiff
	}: {
		findings: ReviewingFinding[];
		meta: ReviewingMeta;
		/** Units and subagents that ended without a result. */
		failed: { units: number; subagents: number };
		onShowView: ((view: 'findings' | 'diff') => void | Promise<void>) | null;
		onOpenDiff: (() => void) | null;
	} = $props();

	const failedLabel = $derived(
		[
			failed.units ? `${failed.units} ${failed.units === 1 ? 'unit' : 'units'}` : '',
			failed.subagents ? `${failed.subagents} ${failed.subagents === 1 ? 'subagent' : 'subagents'}` : ''
		]
			.filter(Boolean)
			.join(' and ')
	);

	const findingCounts = $derived(
		(['high', 'medium', 'low'] as const)
			.map((severity) => ({ severity, count: findings.filter((finding) => finding.severity === severity).length }))
			.filter((item) => item.count > 0)
	);
</script>

<Card.Root class="review-result">
	<span class="review-result-mark" data-warn={!!failedLabel || undefined} aria-hidden="true"
		>{#if failedLabel}<CircleAlert size={14} strokeWidth={2.25} />{:else}<Check
				size={14}
				strokeWidth={2.25}
			/>{/if}</span
	>
	<div class="review-result-text">
		<Typography.Text class="review-result-title">Review finished</Typography.Text>
		<Typography.Metadata class="review-result-meta"
			>{findings.length
				? `${findings.length} ${findings.length === 1 ? 'finding' : 'findings'}`
				: 'No findings'}{meta.elapsed ? ` · ${meta.elapsed}` : ''}{meta.files !== null
				? ` · ${meta.files} ${meta.files === 1 ? 'file' : 'files'}`
				: ''}{#if failedLabel}{' · '}<span class="review-result-failed">{failedLabel} failed</span
				>{/if}</Typography.Metadata
		>
		{#if findingCounts.length}
			<div class="review-result-pills" aria-label="Findings by severity">
				{#each findingCounts as item (item.severity)}<FindingSeverity
						severity={item.severity}
						count={item.count}
					/>{/each}
			</div>
		{/if}
	</div>
	<Button
		onclick={onShowView ? () => void onShowView('findings') : (onOpenDiff ?? undefined)}
		disabled={!onShowView && !onOpenDiff}
		class="shrink-0 gap-2">Open findings <ArrowUpRight size={14} aria-hidden="true" /></Button
	>
</Card.Root>
