<script lang="ts">
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import type { Finding } from '$lib/findings/findings.svelte';
	import { applyReadyFixes } from '$lib/findings/fixes';

	/** Confirms applying every ready fix to the review checkout. */
	let { open = $bindable(false), ready }: { open?: boolean; ready: Finding[] } = $props();

	const label = $derived(`Apply ${ready.length} ${ready.length === 1 ? 'fix' : 'fixes'}`);
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{label}?</AlertDialog.Title>
			<AlertDialog.Description
				>Each fix is applied to the review checkout. Nothing is committed or pushed until you do it from Changes.</AlertDialog.Description
			>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Exit>Cancel</AlertDialog.Exit>
			<AlertDialog.Confirm
				variant="primary"
				onclick={() => {
					open = false;
					void applyReadyFixes(ready);
				}}>{label}</AlertDialog.Confirm
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
