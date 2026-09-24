<script lang="ts">
	import * as AlertDialog from '@sivir-ui/svelte/components/alert-dialog';
	import { deleteConfirm, deleteSession, isSessionRunning } from '$lib/delete-session.svelte';
	import { recentSessions } from '$lib/recent-sessions.svelte';

	/** Keep the copy while the dialog animates out after `id` clears. */
	let shown = $state<{ label: string; running: boolean }>({ label: 'this session', running: false });
	$effect(() => {
		const id = deleteConfirm.id;
		if (!id) return;
		const review = recentSessions.reviews.find((item) => item.id === id);
		shown = { label: review ? `#${review.prNumber}` : 'this session', running: isSessionRunning(id) };
	});
</script>

<AlertDialog.Root bind:open={() => deleteConfirm.id !== null, (open) => { if (!open) deleteConfirm.id = null; }}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete session {shown.label}?</AlertDialog.Title>
			<AlertDialog.Description>
				{shown.running ? 'The review is still running. Deleting it stops the review and removes' : 'This removes'} its findings, conversation and token usage. This can't be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Exit>Cancel</AlertDialog.Exit>
			<AlertDialog.Confirm
				variant="destructive"
				onclick={() => {
					const id = deleteConfirm.id;
					deleteConfirm.id = null;
					if (id) void deleteSession(id);
				}}>Delete session</AlertDialog.Confirm
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
