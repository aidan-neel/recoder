<script lang="ts">
	import appleTouchIcon from '$web/assets/apple-touch-icon.png';
	import favicon from '$web/assets/favicon.svg';
	import * as Card from '@sivir-ui/svelte/components/card';
	import SiteNav from '$lib/components/site-nav.svelte';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<link rel="apple-touch-icon" href={appleTouchIcon} />
</svelte:head>

<div class="site-shell bg-chrome text-fg">
	<Card.Root class="app-canvas site-card min-w-0 flex-1 gap-0 rounded-[14px] border border-line-canvas bg-canvas p-0 shadow-none">
		<SiteNav />
		<main class="site-main">
			{@render children()}
		</main>
	</Card.Root>
</div>
