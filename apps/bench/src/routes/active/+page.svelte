<script lang="ts">
	import { onMount } from 'svelte';
	import * as Alert from '@sivir-ui/svelte/components/alert';
	import { Button } from '@sivir-ui/svelte/components/button';
	import { ScrollArea } from '@sivir-ui/svelte/components/scroll-area';
	import HostCards from '$lib/components/live/host-cards.svelte';
	import RunList from '$lib/components/live/run-list.svelte';
	import { LIVE, poll } from '$lib/live/poll';
	import { settled } from '$lib/live/settled.svelte';

	let { data } = $props();

	onMount(() => poll(LIVE, 5_000));

	const live = settled(() => data.live);
</script>

<ScrollArea class="h-full min-h-0" aria-label="Active runs" showCues={false}>
	<div class="bench-page">
		<div class="bench-head">
			<h1 class="bench-title">Active runs</h1>
			<Button href="/new" variant="outline">New run</Button>
		</div>

		{#if live.error}
			<Alert.Root variant="error"><Alert.Description>{live.error}</Alert.Description></Alert.Root>
		{:else}
			<RunList runs={live.current?.runs} />

			<section class="bench-section">
				<h2 class="bench-section-title">Hosts</h2>
				<HostCards hosts={live.current?.hosts} />
			</section>
		{/if}
	</div>
</ScrollArea>
