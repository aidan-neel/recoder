<script lang="ts">
	import { Button } from '@sivir-ui/svelte/components/button';
	import * as Card from '@sivir-ui/svelte/components/card';
	import * as Typography from '@sivir-ui/svelte/components/typography';
	import { approvePlan, declinePlan } from '$lib/review/plan-approval.svelte';

	/** Asks the developer whether the plan's specialists should run; nothing runs until they answer. */
	let { reviewId, approving }: { reviewId?: string; approving: boolean } = $props();
</script>

<Card.Root class="review-approval">
	<div class="review-approval-text">
		<Typography.Text class="review-approval-title">Run specialists?</Typography.Text>
	</div>
	<div class="review-approval-actions">
		<Button variant="outline" disabled={approving || !reviewId} onclick={() => reviewId && declinePlan(reviewId)}
			>No</Button
		>
		<Button loading={approving} disabled={approving || !reviewId} onclick={() => reviewId && void approvePlan(reviewId)}
			>Yes</Button
		>
	</div>
</Card.Root>
