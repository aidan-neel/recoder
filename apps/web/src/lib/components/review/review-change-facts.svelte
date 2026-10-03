<script lang="ts">
	import type { ReviewingMeta } from '$lib/review/reviewing-view';

	/** The pull request's size on a session's placeholder cards: files changed and lines added and removed. */
	let { meta }: { meta: ReviewingMeta } = $props();
</script>

<div class="focus-empty-facts">
	{#if meta.files !== null}<span><b>{meta.files}</b> {meta.files === 1 ? 'file' : 'files'}</span>{/if}
	{#if meta.additions !== null && meta.deletions !== null}<span
			><b class="text-success">+{meta.additions}</b> <b class="text-danger">−{meta.deletions}</b></span
		>{/if}
</div>
