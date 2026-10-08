<script lang="ts">
	import appleTouchIcon from '$web/assets/apple-touch-icon.png';
	import favicon from '$web/assets/favicon.svg';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { theme } from '$web/settings/theme.svelte';
	import { onMount } from 'svelte';
	import BenchBar from '$lib/components/shell/bench-bar.svelte';
	import '../app.css';

	let { children } = $props();

	onMount(() => theme.init());
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<link rel="apple-touch-icon" href={appleTouchIcon} />
	<title>Recoder Bench</title>
</svelte:head>

<div class="flex h-dvh flex-col overflow-hidden bg-chrome text-fg">
	<BenchBar />
	<main id="app-canvas" class="flex min-h-0 flex-1 px-2 pb-2">
		<Card.Root
			class="app-canvas min-h-0 min-w-0 flex-1 gap-0 overflow-hidden rounded-[14px] border border-line-canvas bg-canvas p-0 shadow-none"
		>
			{@render children()}
		</Card.Root>
	</main>
</div>
