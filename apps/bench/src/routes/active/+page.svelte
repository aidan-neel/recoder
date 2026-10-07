<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import HostCards from '$lib/components/live/host-cards.svelte';
	import RunList from '$lib/components/live/run-list.svelte';
	import { LIVE, poll } from '$lib/live/poll';

	let { data } = $props();

	onMount(() => poll(LIVE, 5_000));
</script>

<ScrollArea class="h-full min-h-0" aria-label="Active runs" showCues={false}>
	<div class="bench-page">
		<div class="bench-head">
			<h1 class="bench-title">Active runs</h1>
			<Button href="/new" variant="outline">New run</Button>
		</div>

		<RunList runs={data.runs} />

		<section class="bench-section">
			<h2 class="bench-section-title">Hosts</h2>
			<HostCards hosts={data.hosts} />
		</section>
	</div>
</ScrollArea>
