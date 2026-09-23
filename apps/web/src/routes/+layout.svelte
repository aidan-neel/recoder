<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import * as Card from '@sivir-ui/svelte/components/card';
	import { Toaster } from '@sivir-ui/svelte/components/toast';
	import CommandPalette from '$lib/components/command-palette.svelte';
	import ModelSettingsModal from '$lib/components/model-settings-modal.svelte';
	import UsageModal from '$lib/components/usage-modal.svelte';
	import TopBar from '$lib/components/top-bar.svelte';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Recoder</title>
	<meta
		name="description"
		content="Recoder is a self-hosted, OpenCode-style pull request reviewer you run with Docker."
	/>
</svelte:head>

<div class="flex h-dvh flex-col overflow-hidden bg-chrome text-fg">
	<TopBar />
	<main id="app-canvas" class="flex min-h-0 flex-1 px-2 pb-2" data-route={page.route.id}>
		<Card.Root class="app-canvas min-h-0 min-w-0 flex-1 gap-0 overflow-hidden rounded-[14px] border border-line-canvas bg-canvas p-0 shadow-none">
			{@render children()}
		</Card.Root>
	</main>
	<ModelSettingsModal />
	<UsageModal />
	<CommandPalette />
	<Toaster />
</div>
