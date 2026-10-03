<script lang="ts">
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';

	/** Confirms restarting a review, which opens a fresh session for the same pull request. */
	let { open = $bindable(false), onRestart }: { open?: boolean; onRestart: (() => void) | null } = $props();
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Restart review?</AlertDialog.Title>
			<AlertDialog.Description
				>Open a fresh session for this pull request. Tell the orchestrator what to review when you’re ready.</AlertDialog.Description
			>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Exit>Cancel</AlertDialog.Exit>
			<AlertDialog.Confirm variant="primary" onclick={onRestart ?? undefined}>Restart review</AlertDialog.Confirm>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
