<script lang="ts">
	import ReviewMetricsModal from './review-metrics-modal.svelte';
	import PrChecks from '../home/pr-checks.svelte';

	/** The session header's far right, beside the menu: token usage, then the PR's checks. */
	let { reviewId, checks }: { reviewId: string; checks: boolean } = $props();
</script>

<ReviewMetricsModal {reviewId} />
{#if checks}<PrChecks {reviewId} />{/if}
