<script lang="ts">
	import ScanSearch from '@lucide/svelte/icons/scan-search';
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import ReviewChangeFacts from './review-change-facts.svelte';
	import type { ReviewingMeta } from '$lib/review/reviewing-view';
	import { PendingAction } from '$lib/shell/pending-action.svelte';

	/** A new session opens on this card with Run full review until the developer says something. */
	let {
		meta,
		onStartReview,
		onOpenDiff
	}: {
		meta: ReviewingMeta;
		onStartReview: (() => Promise<void>) | null;
		onOpenDiff: (() => void) | null;
	} = $props();

	const start = new PendingAction(() => onStartReview);
</script>

<div class="focus-empty review-intro">
	<div class="focus-empty-card">
		<span class="focus-empty-icon" aria-hidden="true"><ScanSearch size={20} /></span>
		<Typography.Title level={2} class="focus-empty-title">Nothing reviewed yet</Typography.Title>
		<p class="focus-empty-text">Ask about any change, or run the full review and specialists will check every file.</p>
		<ReviewChangeFacts {meta} />
		<div class="focus-empty-actions">
			{#if onStartReview}<Button
					variant="primary"
					loading={start.running}
					disabled={start.running}
					onclick={() => void start.run()}>Run full review</Button
				>{/if}
			{#if onOpenDiff}<Button variant="ghost" onclick={onOpenDiff}>Open diff</Button>{/if}
		</div>
	</div>
</div>
