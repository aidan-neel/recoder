<script lang="ts">
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { cancelDeclinedReview, planApproval } from '$lib/plan-approval.svelte';
</script>

<AlertDialog.Root bind:open={() => planApproval.declining !== null, (open) => { if (!open) planApproval.declining = null; }}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Stop the review?</AlertDialog.Title>
			<AlertDialog.Description>No specialists will run, so this review won't produce any findings.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Exit>Back</AlertDialog.Exit>
			<AlertDialog.Confirm
				variant="destructive"
				onclick={() => {
					const id = planApproval.declining;
					planApproval.declining = null;
					if (id) void cancelDeclinedReview(id);
				}}>Stop review</AlertDialog.Confirm
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
