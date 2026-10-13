<script lang="ts">
	import { page } from '$app/state';
	import ReviewPage from '$lib/components/review/review-page.svelte';
</script>

<svelte:head><title>Review · Recoder</title></svelte:head>

{#key page.params.id}
	<ReviewPage id={page.params.id ?? ''} />
{/key}
